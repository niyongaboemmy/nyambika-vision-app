import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { AGENT_LIMITS, AgentCheckoutCreate, MandateConfirm } from "@nyambika/contracts";
import { Prisma, type AgentCheckout } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { DELIVERY_FEE_RWF } from "../checkout/split";
import { PaymentsService } from "../payments/payments.module";
import { serverEvent } from "../pilot/pilot.service";
import type { AgentContext } from "./access";
import { CatalogueApi, makerSpaceUrl } from "./catalogue.service";
import { itemsHash, newNonce, signMandate, verifyMandate, type MandateItem } from "./mandate";

interface SessionItem extends MandateItem {
  productId: string;
  title: string;
  colourName: string;
  makerName: string;
  image: string | null;
}

const toE164 = (p: string) => (p.startsWith("+") ? p : `+250${p.replace(/\D/g, "").replace(/^0/, "")}`);
const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"];
const MANDATE_REASON = { MALFORMED: "This confirmation link is not valid.", BAD_SIGNATURE: "This confirmation link is not valid.", EXPIRED: "This confirmation link has expired. Ask your assistant to start again." };

/**
 * Agent-initiated checkout (FR-AGT-02/04). An agent creates a session for one maker; Nyambika signs the
 * exact cart into a single-use, expiring mandate link. Only when the signed-in shopper confirms that link
 * does the normal hold-to-buy order + Mobile Money request (straight to the maker) happen.
 */
