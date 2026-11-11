import { Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Role } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { LooksModule } from "../looks/looks.module";
import { TwinModule } from "../twin/twin.module";
import { Asset3dService } from "./asset3d.service";
import { MotionService } from "./motion.service";

const CONTRIBUTORS: Role[] = [...MANAGE, "COOP_MEMBER"];

/** E27 3D garment + AR view, E28 motion preview. */
@Controller("xr")
export class XrController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private storage: StorageService,
    private assets: Asset3dService,
    private motion: MotionService,
  ) {}

  private async product(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException("Product not found");
    return p;
  }

  // ── 3D garment (studio) ───────────────────────────────────────────────────
  @Get("products/:id/3d")
  async status(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const p = await this.product(id);
    await this.access.requirePage(user.id, p.pageId, CONTRIBUTORS);
    return this.assets.forProduct(id);
  }

  @Post("products/:id/3d")
  async generate(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { variantIds } = parse(z.object({ variantIds: z.array(z.string()).max(20).optional() }), body ?? {});
    const p = await this.product(id);
    await this.access.requirePage(user.id, p.pageId, CONTRIBUTORS);
    return this.assets.request(id, user.id, variantIds);
  }

  /** FR-3D-06: the page reviews and approves AI 3D models before shoppers see them. */
  @Post("products/:id/3d/approve")
  async approve(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { approved } = parse(z.object({ approved: z.boolean() }), body);
    const p = await this.product(id);
    await this.access.requirePage(user.id, p.pageId, MANAGE);
    const out = await this.assets.approve(id, approved);
    await this.access.audit(user.id, approved ? "product.3d_approve" : "product.3d_hide", { productId: id }, p.pageId);
    return out;
  }

  // ── 3D garment (shoppers, public) ─────────────────────────────────────────
  @Public()
  @Get("public/products/:id/3d")
  publicAssets(@Param("id") id: string) {
    return this.assets.publicForProduct(id);
  }

  // ── Motion preview (shopper, private) ─────────────────────────────────────
  @Get("looks/:lookId/motion")
  motionState(@Param("lookId") lookId: string, @CurrentUser() user: AuthUser) {
    return this.motion.state(user.id, lookId);
  }

  @Post("looks/:lookId/motion")
  motionStart(@Param("lookId") lookId: string, @CurrentUser() user: AuthUser) {
    return this.motion.start(user.id, lookId);
  }

  @Get("motion/:id")
  motionGet(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.motion.get(user.id, id);
  }

  /** Signed, short-lived file link; sendFile handles HTTP range requests so <video> can seek and loop. */
  @Public()
  @Get("motion-file")
  motionFile(@Query("p") p: string, @Query("exp") exp: string, @Query("sig") sig: string, @Res() res: Response) {
    if (!p || !p.startsWith("private/motion/") || p.includes("..") || !this.storage.verify("motion", p, exp, sig)) {
      throw new ForbiddenException("Link expired");
    }
    res.sendFile(p, { root: this.storage.root, headers: { "cache-control": "private, max-age=300" }, dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}

@Module({
  imports: [LooksModule, TwinModule],
  controllers: [XrController],
  providers: [Asset3dService, MotionService],
  exports: [Asset3dService],
})
export class XrModule {}
