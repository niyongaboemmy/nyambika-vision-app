import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Headers, Injectable, Module, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AuthUser, CurrentUser } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { PaymentsService } from "../payments/payments.module";
import { serverEvent } from "../pilot/pilot.service";
import { decryptField, encryptField } from "../tailor/crypto";
import { MAX_QTY, orderKey, splitBag, type BagLine, type DeliveryMode, type MakerGroup } from "./split";

const toE164 = (p: string) => (p.startsWith("+") ? p : `+250${p.replace(/\D/g, "").replace(/^0/, "")}`);
const MAX_ADDRESSES = 5;

const CheckoutInput = z.object({
  wallet: z.enum(["MTN_MOMO", "AIRTEL_MONEY"]),
  payerPhone: z.string().regex(/^\+?[0-9]{9,15}$/),
  delivery: z.record(z.string(), z.enum(["DELIVERY", "PICKUP"])).default({}),
  addressId: z.string().optional(),
  address: z.string().trim().max(200).optional(),
  saveAddress: z.boolean().default(false),
  addressLabel: z.string().trim().min(1).max(30).optional(),
});

export interface CheckoutResult {
  checkoutId: string;
  orders: { id: string; code: string; pageName: string; payoutLabel: string; totalRwf: number; items: number; status: string }[];
  failed: { pageName: string; reason: string }[];
}

