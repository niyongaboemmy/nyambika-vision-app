import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,

  Get,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
} from "@nestjs/common";
import {
  canProgress,
  CustomOrderRequest,
  depositSplit,
  MorphSpec,
  morphPrice,
  PROGRESS_STEPS,
  QuoteInput,
  shareActive,
  type CustomOrderStatus,
  type OrderStatus,
  type ProgressStep,
} from "@nyambika/contracts";
import type { CustomOrder } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE } from "../../common/auth";
import { MessagingService } from "../../common/messaging.service";
import { PushService } from "../../common/push/push.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { PaymentsService } from "../payments/payments.module";
import { MeasurementsService } from "./measurements";
import { MorphService, normaliseSpec } from "./morph";

const toE164 = (p: string) => (p.startsWith("+") ? p : `+250${p.replace(/\D/g, "").replace(/^0/, "")}`);
const Wallet = z.object({ wallet: z.enum(["MTN_MOMO", "AIRTEL_MONEY"]).default("MTN_MOMO") });

/** Backing order status that mirrors each custom-order stage (so /orders and the order inbox stay truthful). */
const ORDER_MIRROR: Partial<Record<CustomOrderStatus, OrderStatus>> = {
  DEPOSIT_PAID: "ACCEPTED",
  CUTTING: "IN_PREPARATION",
  SEWING: "IN_PREPARATION",
  FITTING: "IN_PREPARATION",
  FINISHING: "IN_PREPARATION",
  READY: "READY",
  DELIVERED: "DELIVERED",
};

const STATUS_COPY: Partial<Record<CustomOrderStatus, string>> = {
  QUOTED: "sent you a quote",
  DEPOSIT_PAID: "received your deposit and will start soon",
  CUTTING: "is cutting your fabric",
  SEWING: "is sewing your piece",
  FITTING: "is ready for your fitting",
  FINISHING: "is finishing your piece",
  READY: "says your piece is ready. Pay the balance to collect it",
  DELIVERED: "marked your piece as delivered",
  DECLINED: "can't take this custom order",
};

/**
 * Tailor custom orders (E24, FR-SIZE-04..07): request → quote → deposit (Mobile Money straight to the
 * tailor) → fittings → progress → balance → delivered. Payments ride on a backing Order so the existing
 * PaymentsService, simulated handset and reconciliation are reused; a settle hook routes them here.
 */
