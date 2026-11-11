import { z } from "zod";

/**
 * E30 member growth tools: discount codes / time-boxed offers, follower broadcasts, share sources.
 * Discounts are maker-funded: the shopper pays the maker less, the platform never tops up (OP-2).
 */

export const DISCOUNT_KINDS = ["PERCENT", "AMOUNT"] as const;
/** A discount never takes more than this share of the item price (protects makers from typos). */
export const MAX_DISCOUNT_SHARE = 0.9;
export const MAX_PERCENT = 90;

export const DiscountInput = z
  .object({
    /** Empty / missing = automatic time-boxed offer shown to every shopper. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,20}$/, "Use 3–20 letters, numbers or dashes")
      .optional()
      .nullable(),
    label: z.string().trim().max(60).default(""),
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int().positive(),
    productId: z.string().optional().nullable(),
    minSpendRwf: z.number().int().min(0).default(0),
    maxUses: z.number().int().positive().optional().nullable(),
    perShopper: z.number().int().min(1).max(10).default(1),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional().nullable(),
  })
  .refine((d) => d.kind !== "PERCENT" || d.value <= MAX_PERCENT, { message: `Percent discounts go up to ${MAX_PERCENT}%`, path: ["value"] })
  .refine((d) => d.code || d.endsAt, { message: "An automatic offer needs an end date (time-boxed)", path: ["endsAt"] })
  .refine((d) => !d.endsAt || !d.startsAt || Date.parse(d.endsAt) > Date.parse(d.startsAt), { message: "End must be after start", path: ["endsAt"] });
export type DiscountInput = z.infer<typeof DiscountInput>;

export interface DiscountRule {
  id: string;
  code: string | null;
  kind: string;
  value: number;
  productId: string | null;
  minSpendRwf: number;
  maxUses: number | null;
  perShopper: number;
  uses: number;
  startsAt: Date | string;
  endsAt: Date | string | null;
  active: boolean;
  fundedBy?: string;
}

export interface DiscountContext {
  productId: string;
  /** Item price (delivery fees are never discounted). */
  priceRwf: number;
  /** How many times this shopper already used this discount. */
  shopperUses: number;
  now?: Date;
}

export type DiscountVerdict =
  | { ok: true; amountRwf: number; priceAfterRwf: number }
  | { ok: false; reason: "INACTIVE" | "NOT_STARTED" | "EXPIRED" | "WRONG_PRODUCT" | "MIN_SPEND" | "USED_UP" | "ALREADY_USED" | "NOT_MAKER_FUNDED"; message: string };

const t = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));

/** Pure validation used at hold-to-buy (server) and in the buy sheet preview (client). */
export function evaluateDiscount(d: DiscountRule, ctx: DiscountContext): DiscountVerdict {
  const now = (ctx.now ?? new Date()).getTime();
  if (d.fundedBy && d.fundedBy !== "MAKER") return { ok: false, reason: "NOT_MAKER_FUNDED", message: "Only maker-funded discounts are allowed" };
  if (!d.active) return { ok: false, reason: "INACTIVE", message: "This code isn't active" };
  if (now < t(d.startsAt)) return { ok: false, reason: "NOT_STARTED", message: "This offer hasn't started yet" };
  if (d.endsAt && now >= t(d.endsAt)) return { ok: false, reason: "EXPIRED", message: "This offer has ended" };
  if (d.productId && d.productId !== ctx.productId) return { ok: false, reason: "WRONG_PRODUCT", message: "This code is for another piece" };
  if (ctx.priceRwf < d.minSpendRwf) return { ok: false, reason: "MIN_SPEND", message: `For pieces from RWF ${d.minSpendRwf.toLocaleString("en-US")}` };
  if (d.maxUses != null && d.uses >= d.maxUses) return { ok: false, reason: "USED_UP", message: "This code has been used up" };
  if (ctx.shopperUses >= d.perShopper) return { ok: false, reason: "ALREADY_USED", message: "You already used this code" };
  const raw = d.kind === "PERCENT" ? Math.round((ctx.priceRwf * Math.min(d.value, MAX_PERCENT)) / 100) : d.value;
  const amountRwf = Math.max(0, Math.min(raw, Math.floor(ctx.priceRwf * MAX_DISCOUNT_SHARE)));
  return { ok: true, amountRwf, priceAfterRwf: ctx.priceRwf - amountRwf };
}

