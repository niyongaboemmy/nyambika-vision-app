import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Module, NotFoundException, Param, Patch, Post, Put, Query, Req, UnauthorizedException } from "@nestjs/common";
import {
  CURRENCIES,
  isRegion,
  parseMajor,
  PassportInput,
  REGIONS,
  RegionCheckoutInput,
  RegionCode,
  ShippingZoneInput,
  ShopperPrefsInput,
  type CurrencyCode as Cur,
} from "@nyambika/contracts";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { DiscountsModule } from "../growth/discounts";
import { sign } from "../payments/providers";
import { launchChecklist } from "./checklist";
import { FxService } from "./fx";
import { PassportService } from "./passport";
import { RegionService } from "./region.service";
import { ResidencyService } from "./residency";
import { stripeWebhookSecret, verifyStripeSignature, type StripeEventBody } from "./stripe";

const dev = () => process.env.NODE_ENV !== "production";

@Controller("region")
export class RegionController {
  constructor(
    private region: RegionService,
    private fx: FxService,
    private prisma: PrismaService,
    private access: Access,
  ) {}

  @Public()
  @Get("configs")
  async configs() {
    const rows = await this.prisma.regionConfig.findMany({ orderBy: { code: "asc" } });
    return rows.map((r) => ({ code: r.code, name: r.name, flag: REGIONS[r.code as RegionCode]?.flag ?? "", currency: r.currency, wallets: r.wallets, languages: r.languages, launched: r.launched, taxNote: r.taxNote, legalEntity: r.legalEntity, phoneExample: REGIONS[r.code as RegionCode]?.phoneExample ?? "" }));
  }

  @Public()
  @Get("fx")
  fxSnapshot() {
    return this.fx.snapshot();
  }

  @Public()
  @Get("prefs")
  prefs(@CurrentUser() user: AuthUser | null) {
    return this.region.prefs(user?.id ?? null, user?.phone);
  }

  @Put("prefs")
  async savePrefs(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(ShopperPrefsInput, body);
    const cur = await this.region.prefs(user.id, user.phone);
    const next = { displayCurrency: input.displayCurrency ?? cur.displayCurrency, country: input.country ?? cur.country, crossBorder: input.crossBorder ?? cur.crossBorder };
    await this.prisma.shopperPrefs.upsert({ where: { userId: user.id }, create: { userId: user.id, ...next }, update: next });
    return this.region.prefs(user.id, user.phone);
  }

  /** Region-ranked maker directory (E41). Country / cross-border come from the shopper's prefs or query. */
  @Public()
  @Get("directory")
  async directory(@CurrentUser() user: AuthUser | null, @Query("q") q?: string, @Query("type") type?: string, @Query("country") country?: string, @Query("xb") xb?: string) {
    const prefs = await this.region.prefs(user?.id ?? null, user?.phone);
    return this.region.directory({ q, type, country: country && isRegion(country) ? country : prefs.country, crossBorder: xb === undefined ? prefs.crossBorder : xb === "1" });
  }

  @Public()
  @Get("pages/by-handle/:handle/commerce")
  commerce(@Param("handle") handle: string) {
    return this.region.commerce(handle);
  }

  @Post("checkout")
  checkout(@CurrentUser() user: AuthUser, @Headers("idempotency-key") key: string | undefined, @Body() body: unknown) {
    if (!key || key.length < 8) throw new BadRequestException("Idempotency-Key header required");
    return this.region.checkout(user.id, key, parse(RegionCheckoutInput, body));
  }

  @Get("orders/:id/money")
  async money(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException();
    if (o.shopperId !== user.id) await this.access.requirePage(user.id, o.pageId, MANAGE);
    return (await this.region.money(id)) ?? { currency: "RWF", legacy: true };
  }

  @Post("orders/:id/refund")
  async refund(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { amount } = parse(z.object({ amount: z.string().max(14).optional() }), body ?? {});
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, o.pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const m = await this.prisma.orderMoney.findUniqueOrThrow({ where: { orderId: id } });
    const minor = amount ? parseMajor(amount, m.currency as Cur) : undefined;
    const r = await this.region.refund(id, user.id, minor);
    await this.access.audit(user.id, "order.refund", { orderId: id, amountMinor: minor ?? "full", currency: m.currency }, o.pageId);
    return r;
  }