@Injectable()
export class CustomOrdersService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("CustomOrders");
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private access: Access,
    private payments: PaymentsService,
    private messaging: MessagingService,
    private measurements: MeasurementsService,
    private morph: MorphService,
    private push: PushService,
  ) {}

  onModuleInit() {
    this.payments.onSettle((p, status) => this.onPaymentSettled(p.id, status));
    this.timer = setInterval(() => void this.sendReminders().catch((e) => this.log.error(e)), 10 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async event(customOrderId: string, status: string, note = "", actorId: string | null = null) {
    await this.prisma.customOrderEvent.create({ data: { customOrderId, status, note, actorId } });
  }

  private async load(id: string) {
    const co = await this.prisma.customOrder.findUnique({ where: { id } });
    if (!co) throw new NotFoundException("Custom order not found");
    return co;
  }

  private async asShopper(userId: string, id: string) {
    const co = await this.load(id);
    if (co.shopperId !== userId) throw new NotFoundException("Custom order not found");
    return co;
  }

  private async asTailor(userId: string, id: string) {
    const co = await this.load(id);
    await this.access.requirePage(userId, co.pageId, MANAGE);
    return co;
  }

  private async move(co: CustomOrder, to: CustomOrderStatus, note: string, actorId: string | null, data: Record<string, unknown> = {}) {
    const updated = await this.prisma.customOrder.updateMany({ where: { id: co.id, status: co.status }, data: { status: to, ...data } });
    if (updated.count === 0) throw new ConflictException("This order just changed. Refresh and try again.");
    await this.event(co.id, to, note, actorId);
    const mirror = ORDER_MIRROR[to];
    if (mirror && co.orderId) {
      await this.prisma.order.update({ where: { id: co.orderId }, data: { status: mirror } });
      await this.prisma.orderEvent.create({ data: { orderId: co.orderId, status: mirror, note: `${to.replace(/_/g, " ").toLowerCase()}${note ? `: ${note}` : ""}`, actorId } });
      // E38: cutting → sewing → … drive the same live activity as ready-made orders.
      await this.push.orderUpdate(co.orderId, { craft: (["CUTTING", "SEWING", "FITTING", "FINISHING"] as string[]).includes(to) ? (to as "CUTTING") : null });
    }
    const copy = STATUS_COPY[to];
    if (copy) {
      const [page, shopper] = await Promise.all([
        this.prisma.page.findUniqueOrThrow({ where: { id: co.pageId } }),
        this.prisma.user.findUniqueOrThrow({ where: { id: co.shopperId } }),
      ]);
      await this.messaging.send("WHATSAPP", shopper.phone, `custom_${to.toLowerCase()}`, `${page.name} ${copy} (${co.code}).${note ? ` “${note}”` : ""}`, co.id);
      if (to === "QUOTED") {
        const fresh = await this.prisma.customOrder.findUniqueOrThrow({ where: { id: co.id } });
        await this.push.event(co.shopperId, "custom.quote", { url: `/custom/${co.id}`, refId: co.id, vars: { maker: page.name, item: co.title, price: (fresh.quotePriceRwf ?? 0).toLocaleString("en-US") } });
      }
    }
  }

  // ── shopper ────────────────────────────────────────────────────────────────

  async request(userId: string, body: unknown) {
    const req = parse(CustomOrderRequest, body);
    const page = await this.prisma.page.findUnique({ where: { id: req.pageId } });
    if (!page || page.status !== "PUBLISHED" || page.memberType !== "TAILOR") throw new NotFoundException("This tailor isn't taking custom orders");
    let title = "Custom piece";
    let estimate = 0;
    let spec: MorphSpec = { hue: null, length: null, sleeve: null };
    if (req.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: req.productId }, include: { variants: true } });
      if (!product || product.pageId !== page.id || product.status !== "PUBLISHED") throw new NotFoundException("This item isn't available");
      if (req.variantId && !product.variants.some((v) => v.id === req.variantId)) throw new BadRequestException("Unknown colour");
      const t = await this.morph.template(product.id);
      if (!t && !product.madeToOrder) throw new BadRequestException("This piece isn't made to order");
      title = product.title;
      estimate = product.priceRwf;
      if (t && req.spec) {
        spec = normaliseSpec(req.spec, t.options);
        try {
          estimate = morphPrice(product.priceRwf, t.options, spec).totalRwf;
        } catch (e) {
          throw new BadRequestException((e as Error).message);
        }
      }
    }
    if (req.serviceId) {
      const svc = await this.prisma.tailorService.findFirst({ where: { id: req.serviceId, pageId: page.id, active: true } });
      if (!svc) throw new NotFoundException("This service isn't available");
      if (!req.productId) {
        title = svc.title;
        estimate = svc.startingPriceRwf;
      }
    }
    let previewSource: string | null = null;
    if (req.sharePreview) {
      if (!req.renderId) throw new BadRequestException("Pick the preview you want to share");
      const g = await this.prisma.generation.findFirst({ where: { id: req.renderId, userId, status: "DELIVERED" } });
      if (!g?.outputPath) throw new BadRequestException("That preview isn't ready yet");
      previewSource = g.outputPath;
    }
    const code = `NC-${randomBytes(3).toString("hex").toUpperCase()}`;
    const co = await this.prisma.customOrder.create({
      data: {
        code,
        pageId: page.id,
        shopperId: userId,
        productId: req.productId,
        variantId: req.variantId,
        serviceId: req.serviceId,
        spec: { ...spec, renderId: req.renderId ?? null },
        title,
        estimateRwf: estimate,
        size: req.size,
        note: req.note,
      },
    });
    if (previewSource) {
      // A copy the tailor may see; the shopper's own look stays private and is never linked.
      const previewPath = await this.storage.put(`private/custom-orders/${co.id}/preview.png`, await this.storage.read(previewSource));
      await this.prisma.customOrder.update({ where: { id: co.id }, data: { previewPath } });
      await this.access.audit(userId, "CUSTOM_PREVIEW_SHARED", { customOrderId: co.id }, page.id);
    }
    if (req.shareMeasurements) await this.measurements.grant(userId, page.id, co.id, req.shareDays);
    await this.event(co.id, "REQUESTED", req.note, userId);
    const shopper = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.messaging.send(
      "WHATSAPP",
      page.whatsapp || page.momoMerchant,
      "custom_requested_tailor",
      `New custom order ${code}: ${title}${spec.hue !== null || spec.length || spec.sleeve ? " (customised)" : ""} from ${shopper.name ?? shopper.phone}. Estimate RWF ${estimate.toLocaleString()}. Send your quote in the Studio.`,
      co.id,
    );
    return this.view(co.id, userId);
  }

  async mine(userId: string) {
    const rows = await this.prisma.customOrder.findMany({ where: { shopperId: userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return Promise.all(rows.map((r) => this.view(r.id, userId)));
  }

  /** Accept the quote and pay the deposit by Mobile Money, straight to the tailor's merchant account. */
  async accept(userId: string, id: string, body: unknown) {
    const { wallet } = parse(Wallet, body ?? {});
    const co = await this.asShopper(userId, id);
    if (co.status !== "QUOTED") throw new BadRequestException("There is no quote to accept yet");
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: co.pageId } });
    if (!page.momoMerchant) throw new ConflictException("This tailor hasn't set up Mobile Money yet. Chat on WhatsApp instead.");
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let orderId = co.orderId;
    if (!orderId) {
      const order = await this.prisma.order.create({
        data: {
          code: co.code,
          pageId: co.pageId,
          shopperId: userId,
          status: "AWAITING_PAYMENT",
          totalRwf: co.quotePriceRwf!,
          deliveryMode: "PICKUP",
          wallet,
          payerPhone: toE164(user.phone),
          payoutMsisdn: page.momoMerchant,
          payoutLabel: page.name,
          idempotencyKey: `custom:${co.id}`,
          readyBy: new Date(Date.now() + (co.leadTimeDays ?? 7) * 86400_000),
          items: co.variantId && co.productId
            ? { create: { productId: co.productId, variantId: co.variantId, title: `${co.title} (tailor-made)`, colourName: await this.colourLabel(co), size: co.size ?? "Custom", unitPriceRwf: co.quotePriceRwf! } }
            : undefined,
          events: { create: [{ status: "AWAITING_PAYMENT", note: `Custom order ${co.code}: deposit requested` }] },
        },
      });
      orderId = order.id;
    }
    await this.move(co, "DEPOSIT_PENDING", "Deposit requested on your phone", userId, { orderId });
    await this.pay(co.id, orderId, "DEPOSIT", co.depositRwf!, wallet, `Deposit for ${co.title} (${co.code}) to ${page.name}`);
    return this.view(co.id, userId);
  }

  private async colourLabel(co: CustomOrder) {
    const spec = co.spec as MorphSpec;
    const v = co.variantId ? await this.prisma.variant.findUnique({ where: { id: co.variantId } }) : null;
    return spec.hue !== null && spec.hue !== undefined ? `Custom hue ${spec.hue}°` : (v?.colourName ?? "");
  }

  private async pay(customOrderId: string, orderId: string, stage: "DEPOSIT" | "BALANCE", amountRwf: number, wallet: "MTN_MOMO" | "AIRTEL_MONEY", note: string) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const payment = await this.payments.request(orderId, { amountRwf, payerPhone: order.payerPhone, merchant: order.payoutMsisdn, reference: order.code, wallet, note });
    await this.prisma.customOrderPayment.create({ data: { customOrderId, paymentId: payment.id, stage, amountRwf } });
  }

  async payBalance(userId: string, id: string, body: unknown) {
    const { wallet } = parse(Wallet, body ?? {});
    const co = await this.asShopper(userId, id);
    if (co.status !== "READY") throw new BadRequestException("The balance is due when your piece is ready");
    if (!co.balanceRwf) throw new BadRequestException("Nothing left to pay");
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: co.pageId } });
    await this.move(co, "BALANCE_PENDING", "Balance requested on your phone", userId);
    await this.pay(co.id, co.orderId!, "BALANCE", co.balanceRwf, wallet, `Balance for ${co.title} (${co.code}) to ${page.name}`);
    return this.view(co.id, userId);
  }

  async cancel(userId: string, id: string) {
    const co = await this.asShopper(userId, id);
    if (!["REQUESTED", "QUOTED"].includes(co.status)) throw new BadRequestException("This order can't be cancelled here any more. Chat with the tailor.");
    await this.move(co, "CANCELLED", "Cancelled by you", userId);
    await this.endShares(co, "order cancelled");
    return this.view(co.id, userId);
  }

  async book(userId: string, id: string, body: unknown) {
    const { slotId } = parse(z.object({ slotId: z.string() }), body);
    const co = await this.asShopper(userId, id);
    if (!["DEPOSIT_PAID", "CUTTING", "SEWING", "FITTING", "FINISHING"].includes(co.status)) throw new BadRequestException("Book a fitting after the deposit is paid");
    const slot = await this.prisma.appointmentSlot.findFirst({ where: { id: slotId, pageId: co.pageId } });
    if (!slot || slot.startsAt < new Date()) throw new NotFoundException("That time isn't available");
    // Free any earlier booking for this order, then claim the slot atomically.
    await this.prisma.appointmentSlot.updateMany({ where: { customOrderId: co.id, id: { not: slotId } }, data: { bookedById: null, customOrderId: null, bookedAt: null, reminderSentAt: null } });
    const r = await this.prisma.appointmentSlot.updateMany({ where: { id: slotId, bookedById: null }, data: { bookedById: userId, customOrderId: co.id, bookedAt: new Date() } });
    if (r.count === 0 && slot.customOrderId !== co.id) throw new ConflictException("Someone just booked that time. Pick another.");
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: co.pageId } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const when = slot.startsAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
    await this.event(co.id, "FITTING_BOOKED", `Fitting ${when} at ${slot.location || page.sector}`, userId);
    await this.messaging.send("WHATSAPP", user.phone, "fitting_booked_shopper", `Fitting booked with ${page.name}: ${when} at ${slot.location || page.sector} (${co.code}). We'll remind you the day before.`, co.id);
    await this.messaging.send("WHATSAPP", page.whatsapp || page.momoMerchant, "fitting_booked_tailor", `Fitting booked: ${when}, ${user.name ?? user.phone} for ${co.code} (${co.title}).`, co.id);
    return this.view(co.id, userId);
  }

  async openSlots(userId: string, id: string) {
    const co = await this.asShopper(userId, id);
    const slots = await this.prisma.appointmentSlot.findMany({
      where: { pageId: co.pageId, startsAt: { gt: new Date() }, OR: [{ bookedById: null }, { customOrderId: co.id }] },
      orderBy: { startsAt: "asc" },
      take: 40,
    });
    return slots.map((s) => ({ id: s.id, startsAt: s.startsAt, durationMin: s.durationMin, location: s.location, mine: s.customOrderId === co.id }));
  }

  // ── tailor ─────────────────────────────────────────────────────────────────

  async inbox(userId: string, pageId: string) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const rows = await this.prisma.customOrder.findMany({ where: { pageId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
    return Promise.all(rows.map((r) => this.view(r.id, userId, true)));
  }

  async quote(userId: string, id: string, body: unknown) {
    const q = parse(QuoteInput, body);
    const co = await this.asTailor(userId, id);
    if (!["REQUESTED", "QUOTED"].includes(co.status)) throw new BadRequestException("This order already has an accepted quote");
    const { depositRwf, balanceRwf } = depositSplit(q.priceRwf, q.depositPct);
    const fresh = await this.load(co.id);
    await this.move(fresh, "QUOTED", `RWF ${q.priceRwf.toLocaleString()} · ${q.depositPct}% deposit · ready in ${q.leadTimeDays} days${q.note ? ` · ${q.note}` : ""}`, userId, {
      quotePriceRwf: q.priceRwf,
      depositPct: q.depositPct,
      leadTimeDays: q.leadTimeDays,
      quoteNote: q.note,
      quotedAt: new Date(),
      depositRwf,
      balanceRwf,
    });
    await this.access.audit(userId, "CUSTOM_QUOTE_SENT", { customOrderId: co.id, ...q, depositRwf }, co.pageId);
    return this.view(co.id, userId, true);
  }

  async progress(userId: string, id: string, body: unknown) {
    const { to, note } = parse(z.object({ to: z.enum(PROGRESS_STEPS), note: z.string().max(300).default("") }), body);
    const co = await this.asTailor(userId, id);
    if (!canProgress(co.status as CustomOrderStatus, to as ProgressStep)) throw new BadRequestException(`Can't move from ${co.status} to ${to}`);
    await this.move(co, to, note, userId, to === "READY" ? { readyBy: new Date() } : {});
    return this.view(co.id, userId, true);
  }

  async deliver(userId: string, id: string) {
    const co = await this.asTailor(userId, id);
    const ok = co.status === "BALANCE_PAID" || (co.status === "READY" && !co.balanceRwf);
    if (!ok) throw new BadRequestException("Deliver once the balance is paid");
    await this.move(co, "DELIVERED", "", userId);
    await this.endShares(co, "order delivered");
    return this.view(co.id, userId, true);
  }

  async decline(userId: string, id: string, body: unknown) {
    const { note } = parse(z.object({ note: z.string().max(300).default("") }), body ?? {});
    const co = await this.asTailor(userId, id);
    if (!["REQUESTED", "QUOTED"].includes(co.status)) throw new BadRequestException("Only open requests can be declined");
    await this.move(co, "DECLINED", note, userId);
    await this.endShares(co, "order declined");
    return this.view(co.id, userId, true);
  }

  /** A share is for one custom order: it ends when the order ends (and always at its expiry). */
  private async endShares(co: CustomOrder, reason: string) {
    const r = await this.prisma.measurementShare.updateMany({ where: { customOrderId: co.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count) await this.access.audit(null, "MEASUREMENT_SHARE_ENDED", { customOrderId: co.id, reason }, co.pageId);
  }

  // ── payments ───────────────────────────────────────────────────────────────

  async onPaymentSettled(paymentId: string, status: "SUCCESSFUL" | "FAILED") {
    const link = await this.prisma.customOrderPayment.findUnique({ where: { paymentId }, include: { customOrder: true } });
    if (!link) return false;
    const co = link.customOrder;
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: co.pageId } });
    const ok = status === "SUCCESSFUL";
    const amount = `RWF ${link.amountRwf.toLocaleString()}`;
    if (link.stage === "DEPOSIT" && co.status === "DEPOSIT_PENDING") {
      await this.move(co, ok ? "DEPOSIT_PAID" : "QUOTED", ok ? `Deposit ${amount} paid directly to ${page.name}` : "Deposit declined or timed out. No money was taken.", null);
      if (ok) {
        await this.prisma.orderEvent.create({ data: { orderId: co.orderId!, status: "PAID", note: `Deposit ${amount} paid directly to ${page.name}` } });
        await this.messaging.send("WHATSAPP", page.whatsapp || page.momoMerchant, "custom_deposit_tailor", `Deposit ${amount} received for ${co.code} (${co.title}). Time to cut!`, co.id);
      }
    } else if (link.stage === "BALANCE" && co.status === "BALANCE_PENDING") {
      await this.move(co, ok ? "BALANCE_PAID" : "READY", ok ? `Balance ${amount} paid directly to ${page.name}` : "Balance payment declined or timed out. No money was taken.", null);
      if (ok) {
        await this.prisma.order.update({ where: { id: co.orderId! }, data: { status: "PAID" } });
        await this.prisma.orderEvent.create({ data: { orderId: co.orderId!, status: "PAID", note: `Balance ${amount} paid directly to ${page.name}. Fully paid.` } });
        await this.messaging.send("WHATSAPP", page.whatsapp || page.momoMerchant, "custom_balance_tailor", `Balance ${amount} received for ${co.code}. Fully paid: hand it over!`, co.id);
      }
    }
    return true;
  }

  // ── reminders ──────────────────────────────────────────────────────────────

  /** WhatsApp reminders for fittings starting within 24 h (outbox; swept every 10 minutes). */
  async sendReminders(now = new Date()) {
    const soon = await this.prisma.appointmentSlot.findMany({
      where: { bookedById: { not: null }, reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600_000) } },
    });
    for (const s of soon) {
      const claimed = await this.prisma.appointmentSlot.updateMany({ where: { id: s.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!claimed.count) continue;
      const [page, user, co] = await Promise.all([
        this.prisma.page.findUniqueOrThrow({ where: { id: s.pageId } }),
        this.prisma.user.findUniqueOrThrow({ where: { id: s.bookedById! } }),
        s.customOrderId ? this.prisma.customOrder.findUnique({ where: { id: s.customOrderId } }) : null,
      ]);
      const when = s.startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
      await this.messaging.send("WHATSAPP", user.phone, "fitting_reminder", `Reminder: fitting with ${page.name} ${when} at ${s.location || page.sector}${co ? ` (${co.code})` : ""}. Wear the shoes you'll pair it with.`, s.customOrderId ?? s.id);
    }
    return soon.length;
  }

  // ── view ───────────────────────────────────────────────────────────────────

  async view(id: string, viewerId: string, forTailor = false) {
    const co = await this.prisma.customOrder.findUniqueOrThrow({
      where: { id },
      include: { events: { orderBy: { createdAt: "asc" } }, payments: { orderBy: { createdAt: "asc" } } },
    });
    const [page, product, variant, service, slot, share, shopper] = await Promise.all([
      this.prisma.page.findUniqueOrThrow({ where: { id: co.pageId } }),
      co.productId ? this.prisma.product.findUnique({ where: { id: co.productId } }) : null,
      co.variantId ? this.prisma.variant.findUnique({ where: { id: co.variantId } }) : null,
      co.serviceId ? this.prisma.tailorService.findUnique({ where: { id: co.serviceId } }) : null,
      this.prisma.appointmentSlot.findFirst({ where: { customOrderId: co.id } }),
      this.prisma.measurementShare.findFirst({ where: { customOrderId: co.id }, orderBy: { createdAt: "desc" } }),
      forTailor ? this.prisma.user.findUnique({ where: { id: co.shopperId } }) : null,
    ]);
    const payments = co.payments.length
      ? await this.prisma.payment.findMany({ where: { id: { in: co.payments.map((p) => p.paymentId) } } })
      : [];
    const pById = new Map(payments.map((p) => [p.id, p]));
    const spec = co.spec as MorphSpec & { renderId?: string | null };
    let image: string | null = null;
    if (forTailor) {
      image = co.previewPath ? this.storage.sign(co.previewPath, "look") : null;
    } else if (spec.renderId) {
      const g = await this.prisma.generation.findFirst({ where: { id: spec.renderId, userId: viewerId, status: "DELIVERED" } });
      image = g?.outputPath ? this.storage.sign(g.outputPath, "look") : null;
    }
    return {
      id: co.id,
      code: co.code,
      status: co.status,
      title: co.title,
      spec: { hue: spec.hue ?? null, length: spec.length ?? null, sleeve: spec.sleeve ?? null },
      size: co.size,
      note: co.note,
      estimateRwf: co.estimateRwf,
      quote: co.quotePriceRwf
        ? { priceRwf: co.quotePriceRwf, depositPct: co.depositPct!, depositRwf: co.depositRwf!, balanceRwf: co.balanceRwf!, leadTimeDays: co.leadTimeDays!, note: co.quoteNote ?? "", at: co.quotedAt }
        : null,
      image,
      previewShared: Boolean(co.previewPath),
      productImage: variant?.imagePath ? `/api/files/${variant.imagePath}` : null,
      colour: variant ? { name: variant.colourName, hex: variant.colourHex } : null,
      product: product ? { id: product.id, title: product.title, category: product.category } : null,
      service: service ? { id: service.id, title: service.title } : null,
      page: { id: page.id, name: page.name, handle: page.handle, whatsapp: page.whatsapp, sector: page.sector },
      orderId: co.orderId,
      readyBy: co.readyBy,
      fitting: slot ? { id: slot.id, startsAt: slot.startsAt, durationMin: slot.durationMin, location: slot.location || page.sector } : null,
      measurementShare: share ? { active: shareActive(share), expiresAt: share.expiresAt, revokedAt: share.revokedAt, id: share.id } : null,
      payments: co.payments.map((p) => ({ stage: p.stage, amountRwf: p.amountRwf, status: pById.get(p.paymentId)?.status ?? "PENDING", at: p.createdAt })),
      events: co.events.map((e) => ({ status: e.status, note: e.note, at: e.createdAt })),
      createdAt: co.createdAt,
      updatedAt: co.updatedAt,
      ...(forTailor && shopper ? { buyer: shopper.deletedAt ? { name: "Deleted account", phone: "" } : { name: shopper.name, phone: shopper.phone } } : {}),
    };
  }

  async get(userId: string, id: string) {
    const co = await this.load(id);
    if (co.shopperId === userId) return this.view(id, userId);
    await this.access.requirePage(userId, co.pageId, MANAGE);
    return this.view(id, userId, true);
  }

  async exportFor(userId: string) {
    return this.prisma.customOrder.findMany({ where: { shopperId: userId }, include: { events: true, payments: true } });
  }

  /** Remove shared previews (personal images). Orders themselves are retained for accounting, like Order. */
  async deleteFor(userId: string) {
    const rows = await this.prisma.customOrder.findMany({ where: { shopperId: userId, previewPath: { not: null } } });
    for (const r of rows) await this.storage.remove(r.previewPath!);
    await this.prisma.customOrder.updateMany({ where: { shopperId: userId }, data: { previewPath: null, note: "" } });
    return rows.length;
  }
}

