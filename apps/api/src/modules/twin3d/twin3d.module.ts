import "multer";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Module,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { MeasurementsInput } from "@nyambika/contracts";
import type { Response } from "express";
import { z } from "zod";
import { AuthUser, CurrentUser, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { LooksModule } from "../looks/looks.module";
import { TailorModule } from "../tailor/tailor.module";
import { TwinModule } from "../twin/twin.module";
import { CAPTURE, isAvatarPath } from "./twin3d-rules";
import { Twin3dService } from "./twin3d.service";

const Skin = z.array(z.number().min(0).max(1)).length(3);

/** E33 3D twin + E34 3D try-on (shopper-only, private). */
@Controller("twin3d")
export class Twin3dController {
  constructor(
    private svc: Twin3dService,
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private async locale(userId: string, given?: string) {
    return given ?? (await this.prisma.user.findUnique({ where: { id: userId } }))?.locale ?? "en";
  }

  @Get()
  state(@CurrentUser() user: AuthUser) {
    return this.svc.state(user.id);
  }

  /** Separate explicit consent for the 3D twin (FR-AVA-02). Withdrawing deletes the 3D twin. */
  @Post("consent")
  async consent(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { granted, locale } = parse(z.object({ granted: z.boolean(), locale: z.string().optional() }), body);
    return this.svc.setConsent(user.id, granted, await this.locale(user.id, locale));
  }

  /** 360° turn capture: ~24 frames sampled on the phone while the shopper turns, each with its turn angle. */
  @Post("capture")
  @UseInterceptors(FilesInterceptor("frames", CAPTURE.maxFrames, { limits: { fileSize: CAPTURE.maxFrameBytes } }))
  capture(@CurrentUser() user: AuthUser, @Body() body: { yaws?: string; consent?: string }, @UploadedFiles() files: Express.Multer.File[] = []) {
    if (body.consent !== "true") throw new BadRequestException("Your explicit consent is needed to build a 3D twin");
    let yaws: number[];
    try {
      yaws = z.array(z.number().min(-720).max(720)).parse(JSON.parse(body.yaws ?? "[]"));
    } catch {
      throw new BadRequestException("Turn angles are missing");
    }
    return this.svc.capture(user.id, files, yaws);
  }

  @Get("personas/:n/turnaround")
  turnaround(@Param("n") n: string) {
    return this.svc.turnaround(Number(n));
  }

  /** Synthetic persona turnaround (no real person), for testing without a camera (plan §4.6). */
  @Post("persona")
  persona(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { persona } = parse(z.object({ persona: z.number().int().min(1).max(5), consent: z.literal(true) }), body);
    return this.svc.persona(user.id, persona);
  }

  /** FR-AVA-06: body-shape avatar from measurements only. */
  @Post("measurements")
  measurements(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { skin, measurements } = parse(z.object({ skin: Skin, measurements: MeasurementsInput.optional(), consent: z.literal(true) }), body);
    return this.svc.fromMeasurements(user.id, skin, measurements as Record<string, number> | undefined);
  }

  /** FR-AVA-03: adjust the avatar's body measurements (new version). */
  @Post("adjust")
  adjust(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { measurements } = parse(z.object({ measurements: MeasurementsInput }), body);
    if (!Object.keys(measurements).length) throw new BadRequestException("Change at least one measurement");
    return this.svc.adjust(user.id, measurements as Record<string, number>);
  }

  @Get("avatar/:id")
  avatar(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.svc.get(user.id, id);
  }

  @Delete()
  async remove(@CurrentUser() user: AuthUser) {
    const removed = await this.svc.deleteFor(user.id);
    return { deleted: true, versions: removed };
  }

  // ── 3D try-on ──
  @Get("wardrobe")
  wardrobe(@CurrentUser() user: AuthUser) {
    return this.svc.wardrobe(user.id);
  }

  @Get("garment/:variantId")
  garment(@CurrentUser() user: AuthUser, @Param("variantId") variantId: string) {
    return this.svc.garment(user.id, variantId);
  }

  @Post("fit")
  fit(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { variantId, size } = parse(z.object({ variantId: z.string().min(1), size: z.string().max(4).optional() }), body);
    return this.svc.fit(user.id, variantId, size);
  }

  @Get("fit/:id")
  getFit(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.svc.getFit(user.id, id);
  }

  /** Owner-only signed link (≤ 5 min); bytes decrypted on the fly and never cached by shared caches. */
  @Public()
  @Get("file")
  async file(@Query("p") p: string, @Query("exp") exp: string, @Query("sig") sig: string, @Res() res: Response) {
    if (!p || !isAvatarPath(p) || !this.storage.verify("avatar", p, exp, sig)) throw new ForbiddenException("Link expired");
    const { data, type } = await this.svc.file(p);
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "private, max-age=300");
    res.setHeader("x-content-type-options", "nosniff");
    res.send(data);
  }
}

@Module({
  imports: [LooksModule, TwinModule, TailorModule],
  controllers: [Twin3dController],
  providers: [Twin3dService],
  exports: [Twin3dService],
})
export class Twin3dModule {}
