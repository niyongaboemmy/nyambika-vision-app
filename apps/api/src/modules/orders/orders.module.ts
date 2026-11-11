import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Module, NotFoundException, Param, Post, Res } from "@nestjs/common";
import { HoldToBuyRequest, ORDER_TRANSITIONS, type OrderStatus } from "@nyambika/contracts";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE } from "../../common/auth";
import { MessagingService } from "../../common/messaging.service";
import { PushService } from "../../common/push/push.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { LooksModule, LooksService } from "../looks/looks.module";
import { PaymentsService } from "../payments/payments.module";
import { DiscountService, DiscountsModule } from "../growth/discounts";

const DELIVERY_FEE_RWF = 2000;
const STATUS_COPY: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: "accepted your order",
  DECLINED: "couldn't take this order. Your refund is handled by the maker",
  IN_PREPARATION: "is sewing / preparing your order",
  READY: "says your order is ready for pickup",
  SHIPPED: "sent your order out for delivery",
  DELIVERED: "marked your order as delivered",
};

const toE164 = (p: string) => (p.startsWith("+") ? p : `+250${p.replace(/\D/g, "").replace(/^0/, "")}`);

@Controller()
export class OrdersController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private payments: PaymentsService,
    private messaging: MessagingService,
    private looks: LooksService,
    private discounts: DiscountService,
    private push: PushService,
  ) {}

  /**
   * Hold to buy (US-11.1, CR-06): auto-filled size, delivery and wallet; a Mobile Money push goes
   * to the shopper and the money lands in the maker's merchant account. Idempotent on retry.
   */
  @Post("orders")
  async hold(@CurrentUser() user: AuthUser, @Headers("idempotency-key") key: string | undefined, @Body() body: unknown) {
    if (!key || key.length < 8) throw new BadRequestException("Idempotency-Key header required");
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.shopperId !== user.id) throw new ConflictException();
      return this.view(existing.id);
    }
    const req = parse(HoldToBuyRequest, body);
    const variant = await this.prisma.variant.findUnique({
      where: { id: req.variantId },
      include: { product: { include: { page: true, makers: { include: { coopMember: true } } } } },
    });
    if (!variant || variant.product.status !== "PUBLISHED" || variant.product.page.status !== "PUBLISHED") throw new NotFoundException("This item isn't available");
    const p = variant.product;
    if (!variant.sizes.includes(req.size)) throw new BadRequestException(`Size ${req.size} isn't offered`);
    if (!p.madeToOrder && variant.stock < 1) throw new ConflictException("Sold out in this colour");

    // Payout destination (FR-COOP-05): maker's own account if configured, else the page's.
    const maker = p.makers.map((m) => m.coopMember).find((m) => m.active && m.momoMerchant);
    const toMaker = p.payoutTarget === "MAKER" && maker;
    const payoutMsisdn = toMaker ? maker!.momoMerchant : p.page.momoMerchant;
    const payoutLabel = toMaker ? `${maker!.name} (${p.page.name})` : p.page.name;
    if (!payoutMsisdn) throw new ConflictException("This maker hasn't set up Mobile Money yet. Order on WhatsApp instead.");

    const fee = req.delivery === "DELIVERY" ? DELIVERY_FEE_RWF : 0;
    // E30: maker-funded discount code / time-boxed offer (never platform-funded, never on the delivery fee).
    const discount = await this.discounts.resolve(p.pageId, p.id, p.priceRwf, user.id, req.discountCode);
    const total = p.priceRwf - (discount?.amountRwf ?? 0) + fee;
    const code = `NY-${randomBytes(3).toString("hex").toUpperCase()}`;
    const readyBy = new Date(Date.now() + Math.max(1, p.leadTimeDays) * 86400_000);
    const order = await this.prisma.$transaction(async (tx) => {
      if (!p.madeToOrder) {
        const r = await tx.variant.updateMany({ where: { id: variant.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
        if (r.count === 0) throw new ConflictException("Sold out in this colour");
      }
      const created = await tx.order.create({
        data: {
          code,
          pageId: p.pageId,
          shopperId: user.id,
          status: "AWAITING_PAYMENT",
          totalRwf: total,
          deliveryMode: req.delivery,
          deliveryFeeRwf: fee,
          address: req.address,
          wallet: req.wallet,
          payerPhone: toE164(req.payerPhone),
          payoutMsisdn,
          payoutLabel,
          idempotencyKey: key,
          lookId: req.lookId,
          readyBy,
          items: {
            create: {
              productId: p.id,
              variantId: variant.id,
              title: p.title,
              colourName: variant.colourName,
              size: req.size,
              unitPriceRwf: p.priceRwf,
              makerName: maker?.name ?? "",
            },
          },
          events: {
            create: [
              { status: "NEW", note: discount ? `Held to buy · ${discount.rule.code ?? discount.rule.label ?? "offer"} −RWF ${discount.amountRwf.toLocaleString("en-US")} (maker-funded)` : "Held to buy" },
              { status: "AWAITING_PAYMENT", note: "Mobile Money request sent to your phone" },
            ],
          },
        },
      });
      if (discount) await this.discounts.redeem(tx, discount, created.id, user.id);
      return created;
    });
    if (req.lookId) void this.looks.render(req.lookId, "HD").catch(() => undefined);
    await this.payments.request(order.id, {
      amountRwf: total,
      payerPhone: order.payerPhone,
      merchant: payoutMsisdn,
      reference: code,
      wallet: req.wallet,
      note: `${p.title} from ${p.page.name}`,
    });
    return this.view(order.id);
  }

  @Get("orders/mine")
  async mine(@CurrentUser() user: AuthUser) {
    const orders = await this.prisma.order.findMany({ where: { shopperId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return Promise.all(orders.map((o) => this.view(o.id)));
  }

  @Get("orders/:id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException();
    if (o.shopperId !== user.id) await this.access.requirePage(user.id, o.pageId, MANAGE);
    return this.view(id);
  }

  /** Member order inbox (FR-ORD-04). Makers see buyer contact for fulfilment only, never twins or looks (OP-5). */
  @Get("pages/:pageId/orders")
  async inbox(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const orders = await this.prisma.order.findMany({ where: { pageId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return Promise.all(orders.map((o) => this.view(o.id, true)));
  }

  /** FR-ORD-11: the page owns its order data. */
  @Get("pages/:pageId/orders.csv")
  async export(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Res() res: Response) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const orders = await this.prisma.order.findMany({ where: { pageId }, include: { items: true, shopper: true }, orderBy: { createdAt: "asc" } });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["code", "date", "status", "item", "colour", "size", "maker", "total_rwf", "delivery", "buyer", "buyer_phone"].join(","),
      ...orders.map((o) =>
        [o.code, o.createdAt.toISOString(), o.status, o.items[0]?.title, o.items[0]?.colourName, o.items[0]?.size, o.items[0]?.makerName, o.totalRwf, o.deliveryMode, o.shopper.name, o.shopper.phone].map(esc).join(","),
      ),
    ];
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="orders-${pageId}.csv"`);
    res.send(lines.join("\n"));
  }

  @Post("orders/:id/transition")
  async transition(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { to, note } = parse(z.object({ to: z.string(), note: z.string().max(300).optional() }), body);
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id }, include: { page: true, shopper: true } });
    const isShopper = o.shopperId === user.id;
    if (!isShopper) await this.access.requirePage(user.id, o.pageId, MANAGE);
    const allowed = ORDER_TRANSITIONS[o.status as OrderStatus] ?? [];
    if (!allowed.includes(to as OrderStatus)) throw new BadRequestException(`Can't move from ${o.status} to ${to}`);
    // Shoppers may only confirm receipt; makers drive fulfilment.
    if (isShopper && to !== "COMPLETED") throw new ForbiddenException();
    if (!isShopper && (to === "COMPLETED" || to === "PAID")) throw new ForbiddenException();
    await this.prisma.order.update({ where: { id }, data: { status: to as OrderStatus } });
    await this.prisma.orderEvent.create({ data: { orderId: id, status: to as OrderStatus, note: note ?? "", actorId: user.id } });
    if (to === "CANCELLED" || to === "DECLINED") await this.discounts.release(id); // E30: an order that doesn't go through gives the use back
    const copy = STATUS_COPY[to as OrderStatus];
    if (copy) await this.messaging.send("WHATSAPP", o.shopper.phone, `order_${to.toLowerCase()}`, `${o.page.name} ${copy} (${o.code}).${note ? ` “${note}”` : ""}`, id);
    await this.push.orderUpdate(id); // E38: shipped/delivered alerts, silent live-activity steps
    return this.view(id, !isShopper);
  }

  @Post("orders/:id/dispute")
  async dispute(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().min(5).max(500) }), body);
    const o = await this.prisma.order.findFirstOrThrow({ where: { id, shopperId: user.id } });
    if (!["DELIVERED", "COMPLETED"].includes(o.status)) throw new BadRequestException("You can raise an issue once the order is delivered");
    await this.prisma.order.update({ where: { id }, data: { status: "DISPUTED" } });
    await this.prisma.orderEvent.create({ data: { orderId: id, status: "DISPUTED", note: reason, actorId: user.id } });
    await this.prisma.moderationItem.create({ data: { kind: "ORDER_DISPUTE", refId: id, pageId: o.pageId, reason } });
    return this.view(id);
  }

  /** FR-ORD-09: verified-purchase reviews. */
  @Post("orders/:id/review")
  async review(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const { rating, text } = parse(z.object({ rating: z.number().int().min(1).max(5), text: z.string().max(500).default("") }), body);
    const o = await this.prisma.order.findFirstOrThrow({ where: { id, shopperId: user.id }, include: { review: true } });
    if (!["DELIVERED", "COMPLETED"].includes(o.status)) throw new BadRequestException("Review after delivery");
    if (o.review) throw new ConflictException("Already reviewed");
    await this.prisma.review.create({ data: { orderId: id, pageId: o.pageId, rating, text } });
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: o.pageId } });
    // Seeded legacy review counts are kept; new reviews blend into the running average.
    const total = page.reviewCount + 1;
    const rating2 = (page.rating * page.reviewCount + rating) / total;
    await this.prisma.page.update({ where: { id: o.pageId }, data: { reviewCount: total, rating: Math.round(rating2 * 10) / 10 } });
    return this.view(id);
  }

  private async view(id: string, forMaker = false) {
    const o = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: { items: true, events: { orderBy: { createdAt: "asc" } }, payments: true, page: true, shopper: true, review: true },
    });
    const variantImg = await this.prisma.variant.findUnique({ where: { id: o.items[0]?.variantId ?? "" }, select: { imagePath: true } });
    return {
      id: o.id,
      code: o.code,
      status: o.status,
      totalRwf: o.totalRwf,
      deliveryMode: o.deliveryMode,
      deliveryFeeRwf: o.deliveryFeeRwf,
      address: o.address,
      wallet: o.wallet,
      payoutLabel: o.payoutLabel,
      readyBy: o.readyBy,
      createdAt: o.createdAt,
      item: o.items[0],
      items: o.items, // E29 bag checkouts: several lines per maker
      image: variantImg?.imagePath ? `/api/files/${variantImg.imagePath}` : null,
      page: { id: o.page.id, name: o.page.name, handle: o.page.handle, whatsapp: o.page.whatsapp },
      events: o.events.map((e) => ({ status: e.status, note: e.note, at: e.createdAt })),
      payment: o.payments[0] ? { status: o.payments[0].status, provider: o.payments[0].provider, reconciled: o.payments[0].reconciled } : null,
      review: o.review ? { rating: o.review.rating, text: o.review.text } : null,
      next: ORDER_TRANSITIONS[o.status as OrderStatus],
      ...(forMaker ? { buyer: { name: o.shopper.name, phone: o.shopper.phone } } : {}),
    };
  }
}

@Module({ imports: [LooksModule, DiscountsModule], controllers: [OrdersController] })
export class OrdersModule {}
