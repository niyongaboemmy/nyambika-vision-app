import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Post, Put } from "@nestjs/common";
import {
  MORPH_LENGTHS,
  MORPH_SLEEVES,
  MorphSpec,
  MorphTemplateInput,
  morphPrice,
  offered,
  quantizeHue,
} from "@nyambika/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AiClient } from "../../common/ai.client";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { GenerationService, type MorphRender } from "../looks/generation.service";

interface MorphResult {
  cutout_b64: string;
  frame: number[];
  applied: Record<string, unknown>;
}

/** Normalised spec: hue snapped to the ring step, base options folded to null. */
export function normaliseSpec(spec: MorphSpec, t: MorphTemplateInput): MorphSpec {
  return {
    hue: spec.hue === null || !t.colourEnabled ? null : quantizeHue(spec.hue),
    length: spec.length && spec.length !== t.baseLength ? spec.length : null,
    sleeve: spec.sleeve && spec.sleeve !== t.baseSleeve ? spec.sleeve : null,
  };
}

export const specKey = (s: MorphSpec) => `h${s.hue ?? "-"}|l${s.length ?? "-"}|s${s.sleeve ?? "-"}`;

/**
 * Live morph (E23, FR-TRY-16): tailor templates, morphed cut-outs (AI gateway) and renders on the
 * twin through the normal generation path (guard, C2PA and billing unchanged; cache key has the spec).
 */
