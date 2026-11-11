import { BadRequestException, ConflictException, Injectable, Module } from "@nestjs/common";
import { bestDiscount, evaluateDiscount, type DiscountRule } from "@nyambika/contracts";
import type { DiscountCode, Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";

export interface AppliedDiscount {
  rule: DiscountCode;
  amountRwf: number;
}

/**
 * Discount codes and time-boxed offers (E30). Validated at hold-to-buy; maker-funded only:
 * the Mobile Money request is simply smaller and goes straight to the maker (OP-2), the platform never tops up.
 */
@Injectable()
export class DiscountService {
  constructor(private prisma: PrismaService) {}

  private async shopperUses(discountIds: string[], shopperId: string | null) {
    if (!shopperId || !discountIds.length) return new Map<string, number>();
    const rows = await this.prisma.discountRedemption.groupBy({ by: ["discountId"], where: { discountId: { in: discountIds }, shopperId }, _count: true });
    return new Map(rows.map((r) => [r.discountId, r._count]));
  }

  /** Best automatic offer for a product (shown on the buy sheet without a code). */
  async bestOffer(pageId: string, productId: string, priceRwf: number, shopperId: string | null): Promise<AppliedDiscount | null> {
    const now = new Date();
    const offers = await this.prisma.discountCode.findMany({
      where: { pageId, code: null, active: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    });
    const used = await this.shopperUses(offers.map((o) => o.id), shopperId);
    const best = bestDiscount(offers as unknown as (DiscountRule & DiscountCode)[], (r) => ({ productId, priceRwf, shopperUses: used.get(r.id) ?? 0, now }));
    return best ? { rule: best.rule as DiscountCode, amountRwf: best.amountRwf } : null;
  }

  /** Resolve the discount for a hold-to-buy. A wrong code is an error (the shopper typed it); offers apply silently. */
  async resolve(pageId: string, productId: string, priceRwf: number, shopperId: string, code?: string | null): Promise<AppliedDiscount | null> {
    const offer = await this.bestOffer(pageId, productId, priceRwf, shopperId);
    if (!code?.trim()) return offer;
    const rule = await this.prisma.discountCode.findUnique({ where: { pageId_code: { pageId, code: code.trim().toUpperCase() } } });
    if (!rule) throw new BadRequestException({ message: "That code doesn't exist for this maker", code: "DISCOUNT_UNKNOWN" });
    const used = await this.shopperUses([rule.id], shopperId);
    const v = evaluateDiscount(rule as unknown as DiscountRule, { productId, priceRwf, shopperUses: used.get(rule.id) ?? 0 });
    if (!v.ok) throw new BadRequestException({ message: v.message, code: `DISCOUNT_${v.reason}` });
    // Never stack: the larger saving wins.
    return offer && offer.amountRwf > v.amountRwf ? offer : { rule, amountRwf: v.amountRwf };
  }

  /** Atomically count a use (respecting maxUses) and record the redemption, inside the order transaction. */
  async redeem(tx: Prisma.TransactionClient, d: AppliedDiscount, orderId: string, shopperId: string) {
    const n = await tx.$executeRaw`UPDATE "DiscountCode" SET uses = uses + 1 WHERE id = ${d.rule.id} AND active AND ("maxUses" IS NULL OR uses < "maxUses")`;
    if (n === 0) throw new ConflictException({ message: "This code has just been used up", code: "DISCOUNT_USED_UP" });
    await tx.discountRedemption.create({ data: { discountId: d.rule.id, orderId, shopperId, pageId: d.rule.pageId, amountRwf: d.amountRwf } });
  }
}

@Module({ providers: [DiscountService], exports: [DiscountService] })
export class DiscountsModule {}
