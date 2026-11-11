import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Headers, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { ProductInput } from "@nyambika/contracts";
import type { CoopMember } from "@prisma/client";
import type { Response } from "express";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, Public } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { ASSIST_DAYS, ASSIST_SCOPES, assistAllowed, checkCode, CONSENT_TEXT, hashCode, newCode, type AssistScope } from "./assist";
import { USSD_CODE, ussdStep, type UssdContext, type UssdLocale } from "./ussd";

const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] as const;
const toE164 = (p: string) => (p.startsWith("+") ? p : `+250${p.replace(/\D/g, "").replace(/^0/, "")}`);
const rwf = (n: number) => `RWF ${n.toLocaleString("en-US")}`;
const asLocale = (l?: string | null): UssdLocale => (l === "en" || l === "fr" ? l : "rw");
const monthStart = (d: Date, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
const dayLabel = (d: Date, l: UssdLocale) => d.toLocaleDateString(l === "rw" ? "en-GB" : l === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const SMS = {
  newOrder: {
    rw: (code: string, title: string, size: string, total: number) => `Nyambika: komande nshya ${code}: ${title} (${size}) ${rwf(total)}. Kanda ${USSD_CODE} hanyuma 3 uyemeze.`,
    en: (code: string, title: string, size: string, total: number) => `Nyambika: new order ${code}: ${title} (${size}) ${rwf(total)}. Dial ${USSD_CODE} then 3 to accept.`,
    fr: (code: string, title: string, size: string, total: number) => `Nyambika : nouvelle commande ${code} : ${title} (${size}) ${rwf(total)}. Composez ${USSD_CODE} puis 3 pour accepter.`,
  },
  assistCode: {
    rw: (admin: string, code: string) => `Nyambika: ${admin} arashaka kugufasha. Niba ubyemera, mubwire iyi kode: ${code} cyangwa kanda ${USSD_CODE} hanyuma 4. Ntuyihe undi muntu.`,
    en: (admin: string, code: string) => `Nyambika: ${admin} asks to help you. If you agree, tell them this code: ${code} or dial ${USSD_CODE} then 4. Don't share it with anyone else.`,
    fr: (admin: string, code: string) => `Nyambika : ${admin} demande à vous aider. Si vous êtes d'accord, donnez-lui ce code : ${code} ou composez ${USSD_CODE} puis 4. Ne le partagez avec personne d'autre.`,
  },
  assistOn: {
    rw: (admin: string, days: number) => `Nyambika: ${admin} yemerewe kugufasha iminsi ${days}. Kubihagarika: kanda ${USSD_CODE}.`,
    en: (admin: string, days: number) => `Nyambika: ${admin} may now help you for ${days} days. To stop, dial ${USSD_CODE}.`,
    fr: (admin: string, days: number) => `Nyambika : ${admin} peut vous aider pendant ${days} jours. Pour arrêter, composez ${USSD_CODE}.`,
  },
  accepted: {
    rw: (code: string) => `Nyambika: wemeje komande ${code}. Umuguzi yamenyeshejwe.`,
    en: (code: string) => `Nyambika: you accepted order ${code}. The buyer has been told.`,
    fr: (code: string) => `Nyambika : commande ${code} acceptée. L'acheteur est prévenu.`,
  },
};

const SPOKEN = {
  rw: (name: string, month: string, count: number, total: number, page: number, direct: number, next: string) =>
    `${name}, muri ${month} wagurishije imyenda ${count}, yose hamwe ${total.toLocaleString("en-US")} amafaranga. Koperative izakwishyura ${page.toLocaleString("en-US")} ku wa ${next}. Wakiriye ${direct.toLocaleString("en-US")} kuri MoMo yawe.`,
  en: (name: string, month: string, count: number, total: number, page: number, direct: number, next: string) =>
    `${name}, in ${month} you sold ${count} pieces, ${total.toLocaleString("en-US")} francs in total. Your cooperative pays you ${page.toLocaleString("en-US")} francs on ${next}. You received ${direct.toLocaleString("en-US")} francs directly on your MoMo.`,
  fr: (name: string, month: string, count: number, total: number, page: number, direct: number, next: string) =>
    `${name}, en ${month} vous avez vendu ${count} pièces, ${total.toLocaleString("fr-FR")} francs au total. La coopérative vous paie ${page.toLocaleString("fr-FR")} francs le ${next}. Vous avez reçu ${direct.toLocaleString("fr-FR")} francs directement sur votre MoMo.`,
};

/** Low-literacy cooperative flows (E31): maker summaries, statements, USSD, SMS notices, assisted mode. */
@Injectable()
export class CoopVoiceService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("CoopVoice");
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private access: Access,
    private messaging: MessagingService,
    private consent: ConsentService,
  ) {}

  onModuleInit() {
    // FR-COOP-09: SMS order notices for makers in SMS mode (outbox; idempotent per order + maker).
    this.timer = setInterval(() => void this.smsSweep().catch((e) => this.log.warn(`sms sweep: ${(e as Error).message}`)), 20_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async settings(makerId: string) {
    return (await this.prisma.makerAccess.findUnique({ where: { coopMemberId: makerId } })) ?? { coopMemberId: makerId, voiceMode: false, smsMode: false, locale: "rw" };
  }

  async productIds(makerId: string) {
    return (await this.prisma.productMaker.findMany({ where: { coopMemberId: makerId }, select: { productId: true } })).map((p) => p.productId);
  }

  /** Sales, payout and orders waiting for one maker (their own products only). */
  async summary(maker: CoopMember, now = new Date()) {
    const ids = await this.productIds(maker.id);
    const thisMonth = monthStart(now);
    const lastMonth = monthStart(now, -1);
    const items = await this.prisma.orderItem.findMany({
      where: { productId: { in: ids }, order: { pageId: maker.pageId, status: { in: [...PAID] }, createdAt: { gte: lastMonth } } },
      include: { order: { select: { createdAt: true, payoutMsisdn: true } } },
    });
    const sum = (xs: typeof items) => xs.reduce((s, i) => s + i.unitPriceRwf * i.qty, 0);
    const month = items.filter((i) => i.order.createdAt >= thisMonth);
    const last = items.filter((i) => i.order.createdAt < thisMonth);
    const direct = month.filter((i) => maker.momoMerchant && i.order.payoutMsisdn === maker.momoMerchant);
    const viaPage = month.filter((i) => !(maker.momoMerchant && i.order.payoutMsisdn === maker.momoMerchant));
    const pending = await this.prisma.order.findMany({
      where: { pageId: maker.pageId, status: "PAID", items: { some: { productId: { in: ids } } } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      sales: { monthCount: month.reduce((s, i) => s + i.qty, 0), monthRwf: sum(month), lastCount: last.reduce((s, i) => s + i.qty, 0), lastRwf: sum(last) },
      payout: { nextRwf: sum(viaPage), nextDate: monthStart(now, 1), directRwf: sum(direct) },
      orders: pending.map((o) => ({ id: o.id, code: o.code, title: o.items[0]?.title ?? "", colour: o.items[0]?.colourName ?? "", size: o.items[0]?.size ?? "", totalRwf: o.totalRwf, createdAt: o.createdAt })),
    };
  }

  async pendingGrant(makerId: string) {
    return this.prisma.assistGrant.findFirst({ where: { coopMemberId: makerId, status: "PENDING", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { createdAt: "desc" } });
  }

  async activeGrant(makerId: string) {
    return this.prisma.assistGrant.findFirst({ where: { coopMemberId: makerId, status: "ACTIVE" }, orderBy: { grantedAt: "desc" } });
  }

  /** Accept a paid order on behalf of the maker (USSD, voice mode or assisted mode). Mirrors the order transition. */
  async acceptOrder(maker: CoopMember, orderId: string, actorId: string | null, via: string) {
    const ids = await this.productIds(maker.id);
    const o = await this.prisma.order.findFirst({ where: { id: orderId, pageId: maker.pageId, items: { some: { productId: { in: ids } } } }, include: { page: true, shopper: true } });
    if (!o) throw new NotFoundException("Order not found for this maker");
    if (o.status !== "PAID") throw new BadRequestException(`Order is ${o.status.toLowerCase()}`);
    await this.prisma.order.update({ where: { id: o.id }, data: { status: "ACCEPTED" } });
    await this.prisma.orderEvent.create({ data: { orderId: o.id, status: "ACCEPTED", note: `Accepted by ${maker.name} (${via})`, actorId } });
    await this.messaging.send("WHATSAPP", o.shopper.phone, "order_accepted", `${o.page.name} accepted your order (${o.code}).`, o.id);
    return o;
  }

  async grantAssist(grantId: string, method: string, maker: CoopMember) {
    const g = await this.prisma.assistGrant.findUniqueOrThrow({ where: { id: grantId } });
    if (g.coopMemberId !== maker.id || g.status !== "PENDING") throw new BadRequestException("No request waiting");
    const s = await this.settings(maker.id);
    const locale = asLocale(s.locale);
    const consent = maker.userId ? await this.consent.record(maker.userId, `ASSISTED_MODE:${maker.pageId}`, true, locale) : null;
    const expiresAt = new Date(Date.now() + ASSIST_DAYS * 86_400_000);
    // A new grant replaces any older active one.
    await this.prisma.assistGrant.updateMany({ where: { coopMemberId: maker.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
    const updated = await this.prisma.assistGrant.update({ where: { id: g.id }, data: { status: "ACTIVE", method, grantedAt: new Date(), expiresAt, consentId: consent?.id ?? null } });
    await this.access.audit(maker.userId, "coop.assist_consent_granted", { grantId: g.id, makerId: maker.id, method, scopes: g.scopes, expiresAt, consentId: consent?.id }, maker.pageId);
    const admin = await this.prisma.user.findUnique({ where: { id: g.requestedBy } });
    if (maker.phone) await this.messaging.send("SMS", maker.phone, "coop_assist_on", SMS.assistOn[locale](admin?.name ?? "Admin", ASSIST_DAYS), g.id);
    return updated;
  }

  async ussd(phone: string, text: string) {
    const e164 = toE164(phone);
    const maker = await this.prisma.coopMember.findFirst({ where: { phone: e164, active: true }, orderBy: { createdAt: "asc" } });
    if (!maker) return { text: "END Iyi nimero ntabwo yanditswe nk'umudozi wa koperative. / This number isn't registered as a cooperative maker.", end: true };
    const s = await this.settings(maker.id);
    const sum = await this.summary(maker);
    const pending = await this.pendingGrant(maker.id);
    const admin = pending ? await this.prisma.user.findUnique({ where: { id: pending.requestedBy } }) : null;
    const locale = asLocale(s.locale);
    const ctx: UssdContext = {
      makerName: maker.name,
      locale,
      sales: sum.sales,
      payout: { nextRwf: sum.payout.nextRwf, nextDate: dayLabel(sum.payout.nextDate, locale), directRwf: sum.payout.directRwf },
      orders: sum.orders,
      pendingAssist: pending ? { id: pending.id, adminName: admin?.name ?? "Admin", days: ASSIST_DAYS } : null,
    };
    const r = ussdStep(ctx, text);
    if (r.action?.type === "ACCEPT_ORDER") {
      const o = await this.acceptOrder(maker, r.action.orderId, maker.userId, "USSD");
      await this.access.audit(maker.userId, "coop.ussd_accept", { orderId: o.id, makerId: maker.id }, maker.pageId);
      await this.messaging.send("SMS", e164, "coop_order_accepted", SMS.accepted[locale](o.code), o.id);
    } else if (r.action?.type === "GRANT_ASSIST") {
      await this.grantAssist(r.action.grantId, "USSD", maker);
    } else if (r.action?.type === "DENY_ASSIST") {
      await this.prisma.assistGrant.update({ where: { id: r.action.grantId }, data: { status: "DENIED", revokedAt: new Date() } });
      await this.access.audit(maker.userId, "coop.assist_consent_denied", { grantId: r.action.grantId, makerId: maker.id }, maker.pageId);
    } else if (r.action?.type === "SET_LOCALE") {
      await this.prisma.makerAccess.upsert({ where: { coopMemberId: maker.id }, update: { locale: r.action.locale }, create: { coopMemberId: maker.id, pageId: maker.pageId, locale: r.action.locale } });
    }
    return { text: r.text, end: r.end };
  }

  async smsSweep() {
    const smsMakers = await this.prisma.makerAccess.findMany({ where: { smsMode: true } });
    for (const s of smsMakers) {
      const maker = await this.prisma.coopMember.findUnique({ where: { id: s.coopMemberId } });
      if (!maker?.phone || !maker.active) continue;
      const ids = await this.productIds(maker.id);
      const orders = await this.prisma.order.findMany({
        where: { pageId: maker.pageId, status: "PAID", updatedAt: { gte: new Date(Date.now() - 2 * 86_400_000) }, items: { some: { productId: { in: ids } } } },
        include: { items: true },
      });
      for (const o of orders) {
        const refId = `${o.id}:${maker.id}`;
        if (await this.prisma.notification.count({ where: { template: "coop_order_sms", refId } })) continue;
        const i = o.items[0];
        await this.messaging.send("SMS", maker.phone, "coop_order_sms", SMS.newOrder[asLocale(s.locale)](o.code, i?.title ?? "", i?.size ?? "", o.totalRwf), refId);
      }
    }
  }

  async statement(maker: CoopMember, month: string, locale: UssdLocale) {
    const [y, m] = month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const ids = await this.productIds(maker.id);
    const items = await this.prisma.orderItem.findMany({
      where: { productId: { in: ids }, order: { pageId: maker.pageId, status: { in: [...PAID] }, createdAt: { gte: from, lt: to } } },
      include: { order: { select: { code: true, createdAt: true, payoutMsisdn: true } } },
      orderBy: { order: { createdAt: "asc" } },
    });
    const lines = items.map((i) => ({
      date: i.order.createdAt,
      code: i.order.code,
      title: i.title,
      size: i.size,
      amountRwf: i.unitPriceRwf * i.qty,
      route: maker.momoMerchant && i.order.payoutMsisdn === maker.momoMerchant ? ("DIRECT" as const) : ("COOPERATIVE" as const),
    }));
    const total = lines.reduce((s, l) => s + l.amountRwf, 0);
    const direct = lines.filter((l) => l.route === "DIRECT").reduce((s, l) => s + l.amountRwf, 0);
    const monthName = from.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const next = dayLabel(to, locale);
    return {
      maker: { id: maker.id, name: maker.name },
      month,
      lines,
      totals: { count: lines.length, totalRwf: total, directRwf: direct, cooperativeRwf: total - direct, payoutDate: to },
      spoken: SPOKEN[locale](maker.name.split(" ")[0], monthName, lines.length, total, total - direct, direct, next),
      locale,
    };
  }
}

const AccessPatch = z.object({ voiceMode: z.boolean().optional(), smsMode: z.boolean().optional(), locale: z.enum(["rw", "en", "fr"]).optional() });
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const thisMonth = () => new Date().toISOString().slice(0, 7);

@Controller()
export class CoopVoiceController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private svc: CoopVoiceService,
    private messaging: MessagingService,
    private consent: ConsentService,
  ) {}

  private async maker(pageId: string, makerId: string) {
    const m = await this.prisma.coopMember.findFirst({ where: { id: makerId, pageId } });
    if (!m) throw new NotFoundException("Maker not found");
    return m;
  }

  /** Admin or the maker themself. */
  private async requireAdminOrSelf(userId: string, pageId: string, makerId: string) {
    const m = await this.maker(pageId, makerId);
    if (m.userId === userId) return m;
    await this.access.requirePage(userId, pageId, ["COOP_ADMIN", "PAGE_OWNER"]);
    return m;
  }

  // ---------- Admin: per-maker modes (toggle in the makers screen) ----------

  @Get("pages/:pageId/maker-access")
  async listAccess(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN", "PAGE_OWNER"]);
    const makers = await this.prisma.coopMember.findMany({ where: { pageId }, select: { id: true } });
    const ids = makers.map((m) => m.id);
    const [settings, grants] = await Promise.all([
      this.prisma.makerAccess.findMany({ where: { coopMemberId: { in: ids } } }),
      this.prisma.assistGrant.findMany({ where: { coopMemberId: { in: ids }, status: { in: ["PENDING", "ACTIVE"] } }, orderBy: { createdAt: "desc" } }),
    ]);
    const now = Date.now();
    return ids.map((id) => {
      const s = settings.find((x) => x.coopMemberId === id);
      const active = grants.find((g) => g.coopMemberId === id && g.status === "ACTIVE" && (g.expiresAt?.getTime() ?? 0) > now);
      const pending = grants.find((g) => g.coopMemberId === id && g.status === "PENDING");
      return {
        makerId: id,
        voiceMode: s?.voiceMode ?? false,
        smsMode: s?.smsMode ?? false,
        locale: s?.locale ?? "rw",
        assist: active ? { status: "ACTIVE", id: active.id, expiresAt: active.expiresAt, method: active.method, scopes: active.scopes } : pending ? { status: "PENDING", id: pending.id, createdAt: pending.createdAt } : null,
      };
    });
  }

  @Patch("pages/:pageId/makers/:makerId/access")
  async setAccess(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN"]);
    const m = await this.maker(pageId, makerId);
    const input = parse(AccessPatch, body);
    if (input.smsMode && !m.phone) throw new BadRequestException("Add the maker's phone number first");
    const row = await this.prisma.makerAccess.upsert({ where: { coopMemberId: makerId }, update: input, create: { coopMemberId: makerId, pageId, ...input } });
    await this.access.audit(user.id, "coop.maker_access", { makerId, ...input }, pageId);
    return row;
  }

  // ---------- Maker self (voice-and-icon mode) ----------

  @Get("coop/me/:pageId")
  async me(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    const m = await this.prisma.coopMember.findFirst({ where: { pageId, userId: user.id, active: true } });
    if (!m) throw new NotFoundException("You are not a maker of this cooperative");
    const [s, sum, pending, active, page] = await Promise.all([
      this.svc.settings(m.id),
      this.svc.summary(m),
      this.svc.pendingGrant(m.id),
      this.svc.activeGrant(m.id),
      this.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { name: true } }),
    ]);
    const admin = pending ? await this.prisma.user.findUnique({ where: { id: pending.requestedBy }, select: { name: true } }) : null;
    return {
      maker: { id: m.id, name: m.name, phone: m.phone, momoMerchant: m.momoMerchant },
      page,
      access: { voiceMode: s.voiceMode, smsMode: s.smsMode, locale: s.locale },
      ...sum,
      pendingAssist: pending ? { id: pending.id, adminName: admin?.name ?? "Admin", consentText: pending.consentText, days: ASSIST_DAYS } : null,
      activeAssist: active && (active.expiresAt?.getTime() ?? 0) > Date.now() ? { id: active.id, expiresAt: active.expiresAt } : null,
    };
  }

  @Post("coop/me/:pageId/orders/:orderId/accept")
  async meAccept(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("orderId") orderId: string) {
    const m = await this.prisma.coopMember.findFirst({ where: { pageId, userId: user.id, active: true } });
    if (!m) throw new ForbiddenException();
    const o = await this.svc.acceptOrder(m, orderId, user.id, "voice mode");
    await this.access.audit(user.id, "coop.maker_accept", { orderId: o.id, makerId: m.id }, pageId);
    return { ok: true, code: o.code };
  }

  /** The maker answers an assisted-mode request in the app (tap + spoken consent text). */
  @Post("coop/me/:pageId/assist/:grantId")
  async meAssist(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("grantId") grantId: string, @Body() body: unknown) {
    const { approve } = parse(z.object({ approve: z.boolean() }), body);
    const m = await this.prisma.coopMember.findFirst({ where: { pageId, userId: user.id } });
    if (!m) throw new ForbiddenException();
    if (approve) return this.svc.grantAssist(grantId, "IN_APP", m);
    const g = await this.prisma.assistGrant.findFirstOrThrow({ where: { id: grantId, coopMemberId: m.id } });
    const status = g.status === "ACTIVE" ? "REVOKED" : "DENIED";
    await this.prisma.assistGrant.update({ where: { id: g.id }, data: { status, revokedAt: new Date() } });
    if (g.status === "ACTIVE" && m.userId) await this.consent.record(m.userId, `ASSISTED_MODE:${pageId}`, false, "rw");
    await this.access.audit(user.id, status === "REVOKED" ? "coop.assist_consent_revoked" : "coop.assist_consent_denied", { grantId, makerId: m.id, by: "maker" }, pageId);
    return { status };
  }

  // ---------- Statements (FR-COOP-07) ----------

  @Get("pages/:pageId/makers/:makerId/statement")
  async statement(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string, @Query("month") month?: string, @Query("locale") locale?: string) {
    const m = await this.requireAdminOrSelf(user.id, pageId, makerId);
    return this.svc.statement(m, parse(Month, month ?? thisMonth()), asLocale(locale));
  }

  @Get("pages/:pageId/coop-statement.csv")
  async coopStatement(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Query("month") month: string | undefined, @Query("locale") locale: string | undefined, @Res() res: Response) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN", "PAGE_OWNER"]);
    const mo = parse(Month, month ?? thisMonth());
    const l = asLocale(locale);
    const makers = await this.prisma.coopMember.findMany({ where: { pageId }, orderBy: { name: "asc" } });
    const head = l === "rw" ? ["ukwezi", "umudozi", "byagurishijwe", "yose_rwf", "kuri_momo_ye_rwf", "koperative_imwishyura_rwf"] : ["month", "maker", "pieces", "total_rwf", "direct_to_maker_rwf", "cooperative_pays_rwf"];
    const rows = [head.join(",")];
    for (const m of makers) {
      const s = await this.svc.statement(m, mo, l);
      rows.push([mo, `"${m.name.replace(/"/g, '""')}"`, s.totals.count, s.totals.totalRwf, s.totals.directRwf, s.totals.cooperativeRwf].join(","));
    }
    await this.access.audit(user.id, "coop.statement_export", { month: mo, locale: l }, pageId);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="coop-statement-${mo}.csv"`);
    res.send(rows.join("\n"));
  }

  // ---------- Assisted mode ----------

  @Post("pages/:pageId/makers/:makerId/assist/request")
  async requestAssist(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN"]);
    const { scopes } = parse(z.object({ scopes: z.array(z.enum(ASSIST_SCOPES)).min(1).default(["PRODUCTS", "ORDERS"]) }), body ?? {});
    const m = await this.maker(pageId, makerId);
    if (!m.phone || !m.userId) throw new BadRequestException("The maker needs a phone number to give consent");
    const s = await this.svc.settings(m.id);
    const locale = asLocale(s.locale);
    const [admin, page] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: user.id } }), this.prisma.page.findUniqueOrThrow({ where: { id: pageId } })]);
    await this.prisma.assistGrant.updateMany({ where: { coopMemberId: m.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    const code = newCode();
    const g = await this.prisma.assistGrant.create({
      data: { pageId, coopMemberId: m.id, requestedBy: user.id, scopes, codeHash: "pending", consentText: CONSENT_TEXT[locale](admin.name ?? "Admin", page.name, ASSIST_DAYS) },
    });
    await this.prisma.assistGrant.update({ where: { id: g.id }, data: { codeHash: hashCode(g.id, code) } });
    await this.messaging.send("SMS", m.phone, "coop_assist_code", SMS.assistCode[locale](admin.name ?? "Admin", code), g.id);
    await this.access.audit(user.id, "coop.assist_requested", { grantId: g.id, makerId: m.id, scopes }, pageId);
    return { grantId: g.id, consentText: g.consentText, expiresInMin: 15 };
  }

  /** The maker read the SMS code out to the admin (in person or by phone): that is the recorded consent. */
  @Post("pages/:pageId/makers/:makerId/assist/confirm")
  async confirmAssist(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN"]);
    const { grantId, code } = parse(z.object({ grantId: z.string(), code: z.string().regex(/^\d{6}$/) }), body);
    const m = await this.maker(pageId, makerId);
    const g = await this.prisma.assistGrant.findFirst({ where: { id: grantId, coopMemberId: m.id } });
    if (!g) throw new NotFoundException();
    const r = checkCode(g, code);
    if (!r.ok) {
      await this.prisma.assistGrant.update({ where: { id: g.id }, data: { attempts: { increment: 1 } } });
      await this.access.audit(user.id, "coop.assist_code_failed", { grantId, reason: r.reason }, pageId);
      throw new BadRequestException({ message: r.reason === "WRONG" ? "That code doesn't match" : r.reason === "EXPIRED" ? "The code expired. Ask again." : r.reason === "LOCKED" ? "Too many tries. Ask again." : "No request waiting", code: `ASSIST_${r.reason}` });
    }
    return this.svc.grantAssist(g.id, "SMS_CODE", m);
  }

  @Post("pages/:pageId/makers/:makerId/assist/revoke")
  async revokeAssist(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN"]);
    const m = await this.maker(pageId, makerId);
    const n = await this.prisma.assistGrant.updateMany({ where: { coopMemberId: m.id, status: { in: ["ACTIVE", "PENDING"] } }, data: { status: "REVOKED", revokedAt: new Date() } });
    if (m.userId) await this.consent.record(m.userId, `ASSISTED_MODE:${pageId}`, false, "rw");
    await this.access.audit(user.id, "coop.assist_consent_revoked", { makerId: m.id, by: "admin", grants: n.count }, pageId);
    return { revoked: n.count };
  }

  private async requireAssist(userId: string, pageId: string, makerId: string, scope: AssistScope) {
    await this.access.requirePage(userId, pageId, ["COOP_ADMIN"]);
    const m = await this.maker(pageId, makerId);
    const g = await this.svc.activeGrant(m.id);
    const check = assistAllowed(g, scope);
    if (!check.ok) {
      if (check.reason === "EXPIRED" && g) await this.prisma.assistGrant.update({ where: { id: g.id }, data: { status: "EXPIRED" } });
      throw new ForbiddenException({ message: "The maker hasn't given consent for this (or it ended). Ask them first.", code: `ASSIST_${check.reason}` });
    }
    return { maker: m, grant: g! };
  }

  /** What the admin sees while helping: the maker's own summary (only with consent). */
  @Get("pages/:pageId/assist/:makerId")
  async assistView(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string) {
    const { maker, grant } = await this.requireAssist(user.id, pageId, makerId, "ORDERS");
    return { maker: { id: maker.id, name: maker.name }, grant: { id: grant.id, expiresAt: grant.expiresAt, scopes: grant.scopes }, ...(await this.svc.summary(maker)) };
  }

  @Post("pages/:pageId/assist/:makerId/products")
  async assistProduct(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string, @Body() body: unknown) {
    const { maker, grant } = await this.requireAssist(user.id, pageId, makerId, "PRODUCTS");
    const { variants, makerIds: _ignored, ...input } = parse(ProductInput, body);
    const p = await this.prisma.product.create({
      data: {
        ...input,
        pageId,
        status: "DRAFT",
        // Submitted as the maker (they consented); the admin who typed it is in the audit log.
        submittedById: maker.userId,
        variants: { create: variants },
        makers: { create: [{ coopMemberId: maker.id }] },
      },
      include: { variants: true },
    });
    await this.access.audit(user.id, "coop.assist.product_create", { grantId: grant.id, makerId: maker.id, productId: p.id, title: p.title, onBehalfOf: maker.userId }, pageId);
    return { id: p.id, title: p.title, variants: p.variants.map((v) => ({ id: v.id, colourName: v.colourName })) };
  }

  @Post("pages/:pageId/assist/:makerId/orders/:orderId/accept")
  async assistAccept(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("makerId") makerId: string, @Param("orderId") orderId: string) {
    const { maker, grant } = await this.requireAssist(user.id, pageId, makerId, "ORDERS");
    const o = await this.svc.acceptOrder(maker, orderId, user.id, "assisted by admin");
    await this.access.audit(user.id, "coop.assist.order_accept", { grantId: grant.id, makerId: maker.id, orderId: o.id, onBehalfOf: maker.userId }, pageId);
    return { ok: true, code: o.code };
  }

  // ---------- USSD gateway callback (simulated in dev at /dev/ussd) ----------

  @Public()
  @Post("ussd")
  @Header("content-type", "text/plain; charset=utf-8")
  async ussd(@Body() body: unknown, @Headers("x-ussd-secret") secret?: string) {
    const prod = process.env.NODE_ENV === "production";
    if (prod && (!process.env.USSD_SHARED_SECRET || secret !== process.env.USSD_SHARED_SECRET)) throw new ForbiddenException();
    const { phoneNumber, text } = parse(z.object({ sessionId: z.string().max(80).optional(), serviceCode: z.string().max(20).optional(), phoneNumber: z.string().min(9).max(16), text: z.string().max(120).default("") }), body);
    const r = await this.svc.ussd(phoneNumber, text);
    return r.text;
  }

  /** Dev only: the SMS inbox of a simulated feature phone (reads the outbox). */
  @Public()
  @Get("dev/sms")
  async devSms(@Query("phone") phone: string) {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    const to = toE164(phone ?? "");
    return this.prisma.notification.findMany({ where: { to, channel: "SMS" }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, template: true, body: true, createdAt: true } });
  }
}

@Module({ controllers: [CoopVoiceController], providers: [CoopVoiceService] })
export class CoopVoiceModule {}