@Injectable()
export class MorphService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private generations: GenerationService,
    private access: Access,
  ) {}

  async template(productId: string) {
    const row = await this.prisma.morphTemplate.findUnique({ where: { productId } });
    if (!row) return null;
    const options = MorphTemplateInput.parse(row.options);
    return options.enabled ? { ...row, options } : null;
  }

  /** Public view used by the morph sheet (no personal data). */
  async publicView(productId: string) {
    const t = await this.template(productId);
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { page: true, variants: true } });
    if (!t || !product || product.status !== "PUBLISHED") return { customizable: false as const, productId, maker: product ? this.maker(product.page) : null, madeToOrder: product?.madeToOrder ?? false };
    const o = t.options;
    return {
      customizable: true as const,
      productId,
      title: product.title,
      category: product.category,
      basePriceRwf: product.priceRwf,
      madeToOrder: product.madeToOrder,
      leadTimeDays: o.leadTimeDays,
      options: o,
      lengths: ["dress", "umushanana", "kitenge", "skirt", "bridal"].includes(product.category) ? offered(MORPH_LENGTHS, o.baseLength, o.lengths) : [o.baseLength],
      sleeves: product.category === "skirt" ? [o.baseSleeve] : offered(MORPH_SLEEVES, o.baseSleeve, o.sleeves),
      variants: product.variants.filter((v) => v.cutoutPath).map((v) => ({ id: v.id, colourName: v.colourName, colourHex: v.colourHex, sizes: v.sizes })),
      maker: this.maker(product.page),
    };
  }

  private maker(p: { id: string; name: string; handle: string; memberType: string; whatsapp: string }) {
    return { pageId: p.id, name: p.name, handle: p.handle, memberType: p.memberType };
  }

  async setTemplate(userId: string, productId: string, body: unknown) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException();
    await this.access.requirePage(userId, product.pageId, MANAGE);
    const options = parse(MorphTemplateInput, body);
    await this.prisma.morphTemplate.upsert({
      where: { productId },
      update: { options, pageId: product.pageId },
      create: { productId, pageId: product.pageId, options },
    });
    await this.access.audit(userId, "MORPH_TEMPLATE_SET", { productId, options }, product.pageId);
    return { productId, options };
  }

  async removeTemplate(userId: string, productId: string) {
    const row = await this.prisma.morphTemplate.findUnique({ where: { productId } });
    if (!row) throw new NotFoundException();
    await this.access.requirePage(userId, row.pageId, MANAGE);
    await this.prisma.morphTemplate.delete({ where: { productId } });
    await this.access.audit(userId, "MORPH_TEMPLATE_REMOVED", { productId }, row.pageId);
    return { removed: true };
  }

  async managerTemplate(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException();
    await this.access.requirePage(userId, product.pageId, MANAGE);
    const row = await this.prisma.morphTemplate.findUnique({ where: { productId } });
    return { productId, basePriceRwf: product.priceRwf, category: product.category, options: row ? MorphTemplateInput.parse(row.options) : null };
  }

  /** Morphed cut-out for a variant + normalised spec, cached for everyone (catalogue-derived media). */
  async cutout(variantId: string, spec: MorphSpec, t: MorphTemplateInput, category: string): Promise<MorphRender | null> {
    if (spec.hue === null && !spec.length && !spec.sleeve) return null;
    const key = specKey(spec);
    const hit = await this.prisma.garmentMorph.findUnique({ where: { variantId_specKey: { variantId, specKey: key } } });
    if (hit) return { key, cutoutPath: hit.cutoutPath, frame: hit.frame as number[] };
    const variant = await this.prisma.variant.findUniqueOrThrow({ where: { id: variantId } });
    if (!variant.cutoutPath) throw new BadRequestException("This colour has no try-on cut-out yet");
    const src = await this.storage.read(variant.cutoutPath);
    const r = await this.ai.post<MorphResult>("/v1/garment/morph", {
      cutout_b64: src.toString("base64"),
      category,
      hue: spec.hue,
      length: spec.length,
      sleeve: spec.sleeve,
      base_length: t.baseLength,
      base_sleeve: t.baseSleeve,
    });
    const hash = createHash("sha256").update(`${variantId}|${key}`).digest("hex").slice(0, 20);
    const cutoutPath = await this.storage.put(`public/morphs/${variantId}/${hash}.png`, Buffer.from(r.cutout_b64, "base64"));
    const row = await this.prisma.garmentMorph.upsert({
      where: { variantId_specKey: { variantId, specKey: key } },
      update: {},
      create: { variantId, specKey: key, cutoutPath, frame: r.frame },
    });
    return { key, cutoutPath: row.cutoutPath, frame: row.frame as number[] };
  }

  async preview(userId: string, body: unknown) {
    const req = parse(z.object({ productId: z.string(), variantId: z.string(), spec: MorphSpec }), body);
    const product = await this.prisma.product.findUnique({ where: { id: req.productId }, include: { variants: true } });
    if (!product || product.status !== "PUBLISHED") throw new NotFoundException("This item isn't available");
    const variant = product.variants.find((v) => v.id === req.variantId);
    if (!variant) throw new NotFoundException("Unknown colour");
    const t = await this.template(product.id);
    if (!t) throw new BadRequestException("This piece isn't customizable");
    const spec = normaliseSpec(req.spec, t.options);
    let price;
    try {
      price = morphPrice(product.priceRwf, t.options, spec);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const morph = await this.cutout(variant.id, spec, t.options, product.category);
    const gen = await this.generations.ensure(userId, variant.id, "PREVIEW", 2, morph ?? undefined);
    return { ...(await this.render(userId, gen.id)), spec, price };
  }

  async render(userId: string, id: string) {
    const g = await this.prisma.generation.findFirst({ where: { id, userId } });
    if (!g) throw new NotFoundException();
    const guard = (g.guard ?? null) as { passed?: boolean } | null;
    return {
      renderId: g.id,
      status: g.status,
      image: g.status === "DELIVERED" && g.outputPath ? this.storage.sign(g.outputPath, "look") : null,
      c2pa: g.c2pa ? { signed: true, sha256: (g.c2pa as { sha256: string }).sha256.slice(0, 16), model: g.modelVersion } : null,
      guardPassed: guard?.passed ?? null,
    };
  }
}

@Controller()
export class MorphController {
  constructor(private morph: MorphService) {}

  @Public()
  @Get("morph/templates/:productId")
  view(@Param("productId") productId: string) {
    return this.morph.publicView(productId);
  }

  @Post("morph/preview")
  preview(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.morph.preview(user.id, body);
  }

  @Get("morph/renders/:id")
  render(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.morph.render(user.id, id);
  }

  @Get("products/:productId/morph-template")
  manager(@CurrentUser() user: AuthUser, @Param("productId") productId: string) {
    return this.morph.managerTemplate(user.id, productId);
  }

  @Put("products/:productId/morph-template")
  set(@CurrentUser() user: AuthUser, @Param("productId") productId: string, @Body() body: unknown) {
    return this.morph.setTemplate(user.id, productId, body);
  }

  @Delete("products/:productId/morph-template")
  remove(@CurrentUser() user: AuthUser, @Param("productId") productId: string) {
    return this.morph.removeTemplate(user.id, productId);
  }
}