/** Codes and automatic offers never stack: the biggest valid saving wins. */
export function bestDiscount<D extends DiscountRule>(rules: D[], ctx: (d: D) => DiscountContext): { rule: D; amountRwf: number } | null {
  let best: { rule: D; amountRwf: number } | null = null;
  for (const r of rules) {
    const v = evaluateDiscount(r, ctx(r));
    if (v.ok && v.amountRwf > 0 && (!best || v.amountRwf > best.amountRwf)) best = { rule: r, amountRwf: v.amountRwf };
  }
  return best;
}

// ---- Follower broadcasts ----

export const BROADCAST_LIMITS = {
  /** Per page: at most one broadcast a day and three a week. */
  pagePerDay: 1,
  pagePerWeek: 3,
  /** Per follower across all pages: at most this many broadcast messages a week. */
  recipientPerWeek: 4,
} as const;

export const BroadcastInput = z.object({
  message: z.string().trim().min(10).max(320),
  productIds: z.array(z.string()).max(6).default([]),
  locale: z.enum(["rw", "en", "fr"]).default("rw"),
});
export type BroadcastInput = z.infer<typeof BroadcastInput>;

export interface BroadcastRecipient {
  userId: string;
  phone: string;
  optedIn: boolean;
  /** Broadcast messages this phone received in the last 7 days (any page). */
  recentWeek: number;
}

export type BroadcastPlan =
  | { ok: true; send: BroadcastRecipient[]; skipped: { userId: string; reason: "NOT_OPTED_IN" | "RECIPIENT_LIMIT" }[] }
  | { ok: false; reason: "PAGE_DAILY_LIMIT" | "PAGE_WEEKLY_LIMIT" | "NO_RECIPIENTS"; message: string; retryAt?: Date };

/** Pure planner: only opted-in followers, page and recipient rate limits. `pageSent` = this page's broadcast times. */
export function planBroadcast(pageSent: (Date | string)[], recipients: BroadcastRecipient[], now = new Date()): BroadcastPlan {
  const ms = now.getTime();
  const times = pageSent.map(t).sort((a, b) => a - b);
  const day = times.filter((x) => ms - x < 86_400_000);
  const week = times.filter((x) => ms - x < 7 * 86_400_000);
  if (day.length >= BROADCAST_LIMITS.pagePerDay)
    return { ok: false, reason: "PAGE_DAILY_LIMIT", message: "One broadcast a day keeps followers happy. Try again tomorrow.", retryAt: new Date(day[0] + 86_400_000) };
  if (week.length >= BROADCAST_LIMITS.pagePerWeek)
    return { ok: false, reason: "PAGE_WEEKLY_LIMIT", message: `Up to ${BROADCAST_LIMITS.pagePerWeek} broadcasts a week.`, retryAt: new Date(week[0] + 7 * 86_400_000) };
  const send: BroadcastRecipient[] = [];
  const skipped: { userId: string; reason: "NOT_OPTED_IN" | "RECIPIENT_LIMIT" }[] = [];
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.phone)) continue;
    seen.add(r.phone);
    if (!r.optedIn) skipped.push({ userId: r.userId, reason: "NOT_OPTED_IN" });
    else if (r.recentWeek >= BROADCAST_LIMITS.recipientPerWeek) skipped.push({ userId: r.userId, reason: "RECIPIENT_LIMIT" });
    else send.push(r);
  }
  if (!send.length) return { ok: false, reason: "NO_RECIPIENTS", message: "No followers have opted in to WhatsApp updates yet." };
  return { ok: true, send, skipped };
}

// ---- Share links (source tags feed analytics) ----

export const SHARE_SOURCES = ["wa_status", "wa_chat", "wa_catalogue", "ig_story", "qr_card", "qr_story", "broadcast", "link"] as const;
export type ShareSource = (typeof SHARE_SOURCES)[number];

/** UTM-style tagged Maker Space link. `src` is what the Maker Space reports as the analytics `source`. */
export function shareLink(base: string, handle: string, src: ShareSource, opts: { productId?: string; campaign?: string } = {}) {
  const u = new URL(`/m/${handle}`, base);
  u.searchParams.set("src", src);
  u.searchParams.set("utm_source", src.startsWith("wa") || src === "broadcast" ? "whatsapp" : src.startsWith("ig") ? "instagram" : "qr");
  u.searchParams.set("utm_medium", src);
  if (opts.campaign) u.searchParams.set("utm_campaign", opts.campaign);
  if (opts.productId) u.searchParams.set("p", opts.productId);
  return u.toString();
}