@Injectable()
export class CheckoutService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
  ) {}

  /** The shopper's bag as priced lines with each product's payout account resolved. */
  async lines(userId: string): Promise<BagLine[]> {
    const items = await this.prisma.bagItem.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (!items.length) return [];
    const variants = await this.prisma.variant.findMany({
      where: { id: { in: items.map((i) => i.variantId) } },
      include: { product: { include: { page: true, makers: { include: { coopMember: true } } } } },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    return items.flatMap((i) => {
      const v = byId.get(i.variantId);
      if (!v) return [];
      const p = v.product;
      const maker = p.makers.map((m) => m.coopMember).find((m) => m.active && m.momoMerchant);
      const toMaker = p.payoutTarget === "MAKER" && maker;
      return [{
        id: i.id,
        productId: p.id,
        variantId: v.id,
        size: i.size,
        qty: i.qty,
        lookId: i.lookId,
        title: p.title,
        colourName: v.colourName,
        unitPriceRwf: p.priceRwf,
        madeToOrder: p.madeToOrder,
        stock: v.stock,
        sizes: v.sizes,
        available: p.status === "PUBLISHED" && p.page.status === "PUBLISHED",
        pageId: p.pageId,
        pageName: p.page.name,
        sector: p.page.sector,
        leadTimeDays: p.leadTimeDays,
        payoutMsisdn: (toMaker ? maker!.momoMerchant : p.page.momoMerchant) || null,
        payoutLabel: toMaker ? `${maker!.name} (${p.page.name})` : p.page.name,
        makerName: maker?.name ?? "",
        image: v.imagePath ? `/api/files/${v.imagePath}` : null,
      } as BagLine & { image: string | null }];
    });
  }

  async bag(userId: string, delivery: Record<string, DeliveryMode> = {}) {
    const groups = splitBag(await this.lines(userId), delivery);
    return {
      groups: groups.map((g) => ({ ...g, payoutMsisdn: undefined })),
      count: groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.qty, 0), 0),
      totalRwf: groups.reduce((n, g) => n + g.totalRwf, 0),
      payments: groups.length,
    };
  }

  async add(userId: string, input: { variantId: string; size: string; qty: number; lookId?: string }) {
    const v = await this.prisma.variant.findUnique({ where: { id: input.variantId }, include: { product: { include: { page: true } } } });
    if (!v || v.product.status !== "PUBLISHED" || v.product.page.status !== "PUBLISHED") throw new NotFoundException("This item isn't available");
    if (!v.sizes.includes(input.size)) throw new BadRequestException(`Size ${input.size} isn't offered`);
    if (!v.product.madeToOrder && v.stock < 1) throw new ConflictException("Sold out in this colour");
    const lookId = input.lookId ? (await this.prisma.look.findFirst({ where: { id: input.lookId, userId }, select: { id: true } }))?.id ?? null : null;
    const existing = await this.prisma.bagItem.findUnique({ where: { userId_variantId_size: { userId, variantId: v.id, size: input.size } } });
    const qty = Math.min(MAX_QTY, (existing?.qty ?? 0) + input.qty);
    await this.prisma.bagItem.upsert({
      where: { userId_variantId_size: { userId, variantId: v.id, size: input.size } },
      create: { userId, productId: v.productId, variantId: v.id, size: input.size, qty, lookId },
      update: { qty, ...(lookId ? { lookId } : {}) },
    });
    return this.bag(userId);
  }

  async setQty(userId: string, id: string, qty: number) {
    const item = await this.prisma.bagItem.findFirst({ where: { id, userId } });
    if (!item) throw new NotFoundException();
    if (qty <= 0) await this.prisma.bagItem.delete({ where: { id } });
    else await this.prisma.bagItem.update({ where: { id }, data: { qty: Math.min(MAX_QTY, qty) } });
    return this.bag(userId);
  }

  // ── Saved delivery addresses (sealed at rest) ─────────────────────────────────────────────────

  async addresses(userId: string) {
    const rows = await this.prisma.savedAddress.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] });
    return rows.map((r) => ({ id: r.id, label: r.label, address: decryptField(r.sealed), isDefault: r.isDefault, lastUsedAt: r.lastUsedAt }));
  }

  async saveAddress(userId: string, label: string, address: string, isDefault = false) {
    if ((await this.prisma.savedAddress.count({ where: { userId } })) >= MAX_ADDRESSES) throw new BadRequestException(`Keep up to ${MAX_ADDRESSES} addresses. Remove one first.`);
    const first = (await this.prisma.savedAddress.count({ where: { userId } })) === 0;
    if (isDefault) await this.prisma.savedAddress.updateMany({ where: { userId }, data: { isDefault: false } });
    return this.prisma.savedAddress.create({ data: { userId, label, sealed: encryptField(address), isDefault: isDefault || first } });
  }

  async removeAddress(userId: string, id: string) {
    const r = await this.prisma.savedAddress.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException();
  }

  // ── Checkout ──────────────────────────────────────────────────────────────────────────────────

  private async result(checkoutId: string, failed: CheckoutResult["failed"] = []): Promise<CheckoutResult> {
    const c = await this.prisma.checkout.findUniqueOrThrow({ where: { id: checkoutId } });
    const orders = await this.prisma.order.findMany({ where: { id: { in: c.orderIds } }, include: { page: true, items: true }, orderBy: { createdAt: "asc" } });
    return {
      checkoutId,
      orders: orders.map((o) => ({ id: o.id, code: o.code, pageName: o.page.name, payoutLabel: o.payoutLabel, totalRwf: o.totalRwf, items: o.items.reduce((n, i) => n + i.qty, 0), status: o.status })),
      failed,
    };
  }

  /**
   * One order + one Mobile Money request-to-pay per maker payout account, each straight to that maker
   * (OP-3). Idempotent: the same Idempotency-Key returns the same orders and never pushes twice.
   */
  async checkout(userId: string, key: string | undefined, body: unknown): Promise<CheckoutResult> {
    if (!key || key.length < 8 || key.length > 80) throw new BadRequestException("Idempotency-Key header required");
    const prior = await this.prisma.checkout.findUnique({ where: { idempotencyKey: key } });
    if (prior) {
      if (prior.userId !== userId) throw new ConflictException();
      return this.result(prior.id);
    }
    const input = parse(CheckoutInput, body);
    const groups = splitBag(await this.lines(userId), input.delivery);
    if (!groups.length) throw new BadRequestException("Your bag is empty");
    const blocked = groups.flatMap((g) => g.problems);
    if (blocked.length) throw new ConflictException(blocked.join(". "));

    let address = "";
    if (groups.some((g) => g.deliveryFeeRwf > 0)) {
      if (input.addressId) {
        const row = await this.prisma.savedAddress.findFirst({ where: { id: input.addressId, userId } });
        if (!row) throw new BadRequestException("Pick a delivery address");
        address = decryptField(row.sealed);
        await this.prisma.savedAddress.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
      } else address = input.address ?? "";
      if (address.trim().length < 4) throw new BadRequestException("Add a delivery address");
      if (!input.addressId && input.saveAddress) await this.saveAddress(userId, input.addressLabel ?? "Home", address.trim());
    }

    let checkout;
    try {
      checkout = await this.prisma.checkout.create({ data: { userId, idempotencyKey: key } });
    } catch (e) {
      // A concurrent retry with the same key won the race: answer with its orders.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const c = await this.prisma.checkout.findUniqueOrThrow({ where: { idempotencyKey: key } });
        return this.result(c.id);
      }
      throw e;
    }

    const failed: CheckoutResult["failed"] = [];
    const orderIds: string[] = [];
    for (const g of groups) {
      try {
        const id = await this.placeGroup(userId, key, g, input, address);
        orderIds.push(id);
        await this.prisma.checkout.update({ where: { id: checkout.id }, data: { orderIds } });
        await this.prisma.bagItem.deleteMany({ where: { userId, id: { in: g.lines.map((l) => l.id) } } });
      } catch (e) {
        failed.push({ pageName: g.pageName, reason: (e as Error).message });
      }
    }
    await this.prisma.checkout.update({ where: { id: checkout.id }, data: { status: failed.length ? (orderIds.length ? "PARTIAL" : "FAILED") : "DONE" } });
    // Funnel: a bag checkout is the same "hold_started" step as hold-to-buy, tagged by source.
    for (const [i, orderId] of orderIds.entries()) await serverEvent(this.prisma, "hold_started", userId, { source: "bag", orderId, index: i, total: groups.length });
    return this.result(checkout.id, failed);
  }

  private async placeGroup(userId: string, key: string, g: MakerGroup, input: z.infer<typeof CheckoutInput>, address: string) {
    const idempotencyKey = orderKey(key, g);
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
    if (existing) return existing.id;
    const payerPhone = toE164(input.payerPhone);
    const code = `NY-${randomBytes(3).toString("hex").toUpperCase()}`;
    const isDelivery = g.deliveryFeeRwf > 0;
    const order = await this.prisma.$transaction(async (tx) => {
      for (const l of g.lines) {
        if (l.madeToOrder) continue;
        const r = await tx.variant.updateMany({ where: { id: l.variantId, stock: { gte: l.qty } }, data: { stock: { decrement: l.qty } } });
        if (r.count === 0) throw new ConflictException(`${l.title} (${l.colourName}) just sold out`);
      }
      const n = g.lines.reduce((s, l) => s + l.qty, 0);
      return tx.order.create({
        data: {
          code,
          pageId: g.pageId,
          shopperId: userId,
          status: "AWAITING_PAYMENT",
          totalRwf: g.totalRwf,
          deliveryMode: isDelivery ? "DELIVERY" : "PICKUP",
          deliveryFeeRwf: g.deliveryFeeRwf,
          address: isDelivery ? address : "",
          wallet: input.wallet,
          payerPhone,
          payoutMsisdn: g.payoutMsisdn!,
          payoutLabel: g.payoutLabel,
          idempotencyKey,
          lookId: g.lines.find((l) => l.lookId)?.lookId ?? null,
          readyBy: new Date(Date.now() + Math.max(1, g.leadTimeDays) * 86400_000),
          items: {
            create: g.lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              title: l.title,
              colourName: l.colourName,
              size: l.size,
              qty: l.qty,
              unitPriceRwf: l.unitPriceRwf,
              makerName: l.makerName,
            })),
          },
          events: { create: [{ status: "NEW", note: `Checked out from your bag (${n} item${n === 1 ? "" : "s"})` }, { status: "AWAITING_PAYMENT", note: "Mobile Money request sent to your phone" }] },
        },
      });
    });
    await this.payments.request(order.id, {
      amountRwf: g.totalRwf,
      payerPhone,
      merchant: g.payoutMsisdn!,
      reference: code,
      wallet: input.wallet,
      note: `${g.lines.length > 1 ? `${g.lines.length} items` : g.lines[0].title} from ${g.pageName}`,
    });
    return order.id;
  }

  // ── Privacy (FR-PRV-03/04) ────────────────────────────────────────────────────────────────────

  async exportFor(userId: string) {
    const bag = await this.prisma.bagItem.findMany({ where: { userId }, select: { productId: true, variantId: true, size: true, qty: true, createdAt: true } });
    return { bag, addresses: await this.addresses(userId) };
  }

  async deleteFor(userId: string) {
    const [a, b] = await Promise.all([this.prisma.savedAddress.deleteMany({ where: { userId } }), this.prisma.bagItem.deleteMany({ where: { userId } })]);
    return { addresses: a.count, bagItems: b.count };
  }
}

