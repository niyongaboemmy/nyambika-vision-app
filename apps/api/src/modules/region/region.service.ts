import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  convertMinor,
  CURRENCIES,
  formatMoney,
  isCurrency,
  isRegion,
  normalizePhone,
  pickZone,
  rankByRegion,
  REGIONS,
  WALLET_LABEL,
  type CurrencyCode,
  type RegionCheckoutInput,
  type RegionCode,
  type Wallet,
} from "@nyambika/contracts";
import type { PageRegion } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { DiscountService } from "../growth/discounts";
import { PaymentsService } from "../payments/payments.module";
import { serverEvent } from "../pilot/pilot.service";
import { FxService } from "./fx";
import { HttpStripeAdapter, MockStripeAdapter, type StripeAdapter, type StripeEventBody } from "./stripe";
import { DarajaMpesaProvider, MockWalletProvider, type WalletProvider } from "./wallets";

const DOMESTIC_DELIVERY_RWF = 2000; // same as hold-to-buy for Rwandan pages
/** Domestic delivery fee per currency in minor units (flat, like Rwanda's). Synthetic defaults. */
export const DOMESTIC_DELIVERY_MINOR: Record<CurrencyCode, number> = { RWF: DOMESTIC_DELIVERY_RWF, KES: 25_000, UGX: 7_000, TZS: 500_000, USD: 0, EUR: 0 };

export interface PageRegionView {
  pageId: string;
  region: RegionCode;
  currency: CurrencyCode;
  mpesaTill: string;
  crossBorder: boolean;
  exportEnabled: boolean;
  stripeAccountId: string | null;
  stripeStatus: string;
}

export function pageRegionView(pageId: string, r: PageRegion | null): PageRegionView {
  const region = r && isRegion(r.region) ? r.region : "RW";
  return {
    pageId,
    region,
    currency: r && isCurrency(r.currency) ? r.currency : REGIONS[region].currency,
    mpesaTill: r?.mpesaTill ?? "",
    crossBorder: r?.crossBorder ?? false,
    exportEnabled: r?.exportEnabled ?? false,
    stripeAccountId: r?.stripeAccountId ?? null,
    stripeStatus: r?.stripeStatus ?? "NONE",
  };
}

/** Which wallets a page can take right now: country allows it AND the maker has the account. */
export function pageWallets(region: RegionCode, accounts: { momo: string; airtel: string; mpesaTill: string }): Wallet[] {
  const has: Record<Wallet, boolean> = { MTN_MOMO: Boolean(accounts.momo), AIRTEL_MONEY: Boolean(accounts.airtel || (region === "RW" && accounts.momo)), MPESA: Boolean(accounts.mpesaTill) };
  return REGIONS[region].wallets.filter((w) => has[w]);
}

/**
 * Stripe event → action, given the RegionPayment it refers to. Pure so it can be tested: the event's
 * connected account must match the maker account the payment was created on (connected-account routing).
 */
export function stripeAction(
  event: StripeEventBody,
  payment: { connectedAccount: string | null; amountMinor: number; currency: string; status: string } | null,
): { kind: "settle"; status: "SUCCESSFUL" | "FAILED" } | { kind: "refund"; refundedMinor: number } | { kind: "ignore"; reason: string } {
  if (!payment) return { kind: "ignore", reason: "unknown payment" };
  if (!event.account || event.account !== payment.connectedAccount) return { kind: "ignore", reason: "account mismatch" };
  const o = event.data.object;
  switch (event.type) {
    case "payment_intent.succeeded":
      if (o.amount !== payment.amountMinor || o.currency?.toUpperCase() !== payment.currency) return { kind: "ignore", reason: "amount or currency mismatch" };
      return { kind: "settle", status: "SUCCESSFUL" };
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      return { kind: "settle", status: "FAILED" };
    case "charge.refunded":
      return { kind: "refund", refundedMinor: o.amount_refunded ?? 0 };
    default:
      return { kind: "ignore", reason: `unhandled ${event.type}` };
  }
}