  // ------------------------------------------------------------ provider callbacks + simulators

  /** Wallet simulator webhook (HMAC like the MoMo mock). */
  @Public()
  @Post("webhook/wallet-mock")
  @HttpCode(200)
  async walletWebhook(@Req() req: Request, @Body() body: { referenceId?: string; status?: string }) {
    const given = Buffer.from(String(req.headers["x-signature"] ?? ""), "hex");
    const expected = Buffer.from(sign(JSON.stringify(body)), "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException("Bad signature");
    if (!body.referenceId || !["SUCCESSFUL", "FAILED"].includes(String(body.status))) throw new BadRequestException();
    await this.region.settle(body.referenceId, body.status as "SUCCESSFUL" | "FAILED", body);
    return { ok: true };
  }

  /** Daraja STK callback (stub). Daraja does not sign callbacks: the URL carries a secret token. */
  @Public()
  @Post("webhook/mpesa")
  @HttpCode(200)
  async mpesaWebhook(@Query("token") token: string, @Body() body: { Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number } } }) {
    const secret = process.env.MPESA_CALLBACK_TOKEN;
    if (!secret || token !== secret) throw new UnauthorizedException();
    const cb = body.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) throw new BadRequestException();
    await this.region.settle(cb.CheckoutRequestID, cb.ResultCode === 0 ? "SUCCESSFUL" : "FAILED", body);
    return { ResultCode: 0, ResultDesc: "Accepted" };
  }

  /** Simulated STK prompt on the shopper's phone (dev only). */
  @Post("mock/wallet/:ref")
  @HttpCode(200)
  async walletDecide(@CurrentUser() user: AuthUser, @Param("ref") ref: string, @Body() body: unknown) {
    if (!dev()) throw new NotFoundException();
    const { pin, approve } = parse(z.object({ pin: z.string().regex(/^\d{4,6}$/), approve: z.boolean() }), body);
    const pay = await this.prisma.regionPayment.findUnique({ where: { providerRef: ref } });
    const o = pay && (await this.prisma.order.findUnique({ where: { id: pay.orderId } }));
    if (!o || o.shopperId !== user.id) throw new NotFoundException();
    return { status: await this.region.walletMock.decide(ref, approve && pin !== "0000") };
  }

  /** Mock Payment Element confirm (no Stripe keys): posts a signed Connect webhook back to us. */
  @Post("stripe/mock/confirm")
  @HttpCode(200)
  async stripeMockConfirm(@Body() body: unknown) {
    if (this.region.stripe().mode !== "mock") throw new NotFoundException();
    const { clientSecret, card } = parse(z.object({ clientSecret: z.string().min(10), card: z.string().min(12).max(23) }), body);
    return this.region.stripeMock.confirm(clientSecret, card);
  }

  // ------------------------------------------------------------ maker studio

  @Get("pages/:pageId/settings")
  async settings(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId }, include: { products: { where: { status: { not: "ARCHIVED" } }, orderBy: { createdAt: "asc" }, include: { variants: { take: 1 } } } } });
    const pr = await this.region.pageRegion(pageId);
    const prices = await this.region.prices(pageId, pr.currency, page.products);
    const zones = await this.prisma.shippingZone.findMany({ where: { pageId }, orderBy: { createdAt: "asc" } });
    const cfgs = await this.prisma.regionConfig.findMany({ orderBy: { code: "asc" } });
    return {
      ...pr,
      stripeMode: this.region.stripe().mode,
      momoMerchant: page.momoMerchant,
      airtelMerchant: page.airtelMerchant,
      regions: cfgs.map((c) => ({ code: c.code, name: c.name, flag: REGIONS[c.code as RegionCode]?.flag ?? "", currency: c.currency, wallets: c.wallets, launched: c.launched })),
      products: page.products.map((p) => ({ id: p.id, title: p.title, priceRwf: p.priceRwf, priceMinor: prices[p.id], image: p.variants[0]?.imagePath ? `/api/files/${p.variants[0].imagePath}` : null })),
      zones: zones.map((z) => ({ id: z.id, name: z.name, countries: z.countries, currency: z.currency, feeMinor: z.feeMinor, etaDays: z.etaDays, active: z.active })),
    };
  }

  @Put("pages/:pageId/settings")
  async saveSettings(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const input = parse(
      z.object({ region: RegionCode.optional(), mpesaTill: z.string().regex(/^\d{5,8}$|^$/).optional(), crossBorder: z.boolean().optional(), exportEnabled: z.boolean().optional() }),
      body,
    );
    const before = await this.region.pageRegion(pageId);
    const region = input.region ?? before.region;
    // Moving country changes the charge currency; prices in the old currency stop applying (never auto-converted).
    const data = { region, currency: REGIONS[region].currency, mpesaTill: input.mpesaTill ?? before.mpesaTill, crossBorder: input.crossBorder ?? before.crossBorder, exportEnabled: input.exportEnabled ?? before.exportEnabled };
    if (data.exportEnabled && before.stripeStatus !== "ACTIVE") throw new BadRequestException("Connect your Stripe account first");
    await this.prisma.pageRegion.upsert({ where: { pageId }, create: { pageId, ...data }, update: data });
    await this.access.audit(user.id, "page.region_settings", { before, after: data }, pageId);
    return this.settings(user, pageId);
  }

  @Put("products/:productId/price")
  async price(@CurrentUser() user: AuthUser, @Param("productId") productId: string, @Body() body: unknown) {
    const { amount } = parse(z.object({ amount: z.string().trim().min(1).max(14) }), body);
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    await this.access.requirePage(user.id, p.pageId, MANAGE);
    const pr = await this.region.pageRegion(p.pageId);
    let minor: number;
    try {
      minor = parseMajor(amount, pr.currency);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (minor <= 0) throw new BadRequestException("Price must be above zero");
    await this.prisma.productPrice.upsert({ where: { productId }, create: { productId, pageId: p.pageId, currency: pr.currency, amountMinor: minor }, update: { currency: pr.currency, amountMinor: minor } });
    if (pr.currency === "RWF") await this.prisma.product.update({ where: { id: productId }, data: { priceRwf: minor } });
    return { productId, currency: pr.currency, amountMinor: minor };
  }

  @Post("pages/:pageId/zones")
  async addZone(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const z0 = parse(ShippingZoneInput, body);
    const pr = await this.region.pageRegion(pageId);
    const feeMinor = this.fee(z0.fee, pr.currency);
    const count = await this.prisma.shippingZone.count({ where: { pageId } });
    if (count >= 10) throw new BadRequestException("Up to 10 shipping zones");
    await this.prisma.shippingZone.create({ data: { pageId, name: z0.name, countries: z0.countries, currency: pr.currency, feeMinor, etaDays: z0.etaDays, active: z0.active } });
    return this.settings(user, pageId);
  }

  @Patch("zones/:id")
  async editZone(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const zone = await this.prisma.shippingZone.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, zone.pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const z0 = parse(ShippingZoneInput.partial(), body);
    await this.prisma.shippingZone.update({ where: { id }, data: { ...(z0.name ? { name: z0.name } : {}), ...(z0.countries ? { countries: z0.countries } : {}), ...(z0.fee ? { feeMinor: this.fee(z0.fee, zone.currency as Cur) } : {}), ...(z0.etaDays ? { etaDays: z0.etaDays } : {}), ...(z0.active !== undefined ? { active: z0.active } : {}) } });
    return this.settings(user, zone.pageId);
  }

  @Delete("zones/:id")
  async deleteZone(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const zone = await this.prisma.shippingZone.findUniqueOrThrow({ where: { id } });
    await this.access.requirePage(user.id, zone.pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    await this.prisma.shippingZone.delete({ where: { id } });
    return this.settings(user, zone.pageId);
  }

  /** Stripe Connect onboarding: the maker gets their OWN account; we only hold its id. */
  @Post("pages/:pageId/stripe/connect")
  async connect(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const pr = await this.region.pageRegion(pageId);
    const s = this.region.stripe();
    let onboardingUrl: string | null = null;
    let accountId = pr.stripeAccountId;
    if (!accountId) {
      const a = await s.createAccount(pr.region);
      accountId = a.id;
      onboardingUrl = a.onboardingUrl;
    }
    const ready = await s.accountReady(accountId).catch(() => false);
    const data = { stripeAccountId: accountId, stripeStatus: ready ? "ACTIVE" : "PENDING" };
    await this.prisma.pageRegion.upsert({ where: { pageId }, create: { pageId, region: pr.region, currency: pr.currency, ...data }, update: data });
    await this.access.audit(user.id, "page.stripe_connect", { accountId, status: data.stripeStatus, mode: s.mode }, pageId);
    return { ...(await this.settings(user, pageId)), onboardingUrl };
  }

  private fee(input: string, currency: Cur) {
    try {
      const m = parseMajor(input, currency);
      if (m < 0) throw new Error("Fee can't be negative");
      return m;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}

/** Stripe webhook (raw body; main.ts keeps it for signature verification). */
@Controller("stripe")
export class StripeWebhookController {
  constructor(private region: RegionService) {}

  @Public()
  @Post("webhook")
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);
    const v = verifyStripeSignature(raw, req.headers["stripe-signature"] as string | undefined, stripeWebhookSecret());
    if (!v.ok) throw new BadRequestException(`Webhook signature: ${v.reason}`);
    return this.region.handleStripeEvent(JSON.parse(raw) as StripeEventBody);
  }
}

@Controller("passports")
export class PassportController {
  constructor(private passports: PassportService) {}

  @Public()
  @Get("by-gtin/:gtin")
  byGtin(@Param("gtin") gtin: string) {
    if (!/^\d{8,14}$/.test(gtin)) throw new BadRequestException();
    return this.passports.byGtin(gtin);
  }

  @Public()
  @Get(":productId")
  public(@Param("productId") productId: string, @Query("v") v?: string) {
    return this.passports.public(productId, v ? Number(v) || undefined : undefined);
  }

  @Get(":productId/draft")
  draft(@CurrentUser() user: AuthUser, @Param("productId") productId: string) {
    return this.passports.draft(user.id, productId);
  }

  @Post(":productId")
  publish(@CurrentUser() user: AuthUser, @Param("productId") productId: string, @Body() body: unknown) {
    const { data, note } = parse(PassportInput, body);
    return this.passports.publish(user.id, productId, data, note);
  }

  @Post(":productId/verify")
  verify(@CurrentUser() user: AuthUser, @Param("productId") productId: string, @Body() body: unknown) {
    const { verified } = parse(z.object({ verified: z.boolean() }), body);
    return this.passports.verify(user.id, productId, verified);
  }
}

/** Host admin: country launch checklist + region switcher (E41). */
@Controller("admin/regions")
export class RegionAdminController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private fx: FxService,
    private residency: ResidencyService,
    private passports: PassportService,
  ) {}

  @Get()
  async overview(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const cfgs = await this.prisma.regionConfig.findMany({ orderBy: { code: "asc" } });
    const fx = await this.fx.snapshot();
    const fxFresh = !fx.stale;
    const regionRows = await this.prisma.pageRegion.findMany({ select: { pageId: true, region: true } });
    const published = await this.prisma.page.findMany({ where: { status: "PUBLISHED" }, select: { id: true } });
    const regionOf = new Map(regionRows.map((r) => [r.pageId, r.region]));
    const pagesBy: Record<string, number> = {};
    for (const p of published) pagesBy[regionOf.get(p.id) ?? "RW"] = (pagesBy[regionOf.get(p.id) ?? "RW"] ?? 0) + 1;
    const money = await this.prisma.$queryRaw<{ currency: string; method: string; n: bigint; total: bigint }[]>`
      SELECT m.currency, m.method, COUNT(*)::bigint AS n, COALESCE(SUM(m."totalMinor"), 0)::bigint AS total
      FROM "OrderMoney" m JOIN "Order" o ON o.id = m."orderId" WHERE o.status NOT IN ('CANCELLED','AWAITING_PAYMENT','NEW')
      GROUP BY m.currency, m.method`;
    return {
      fx,
      residencyMode: this.residency.mode,
      regions: await Promise.all(
        cfgs.map(async (c) => ({
          ...c,
          flag: REGIONS[c.code as RegionCode]?.flag ?? "",
          exponent: CURRENCIES[c.currency as Cur]?.exponent ?? 0,
          rate: c.currency === "USD" ? "1" : (fx.rates[c.currency as Cur] ?? null),
          pages: pagesBy[c.code] ?? 0,
          paid: money.filter((m) => m.currency === c.currency).map((m) => ({ method: m.method, orders: Number(m.n), totalMinor: Number(m.total) })),
          route: await this.residency.route(c.code as RegionCode),
          // The Swahili starter catalogue ships with E41 (machine-drafted; native review is a manual item).
          checklist: launchChecklist(c, { fxFresh, pages: pagesBy[c.code] ?? 0, swCatalogue: true }),
        })),
      ),
      claims: await this.passports.pendingClaims(),
    };
  }

  @Patch(":code")
  async edit(@CurrentUser() user: AuthUser, @Param("code") code: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const input = parse(
      z.object({
        taxNote: z.string().max(400).optional(),
        legalEntity: z.string().max(400).optional(),
        vatRateBp: z.number().int().min(0).max(5000).optional(),
        wallets: z.array(z.enum(["MTN_MOMO", "AIRTEL_MONEY", "MPESA"])).optional(),
        languages: z.array(z.enum(["rw", "en", "fr", "sw"])).min(1).optional(),
        storageBucket: z.string().regex(/^[a-z0-9-]{3,63}$/).optional(),
        dbSchema: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/).optional(),
      }),
      body,
    );
    const before = await this.prisma.regionConfig.findUniqueOrThrow({ where: { code } });
    const after = await this.prisma.regionConfig.update({ where: { code }, data: input });
    await this.access.audit(user.id, "region.config", { code, before, after: input });
    return after;
  }

  @Post(":code/checklist")
  async tick(@CurrentUser() user: AuthUser, @Param("code") code: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { item, done, note } = parse(z.object({ item: z.string().max(40), done: z.boolean(), note: z.string().max(200).default("") }), body);
    const c = await this.prisma.regionConfig.findUniqueOrThrow({ where: { code } });
    const list = { ...((c.checklist as object) ?? {}), [item]: { done, note, by: user.phone, at: new Date().toISOString() } };
    await this.prisma.regionConfig.update({ where: { code }, data: { checklist: list } });
    await this.access.audit(user.id, "region.checklist", { code, item, done, note });
    return { ok: true };
  }

  @Post(":code/launch")
  async launch(@CurrentUser() user: AuthUser, @Param("code") code: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { launched } = parse(z.object({ launched: z.boolean() }), body);
    if (code === "RW" && !launched) throw new ForbiddenException("Rwanda is the home region");
    const c = await this.prisma.regionConfig.findUniqueOrThrow({ where: { code } });
    if (launched) {
      const fx = await this.fx.snapshot();
      const pages = await this.prisma.pageRegion.count({ where: { region: code } });
      const cl = launchChecklist(c, { fxFresh: !fx.stale, pages, swCatalogue: true });
      if (!cl.ready) throw new BadRequestException(`Checklist incomplete: ${cl.items.filter((i) => !i.done).map((i) => i.label).join("; ")}`);
    }
    await this.prisma.regionConfig.update({ where: { code }, data: { launched } });
    await this.access.audit(user.id, launched ? "region.launch" : "region.pause", { code });
    return { ok: true, launched };
  }

  @Post("fx/refresh")
  async refreshFx(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const snap = await this.fx.refresh();
    await this.access.audit(user.id, "fx.refresh", { source: snap.source });
    return snap;
  }
}

@Module({
  imports: [DiscountsModule],
  controllers: [RegionController, StripeWebhookController, PassportController, RegionAdminController],
  providers: [RegionService, FxService, ResidencyService, PassportService],
  exports: [RegionService, FxService, ResidencyService],
})
export class RegionModule {}