@Controller()
export class CheckoutController {
  constructor(private checkout: CheckoutService) {}

  @Get("bag")
  bag(@CurrentUser() user: AuthUser) {
    return this.checkout.bag(user.id);
  }

  /** Price preview with per-maker delivery choices (fees differ by group). */
  @Post("bag/quote")
  quote(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { delivery } = parse(z.object({ delivery: z.record(z.string(), z.enum(["DELIVERY", "PICKUP"])).default({}) }), body);
    return this.checkout.bag(user.id, delivery);
  }

  @Post("bag/items")
  add(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(z.object({ variantId: z.string(), size: z.string().min(1).max(10), qty: z.number().int().min(1).max(MAX_QTY).default(1), lookId: z.string().optional() }), body);
    return this.checkout.add(user.id, input);
  }

  @Patch("bag/items/:id")
  setQty(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.checkout.setQty(user.id, id, parse(z.object({ qty: z.number().int().min(0).max(MAX_QTY) }), body).qty);
  }

  @Delete("bag/items/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.checkout.setQty(user.id, id, 0);
  }

  @Get("addresses")
  addresses(@CurrentUser() user: AuthUser) {
    return this.checkout.addresses(user.id);
  }

  @Post("addresses")
  async addAddress(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(z.object({ label: z.string().trim().min(1).max(30), address: z.string().trim().min(4).max(200), isDefault: z.boolean().default(false) }), body);
    await this.checkout.saveAddress(user.id, input.label, input.address, input.isDefault);
    return this.checkout.addresses(user.id);
  }

  @Delete("addresses/:id")
  async removeAddress(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.checkout.removeAddress(user.id, id);
    return this.checkout.addresses(user.id);
  }

  @Post("checkout")
  run(@CurrentUser() user: AuthUser, @Headers("idempotency-key") key: string | undefined, @Body() body: unknown) {
    return this.checkout.checkout(user.id, key, body);
  }
}

@Module({ controllers: [CheckoutController], providers: [CheckoutService], exports: [CheckoutService] })
export class CheckoutModule {}