@Controller()
export class CustomOrdersController {
  constructor(private orders: CustomOrdersService) {}

  @Post("custom-orders")
  request(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.orders.request(user.id, body);
  }

  @Get("custom-orders/mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.orders.mine(user.id);
  }

  @Get("custom-orders/:id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.get(user.id, id);
  }

  @Post("custom-orders/:id/accept")
  accept(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.orders.accept(user.id, id, body);
  }

  @Post("custom-orders/:id/pay-balance")
  payBalance(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.orders.payBalance(user.id, id, body);
  }

  @Post("custom-orders/:id/cancel")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.cancel(user.id, id);
  }

  @Get("custom-orders/:id/slots")
  slots(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.openSlots(user.id, id);
  }

  @Post("custom-orders/:id/book")
  book(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.orders.book(user.id, id, body);
  }

  @Get("pages/:pageId/custom-orders")
  inbox(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    return this.orders.inbox(user.id, pageId);
  }

  @Post("custom-orders/:id/quote")
  quote(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.orders.quote(user.id, id, body);
  }

  @Post("custom-orders/:id/progress")
  progress(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.orders.progress(user.id, id, body);
  }

  @Post("custom-orders/:id/deliver")
  deliver(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.deliver(user.id, id);
  }

  @Post("custom-orders/:id/decline")
  decline(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.orders.decline(user.id, id, body);
  }
}

