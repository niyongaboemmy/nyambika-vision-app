import { describe, expect, it } from "vitest";
import { DELIVERY_FEE_RWF, groupKey, lineProblem, orderKey, splitBag, type BagLine } from "./split";

const line = (over: Partial<BagLine>): BagLine => ({
  id: Math.random().toString(36).slice(2),
  productId: "p1",
  variantId: "v1",
  size: "M",
  qty: 1,
  lookId: null,
  title: "Kitenge shirt",
  colourName: "Teal",
  unitPriceRwf: 20000,
  madeToOrder: false,
  stock: 5,
  sizes: ["S", "M", "L"],
  available: true,
  pageId: "pageA",
  pageName: "Kanombe Kitenge Corner",
  sector: "Kimironko",
  leadTimeDays: 2,
  payoutMsisdn: "0788100003",
  payoutLabel: "Kanombe Kitenge Corner",
  makerName: "",
  ...over,
});

describe("splitBag (E29 optional checkout)", () => {
  it("keeps one maker's items together: one order, one fee, quantities priced", () => {
    const [g, ...rest] = splitBag([line({ qty: 2 }), line({ variantId: "v2", unitPriceRwf: 15000 })]);
    expect(rest).toHaveLength(0);
    expect(g.lines).toHaveLength(2);
    expect(g.subtotalRwf).toBe(2 * 20000 + 15000);
    expect(g.deliveryFeeRwf).toBe(DELIVERY_FEE_RWF);
    expect(g.totalRwf).toBe(55000 + DELIVERY_FEE_RWF);
    expect(g.payable).toBe(true);
  });

  it("splits a multi-maker bag into one payment per maker payout account, with per-maker delivery", () => {
    const a = line({});
    const b = line({ pageId: "pageB", pageName: "Akeza Couture", payoutMsisdn: "0788100006", payoutLabel: "Akeza Couture", unitPriceRwf: 30000, leadTimeDays: 5 });
    const groups = splitBag([a, b, line({ variantId: "v3" })], { [groupKey(b)]: "PICKUP" });
    expect(groups.map((g) => g.pageName)).toEqual(["Kanombe Kitenge Corner", "Akeza Couture"]);
    expect(groups[0].lines).toHaveLength(2);
    expect(groups[1].deliveryFeeRwf).toBe(0);
    expect(groups[1].totalRwf).toBe(30000);
    expect(groups[1].leadTimeDays).toBe(5);
  });

  it("splits one cooperative page by maker account when products pay the maker directly (FR-COOP-05)", () => {
    const toMaker = line({ pageId: "coop", payoutMsisdn: "0788100004", payoutLabel: "Jeanne (Urudodo)" });
    const toPage = line({ pageId: "coop", payoutMsisdn: "0788100002", payoutLabel: "Urudodo" });
    expect(splitBag([toMaker, toPage])).toHaveLength(2);
  });

  it("flags problems so nothing is charged for a group that can't be fulfilled", () => {
    expect(lineProblem(line({ stock: 1, qty: 2 }))).toMatch(/only 1/i);
    expect(lineProblem(line({ stock: 0 }))).toMatch(/sold out/i);
    expect(lineProblem(line({ stock: 0, madeToOrder: true }))).toBeNull();
    expect(lineProblem(line({ size: "XXL" }))).toMatch(/size/i);
    const [g] = splitBag([line({ payoutMsisdn: null })]);
    expect(g.payable).toBe(false);
    expect(g.problems.join()).toMatch(/mobile money/i);
  });

  it("derives a stable per-maker idempotency key", () => {
    const [g] = splitBag([line({})]);
    expect(orderKey("abc12345", g)).toBe(orderKey("abc12345", splitBag([line({ variantId: "other" })])[0]));
    expect(orderKey("abc12345", g)).not.toBe(orderKey("zzz12345", g));
  });
});
