import { Injectable, NotFoundException } from "@nestjs/common";
import { AGENT_LIMITS, Intent } from "@nyambika/contracts";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AiClient } from "../../common/ai.client";
import { PrismaService } from "../../common/prisma.service";
import { config } from "../../config";
import { rank, type Candidate } from "../intent/ranking";

/**
 * Public catalogue for agents and partners (FR-AGT-01). Only PUBLISHED products of PUBLISHED, verified
 * pages that have not opted out of agent channels (FR-AGT-05). Never shopper data: no buyers, looks,
 * twins or review texts, only page-level aggregates (rating, review count).
 */
const productInclude = {
  page: true,
  variants: { orderBy: { id: "asc" } },
  makers: { include: { coopMember: true } },
} satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type PageRow = Prisma.PageGetPayload<object>;

export const encodeCursor = (id: string) => Buffer.from(id, "utf8").toString("base64url");
export const decodeCursor = (c?: string) => {
  if (!c) return undefined;
  const id = Buffer.from(c, "base64url").toString("utf8");
  return /^[a-z0-9]{8,40}$/i.test(id) ? id : undefined;
};
export const clampLimit = (l?: string | number) => Math.min(AGENT_LIMITS.pageSizeMax, Math.max(1, Number(l) || AGENT_LIMITS.pageSizeDefault));

/** Weak ETag over the response body (stable JSON). */
export const etagOf = (body: unknown) => `W/"${createHash("sha1").update(JSON.stringify(body)).digest("base64url").slice(0, 27)}"`;

export function availabilityOf(stock: number, madeToOrder: boolean) {
  if (madeToOrder) return "made_to_order" as const;
  if (stock <= 0) return "out_of_stock" as const;
  if (stock <= 2) return "low_stock" as const;
  return "in_stock" as const;
}

const SCHEMA_AVAILABILITY = {
  made_to_order: "https://schema.org/MadeToOrder",
  out_of_stock: "https://schema.org/OutOfStock",
  low_stock: "https://schema.org/LimitedAvailability",
  in_stock: "https://schema.org/InStock",
} as const;

const abs = (rel: string | null | undefined) => (rel ? `${config.webUrl}/api/files/${rel}` : null);
export const makerSpaceUrl = (handle: string) => `${config.webUrl}/m/${handle}`;
export const tryOnUrl = (variantId: string) => `${config.webUrl}/looks/try?variant=${variantId}`;

export type PublicMaker = ReturnType<CatalogueApi["maker"]>;
export type PublicProduct = ReturnType<CatalogueApi["product"]>;

@Injectable()
export class CatalogueApi {
  constructor(
    private prisma: PrismaService,
    private ai: AiClient,
  ) {}

  /** Page filter shared by every query. */
  async pageWhere(): Promise<Prisma.PageWhereInput> {
    const out = await this.prisma.agentChannelSetting.findMany({ where: { agentsEnabled: false }, select: { pageId: true } });
    return { status: "PUBLISHED", verified: true, ...(out.length ? { id: { notIn: out.map((o) => o.pageId) } } : {}) };
  }

  maker(p: PageRow, productCount?: number) {
    return {
      id: p.id,
      handle: p.handle,
      name: p.name,
      type: p.memberType.toLowerCase(),
      verified: p.verified,
      location: { district: p.district, sector: p.sector, country: "RW" },
      rating: p.rating,
      review_count: p.reviewCount,
      maker_space_url: makerSpaceUrl(p.handle),
      payments: { paid_directly_to_maker: true, methods: ["mtn_momo", "airtel_money"] },
      ...(productCount !== undefined ? { product_count: productCount } : {}),
      updated_at: p.updatedAt.toISOString(),
    };
  }

