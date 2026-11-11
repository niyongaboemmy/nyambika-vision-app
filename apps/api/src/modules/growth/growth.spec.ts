import { BROADCAST_LIMITS, bestDiscount, DiscountInput, evaluateDiscount, planBroadcast, shareLink, type DiscountRule } from "@nyambika/contracts";
import { describe, expect, it } from "vitest";
import { bestHours, kigaliHour, suggest, type InsightFacts } from "./insights";

const now = new Date("2026-11-11T10:00:00Z");
const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  id: "d1",
  code: "GISOZI10",
  kind: "PERCENT",
  value: 10,
  productId: null,
  minSpendRwf: 0,
  maxUses: null,
  perShopper: 1,
  uses: 0,
  startsAt: new Date("2026-11-01T00:00:00Z"),
  endsAt: new Date("2026-11-20T00:00:00Z"),
  active: true,
  fundedBy: "MAKER",
  ...over,
});
const ctx = { productId: "p1", priceRwf: 36000, shopperUses: 0, now };

describe("discount validation (E30)", () => {
  it("applies a percent code to the item price only", () => {
    expect(evaluateDiscount(rule(), ctx)).toEqual({ ok: true, amountRwf: 3600, priceAfterRwf: 32400 });
  });

  it("applies a fixed amount, capped at 90% of the price", () => {
    expect(evaluateDiscount(rule({ kind: "AMOUNT", value: 5000 }), ctx)).toMatchObject({ ok: true, amountRwf: 5000 });
    expect(evaluateDiscount(rule({ kind: "AMOUNT", value: 50000 }), ctx)).toMatchObject({ ok: true, amountRwf: 32400, priceAfterRwf: 3600 });
  });

  it("rejects inactive, not started, expired, wrong product, min spend, used up and repeat use", () => {
    const reason = (r: DiscountRule, c = ctx) => {
      const v = evaluateDiscount(r, c);
      return v.ok ? "OK" : v.reason;
    };
    expect(reason(rule({ active: false }))).toBe("INACTIVE");
    expect(reason(rule({ startsAt: new Date("2026-11-12T00:00:00Z") }))).toBe("NOT_STARTED");
    expect(reason(rule({ endsAt: new Date("2026-11-11T10:00:00Z") }))).toBe("EXPIRED"); // end is exclusive
    expect(reason(rule({ productId: "p2" }))).toBe("WRONG_PRODUCT");
    expect(reason(rule({ minSpendRwf: 40000 }))).toBe("MIN_SPEND");
    expect(reason(rule({ maxUses: 5, uses: 5 }))).toBe("USED_UP");
    expect(reason(rule({ perShopper: 1 }), { ...ctx, shopperUses: 1 })).toBe("ALREADY_USED");
    expect(reason(rule({ perShopper: 2 }), { ...ctx, shopperUses: 1 })).toBe("OK");
  });

  it("refuses anything that is not maker-funded", () => {
    expect(evaluateDiscount(rule({ fundedBy: "PLATFORM" }), ctx)).toMatchObject({ ok: false, reason: "NOT_MAKER_FUNDED" });
  });

  it("never stacks: the best valid saving wins", () => {
    const best = bestDiscount([rule({ id: "a", value: 10 }), rule({ id: "b", kind: "AMOUNT", value: 5000 }), rule({ id: "c", value: 50, active: false })], () => ctx);
    expect(best?.rule.id).toBe("b");
    expect(best?.amountRwf).toBe(5000);
    expect(bestDiscount([rule({ active: false })], () => ctx)).toBeNull();
  });

  it("validates the studio input (percent cap, time-boxed offers, code format)", () => {
    expect(DiscountInput.safeParse({ code: "save10", kind: "PERCENT", value: 10 }).data?.code).toBe("SAVE10");
    expect(DiscountInput.safeParse({ code: "X", kind: "PERCENT", value: 10 }).success).toBe(false);
    expect(DiscountInput.safeParse({ code: "BIG", kind: "PERCENT", value: 95 }).success).toBe(false);
    expect(DiscountInput.safeParse({ kind: "PERCENT", value: 10 }).success).toBe(false); // automatic offer without an end
    expect(DiscountInput.safeParse({ kind: "PERCENT", value: 10, endsAt: "2026-11-20T00:00:00Z" }).success).toBe(true);
  });
});