@Injectable()
export class AgentCheckoutService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private catalogue: CatalogueApi,
  ) {}

  token(s: Pick<AgentCheckout, "id" | "mandateNonce" | "pageId" | "subtotalRwf" | "itemsHash" | "mandateExpiresAt">) {
    return signMandate({ sid: s.id, n: s.mandateNonce, pageId: s.pageId, totalRwf: s.subtotalRwf, ih: s.itemsHash, exp: Math.floor(s.mandateExpiresAt.getTime() / 1000) }, config.jwtSecret);
  }

  confirmationUrl(s: AgentCheckout) {
    return `${config.webUrl}/confirm/${this.token(s)}`;
  }

  /** Resolve and validate an agent's line items against the live catalogue (one maker, one payout account). */
  private async resolve(input: AgentCheckoutCreate) {
    const pageWhere = await this.catalogue.pageWhere();
    const variants = await this.prisma.variant.findMany({
      where: { id: { in: input.items.map((i) => i.id) }, product: { status: "PUBLISHED", page: pageWhere } },
      include: { product: { include: { page: true, makers: { include: { coopMember: true } } } } },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const items: SessionItem[] = [];
    let payout: { msisdn: string; label: string; pageId: string } | null = null;
    for (const line of input.items) {
      const v = byId.get(line.id);
      if (!v) throw new BadRequestException({ message: `Variant ${line.id} is not on the public catalogue`, code: "UNKNOWN_ITEM" });
      const p = v.product;
      if (!v.sizes.includes(line.size)) throw new BadRequestException({ message: `${p.title}: size ${line.size} isn't offered (${v.sizes.join(", ")})`, code: "SIZE_NOT_OFFERED" });
      if (!p.madeToOrder && v.stock < line.quantity) throw new ConflictException({ message: `${p.title} (${v.colourName}) is out of stock`, code: "OUT_OF_STOCK" });
      const maker = p.makers.map((m) => m.coopMember).find((m) => m.active && m.momoMerchant);
      const toMaker = p.payoutTarget === "MAKER" && maker;
      const msisdn = (toMaker ? maker!.momoMerchant : p.page.momoMerchant) || "";
      const label = toMaker ? `${maker!.name} (${p.page.name})` : p.page.name;
      if (!msisdn) throw new ConflictException({ message: `${p.page.name} doesn't take Mobile Money orders yet; send the shopper to ${makerSpaceUrl(p.page.handle)}`, code: "MAKER_NOT_PAYABLE" });
      if (payout && (payout.pageId !== p.pageId || payout.msisdn !== msisdn)) {
        throw new BadRequestException({ message: "One checkout session per maker payout account: create a separate session for items from another maker", code: "MULTIPLE_MAKERS" });
      }
      payout = { msisdn, label, pageId: p.pageId };
      const dup = items.find((i) => i.variantId === v.id && i.size === line.size);
      if (dup) dup.qty = Math.min(AGENT_LIMITS.maxQty, dup.qty + line.quantity);
      else
        items.push({
          productId: p.id,
          variantId: v.id,
          size: line.size,
          qty: line.quantity,
          unitPriceRwf: p.priceRwf,
          title: p.title,
          colourName: v.colourName,
          makerName: maker?.name ?? "",
          image: v.imagePath ? `/api/files/${v.imagePath}` : null,
        });
    }
    return { items, payout: payout!, leadTimeDays: Math.max(...variants.map((v) => v.product.leadTimeDays), 0) };
  }

  async create(agent: AgentContext, idempotencyKey: string | undefined, body: unknown, channel: "REST" | "MCP" = "REST") {
    if (!agent.client || !agent.key) throw new BadRequestException("API key required");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 80) throw new BadRequestException({ message: "Idempotency-Key header required (8–80 chars)", code: "IDEMPOTENCY_KEY_REQUIRED" });
    const prior = await this.prisma.agentCheckout.findUnique({ where: { clientId_idempotencyKey: { clientId: agent.client.id, idempotencyKey } } });
    if (prior) return this.view(prior);
    const input = parse(AgentCheckoutCreate, body);
    const { items, payout } = await this.resolve(input);
    const subtotal = items.reduce((s, i) => s + i.unitPriceRwf * i.qty, 0);
    try {
      const s = await this.prisma.agentCheckout.create({
        data: {
          clientId: agent.client.id,
          keyId: agent.key.id,
          pageId: payout.pageId,
          items: items as unknown as Prisma.InputJsonValue,
          itemsHash: itemsHash(items),
          subtotalRwf: subtotal,
          payoutLabel: payout.label,
          mandateNonce: newNonce(),
          mandateExpiresAt: new Date(Date.now() + AGENT_LIMITS.mandateTtlMin * 60_000),
          idempotencyKey,
          externalRef: input.external_reference ?? null,
          channel,
        },
      });
      return this.view(s);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return this.view(await this.prisma.agentCheckout.findUniqueOrThrow({ where: { clientId_idempotencyKey: { clientId: agent.client.id, idempotencyKey } } }));
      }
      throw e;
    }
  }

  async forAgent(agent: AgentContext, id: string) {
    const s = await this.prisma.agentCheckout.findFirst({ where: { id, clientId: agent.client?.id ?? "-" } });
    if (!s) throw new NotFoundException({ message: "No such checkout session", code: "NOT_FOUND" });
    return s;
  }

  async cancel(agent: AgentContext, id: string) {
    const s = await this.forAgent(agent, id);
    const r = await this.prisma.agentCheckout.updateMany({ where: { id: s.id, status: "AWAITING_CONFIRMATION", mandateUsedAt: null }, data: { status: "CANCELED" } });
    if (!r.count && s.status !== "CANCELED") throw new ConflictException({ message: "The shopper already confirmed this session", code: "ALREADY_CONFIRMED" });
    return this.view(await this.prisma.agentCheckout.findUniqueOrThrow({ where: { id } }));
  }

  /** Lazily expire unconfirmed sessions so status is always truthful. */
  private async fresh(s: AgentCheckout) {
    if (s.status === "AWAITING_CONFIRMATION" && !s.mandateUsedAt && s.mandateExpiresAt <= new Date()) {
      await this.prisma.agentCheckout.updateMany({ where: { id: s.id, status: "AWAITING_CONFIRMATION" }, data: { status: "EXPIRED" } });
      return { ...s, status: "EXPIRED" };
    }
    return s;
  }

  /** ACP-shaped checkout session view. Never contains shopper data (payer, address, phone). */
  async view(raw: AgentCheckout) {
    const s = await this.fresh(raw);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: s.pageId } });
    const order = s.orderId ? await this.prisma.order.findUnique({ where: { id: s.orderId } }) : null;
    const items = s.items as unknown as SessionItem[];
    let status: "not_ready_for_payment" | "in_progress" | "completed" | "canceled" = "not_ready_for_payment";
    let ny: "awaiting_user_confirmation" | "awaiting_payment" | "paid" | "declined" | "canceled" | "expired" = "awaiting_user_confirmation";
    if (s.status === "CANCELED") [status, ny] = ["canceled", "canceled"];
    else if (s.status === "EXPIRED") [status, ny] = ["canceled", "expired"];
    else if (order) {
      if (PAID.includes(order.status)) [status, ny] = ["completed", "paid"];
      else if (order.status === "CANCELLED" || order.status === "DECLINED") [status, ny] = ["canceled", "declined"];
      else [status, ny] = ["in_progress", "awaiting_payment"];
    }
    const awaiting = ny === "awaiting_user_confirmation";
    const messages = [
      awaiting
        ? { type: "info" as const, content: "Send this confirmation link to the shopper. Nothing is ordered or paid until they confirm in Nyambika and approve the Mobile Money request." }
        : ny === "expired"
          ? { type: "error" as const, content: "The confirmation link expired before the shopper confirmed. Create a new session." }
          : { type: "info" as const, content: `Order ${ny.replace(/_/g, " ")}.` },
    ];
    return {
      id: s.id,
      object: "checkout_session" as const,
      status,
      nyambika_status: ny,
      currency: "RWF" as const,
      maker: { id: page.id, handle: page.handle, name: page.name, maker_space_url: makerSpaceUrl(page.handle) },
      line_items: items.map((i, n) => ({
        id: `li_${n + 1}`,
        item: { id: i.variantId, quantity: i.qty },
        title: i.title,
        colour_name: i.colourName,
        size: i.size,
        base_amount: i.unitPriceRwf,
        subtotal: i.unitPriceRwf * i.qty,
      })),
      totals: [
        { type: "items_base_amount", display_text: "Items", amount: s.subtotalRwf },
        { type: "fulfillment", display_text: `Delivery (shopper's choice: +${DELIVERY_FEE_RWF} or free pickup)`, amount: 0 },
        { type: "total", display_text: "Total before delivery", amount: s.subtotalRwf },
      ],
      payment: { paid_directly_to: s.payoutLabel, methods: ["mtn_momo", "airtel_money"], handled_by: "shopper_in_nyambika" as const },
      mandate: { type: "user_confirmation" as const, confirmation_url: awaiting ? this.confirmationUrl(s) : null, expires_at: s.mandateExpiresAt.toISOString(), single_use: true as const },
      order: order ? { code: order.code, status: order.status.toLowerCase() } : null,
      messages,
      links: [
        { type: "maker_space", url: makerSpaceUrl(page.handle) },
        { type: "terms_of_use", url: `${config.webUrl}/trust` },
      ],
      external_reference: s.externalRef,
      created_at: s.createdAt.toISOString(),
      expires_at: s.mandateExpiresAt.toISOString(),
    };
  }

  // ── Shopper side (mandate link) ──────────────────────────────────────────────────────────────

  private async fromToken(token: string) {
    const check = verifyMandate(token, config.jwtSecret);
    if (!check.ok) throw (check.reason === "EXPIRED" ? new GoneException({ message: MANDATE_REASON.EXPIRED, code: "MANDATE_EXPIRED" }) : new BadRequestException({ message: MANDATE_REASON[check.reason], code: `MANDATE_${check.reason}` }));
    const s = await this.prisma.agentCheckout.findUnique({ where: { id: check.payload.sid } });
    // The nonce, cart hash and total in the token must match what Nyambika stored (tamper / replay check).
    if (!s || s.mandateNonce !== check.payload.n || s.itemsHash !== check.payload.ih || s.subtotalRwf !== check.payload.totalRwf || s.pageId !== check.payload.pageId) {
      throw new BadRequestException({ message: MANDATE_REASON.BAD_SIGNATURE, code: "MANDATE_MISMATCH" });
    }
    return this.fresh(s);
  }

  /** What the shopper sees before confirming: maker, items, price, who asked. No account needed to look. */
  async preview(token: string, userId?: string) {
    const s = await this.fromToken(token);
    const [page, client, order] = await Promise.all([
      this.prisma.page.findUniqueOrThrow({ where: { id: s.pageId } }),
      this.prisma.apiClient.findUnique({ where: { id: s.clientId } }),
      s.orderId ? this.prisma.order.findUnique({ where: { id: s.orderId } }) : null,
    ]);
    const items = s.items as unknown as SessionItem[];
    const leadTime = await this.prisma.product.aggregate({ where: { id: { in: items.map((i) => i.productId) } }, _max: { leadTimeDays: true } });
    return {
      id: s.id,
      state: s.status === "AWAITING_CONFIRMATION" ? "open" : s.status === "CONFIRMED" ? "confirmed" : s.status.toLowerCase(),
      agent: { name: client?.name ?? "An AI assistant", verified: client?.status === "ACTIVE" },
      maker: { name: page.name, handle: page.handle, verified: page.verified, sector: page.sector, district: page.district },
      paidTo: s.payoutLabel,
      items: items.map((i) => ({ title: i.title, colourName: i.colourName, size: i.size, qty: i.qty, unitPriceRwf: i.unitPriceRwf, image: i.image, makerName: i.makerName })),
      subtotalRwf: s.subtotalRwf,
      deliveryFeeRwf: DELIVERY_FEE_RWF,
      leadTimeDays: leadTime._max.leadTimeDays ?? 0,
      expiresAt: s.mandateExpiresAt.toISOString(),
      orderId: order && order.shopperId === userId ? order.id : null,
    };
  }

  /**
   * The shopper confirms the signed cart: the mandate is consumed atomically (single use), stock is
   * reserved and the order + Mobile Money request go straight to the maker, exactly like hold-to-buy.
   */
  async confirm(userId: string, token: string, body: unknown) {
    const s = await this.fromToken(token);
    if (s.status === "CONFIRMED" && s.confirmedById === userId && s.orderId) return { orderId: s.orderId, reused: true };
    if (s.mandateUsedAt || s.status === "CONFIRMED") throw new ConflictException({ message: "This confirmation link was already used.", code: "MANDATE_USED" });
    if (s.status === "EXPIRED") throw new GoneException({ message: MANDATE_REASON.EXPIRED, code: "MANDATE_EXPIRED" });
    if (s.status !== "AWAITING_CONFIRMATION") throw new ConflictException({ message: "The assistant cancelled this checkout.", code: "MANDATE_CANCELED" });
    const input = parse(MandateConfirm, body);
    if (input.delivery === "DELIVERY" && input.address.trim().length < 4) throw new BadRequestException("Add a delivery address");
    const items = s.items as unknown as SessionItem[];

    // Re-check live prices and payout: the shopper must pay exactly what the mandate shows.
    const { items: live, payout, leadTimeDays } = await this.resolve({ items: items.map((i) => ({ id: i.variantId, size: i.size, quantity: i.qty })) });
    if (itemsHash(live) !== s.itemsHash || payout.label !== s.payoutLabel) {
      throw new ConflictException({ message: "The maker changed the price or details since your assistant asked. Ask it to start again.", code: "CART_CHANGED" });
    }
    const fee = input.delivery === "DELIVERY" ? DELIVERY_FEE_RWF : 0;
    const total = s.subtotalRwf + fee;
    const payerPhone = toE164(input.payerPhone);
    const code = `NY-${randomBytes(3).toString("hex").toUpperCase()}`;
    const client = await this.prisma.apiClient.findUnique({ where: { id: s.clientId } });

    const order = await this.prisma.$transaction(async (tx) => {
      const used = await tx.agentCheckout.updateMany({
        where: { id: s.id, status: "AWAITING_CONFIRMATION", mandateUsedAt: null, mandateExpiresAt: { gt: new Date() } },
        data: { mandateUsedAt: new Date(), status: "CONFIRMED", confirmedById: userId },
      });
      if (used.count !== 1) throw new ConflictException({ message: "This confirmation link was already used.", code: "MANDATE_USED" });
      for (const l of items) {
        const madeToOrder = (await tx.product.findUniqueOrThrow({ where: { id: l.productId }, select: { madeToOrder: true } })).madeToOrder;
        if (madeToOrder) continue;
        const r = await tx.variant.updateMany({ where: { id: l.variantId, stock: { gte: l.qty } }, data: { stock: { decrement: l.qty } } });
        if (r.count === 0) throw new ConflictException({ message: `${l.title} (${l.colourName}) just sold out`, code: "OUT_OF_STOCK" });
      }
      const o = await tx.order.create({
        data: {
          code,
          pageId: s.pageId,
          shopperId: userId,
          status: "AWAITING_PAYMENT",
          totalRwf: total,
          deliveryMode: input.delivery,
          deliveryFeeRwf: fee,
          address: input.delivery === "DELIVERY" ? input.address.trim() : "",
          wallet: input.wallet,
          payerPhone,
          payoutMsisdn: payout.msisdn,
          payoutLabel: payout.label,
          idempotencyKey: `agent:${s.id}`,
          readyBy: new Date(Date.now() + Math.max(1, leadTimeDays) * 86400_000),
          items: {
            create: items.map((l) => ({ productId: l.productId, variantId: l.variantId, title: l.title, colourName: l.colourName, size: l.size, qty: l.qty, unitPriceRwf: l.unitPriceRwf, makerName: l.makerName })),
          },
          events: {
            create: [
              { status: "NEW", note: `Confirmed by you from a request by ${client?.name ?? "an AI assistant"}` },
              { status: "AWAITING_PAYMENT", note: "Mobile Money request sent to your phone" },
            ],
          },
        },
      });
      await tx.agentCheckout.update({ where: { id: s.id }, data: { orderId: o.id } });
      return o;
    });
    await this.payments.request(order.id, {
      amountRwf: total,
      payerPhone,
      merchant: payout.msisdn,
      reference: code,
      wallet: input.wallet,
      note: `${items.length > 1 ? `${items.length} items` : items[0].title} from ${payout.label}`,
    });
    await serverEvent(this.prisma, "hold_started", userId, { source: "agent", orderId: order.id, pageId: s.pageId });
    return { orderId: order.id, reused: false };
  }

  async decline(token: string) {
    const s = await this.fromToken(token);
    await this.prisma.agentCheckout.updateMany({ where: { id: s.id, status: "AWAITING_CONFIRMATION", mandateUsedAt: null }, data: { status: "CANCELED" } });
    return { declined: true };
  }
}
