import "multer";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AiClient } from "../../common/ai.client";
import { AuthUser, CurrentUser } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";

interface TwinCheck {
  ok: boolean;
  checks: Record<string, { pass: boolean; note: string }>;
  estimated_size: string;
  height_ratio: number;
}

export const PERSONA_COUNT = 5;

/** Persistent photo twin (CR-02, US-06.1). Bytes are AES-256-GCM encrypted; never exposed to makers. */
@Injectable()
export class TwinService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private consent: ConsentService,
  ) {}

  current(userId: string) {
    return this.prisma.twin.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } });
  }

  /** Image used for rendering: the user's twin, or a synthetic AI model when there is none. */
  async renderSource(userId: string, persona = 2): Promise<{ image: Buffer; twinKey: string; version: number; onTwin: boolean }> {
    const twin = await this.current(userId);
    if (twin) {
      return { image: await this.storage.readEncrypted(twin.encPath, twin.iv, twin.authTag), twinKey: twin.id, version: twin.version, onTwin: true };
    }
    return { image: await this.persona(persona), twinKey: `persona-${persona}`, version: 0, onTwin: false };
  }

  persona(n: number) {
    const i = Math.min(Math.max(1, Math.round(n)), PERSONA_COUNT);
    return readFile(join(this.storage.root, "personas", `persona-${i}.png`));
  }

  check(image: Buffer) {
    return this.ai.post<TwinCheck>("/v1/twin/check", { image_b64: image.toString("base64") });
  }

  async create(userId: string, image: Buffer, mime: string, locale: string) {
    const check = await this.check(image);
    if (!check.ok) {
      const failed = Object.values(check.checks).filter((c) => !c.pass).map((c) => c.note);
      throw new BadRequestException({ message: "Let's retake that photo", checks: check.checks, failed });
    }
    const consent = await this.consent.record(userId, "TWIN_PROCESSING", true, locale);
    await this.consent.record(userId, "TRYON_GENERATION", true, locale);
    const previous = await this.current(userId);
    const version = (previous?.version ?? 0) + 1;
    const encPath = `private/twins/${userId}/v${version}.enc`;
    const { iv, authTag } = await this.storage.putEncrypted(encPath, image);
    if (previous) await this.purge(previous.id);
    return this.prisma.twin.create({
      data: { userId, version, encPath, iv, authTag, mime, size: check.estimated_size, checks: check.checks, consentId: consent.id },
    });
  }

  /** Remove twin bytes and every look rendered from it (storage + DB). */
  async purge(twinId: string) {
    const twin = await this.prisma.twin.findUnique({ where: { id: twinId } });
    if (!twin) return 0;
    await this.storage.remove(twin.encPath);
    const gens = await this.prisma.generation.findMany({ where: { userId: twin.userId, twinVersion: twin.version, cacheKey: { contains: twin.id } } });
    for (const g of gens) if (g.outputPath) await this.storage.remove(g.outputPath);
    await this.prisma.generation.deleteMany({ where: { id: { in: gens.map((g) => g.id) } } });
    await this.prisma.twin.update({ where: { id: twinId }, data: { deletedAt: new Date(), encPath: "" } });
    return gens.length;
  }
}

@Controller("twin")
export class TwinController {
  constructor(
    private twins: TwinService,
    private storage: StorageService,
    private consent: ConsentService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const t = await this.twins.current(user.id);
    if (!t) return { twin: null };
    // Decrypt into a short-lived private copy only for the owner to preview.
    const previewPath = `private/twin-previews/${user.id}.png`;
    await this.storage.put(previewPath, await this.storage.readEncrypted(t.encPath, t.iv, t.authTag));
    return {
      twin: { id: t.id, version: t.version, size: t.size, createdAt: t.createdAt, checks: t.checks, preview: this.storage.sign(previewPath, "twin") },
    };
  }

  /** Pre-flight capture checks; nothing is stored. */
  @Post("check")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async check(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Attach a photo");
    return this.twins.check(file.buffer);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async create(@CurrentUser() user: AuthUser, @Body() body: { consent?: string; locale?: string }, @UploadedFile() file?: Express.Multer.File) {
    if (body.consent !== "true") throw new BadRequestException("Your explicit consent is needed to create a twin");
    if (!file || !/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) throw new BadRequestException("Attach a PNG or JPEG photo");
    const t = await this.twins.create(user.id, file.buffer, file.mimetype, body.locale ?? "en");
    return { id: t.id, version: t.version, size: t.size };
  }

  /** Synthetic persona twin for testing without a real person (plan §4.6). */
  @Post("persona")
  async persona(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { persona, consent, locale } = parse(z.object({ persona: z.number().int().min(1).max(5), consent: z.literal(true), locale: z.string().default("en") }), body);
    void consent;
    const t = await this.twins.create(user.id, await this.twins.persona(persona), "image/png", locale);
    return { id: t.id, version: t.version, size: t.size };
  }

  @Delete()
  async remove(@CurrentUser() user: AuthUser) {
    const t = await this.twins.current(user.id);
    if (!t) throw new NotFoundException("No twin to delete");
    const looks = await this.twins.purge(t.id);
    await this.storage.remove(`private/twin-previews/${user.id}.png`);
    const locale = (await this.prisma.user.findUnique({ where: { id: user.id } }))?.locale ?? "en";
    await this.consent.record(user.id, "TWIN_PROCESSING", false, locale);
    return { deleted: true, looksRemoved: looks };
  }
}

@Module({ controllers: [TwinController], providers: [TwinService], exports: [TwinService] })
export class TwinModule {}
