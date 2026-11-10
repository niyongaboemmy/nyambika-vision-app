import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthUser, CurrentUser } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { TwinModule, TwinService } from "../twin/twin.module";
import { GenerationService } from "./generation.service";

const lookInclude = {
  generation: true,
  intentSession: { select: { id: true, intent: true } },
} satisfies Prisma.LookInclude;

type LookRow = Prisma.LookGetPayload<{ include: typeof lookInclude }>;

@Injectable()
export class LooksService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private generations: GenerationService,
    private twins: TwinService,
  ) {}

  async create(userId: string, intentSessionId: string, productId: string, variantId: string, rank: number, score = 0) {
    return this.prisma.look.create({ data: { userId, intentSessionId, productId, variantId, rank, score } });
  }

  /** Make sure a look has a generation (progressive: called only for looks the shopper is about to see). */
  async render(lookId: string, tier: "PREVIEW" | "HD" = "PREVIEW") {
    const look = await this.prisma.look.findUniqueOrThrow({ where: { id: lookId } });
    const gen = await this.generations.ensure(look.userId, look.variantId, tier);
    if (tier === "PREVIEW" || gen.status === "DELIVERED") {
      await this.prisma.look.update({ where: { id: lookId }, data: { generationId: gen.id } });
    }
    return gen;
  }

  async views(rows: LookRow[]) {
    const productIds = [...new Set(rows.map((r) => r.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { page: true, variants: true, makers: { include: { coopMember: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const hasTwin = rows.length ? Boolean(await this.twins.current(rows[0].userId)) : false;
    return rows.map((l) => {
      const p = byId.get(l.productId)!;
      const v = p.variants.find((x) => x.id === l.variantId) ?? p.variants[0];
      const g = l.generation;
      const guard = (g?.guard ?? null) as { passed?: boolean } | null;
      return {
        id: l.id,
        rank: l.rank,
        saved: Boolean(l.savedAt),
        status: g?.status ?? "PENDING",
        image: g?.status === "DELIVERED" && g.outputPath ? this.storage.sign(g.outputPath, "look") : null,
        onTwin: hasTwin,
        tier: g?.tier ?? "PREVIEW",
        c2pa: g?.c2pa ? { signed: true, sha256: (g.c2pa as { sha256: string }).sha256.slice(0, 16), model: g.modelVersion } : null,
        guardPassed: guard?.passed ?? null,
        latencyMs: g?.latencyMs ?? null,
        intentSessionId: l.intentSessionId,
        product: {
          id: p.id,
          title: p.title,
          priceRwf: p.priceRwf,
          madeToOrder: p.madeToOrder,
          leadTimeDays: p.leadTimeDays,
          category: p.category,
          fabric: p.fabric,
        },
        variant: { id: v.id, colourName: v.colourName, colourHex: v.colourHex, sizes: v.sizes, inStock: v.stock > 0 || p.madeToOrder },
        variants: p.variants.filter((x) => x.cutoutPath).map((x) => ({ id: x.id, colourName: x.colourName, colourHex: x.colourHex })),
        maker: {
          pageId: p.page.id,
          name: p.page.name,
          handle: p.page.handle,
          memberType: p.page.memberType,
          verified: p.page.verified,
          sector: p.page.sector,
          whatsapp: p.page.whatsapp,
          madeBy: p.makers.filter((m) => m.coopMember.attributionConsent).map((m) => m.coopMember.name),
        },
      };
    });
  }

  async view(lookId: string, userId: string) {
    const row = await this.prisma.look.findFirst({ where: { id: lookId, userId }, include: lookInclude });
    if (!row) throw new NotFoundException("Look not found");
    return (await this.views([row]))[0];
  }

  rows(where: Prisma.LookWhereInput, orderBy: Prisma.LookOrderByWithRelationInput = { rank: "asc" }) {
    return this.prisma.look.findMany({ where, include: lookInclude, orderBy });
  }
}

@Controller("looks")
export class LooksController {
  constructor(
    private prisma: PrismaService,
    private looks: LooksService,
  ) {}

  /** Try one product on the twin (Maker Space "Try on me"). */
  @Post("try")
  async tryOn(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { variantId } = parse(z.object({ variantId: z.string() }), body);
    const variant = await this.prisma.variant.findUnique({ where: { id: variantId }, include: { product: true } });
    if (!variant || variant.product.status !== "PUBLISHED") throw new NotFoundException("This item isn't available");
    const session = await this.prisma.intentSession.create({
      data: { userId: user.id, input: `try:${variant.product.title}`, source: "direct", intent: {} },
    });
    const look = await this.looks.create(user.id, session.id, variant.productId, variant.id, 0);
    await this.looks.render(look.id);
    return this.looks.view(look.id, user.id);
  }

  @Get("saved")
  async saved(@CurrentUser() user: AuthUser) {
    return this.looks.views(await this.looks.rows({ userId: user.id, savedAt: { not: null } }, { savedAt: "desc" }));
  }

  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.looks.view(id, user.id);
  }

  /** Double-tap save. HD is rendered on save (preview tier first, plan §4.4). */
  @Post(":id/save")
  async save(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const look = await this.prisma.look.findFirstOrThrow({ where: { id, userId: user.id } });
    const savedAt = look.savedAt ? null : new Date();
    await this.prisma.look.update({ where: { id }, data: { savedAt } });
    if (savedAt) await this.looks.render(id, "HD").catch(() => undefined);
    return this.looks.view(id, user.id);
  }

  /** Colour ring: snap to one of the maker's real variants (R1 scope, CR-08). */
  @Post(":id/variant")
  async variant(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { variantId } = parse(z.object({ variantId: z.string() }), body);
    const look = await this.prisma.look.findFirstOrThrow({ where: { id, userId: user.id } });
    const v = await this.prisma.variant.findFirstOrThrow({ where: { id: variantId, productId: look.productId } });
    await this.prisma.look.update({ where: { id }, data: { variantId: v.id, generationId: null } });
    await this.looks.render(id);
    return this.looks.view(id, user.id);
  }
}

@Module({
  imports: [TwinModule],
  controllers: [LooksController],
  providers: [LooksService, GenerationService],
  exports: [LooksService, GenerationService],
})
export class LooksModule {}
