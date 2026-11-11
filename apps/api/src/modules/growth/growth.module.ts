import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { BroadcastInput, DiscountInput, planBroadcast, SHARE_SOURCES, shareLink, type ShareSource } from "@nyambika/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AiClient } from "../../common/ai.client";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { DiscountService, DiscountsModule } from "./discounts";
import { kigaliHour, suggest, type InsightFacts, type Locale, type Suggestion } from "./insights";
import { renderPromo, type PromoFormat } from "./promo";

const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] as const;
const BROADCAST_TEMPLATE = "broadcast_new_collection";
const BROADCAST_COPY: Record<Locale, (page: string, msg: string, link: string) => string> = {
  rw: (p, m, l) => `${p} ✨ ${m}\nReba kandi ugerageze kuri wowe: ${l}\nOhereza STOP ngo ntuzongere kubona ubu butumwa.`,
  en: (p, m, l) => `${p} ✨ ${m}\nSee it and try it on you: ${l}\nReply STOP to stop these updates.`,
  fr: (p, m, l) => `${p} ✨ ${m}\nDécouvrez et essayez sur vous : ${l}\nRépondez STOP pour ne plus recevoir ces messages.`,
};
const SHARE_TEXT: Record<Locale, (title: string, page: string) => string> = {
  rw: (t, p) => `${t} kwa ${p}. Yigerageze kuri wowe kuri Nyambika ✨`,
  en: (t, p) => `${t} by ${p}. Try it on you on Nyambika ✨`,
  fr: (t, p) => `${t} par ${p}. Essayez-la sur vous sur Nyambika ✨`,
};

const shortUrl = (handle: string) => `${new URL(config.webUrl).host}/m/${handle}`;
const offerLabel = (d: { kind: string; value: number }) => (d.kind === "PERCENT" ? `−${d.value}%` : `−RWF ${d.value.toLocaleString("en-US")}`);

/**
 * E30 member growth tools: promo cards (FR-PHO-07), tagged share links, discount codes / offers,
 * follower broadcasts with opt-in and rate limits, insights v2 + ✨ suggestions (FR-ANL-01/03).
 */
@Controller()
export class GrowthController {


  constructor(
    private prisma: PrismaService,
    private access: Access,
    private storage: StorageService,
    private messaging: MessagingService,
    private consent: ConsentService,
    private discounts: DiscountService,
    private ai: AiClient,
  ) {}

  // ---------- Promo cards + share links ----------

  @Post("pages/:pageId/promo")
  async promo(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const req = parse(z.object({ productId: z.string(), format: z.enum(["story", "square"]), locale: z.enum(["rw", "en", "fr"]).default("rw") }), body);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const product = await this.prisma.product.findFirst({ where: { id: req.productId, pageId }, include: { variants: true } });
    if (!product) throw new NotFoundException("Product not found on this page");
    const src: ShareSource = req.format === "story" ? "qr_story" : "qr_card";
    const url = shareLink(config.webUrl, page.handle, src, { productId: product.id, campaign: "promo" });
    const photoPath = product.variants.find((v) => v.imagePath)?.imagePath;
    const photo = photoPath ? await this.storage.read(photoPath).catch(() => null) : null;
    const offer = await this.discounts.bestOffer(pageId, product.id, product.priceRwf, null);
    const png = await renderPromo({
      format: req.format as PromoFormat,
      locale: req.locale,
      theme: page.theme,
      pageName: page.name,
      title: product.title,
      priceRwf: product.priceRwf,
      madeToOrder: product.madeToOrder,
      photo,
      url,
      shortUrl: shortUrl(page.handle),
      offer: offer ? offerLabel(offer.rule) : null,
    });
    // Member-owned public media; the name changes when the content does (cache-safe).
    const hash = createHash("sha256").update(png).digest("hex").slice(0, 10);
    const rel = `public/promo/${pageId}/${product.id}-${req.format}-${req.locale}-${hash}.png`;
    await this.storage.put(rel, png);
    await this.access.audit(user.id, "growth.promo_card", { productId: product.id, format: req.format, locale: req.locale }, pageId);
    const text = SHARE_TEXT[req.locale](product.title, page.name);
    return {
      url: this.storage.publicUrl(rel),
      width: req.format === "story" ? 1080 : 1080,
      height: req.format === "story" ? 1920 : 1080,
      shareText: text,
      link: url,
      links: this.links(page.handle, product.id, text),
    };
  }

