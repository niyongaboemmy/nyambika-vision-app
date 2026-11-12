import "multer";
import { clampPersona, personaSet } from "../twin/personas";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ProductInput, VariantInput } from "@nyambika/contracts";
import type { Role } from "@prisma/client";
import { z } from "zod";
import { AiClient } from "../../common/ai.client";
import { MeteringService } from "../../common/metering.service";
import { Access, AuthUser, CurrentUser, MANAGE } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";

const CONTRIBUTORS: Role[] = [...MANAGE, "COOP_MEMBER"];

interface Assessment {
  readiness: "READY" | "NEEDS_BETTER_PHOTO" | "NOT_SUPPORTED";
  quality_score: number;
  notes: string[];
  cutout_b64: string;
  dominant_colours: string[];
  embedding: number[];
}

/** Garment readiness + embeddings via the AI Gateway (FR-CAT-03/04/05, CR-04). */
@Injectable()
export class CatalogueService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private metering: MeteringService,
  ) {}

  async attachVariantImage(variantId: string, image: Buffer) {
    const variant = await this.prisma.variant.findUnique({ where: { id: variantId }, include: { product: true } });
    if (!variant) throw new NotFoundException("Variant not found");
    const base = `public/media/${variant.product.pageId}/${variant.id}`;
    const imagePath = await this.storage.put(`${base}-photo.png`, image);
    const a = await this.ai.post<Assessment>("/v1/garment/assess", {
      image_b64: image.toString("base64"),
      category: variant.product.category,
    });
    const cutoutPath = a.cutout_b64 ? await this.storage.put(`${base}-cutout.png`, Buffer.from(a.cutout_b64, "base64")) : null;
    await this.prisma.variant.update({ where: { id: variantId }, data: { imagePath, cutoutPath } });
    if (a.embedding?.length === 64) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "Variant" SET embedding = $1::vector WHERE id = $2`,
        `[${a.embedding.join(",")}]`,
        variantId,
      );
    }
    await this.prisma.mediaAsset.create({ data: { productId: variant.productId, path: imagePath, kind: "ORIGINAL" } });
    await this.refreshReadiness(variant.productId, a);
    return { readiness: a.readiness, notes: a.notes, qualityScore: a.quality_score, image: this.storage.publicUrl(imagePath) };
  }

  /**
   * AI product studio (FR-PHO-01..06): render a variant on synthetic AI models (never a real person)
   * as labelled, C2PA-signed catalogue photos owned by the member. Metered against the page allowance.
   */
  async studio(variantId: string, personas: number[]) {
    const v = await this.prisma.variant.findUnique({ where: { id: variantId }, include: { product: true } });
    if (!v?.cutoutPath) throw new BadRequestException("Upload a photo for this colour first");
    const garment = await this.storage.read(v.cutoutPath);
    const out: { persona: number; image: string | null; status: string }[] = [];
    for (const n of personas) {
      const model = await this.storage.read(`personas/persona-${clampPersona(n, personaSet(this.storage.root).count)}.png`);
      const r = await this.ai.post<{ status: string; image_b64: string | null; c2pa: { sha256: string } | null }>("/v1/tryon", {
        twin_b64: model.toString("base64"),
        garment_b64: garment.toString("base64"),
        garment_category: v.product.category,
        tier: "HD",
        request_id: `studio-${variantId}-${n}`,
      });
      if (r.status !== "DELIVERED" || !r.image_b64) {
        out.push({ persona: n, image: null, status: r.status });
        continue;
      }
      const path = await this.storage.put(`public/media/${v.product.pageId}/${v.id}-studio-p${n}.png`, Buffer.from(r.image_b64, "base64"));
      await this.prisma.mediaAsset.deleteMany({ where: { productId: v.productId, path } });
      await this.prisma.mediaAsset.create({ data: { productId: v.productId, path, kind: "STUDIO" } });
      await this.metering.record("PHOTO", "PAGE_ALLOWANCE", 110, null, v.product.pageId, v.id);
      out.push({ persona: n, image: this.storage.publicUrl(path), status: "DELIVERED" });
    }
    return out;
  }

  /** Product is try-on READY only when every variant has a passing cut-out. */
  private async refreshReadiness(productId: string, latest: Assessment) {
    const variants = await this.prisma.variant.findMany({ where: { productId } });
    const missing = variants.filter((v) => !v.cutoutPath).length;
    let readiness: Assessment["readiness"] | "NOT_ASSESSED" = latest.readiness;
    if (latest.readiness === "READY" && missing > 0) readiness = "NOT_ASSESSED";
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        readiness,
        readinessNotes: missing > 0 && latest.readiness === "READY" ? [`Add photos for ${missing} more colour(s)`] : latest.notes,
        qualityScore: latest.quality_score,
      },
    });
  }
}

@Controller()
export class CatalogueController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private storage: StorageService,
    private catalogue: CatalogueService,
    private ai: AiClient,
  ) {}

  @Get("pages/:pageId/products")
  async list(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser) {
    await this.access.requirePage(user.id, pageId, CONTRIBUTORS);
    const isMemberOnly =
      !(await this.access.isHost(user.id)) &&
      (await this.prisma.roleAssignment.count({ where: { userId: user.id, pageId, role: { in: MANAGE } } })) === 0;
    const products = await this.prisma.product.findMany({
      where: { pageId, ...(isMemberOnly ? { submittedById: user.id } : {}), status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "desc" },
      include: { variants: true, makers: { include: { coopMember: true } }, media: { where: { kind: "STUDIO" } } },
    });
    return products.map((p) => this.view(p));
  }

  @Get("products/:id")
  async get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true, makers: { include: { coopMember: true } }, media: { where: { kind: "STUDIO" } } },
    });
    if (!p) throw new NotFoundException();
    await this.access.requirePage(user.id, p.pageId, CONTRIBUTORS);
    return this.view(p);
  }

  @Post("pages/:pageId/products")
  async create(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, CONTRIBUTORS);
    const { variants, makerIds, ...input } = parse(ProductInput, body);
    await this.assertMakers(pageId, makerIds);
    const product = await this.prisma.product.create({
      data: {
        ...input,
        pageId,
        submittedById: user.id,
        variants: { create: variants },
        makers: { create: makerIds.map((coopMemberId) => ({ coopMemberId })) },
      },
      include: { variants: true, makers: { include: { coopMember: true } } },
    });
    await this.access.audit(user.id, "product.create", { productId: product.id, title: product.title }, pageId);
    return this.view(product);
  }

  @Patch("products/:id")
  async update(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const existing = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, existing.pageId, CONTRIBUTORS);
    const { variants: _v, makerIds, ...input } = parse(ProductInput.partial(), body);
    if (makerIds) {
      await this.assertMakers(existing.pageId, makerIds);
      await this.prisma.productMaker.deleteMany({ where: { productId: id } });
      await this.prisma.productMaker.createMany({ data: makerIds.map((coopMemberId) => ({ productId: id, coopMemberId })) });
    }
    if (input.payoutTarget && input.payoutTarget !== existing.payoutTarget) {
      // FR-COOP-05/10: payout destination changes are always audit-logged.
      await this.access.requirePage(user.id, existing.pageId, ["COOP_ADMIN", "PAGE_OWNER"]);
      await this.access.audit(user.id, "product.payout_target", { productId: id, from: existing.payoutTarget, to: input.payoutTarget }, existing.pageId);
    }
    const p = await this.prisma.product.update({
      where: { id },
      data: input,
      include: { variants: true, makers: { include: { coopMember: true } } },
    });
    return this.view(p);
  }

  @Post("products/:id/variants")
  async addVariant(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, p.pageId, CONTRIBUTORS);
    return this.prisma.variant.create({ data: { ...parse(VariantInput, body), productId: id } });
  }

  @Patch("variants/:id")
  async updateVariant(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const v = await this.prisma.variant.findUniqueOrThrow({ where: { id }, include: { product: true } });
    await this.access.requirePage(user.id, v.product.pageId, CONTRIBUTORS);
    return this.prisma.variant.update({ where: { id }, data: parse(VariantInput.partial(), body) });
  }

  /** Upload a variant photo → quality check, background removal, readiness, embedding. */
  @Post("variants/:id/image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 } }))
  async upload(@Param("id") id: string, @CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Attach a photo");
    if (!/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) throw new BadRequestException("Use a PNG, JPEG or WebP photo");
    const v = await this.prisma.variant.findUniqueOrThrow({ where: { id }, include: { product: true } });
    await this.access.requirePage(user.id, v.product.pageId, CONTRIBUTORS);
    return this.catalogue.attachVariantImage(id, file.buffer);
  }

  @Post("variants/:id/studio")
  async studio(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { personas } = parse(z.object({ personas: z.array(z.number().int().min(1).max(12)).min(1).max(5) }), body);
    const v = await this.prisma.variant.findUniqueOrThrow({ where: { id }, include: { product: true } });
    await this.access.requirePage(user.id, v.product.pageId, CONTRIBUTORS);
    return this.catalogue.studio(id, personas);
  }

  @Delete("products/:id/media/:mediaId")
  async removeMedia(@Param("id") id: string, @Param("mediaId") mediaId: string, @CurrentUser() user: AuthUser) {
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, p.pageId, CONTRIBUTORS);
    const m = await this.prisma.mediaAsset.findFirstOrThrow({ where: { id: mediaId, productId: id, kind: "STUDIO" } });
    await this.storage.remove(m.path);
    await this.prisma.mediaAsset.delete({ where: { id: m.id } });
    return { ok: true };
  }

  /** AI listing writer for products and page stories (FR-PAGE-07, FR-AST-10). */
  @Post("pages/:pageId/assist")
  async assist(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, CONTRIBUTORS);
    const req = parse(z.object({ kind: z.enum(["product", "story"]), locale: z.enum(["rw", "en", "fr"]), fields: z.record(z.string(), z.unknown()) }), body);
    return this.ai.post("/v1/listing/write", req);
  }

  /**
   * Publish / archive (SRS B4). Cooperative members' submissions go to admin approval
   * (FR-COOP-03); admins approve or reject.
   */
  @Post("products/:id/status")
  async status(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { action, note } = parse(
      z.object({ action: z.enum(["publish", "approve", "reject", "archive", "unpublish"]), note: z.string().max(300).optional() }),
      body,
    );
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, p.pageId, CONTRIBUTORS);
    const isManager =
      (await this.access.isHost(user.id)) ||
      (await this.prisma.roleAssignment.count({ where: { userId: user.id, pageId: p.pageId, role: { in: MANAGE } } })) > 0;
    let next = p.status;
    if (action === "publish") next = isManager ? "PUBLISHED" : "PENDING_APPROVAL";
    else if (action === "approve" || action === "reject") {
      if (!isManager) throw new BadRequestException("Only cooperative admins can approve");
      next = action === "approve" ? "PUBLISHED" : "DRAFT";
    } else if (action === "archive") next = "ARCHIVED";
    else if (action === "unpublish") next = "DRAFT";
    await this.access.audit(user.id, `product.${action}`, { productId: id, from: p.status, to: next, note }, p.pageId);
    const updated = await this.prisma.product.update({
      where: { id },
      data: { status: next },
      include: { variants: true, makers: { include: { coopMember: true } } },
    });
    return this.view(updated);
  }

  @Delete("products/:id")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, p.pageId, MANAGE);
    await this.prisma.product.update({ where: { id }, data: { status: "ARCHIVED" } });
    await this.access.audit(user.id, "product.archive", { productId: id }, p.pageId);
    return { ok: true };
  }

  private async assertMakers(pageId: string, makerIds: string[]) {
    if (!makerIds.length) return;
    const n = await this.prisma.coopMember.count({ where: { id: { in: makerIds }, pageId } });
    if (n !== makerIds.length) throw new BadRequestException("Makers must belong to this page");
  }

  private view(p: {
    id: string;
    pageId: string;
    title: string;
    description: string;
    category: string;
    priceRwf: number;
    madeToOrder: boolean;
    leadTimeDays: number;
    styles: string[];
    occasions: string[];
    fabric: string;
    status: string;
    readiness: string;
    readinessNotes: string[];
    qualityScore: number | null;
    payoutTarget: string;
    featured: boolean;
    variants: { id: string; colourName: string; colourHex: string; sizes: string[]; stock: number; imagePath: string | null; cutoutPath: string | null }[];
    makers: { coopMember: { id: string; name: string } }[];
    media?: { id: string; path: string }[];
  }) {
    return {
      ...p,
      studio: (p.media ?? []).map((m) => ({ id: m.id, image: this.storage.publicUrl(m.path) })),
      variants: p.variants.map((v) => ({
        id: v.id,
        colourName: v.colourName,
        colourHex: v.colourHex,
        sizes: v.sizes,
        stock: v.stock,
        image: this.storage.publicUrl(v.imagePath),
        cutout: this.storage.publicUrl(v.cutoutPath),
      })),
      makers: p.makers.map((m) => ({ id: m.coopMember.id, name: m.coopMember.name })),
    };
  }
}

@Module({ controllers: [CatalogueController], providers: [CatalogueService], exports: [CatalogueService] })
export class CatalogueModule {}