  product(p: ProductRow) {
    const madeBy = p.makers.filter((m) => m.coopMember.attributionConsent).map((m) => m.coopMember.name);
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      fabric: p.fabric,
      styles: p.styles,
      occasions: p.occasions,
      price: { amount: p.priceRwf, currency: "RWF" as const },
      made_to_order: p.madeToOrder,
      lead_time_days: p.leadTimeDays,
      try_on: { readiness: p.readiness.toLowerCase(), ready: p.readiness === "READY", url: p.variants[0] ? tryOnUrl(p.variants[0].id) : null },
      maker: { id: p.page.id, handle: p.page.handle, name: p.page.name, verified: p.page.verified, maker_space_url: makerSpaceUrl(p.page.handle) },
      made_by: madeBy,
      variants: p.variants.map((v) => ({
        id: v.id,
        colour_name: v.colourName,
        colour_hex: v.colourHex,
        sizes: v.sizes,
        availability: availabilityOf(v.stock, p.madeToOrder),
        image_url: abs(v.imagePath),
      })),
      url: makerSpaceUrl(p.page.handle),
      updated_at: p.updatedAt.toISOString(),
    };
  }

  /** schema.org Product + Offer per variant (aligned with the Maker Space's own JSON-LD). */
  jsonLd(p: ReturnType<CatalogueApi["product"]>) {
    return {
      "@context": "https://schema.org",
      "@type": "Product",
      "@id": `${p.url}#${p.id}`,
      sku: p.id,
      name: p.title,
      description: p.description,
      category: p.category,
      material: p.fabric || undefined,
      image: p.variants.map((v) => v.image_url).filter(Boolean),
      brand: { "@type": "Brand", name: p.maker.name },
      offers: p.variants.map((v) => ({
        "@type": "Offer",
        sku: v.id,
        name: `${p.title} · ${v.colour_name}`,
        color: v.colour_name,
        price: p.price.amount,
        priceCurrency: "RWF",
        availability: SCHEMA_AVAILABILITY[v.availability],
        itemCondition: "https://schema.org/NewCondition",
        url: tryOnUrl(v.id),
        seller: { "@type": "Organization", name: p.maker.name, url: p.maker.maker_space_url },
      })),
    };
  }

  async makers(q: { cursor?: string; limit?: string; district?: string; type?: string }) {
    const limit = clampLimit(q.limit);
    const after = decodeCursor(q.cursor);
    const where: Prisma.PageWhereInput = {
      ...(await this.pageWhere()),
      ...(q.district ? { district: { equals: q.district, mode: "insensitive" } } : {}),
      ...(q.type && ["tailor", "cooperative", "seller"].includes(q.type) ? { memberType: q.type.toUpperCase() as "TAILOR" } : {}),
    };
    const rows = await this.prisma.page.findMany({
      where: { AND: [where, after ? { id: { gt: after } } : {}] },
      orderBy: { id: "asc" },
      take: limit + 1,
      include: { _count: { select: { products: { where: { status: "PUBLISHED" } } } } },
    });
    const page = rows.slice(0, limit);
    return { object: "list", data: page.map((p) => this.maker(p, p._count.products)), has_more: rows.length > limit, next_cursor: rows.length > limit ? encodeCursor(page.at(-1)!.id) : null };
  }

  async makerByHandle(handle: string) {
    const p = await this.prisma.page.findFirst({ where: { AND: [await this.pageWhere(), { handle }] } });
    if (!p) throw new NotFoundException({ message: "No such maker on the public catalogue", code: "NOT_FOUND" });
    const products = await this.prisma.product.findMany({ where: { pageId: p.id, status: "PUBLISHED" }, include: productInclude, orderBy: [{ featured: "desc" }, { id: "asc" }], take: 50 });
    return { ...this.maker(p, products.length), products: products.map((x) => this.product(x)) };
  }

  async products(q: { cursor?: string; limit?: string; maker?: string; category?: string; max_price?: string; min_price?: string; try_on_ready?: string; in_stock?: string }) {
    const limit = clampLimit(q.limit);
    const after = decodeCursor(q.cursor);
    const where: Prisma.ProductWhereInput = {
      status: "PUBLISHED",
      page: { ...(await this.pageWhere()), ...(q.maker ? { handle: q.maker } : {}) },
      ...(q.category ? { category: q.category } : {}),
      ...(q.max_price || q.min_price ? { priceRwf: { ...(q.max_price ? { lte: Number(q.max_price) || 0 } : {}), ...(q.min_price ? { gte: Number(q.min_price) || 0 } : {}) } } : {}),
      ...(q.try_on_ready === "true" ? { readiness: "READY" } : {}),
      ...(q.in_stock === "true" ? { OR: [{ madeToOrder: true }, { variants: { some: { stock: { gt: 0 } } } }] } : {}),
    };
    const rows = await this.prisma.product.findMany({ where: { AND: [where, after ? { id: { gt: after } } : {}] }, include: productInclude, orderBy: { id: "asc" }, take: limit + 1 });
    const page = rows.slice(0, limit);
    return { object: "list", data: page.map((p) => this.product(p)), has_more: rows.length > limit, next_cursor: rows.length > limit ? encodeCursor(page.at(-1)!.id) : null };
  }

  async productRow(id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, status: "PUBLISHED", page: await this.pageWhere() }, include: productInclude });
    if (!p) throw new NotFoundException({ message: "No such product on the public catalogue", code: "NOT_FOUND" });
    return p;
  }

  async productById(id: string) {
    const p = this.product(await this.productRow(id));
    return { ...p, schema_org: this.jsonLd(p) };
  }

  /** Availability by product (all variants) or by one variant, optionally for one size. */
  async availability(id: string, size?: string) {
    // `id` may be a product id (all variants) or a variant id (just that colour).
    const asVariant = await this.prisma.variant.findUnique({ where: { id }, select: { productId: true } });
    const variantId = asVariant ? id : undefined;
    const p = await this.productRow(asVariant?.productId ?? id);
    const readyBy = (extraDays: number) => new Date(Date.now() + Math.max(1, p.leadTimeDays + extraDays) * 86400_000).toISOString().slice(0, 10);
    const variants = p.variants
      .filter((v) => !variantId || v.id === variantId)
      .map((v) => {
        const availability = availabilityOf(v.stock, p.madeToOrder);
        const sizeOk = !size || v.sizes.includes(size);
        return {
          variant_id: v.id,
          colour_name: v.colourName,
          sizes: v.sizes,
          availability,
          orderable: sizeOk && availability !== "out_of_stock",
          ...(size ? { size, size_offered: sizeOk } : {}),
        };
      });
    return {
      product_id: p.id,
      title: p.title,
      price: { amount: p.priceRwf, currency: "RWF" },
      made_to_order: p.madeToOrder,
      lead_time_days: p.leadTimeDays,
      ready_by: { pickup: readyBy(0), delivery: readyBy(1) },
      delivery: { fee: { amount: 2000, currency: "RWF" }, pickup_sector: p.page.sector },
      variants,
      checked_at: new Date().toISOString(),
    };
  }

  // ── Search with the Muse ranking (intent → grounded, fair, diversified ranking) ───────────────

  private async intentFor(text: string): Promise<Intent> {
    try {
      const raw = await this.ai.post<Intent>("/v1/intent/parse", { text, source: "text" }, 8000);
      const r = Intent.safeParse(raw);
      if (r.success) return r.data;
    } catch {
      /* gateway down: fall back to an empty intent; explicit filters still apply */
    }
    return { occasion: null, date: null, budgetMax: null, styles: [], colours: [], categories: [], size: null, location: null, language: "en", source: "text", parser: "rules" };
  }

  async search(input: { query: string; max_price?: number; category?: string; colour?: string; occasion?: string; limit?: number }) {
    const intent = await this.intentFor(input.query);
    if (input.max_price) intent.budgetMax = input.max_price;
    if (input.category) intent.categories = [input.category];
    if (input.colour) intent.colours = [input.colour.toLowerCase()];
    if (input.occasion) intent.occasion = input.occasion;
    const rows = await this.prisma.product.findMany({ where: { status: "PUBLISHED", page: await this.pageWhere() }, include: productInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const cands: Candidate[] = rows.map((p) => ({
      productId: p.id,
      pageId: p.pageId,
      priceRwf: p.priceRwf,
      category: p.category,
      fabric: p.fabric,
      occasions: p.occasions,
      styles: p.styles,
      madeToOrder: p.madeToOrder,
      leadTimeDays: p.leadTimeDays,
      featured: p.featured,
      rating: p.page.rating,
      district: p.page.district,
      sector: p.page.sector,
      variants: p.variants.map((v) => ({ id: v.id, colourHex: v.colourHex, colourName: v.colourName, inStock: v.stock > 0 || p.madeToOrder })),
    }));
    const limit = Math.min(20, Math.max(1, input.limit ?? 6));
    const ranked = rank(cands, intent, `agent:${input.query}`, limit).filter((r) => !intent.budgetMax || byId.get(r.productId)!.priceRwf <= intent.budgetMax);
    return {
      query: input.query,
      understood: { occasion: intent.occasion, budget_max: intent.budgetMax, colours: intent.colours, categories: intent.categories, styles: intent.styles, date: intent.date, parser: intent.parser },
      results: ranked.map((r) => {
        const p = this.product(byId.get(r.productId)!);
        const v = p.variants.find((x) => x.id === r.variantId) ?? p.variants[0];
        return { ...p, suggested_variant_id: v?.id ?? null, why: r.reasons, score: Math.round(r.score * 100) / 100 };
      }),
    };
  }

  /** Compact catalogue snapshot for the MCP resource. */
  async snapshot() {
    const pages = await this.prisma.page.findMany({ where: await this.pageWhere(), orderBy: { name: "asc" } });
    const products = await this.prisma.product.findMany({ where: { status: "PUBLISHED", pageId: { in: pages.map((p) => p.id) } }, include: productInclude, orderBy: { id: "asc" } });
    return {
      generated_at: new Date().toISOString(),
      currency: "RWF",
      note: "Every purchase is paid directly to the maker and must be confirmed by the shopper in Nyambika.",
      makers: pages.map((p) => ({ ...this.maker(p), products: products.filter((x) => x.pageId === p.id).map((x) => ({ id: x.id, title: x.title, category: x.category, price_rwf: x.priceRwf, try_on_ready: x.readiness === "READY", in_stock: x.madeToOrder || x.variants.some((v) => v.stock > 0) })) })),
    };
  }
}