  private links(handle: string, productId: string | undefined, text: string) {
    const out: Record<string, { url: string; whatsapp: string }> = {};
    for (const src of SHARE_SOURCES) {
      const url = shareLink(config.webUrl, handle, src, { productId });
      out[src] = { url, whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}` };
    }
    return out;
  }

  @Get("pages/:pageId/share-links")
  async shareLinks(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Query("productId") productId?: string, @Query("locale") locale: Locale = "rw") {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const product = productId ? await this.prisma.product.findFirst({ where: { id: productId, pageId } }) : null;
    const text = product ? SHARE_TEXT[locale in SHARE_TEXT ? locale : "rw"](product.title, page.name) : `${page.name} · Nyambika ✨`;
    return { links: this.links(page.handle, product?.id, text), shareText: text };
  }

  // ---------- Discounts + offers ----------

  @Get("pages/:pageId/discounts")
  async listDiscounts(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const rows = await this.prisma.discountCode.findMany({ where: { pageId }, orderBy: { createdAt: "desc" } });
    const saved = await this.prisma.discountRedemption.groupBy({ by: ["discountId"], where: { pageId }, _sum: { amountRwf: true } });
    const byId = new Map(saved.map((s) => [s.discountId, s._sum.amountRwf ?? 0]));
    const products = await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId).filter((x): x is string => !!x) } }, select: { id: true, title: true } });
    const titles = new Map(products.map((p) => [p.id, p.title]));
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      productTitle: r.productId ? titles.get(r.productId) ?? null : null,
      givenRwf: byId.get(r.id) ?? 0,
      state: !r.active ? "PAUSED" : r.startsAt.getTime() > now ? "SCHEDULED" : r.endsAt && r.endsAt.getTime() <= now ? "ENDED" : r.maxUses != null && r.uses >= r.maxUses ? "USED_UP" : "LIVE",
      display: offerLabel(r),
    }));
  }

  @Post("pages/:pageId/discounts")
  async createDiscount(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN", "PAGE_STAFF"]);
    const d = parse(DiscountInput, body);
    if (d.productId && !(await this.prisma.product.count({ where: { id: d.productId, pageId } }))) throw new BadRequestException("Pick a product from this page");
    if (d.code && (await this.prisma.discountCode.count({ where: { pageId, code: d.code } }))) throw new BadRequestException("You already have this code");
    const row = await this.prisma.discountCode.create({
      data: {
        pageId,
        code: d.code || null,
        label: d.label || (d.code ? d.code : "Offer"),
        kind: d.kind,
        value: d.value,
        productId: d.productId || null,
        minSpendRwf: d.minSpendRwf,
        maxUses: d.maxUses ?? null,
        perShopper: d.perShopper,
        startsAt: d.startsAt ? new Date(d.startsAt) : new Date(),
        endsAt: d.endsAt ? new Date(d.endsAt) : null,
        fundedBy: "MAKER",
        createdBy: user.id,
      },
    });
    // Money-affecting change → audit (brief §2).
    await this.access.audit(user.id, "growth.discount_create", { discountId: row.id, code: row.code, kind: row.kind, value: row.value, endsAt: row.endsAt, fundedBy: "MAKER" }, pageId);
    return row;
  }

  @Patch("pages/:pageId/discounts/:id")
  async updateDiscount(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("id") id: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN", "PAGE_STAFF"]);
    const { active } = parse(z.object({ active: z.boolean() }), body);
    await this.prisma.discountCode.findFirstOrThrow({ where: { id, pageId } });
    const row = await this.prisma.discountCode.update({ where: { id }, data: { active } });
    await this.access.audit(user.id, active ? "growth.discount_resume" : "growth.discount_pause", { discountId: id }, pageId);
    return row;
  }

  /** Buy sheet: the best automatic offer for this colour (no code needed). */
  @Public()
  @Get("discounts/offer")
  async offer(@CurrentUser() user: AuthUser | null, @Query("variantId") variantId: string) {
    const v = await this.prisma.variant.findUnique({ where: { id: variantId ?? "" }, include: { product: true } });
    if (!v) throw new NotFoundException();
    const o = await this.discounts.bestOffer(v.product.pageId, v.productId, v.product.priceRwf, user?.id ?? null);
    return o ? { label: o.rule.label, display: offerLabel(o.rule), amountRwf: o.amountRwf, endsAt: o.rule.endsAt, priceAfterRwf: v.product.priceRwf - o.amountRwf } : null;
  }

  /** Buy sheet: check a typed code before holding (the order re-validates it). */
  @Post("discounts/check")
  async check(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { variantId, code } = parse(z.object({ variantId: z.string(), code: z.string().trim().min(1).max(20) }), body);
    const v = await this.prisma.variant.findUnique({ where: { id: variantId }, include: { product: true } });
    if (!v) throw new NotFoundException();
    const d = await this.discounts.resolve(v.product.pageId, v.productId, v.product.priceRwf, user.id, code);
    return { code: code.toUpperCase(), applied: d?.rule.code ?? null, display: d ? offerLabel(d.rule) : null, amountRwf: d?.amountRwf ?? 0, priceAfterRwf: v.product.priceRwf - (d?.amountRwf ?? 0) };
  }

  // ---------- Follower broadcasts ----------

  @Get("pages/:pageId/broadcast-optin")
  async myOptIn(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    const r = await this.prisma.broadcastOptIn.findUnique({ where: { userId_pageId: { userId: user.id, pageId } } });
    return { optedIn: r?.optedIn ?? false };
  }

  /** Shopper opts in (or out) of WhatsApp "new collection" updates from one page. Opting in also follows the page. */
  @Post("pages/:pageId/broadcast-optin")
  async setOptIn(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    const { optedIn, locale } = parse(z.object({ optedIn: z.boolean(), locale: z.enum(["rw", "en", "fr"]).default("rw") }), body);
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page || page.status !== "PUBLISHED") throw new NotFoundException();
    await this.prisma.broadcastOptIn.upsert({ where: { userId_pageId: { userId: user.id, pageId } }, update: { optedIn }, create: { userId: user.id, pageId, optedIn } });
    if (optedIn) await this.prisma.follow.upsert({ where: { userId_pageId: { userId: user.id, pageId } }, update: {}, create: { userId: user.id, pageId } });
    await this.consent.record(user.id, `BROADCAST_OPTIN:${pageId}`, optedIn, locale);
    return { optedIn };
  }

  @Get("pages/:pageId/broadcasts")
  async broadcasts(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const [history, followers, optedIn] = await Promise.all([
      this.prisma.broadcast.findMany({ where: { pageId }, orderBy: { createdAt: "desc" }, take: 10 }),
      this.prisma.follow.count({ where: { pageId } }),
      this.prisma.broadcastOptIn.count({ where: { pageId, optedIn: true } }),
    ]);
    const plan = planBroadcast(history.map((h) => h.createdAt), [{ userId: "probe", phone: "probe", optedIn: true, recentWeek: 0 }]);
    return { history, followers, optedIn, canSend: plan.ok, blocked: plan.ok ? null : { reason: plan.reason, message: plan.message, retryAt: plan.retryAt ?? null } };
  }

  /** "New collection" broadcast through the WhatsApp outbox: opted-in followers only, page + recipient rate limits. */
  @Post("pages/:pageId/broadcasts")
  async sendBroadcast(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN", "PAGE_STAFF"]);
    const input = parse(BroadcastInput, body);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    if (page.status !== "PUBLISHED") throw new BadRequestException("Publish your page before sending updates");
    const sent = await this.prisma.broadcast.findMany({ where: { pageId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, select: { createdAt: true } });
    const follows = await this.prisma.follow.findMany({ where: { pageId }, include: { user: { select: { id: true, phone: true } } } });
    const opt = await this.prisma.broadcastOptIn.findMany({ where: { pageId, userId: { in: follows.map((f) => f.userId) } } });
    const optMap = new Map(opt.map((o) => [o.userId, o.optedIn]));
    const phones = follows.map((f) => f.user.phone);
    const recent = await this.prisma.notification.groupBy({ by: ["to"], where: { template: BROADCAST_TEMPLATE, to: { in: phones }, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true });
    const recentMap = new Map(recent.map((r) => [r.to, r._count]));
    const plan = planBroadcast(
      sent.map((s) => s.createdAt),
      follows.map((f) => ({ userId: f.userId, phone: f.user.phone, optedIn: optMap.get(f.userId) === true, recentWeek: recentMap.get(f.user.phone) ?? 0 })),
    );
    if (!plan.ok) throw new BadRequestException({ message: plan.message, code: plan.reason, retryAt: plan.retryAt });
    const productIds = (await this.prisma.product.findMany({ where: { id: { in: input.productIds }, pageId, status: "PUBLISHED" }, select: { id: true } })).map((p) => p.id);
    const link = shareLink(config.webUrl, page.handle, "broadcast", { productId: productIds[0], campaign: "new_collection" });
    const b = await this.prisma.broadcast.create({ data: { pageId, createdBy: user.id, message: input.message, productIds, link, recipients: plan.send.length, skipped: plan.skipped.length } });
    for (const r of plan.send) await this.messaging.send("WHATSAPP", r.phone, BROADCAST_TEMPLATE, BROADCAST_COPY[input.locale](page.name, input.message, link), b.id);
    await this.access.audit(user.id, "growth.broadcast", { broadcastId: b.id, recipients: plan.send.length, skipped: plan.skipped.length }, pageId);
    return { ...b, skippedReasons: plan.skipped.reduce<Record<string, number>>((a, s) => ({ ...a, [s.reason]: (a[s.reason] ?? 0) + 1 }), {}) };
  }

  // ---------- Insights v2 ----------

  @Get("pages/:pageId/insights")
  async insights(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Query("locale") rawLocale?: string) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const locale: Locale = rawLocale === "en" || rawLocale === "fr" ? rawLocale : "rw";
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [products, looks, items, visits, optedIn, lastB, offers] = await Promise.all([
      this.prisma.product.findMany({ where: { pageId, status: { in: ["PUBLISHED", "OUT_OF_STOCK"] } }, include: { variants: { select: { id: true, imagePath: true } } } }),
      this.prisma.generation.findMany({ where: { status: "DELIVERED", createdAt: { gte: since }, variant: { product: { pageId } } }, select: { createdAt: true, variant: { select: { productId: true } } } }),
      this.prisma.orderItem.findMany({ where: { order: { pageId, createdAt: { gte: since }, status: { in: [...PAID] } } }, select: { productId: true, qty: true } }),
      this.prisma.$queryRaw<{ source: string | null; occurredAt: Date }[]>`
        SELECT props->>'source' AS source, "occurredAt" FROM "Event"
        WHERE name = 'maker_space_viewed' AND props->>'pageId' = ${pageId} AND "occurredAt" >= ${since}`,
      this.prisma.broadcastOptIn.count({ where: { pageId, optedIn: true } }),
      this.prisma.broadcast.findFirst({ where: { pageId }, orderBy: { createdAt: "desc" } }),
      this.prisma.discountCode.count({ where: { pageId, active: true, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } }),
    ]);
    const lookBy = new Map<string, number>();
    for (const l of looks) lookBy.set(l.variant.productId, (lookBy.get(l.variant.productId) ?? 0) + 1);
    const saleBy = new Map<string, number>();
    for (const i of items) saleBy.set(i.productId, (saleBy.get(i.productId) ?? 0) + i.qty);
    const sources: Record<string, number> = {};
    for (const v of visits) sources[v.source || "direct"] = (sources[v.source || "direct"] ?? 0) + 1;
    const hours = new Array<number>(24).fill(0);
    for (const v of visits) hours[kigaliHour(v.occurredAt)] += 1;
    for (const l of looks) hours[kigaliHour(l.createdAt)] += 1;
    const facts: InsightFacts = {
      products: products.map((p) => ({ id: p.id, title: p.title, priceRwf: p.priceRwf, colours: p.variants.length, looks: lookBy.get(p.id) ?? 0, sales: saleBy.get(p.id) ?? 0, ready: p.readiness === "READY" })),
      sources,
      hours,
      optedInFollowers: optedIn,
      daysSinceBroadcast: lastB ? Math.floor((Date.now() - lastB.createdAt.getTime()) / 86_400_000) : null,
      activeOffers: offers,
    };
    let suggestions: Suggestion[] = suggest(facts, locale, `/studio/${pageId}`);
    let writer: "rules" | "llm" = "rules";
    // Optional Claude path (MUSE_LLM=1 on the gateway): only rephrases the rule suggestions; any failure keeps the rules.
    try {
      const r = await this.ai.post<{ texts: string[]; writer: "rules" | "llm" }>("/v1/insights/phrase", { locale, facts, suggestions: suggestions.map((s) => s.text) }, 8000);
      if (r.writer === "llm" && r.texts.length === suggestions.length) {
        suggestions = suggestions.map((s, i) => ({ ...s, text: r.texts[i] || s.text }));
        writer = "llm";
      }
    } catch {
      /* gateway without the endpoint or LLM off: rules stand */
    }
    const byProduct = facts.products
      .map((p) => ({ ...p, conversion: p.looks ? p.sales / p.looks : 0, image: this.storage.publicUrl(products.find((x) => x.id === p.id)?.variants.find((v) => v.imagePath)?.imagePath) }))
      .sort((a, b) => b.looks - a.looks || b.sales - a.sales);
    const totalVisits = visits.length;
    return {
      periodDays: 30,
      visits: totalVisits,
      sources: Object.entries(sources)
        .map(([source, n]) => ({ source, n, share: totalVisits ? n / totalVisits : 0 }))
        .sort((a, b) => b.n - a.n),
      byProduct: byProduct.slice(0, 8),
      hours,
      suggestions,
      writer,
    };
  }
}

@Module({ imports: [DiscountsModule], controllers: [GrowthController] })
export class GrowthModule {}