@Injectable()
export class RegionService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Region");
  readonly walletMock = new MockWalletProvider();
  readonly stripeMock = new MockStripeAdapter();
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private fx: FxService,
    private payments: PaymentsService,
    private messaging: MessagingService,
    private discounts: DiscountService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.expirePending().catch((e) => this.log.error(e)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  stripe(): StripeAdapter {
    const key = process.env.STRIPE_SECRET_KEY;
    return key ? new HttpStripeAdapter(key) : this.stripeMock;
  }

  wallet(method: Wallet): WalletProvider {
    return method === "MPESA" && process.env.MPESA_PROVIDER === "daraja" ? new DarajaMpesaProvider() : this.walletMock;
  }

  async pageRegion(pageId: string) {
    return pageRegionView(pageId, await this.prisma.pageRegion.findUnique({ where: { pageId } }));
  }

  /** Product prices in the page currency (minor units); falls back to priceRwf for RWF pages. */
  async prices(pageId: string, currency: CurrencyCode, products: { id: string; priceRwf: number }[]) {
    const rows = await this.prisma.productPrice.findMany({ where: { productId: { in: products.map((p) => p.id) } } });
    const by = new Map(rows.map((r) => [r.productId, r]));
    const out: Record<string, number | null> = {};
    for (const p of products) {
      const r = by.get(p.id);
      out[p.id] = r && r.currency === currency ? r.amountMinor : currency === "RWF" ? p.priceRwf : null; // never invent a price by conversion
    }
    return out;
  }

  /** Everything the Maker Space needs to sell in the maker's currency (public). */
  async commerce(handle: string) {
    const page = await this.prisma.page.findUnique({ where: { handle }, include: { products: { where: { status: "PUBLISHED" }, select: { id: true, priceRwf: true } } } });
    if (!page || page.status !== "PUBLISHED") throw new NotFoundException("This page isn't available");
    const pr = await this.pageRegion(page.id);
    const cfg = await this.prisma.regionConfig.findUnique({ where: { code: pr.region } });
    const zones = await this.prisma.shippingZone.findMany({ where: { pageId: page.id, active: true }, orderBy: { feeMinor: "asc" } });
    const passports = await this.prisma.productPassport.findMany({ where: { pageId: page.id }, select: { productId: true } });
    return {
      pageId: page.id,
      region: pr.region,
      country: REGIONS[pr.region].name,
      flag: REGIONS[pr.region].flag,
      currency: pr.currency,
      wallets: pageWallets(pr.region, { momo: page.momoMerchant, airtel: page.airtelMerchant, mpesaTill: pr.mpesaTill }),
      crossBorder: pr.crossBorder,
      card: { enabled: pr.exportEnabled && pr.stripeStatus === "ACTIVE" && Boolean(pr.stripeAccountId), mode: this.stripe().mode },
      domesticDeliveryMinor: DOMESTIC_DELIVERY_MINOR[pr.currency],
      prices: await this.prices(page.id, pr.currency, page.products),
      zones: zones.map((z) => ({ id: z.id, name: z.name, countries: z.countries, currency: z.currency as CurrencyCode, feeMinor: z.feeMinor, etaDays: z.etaDays, active: z.active })),
      passports: passports.map((p) => p.productId),
      taxNote: cfg?.taxNote ?? "",
      legalEntity: cfg?.legalEntity ?? "",
      phoneExample: REGIONS[pr.region].phoneExample,
    };
  }

  /** Directory with region-aware ranking: home country first, others only with cross-border opt-in on both sides. */
  async directory(q: { q?: string; type?: string; country: RegionCode; crossBorder: boolean }) {
    const pages = await this.prisma.page.findMany({
      where: {
        status: "PUBLISHED",
        ...(q.type ? { memberType: q.type as never } : {}),
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { story: { contains: q.q, mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ verified: "desc" }, { rating: "desc" }],
      include: { _count: { select: { products: { where: { status: "PUBLISHED" } } } } },
    });
    const regions = new Map((await this.prisma.pageRegion.findMany({ where: { pageId: { in: pages.map((p) => p.id) } } })).map((r) => [r.pageId, r]));
    const items = pages.map((p) => {
      const r = pageRegionView(p.id, regions.get(p.id) ?? null);
      return {
        id: p.id,
        handle: p.handle,
        name: p.name,
        memberType: p.memberType,
        verified: p.verified,
        sector: p.sector,
        theme: p.theme,
        rating: p.rating,
        reviewCount: p.reviewCount,
        tagline: p.story.split(/[.!?]/)[0]?.slice(0, 90) ?? "",
        productCount: p._count.products,
        region: r.region,
        flag: REGIONS[r.region].flag,
        currency: r.currency,
        crossBorder: r.crossBorder,
      };
    });
    return rankByRegion(items, { country: q.country, crossBorder: q.crossBorder });
  }

  async prefs(userId: string | null, phone?: string) {
    const row = userId ? await this.prisma.shopperPrefs.findUnique({ where: { userId } }) : null;
    const fromPhone = phone ? (Object.values(REGIONS).find((r) => phone.startsWith(`+${r.dialCode}`))?.code ?? "RW") : "RW";
    const country = (row && isRegion(row.country) ? row.country : fromPhone) as RegionCode;
    return { displayCurrency: (row?.displayCurrency ?? REGIONS[country].currency) as CurrencyCode, country, crossBorder: row?.crossBorder ?? false, saved: Boolean(row) };
  }

  // ------------------------------------------------------------------ checkout

  /**
   * Regional / export checkout (E40/E41). Charges in the maker's currency only: the "≈" display amount is
   * stored as a snapshot for the receipt but never charged. Wallet pushes go to the maker's own till;
   * cards are Stripe direct charges on the maker's connected account.
   */
  async checkout(userId: string, key: string, input: RegionCheckoutInput) {
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.shopperId !== userId) throw new ConflictException();
      return this.checkoutResult(existing.id);
    }
    const variant = await this.prisma.variant.findUnique({
      where: { id: input.variantId },
      include: { product: { include: { page: true, makers: { include: { coopMember: true } } } } },
    });
    if (!variant || variant.product.status !== "PUBLISHED" || variant.product.page.status !== "PUBLISHED") throw new NotFoundException("This item isn't available");
    const p = variant.product;
    const page = p.page;
    if (!variant.sizes.includes(input.size)) throw new BadRequestException(`Size ${input.size} isn't offered`);
    if (!p.madeToOrder && variant.stock < 1) throw new ConflictException("Sold out in this colour");

    const pr = await this.pageRegion(page.id);
    const currency = pr.currency;
    const price = (await this.prices(page.id, currency, [p]))[p.id];
    if (price == null) throw new ConflictException(`This maker hasn't set a ${currency} price yet`);

    // Delivery: domestic flat fee, pickup, or a maker-defined international zone.
    let deliveryMinor = 0;
    let zone: { id: string; name: string; etaDays: number } | null = null;
    let shipCountry: string | null = null;
    if (input.delivery === "DELIVERY") deliveryMinor = DOMESTIC_DELIVERY_MINOR[currency];
    if (input.delivery === "SHIP") {
      shipCountry = (input.shipCountry ?? "").toUpperCase();
      if (!shipCountry || shipCountry === pr.region) throw new BadRequestException("Choose the destination country");
      const zones = await this.prisma.shippingZone.findMany({ where: { pageId: page.id } });
      const z = pickZone(zones.map((x) => ({ ...x, currency: x.currency as CurrencyCode })), shipCountry);
      if (!z) throw new ConflictException("This maker doesn't ship to that country yet");
      if (z.currency !== currency) throw new ConflictException("Shipping zone currency differs from the maker's currency");
      deliveryMinor = z.feeMinor;
      zone = z;
    }
    if (input.delivery !== "PICKUP" && input.address.trim().length < 4) throw new BadRequestException("Add a delivery address");

    // Method must be one the maker can actually receive.
    let payerPhone = "";
    let payoutTo = "";
    if (input.method === "CARD") {
      if (!pr.exportEnabled || pr.stripeStatus !== "ACTIVE" || !pr.stripeAccountId) throw new ConflictException("This maker doesn't take card payments yet");
      payoutTo = pr.stripeAccountId;
    } else {
      const allowed = pageWallets(pr.region, { momo: page.momoMerchant, airtel: page.airtelMerchant, mpesaTill: pr.mpesaTill });
      if (!allowed.includes(input.method)) throw new ConflictException(`${WALLET_LABEL[input.method]} isn't available for this maker`);
      // The payer's phone must be valid for the country of the wallet (M-Pesa KE ≠ M-Pesa TZ).
      const ph = normalizePhone(input.payerPhone ?? "", pr.region);
      if (!ph.ok) throw new BadRequestException({ message: ph.message, code: "PHONE_INVALID" });
      payerPhone = ph.e164;
      const maker = p.makers.map((m) => m.coopMember).find((m) => m.active && m.momoMerchant);
      payoutTo = input.method === "MPESA" ? pr.mpesaTill : p.payoutTarget === "MAKER" && maker && input.method === "MTN_MOMO" ? maker.momoMerchant : input.method === "AIRTEL_MONEY" ? page.airtelMerchant || page.momoMerchant : page.momoMerchant;
    }
    const maker = p.makers.map((m) => m.coopMember).find((m) => m.active);
    const payoutLabel = page.name;

    // E30 maker-funded discounts in the page's own currency (whole major units, like RWF today).
    const unit = 10 ** CURRENCIES[currency].exponent;
    const discount = await this.discounts.resolve(page.id, p.id, Math.floor(price / unit), userId, input.discountCode);
    const discountMinor = (discount?.amountRwf ?? 0) * unit;
    const itemsMinor = price;
    const totalMinor = itemsMinor - discountMinor + deliveryMinor;

    // "≈" snapshot in the shopper's display currency, plus an RWF-equivalent for legacy reporting columns.
    const snap = await this.fx.snapshot();
    const display = input.displayCurrency && input.displayCurrency !== currency ? input.displayCurrency : null;
    const displayTotalMinor = display ? safeConvert(totalMinor, currency, display, snap.rates) : null;
    const reportingRwf = currency === "RWF" ? totalMinor : (safeConvert(totalMinor, currency, "RWF", snap.rates) ?? 0);

    const code = `NY-${randomBytes(3).toString("hex").toUpperCase()}`;
    const readyBy = new Date(Date.now() + Math.max(1, p.leadTimeDays + (zone?.etaDays ?? 0)) * 86400_000);
    const methodLabel = input.method === "CARD" ? "card (Stripe)" : WALLET_LABEL[input.method];
    const order = await this.prisma.$transaction(async (tx) => {
      if (!p.madeToOrder) {
        const r = await tx.variant.updateMany({ where: { id: variant.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
        if (r.count === 0) throw new ConflictException("Sold out in this colour");
      }
      const created = await tx.order.create({
        data: {
          code,
          pageId: page.id,
          shopperId: userId,
          status: "AWAITING_PAYMENT",
          totalRwf: reportingRwf,
          deliveryMode: input.delivery === "PICKUP" ? "PICKUP" : "DELIVERY",
          deliveryFeeRwf: currency === "RWF" ? deliveryMinor : 0,
          address: shipCountry ? `${input.address} (${shipCountry})` : input.address,
          wallet: input.method,
          payerPhone,
          payoutMsisdn: payoutTo,
          payoutLabel,
          idempotencyKey: key,
          lookId: input.lookId,
          readyBy,
          items: {
            create: {
              productId: p.id,
              variantId: variant.id,
              title: p.title,
              colourName: variant.colourName,
              size: input.size,
              unitPriceRwf: currency === "RWF" ? price : (safeConvert(price, currency, "RWF", snap.rates) ?? 0),
              makerName: maker?.name ?? "",
            },
          },
          events: {
            create: [
              { status: "NEW", note: `Ordered in ${currency}${discount ? ` · ${discount.rule.code ?? discount.rule.label ?? "offer"} −${formatMoney(discountMinor, currency)} (maker-funded)` : ""}${zone ? ` · ships to ${shipCountry} (${zone.name})` : ""}` },
              { status: "AWAITING_PAYMENT", note: input.method === "CARD" ? "Card payment started" : `${methodLabel} request sent to your phone` },
            ],
          },
        },
      });
      await tx.orderMoney.create({
        data: {
          orderId: created.id,
          pageId: page.id,
          currency,
          totalMinor,
          itemsMinor,
          deliveryMinor,
          discountMinor,
          method: input.method,
          shippingZoneId: zone?.id,
          shipCountry,
          displayCurrency: display,
          displayTotalMinor,
          fxRate: display ? `1 USD = ${currency === "USD" ? "1" : snap.rates[currency]} ${currency} = ${display === "USD" ? "1" : snap.rates[display]} ${display}` : null,
          fxSource: display ? snap.source : null,
          fxAt: display ? new Date(snap.fetchedAt) : null,
        },
      });
      if (discount) await this.discounts.redeem(tx, discount, created.id, userId);
      return created;
    });

    const note = `${p.title} from ${page.name}`;
    if (input.method === "CARD") {
      const intent = await this.stripe().createIntent({ account: payoutTo, amountMinor: totalMinor, currency, reference: code, description: note });
      await this.prisma.regionPayment.create({ data: { orderId: order.id, provider: `stripe-${this.stripe().mode}`, providerRef: intent.id, method: "CARD", currency, amountMinor: totalMinor, connectedAccount: payoutTo, merchant: payoutTo } });
      return { ...(await this.checkoutResult(order.id)), stripe: { clientSecret: intent.clientSecret, account: payoutTo, mode: this.stripe().mode, publishableKey: this.stripe().publishableKey } };
    }
    if (currency === "RWF" && input.method !== "MPESA") {
      // Rwanda's MoMo/Airtel keep the existing E05 path (Payment table, simulated handset, reconciliation).
      await this.payments.request(order.id, { amountRwf: totalMinor, payerPhone, merchant: payoutTo, reference: code, wallet: input.method, note });
    } else {
      const w = this.wallet(input.method);
      const { providerRef } = await w.push({ method: input.method, amountMinor: totalMinor, currency, payerPhone, merchant: payoutTo, reference: code, note });
      await this.prisma.regionPayment.create({ data: { orderId: order.id, provider: w.name, providerRef, method: input.method, currency, amountMinor: totalMinor, merchant: payoutTo, payerPhone } });
    }
    return this.checkoutResult(order.id);
  }

  async checkoutResult(orderId: string) {
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return { orderId: o.id, code: o.code, status: o.status, money: await this.money(orderId) };
  }

  async money(orderId: string) {
    const m = await this.prisma.orderMoney.findUnique({ where: { orderId } });
    if (!m) return null;
    const pays = await this.prisma.regionPayment.findMany({ where: { orderId }, orderBy: { createdAt: "desc" } });
    const cur = m.currency as CurrencyCode;
    return {
      currency: cur,
      totalMinor: m.totalMinor,
      itemsMinor: m.itemsMinor,
      deliveryMinor: m.deliveryMinor,
      discountMinor: m.discountMinor,
      refundedMinor: m.refundedMinor,
      method: m.method,
      methodLabel: m.method === "CARD" ? "Card" : WALLET_LABEL[m.method as Wallet],
      shipCountry: m.shipCountry,
      total: formatMoney(m.totalMinor, cur),
      display: m.displayCurrency && m.displayTotalMinor != null ? { currency: m.displayCurrency, totalMinor: m.displayTotalMinor, text: formatMoney(m.displayTotalMinor, m.displayCurrency as CurrencyCode, { approx: true }), source: m.fxSource, at: m.fxAt } : null,
      payment: pays[0] ? { provider: pays[0].provider, ref: pays[0].providerRef, status: pays[0].status, connectedAccount: pays[0].connectedAccount, refundedMinor: pays[0].refundedMinor } : null,
    };
  }

  /** Settle a regional wallet or Stripe payment exactly once (webhook and expiry may race). */
  async settle(providerRef: string, status: "SUCCESSFUL" | "FAILED", raw: object) {
    const pay = await this.prisma.regionPayment.findUnique({ where: { providerRef } });
    if (!pay) throw new NotFoundException("Unknown payment");
    const n = await this.prisma.regionPayment.updateMany({ where: { id: pay.id, status: "PENDING" }, data: { status, raw, settledAt: new Date() } });
    if (n.count === 0) return pay;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: pay.orderId }, include: { page: true, items: true, shopper: true } });
    const total = formatMoney(pay.amountMinor, pay.currency as CurrencyCode);
    const via = pay.method === "CARD" ? "card (Stripe, maker's own account)" : WALLET_LABEL[pay.method as Wallet];
    if (status === "SUCCESSFUL") {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } });
      await serverEvent(this.prisma, "order_paid", order.shopperId, { orderId: order.id, pageId: order.pageId });
      await this.prisma.orderEvent.create({ data: { orderId: order.id, status: "PAID", note: `Paid ${total} directly to ${order.payoutLabel} via ${via}` } });
      const lines = order.items.map((i) => `${i.title} (${i.colourName}, size ${i.size})`).join("; ");
      await this.messaging.send("WHATSAPP", order.page.whatsapp || order.payerPhone, "order_paid_maker", `New paid order ${order.code}: ${lines} · ${total} paid to ${order.payoutLabel} via ${via}. Deliver to: ${order.address || "pickup"}`, order.id);
      await this.messaging.send("WHATSAPP", order.shopper.phone, "order_paid_shopper", `Asante! ${order.code} is paid directly to ${order.payoutLabel} (${total}).`, order.id);
    } else {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      await this.prisma.orderEvent.create({ data: { orderId: order.id, status: "CANCELLED", note: "Payment was declined or timed out. No money was taken." } });
      for (const it of order.items) await this.prisma.variant.updateMany({ where: { id: it.variantId, product: { madeToOrder: false } }, data: { stock: { increment: it.qty } } });
    }
    return pay;
  }

  async handleStripeEvent(event: StripeEventBody) {
    const fresh = await this.prisma.stripeEvent.createMany({ data: [{ id: event.id, type: event.type, account: event.account ?? null }], skipDuplicates: true });
    if (fresh.count === 0) return { ok: true, duplicate: true };
    const o = event.data.object;
    const ref = o.object === "charge" ? (o.payment_intent ?? "") : o.id;
    const pay = await this.prisma.regionPayment.findUnique({ where: { providerRef: ref } });
    const action = stripeAction(event, pay);
    if (action.kind === "ignore") {
      this.log.warn(`stripe ${event.type} ignored: ${action.reason}`);
      return { ok: true, ignored: action.reason };
    }
    if (action.kind === "settle") await this.settle(ref, action.status, { stripeEvent: event.id, type: event.type });
    if (action.kind === "refund") await this.recordRefund(pay!.orderId, action.refundedMinor, `Stripe ${event.id}`);
    return { ok: true, action: action.kind };
  }

  /** Refund (cards: on the maker's Stripe account). Partial refunds allowed; never above the charge. */
  async refund(orderId: string, actorId: string, amountMinor?: number) {
    const pay = await this.prisma.regionPayment.findFirst({ where: { orderId, method: "CARD", status: "SUCCESSFUL" } });
    if (!pay) throw new BadRequestException("Only paid card orders can be refunded here. Mobile money refunds are sent by the maker from their wallet.");
    const amount = amountMinor ?? pay.amountMinor - pay.refundedMinor;
    if (!Number.isSafeInteger(amount) || amount <= 0 || pay.refundedMinor + amount > pay.amountMinor) throw new BadRequestException("Refund exceeds what was paid");
    const r = await this.stripe().refund({ account: pay.connectedAccount!, paymentIntent: pay.providerRef, amountMinor: amount });
    await this.recordRefund(orderId, pay.refundedMinor + amount, `${r.id} by ${actorId}`);
    return this.money(orderId);
  }

  private async recordRefund(orderId: string, refundedTotal: number, note: string) {
    const pay = await this.prisma.regionPayment.findFirst({ where: { orderId, method: "CARD" } });
    if (!pay || refundedTotal <= pay.refundedMinor) return;
    await this.prisma.regionPayment.update({ where: { id: pay.id }, data: { refundedMinor: refundedTotal } });
    await this.prisma.orderMoney.update({ where: { orderId }, data: { refundedMinor: refundedTotal } });
    const full = refundedTotal >= pay.amountMinor;
    if (full) await this.prisma.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    await this.prisma.orderEvent.create({ data: { orderId, status: full ? "CANCELLED" : "PAID", note: `${full ? "Refunded in full" : "Partly refunded"}: ${formatMoney(refundedTotal, pay.currency as CurrencyCode)} back to the card (${note})` } });
  }

  /** Expire wallet pushes nobody answered after 15 minutes. */
  async expirePending() {
    const old = await this.prisma.regionPayment.findMany({ where: { status: "PENDING", method: { not: "CARD" }, createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } });
    for (const p of old) await this.settle(p.providerRef, "FAILED", { source: "timeout" });
    return old.length;
  }
}

function safeConvert(minor: number, from: CurrencyCode, to: CurrencyCode, rates: Parameters<typeof convertMinor>[3]) {
  try {
    return convertMinor(minor, from, to, rates);
  } catch {
    return null;
  }
}