describe("broadcast opt-in and rate limits (E30)", () => {
  const r = (userId: string, optedIn = true, recentWeek = 0) => ({ userId, phone: `+2507880000${userId}`, optedIn, recentWeek });

  it("sends only to opted-in followers", () => {
    const p = planBroadcast([], [r("1"), r("2", false), r("3")], now);
    expect(p.ok && p.send.map((x) => x.userId)).toEqual(["1", "3"]);
    expect(p.ok && p.skipped).toEqual([{ userId: "2", reason: "NOT_OPTED_IN" }]);
  });

  it("skips followers who already got enough updates this week from any maker", () => {
    const p = planBroadcast([], [r("1", true, BROADCAST_LIMITS.recipientPerWeek), r("2", true, 1)], now);
    expect(p.ok && p.send.map((x) => x.userId)).toEqual(["2"]);
    expect(p.ok && p.skipped[0].reason).toBe("RECIPIENT_LIMIT");
  });

  it("limits a page to one broadcast a day and three a week", () => {
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
    const day = planBroadcast([hoursAgo(5)], [r("1")], now);
    expect(day).toMatchObject({ ok: false, reason: "PAGE_DAILY_LIMIT" });
    expect(!day.ok && day.retryAt?.toISOString()).toBe(new Date(hoursAgo(5).getTime() + 86400_000).toISOString());
    expect(planBroadcast([hoursAgo(30), hoursAgo(60), hoursAgo(100)], [r("1")], now)).toMatchObject({ ok: false, reason: "PAGE_WEEKLY_LIMIT" });
    expect(planBroadcast([hoursAgo(30), hoursAgo(200)], [r("1")], now).ok).toBe(true);
  });

  it("refuses when nobody opted in, and dedupes phones", () => {
    expect(planBroadcast([], [r("1", false)], now)).toMatchObject({ ok: false, reason: "NO_RECIPIENTS" });
    const p = planBroadcast([], [r("1"), { ...r("1"), userId: "dup" }], now);
    expect(p.ok && p.send).toHaveLength(1);
  });
});

describe("share links and insights (E30)", () => {
  it("tags links with a source the Maker Space reports to analytics", () => {
    const u = new URL(shareLink("http://localhost:3103", "uwase-couture", "wa_status", { productId: "p1", campaign: "promo" }));
    expect(u.pathname).toBe("/m/uwase-couture");
    expect(Object.fromEntries(u.searchParams)).toEqual({ src: "wa_status", utm_source: "whatsapp", utm_medium: "wa_status", utm_campaign: "promo", p: "p1" });
  });

  const facts = (over: Partial<InsightFacts> = {}): InsightFacts => ({
    products: [{ id: "p1", title: "Blue kitenge dress", priceRwf: 36000, colours: 1, looks: 40, sales: 1, ready: true }],
    sources: { direct: 40, wa_status: 2 },
    hours: Array.from({ length: 24 }, (_, h) => (h === 19 ? 12 : h === 12 ? 6 : 0)),
    optedInFollowers: 3,
    daysSinceBroadcast: null,
    activeOffers: 0,
    ...over,
  });

  it("flags many try-ons with few sales first, with an offer action (FR-ANL-03 example)", () => {
    const s = suggest(facts(), "en", "/studio/x");
    expect(s[0].key).toBe("lowconv:p1");
    expect(s[0].text).toContain("many try-ons (40) but few sales (1)");
    expect(s[0].action?.href).toBe("/studio/x/grow?tab=offers&product=p1");
  });

  it("speaks Kinyarwanda and suggests WhatsApp, followers and posting time", () => {
    const s = suggest(facts({ products: [] }), "rw", "/studio/x", 6);
    expect(s.map((x) => x.key)).toEqual(["whatsapp", "followers", "hours"]);
    expect(s[2].text).toContain("19:00");
    expect(s[0].text).toContain("WhatsApp");
  });

  it("falls back to an encouraging note when nothing stands out", () => {
    expect(suggest(facts({ products: [], sources: {}, hours: new Array(24).fill(0), optedInFollowers: 0 }), "fr", "/s")[0].key).toBe("ok");
  });

  it("finds best hours in Kigali time", () => {
    expect(bestHours([0, 3, 0, 9, 9])).toEqual([3, 4]);
    expect(kigaliHour(new Date("2026-11-11T17:30:00Z"))).toBe(19);
  });
});
