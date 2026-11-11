import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Global,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, Public } from "../../common/auth";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { payments as paymentsMetric } from "../../common/metrics";
import { MockMomoProvider, MtnMomoProvider, sign, type PaymentProvider, type PayRequest } from "./providers";

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Payments");
  readonly mock = new MockMomoProvider();
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private messaging: MessagingService,
  ) {}

  /** Extension point: a hook that returns true has fully handled the settlement (e.g. custom-order stages, E24). */
  private settleHooks: ((payment: { id: string; orderId: string }, status: "SUCCESSFUL" | "FAILED") => Promise<boolean>)[] = [];
  onSettle(hook: (payment: { id: string; orderId: string }, status: "SUCCESSFUL" | "FAILED") => Promise<boolean>) {
    this.settleHooks.push(hook);
  }

  provider(): PaymentProvider {
    return config.paymentsProvider === "mtn" ? new MtnMomoProvider() : this.mock;
  }

  onModuleInit() {
    // Polling fallback + reconciliation (NFR-REL-04) every minute.
    this.timer = setInterval(() => void this.reconcile().catch((e) => this.log.error(e)), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async request(orderId: string, req: PayRequest) {
    const p = this.provider();
    const { providerRef } = await p.requestToPay(req);
    return this.prisma.payment.create({
      data: { orderId, provider: p.name, providerRef, amountRwf: req.amountRwf, payerPhone: req.payerPhone, merchant: req.merchant },
    });
  }

  /** Apply a provider result exactly once (webhooks and polling may both arrive). */
  async settle(providerRef: string, status: "SUCCESSFUL" | "FAILED", raw: object) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef }, include: { order: { include: { page: true, items: true, shopper: true } } } });
    if (!payment) throw new NotFoundException("Unknown payment");
    if (payment.status !== "PENDING") return payment;
    const updated = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status, webhook: raw, settledAt: new Date() },
    });
    if (updated.count === 0) return payment;
    paymentsMetric.inc({ provider: payment.provider, status });
    for (const hook of this.settleHooks) if (await hook(payment, status)) return payment;
    const order = payment.order;
    if (status === "SUCCESSFUL") {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } });
      await this.prisma.orderEvent.create({ data: { orderId: order.id, status: "PAID", note: `Paid directly to ${order.payoutLabel} via ${order.wallet === "MTN_MOMO" ? "MTN MoMo" : "Airtel Money"}` } });
      const item = order.items[0];
      await this.messaging.send(
        "WHATSAPP",
        order.page.whatsapp || order.payoutMsisdn,
        "order_paid_maker",
        `New paid order ${order.code}: ${item.title} (${item.colourName}, size ${item.size}) · RWF ${order.totalRwf.toLocaleString()} paid to ${order.payoutLabel}. ${order.deliveryMode === "DELIVERY" ? `Deliver to: ${order.address}` : "Pickup"}. Buyer: ${order.shopper.name ?? ""} ${order.shopper.phone}`,
        order.id,
      );
      await this.messaging.send("WHATSAPP", order.shopper.phone, "order_paid_shopper", `Murakoze! ${order.code} is paid directly to ${order.payoutLabel}. We will keep you posted here.`, order.id);
    } else {
      await this.prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      await this.prisma.orderEvent.create({ data: { orderId: order.id, status: "CANCELLED", note: "Payment was declined or timed out. No money was taken." } });
      for (const it of order.items) {
        await this.prisma.variant.updateMany({ where: { id: it.variantId, product: { madeToOrder: false } }, data: { stock: { increment: it.qty } } });
      }
    }
    return payment;
  }

  /** Poll pending payments and flag anything that cannot be matched (daily close in production). */
  async reconcile() {
    const pending = await this.prisma.payment.findMany({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 30_000) } } });
    let settled = 0;
    for (const p of pending) {
      const s = await this.provider().status(p.providerRef).catch(() => "PENDING" as const);
      if (s !== "PENDING") {
        await this.settle(p.providerRef, s, { source: "poll" });
        settled++;
      } else if (Date.now() - p.createdAt.getTime() > 15 * 60_000) {
        await this.settle(p.providerRef, "FAILED", { source: "timeout" });
        settled++;
      }
    }
    const done = await this.prisma.payment.updateMany({ where: { status: "SUCCESSFUL", reconciled: false }, data: { reconciled: true } });
    const unreconciled = await this.prisma.payment.count({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } });
    return { checked: pending.length, settled, reconciled: done.count, unreconciled };
  }
}

@Controller("payments")
export class PaymentsController {
  constructor(
    private payments: PaymentsService,
    private prisma: PrismaService,
    private access: Access,
  ) {}

  /** Provider webhook: HMAC-verified, idempotent. */
  @Public()
  @Post("webhook/:provider")
  @HttpCode(200)
  async webhook(@Param("provider") provider: string, @Req() req: Request, @Body() body: { referenceId?: string; status?: string }) {
    if (provider === "mock") {
      const given = Buffer.from(String(req.headers["x-signature"] ?? ""), "hex");
      const expected = Buffer.from(sign(JSON.stringify(body)), "hex");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException("Bad signature");
    }
    if (!body.referenceId || !["SUCCESSFUL", "FAILED"].includes(String(body.status))) throw new BadRequestException();
    await this.payments.settle(body.referenceId, body.status as "SUCCESSFUL" | "FAILED", body);
    return { ok: true };
  }

  /** Simulated handset (dev only): pending pushes for a phone number. */
  @Public()
  @Get("mock/handset")
  async handset(@Query("phone") phone: string) {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    const p = phone?.startsWith("+") ? phone : `+250${(phone ?? "").replace(/\D/g, "").replace(/^0/, "")}`;
    const rows = await this.prisma.payment.findMany({
      where: { provider: "mock", payerPhone: p },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { order: { select: { code: true, payoutLabel: true, wallet: true } } },
    });
    return rows.map((r) => ({ providerRef: r.providerRef, status: r.status, amountRwf: r.amountRwf, merchant: r.merchant, to: r.order.payoutLabel, code: r.order.code, wallet: r.order.wallet, at: r.createdAt }));
  }

  @Public()
  @Post("mock/handset/:ref")
  @HttpCode(200)
  async approve(@Param("ref") ref: string, @Body() body: unknown) {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    const { pin, approve } = parse(z.object({ pin: z.string().regex(/^\d{4,5}$/), approve: z.boolean() }), body);
    const status = await this.payments.mock.decide(ref, approve && pin !== "0000");
    return { status };
  }

  @Post("reconcile")
  async reconcile(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.payments.reconcile();
  }
}

@Global()
@Module({ controllers: [PaymentsController], providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
