import { describe, expect, it } from "vitest";
import { assistAllowed, checkCode, CODE_TTL_MIN, hashCode, MAX_CODE_ATTEMPTS } from "./assist";
import { normalisePath, ussdStep, type UssdContext } from "./ussd";

const ctx = (over: Partial<UssdContext> = {}): UssdContext => ({
  makerName: "Mukamana Jeanne",
  locale: "en",
  sales: { monthCount: 3, monthRwf: 54000, lastCount: 5, lastRwf: 90000 },
  payout: { nextRwf: 36000, nextDate: "1 Dec", directRwf: 18000 },
  orders: [
    { id: "o1", code: "NY-AAA111", title: "Imigongo umushanana", colour: "Indigo", size: "M", totalRwf: 38000 },
    { id: "o2", code: "NY-BBB222", title: "Uruziga skirt", colour: "Gold", size: "L", totalRwf: 17000 },
  ],
  pendingAssist: { id: "g1", adminName: "Grace", days: 30 },
  ...over,
});

describe("USSD state machine (E31, FR-COOP-09)", () => {
  it("opens with the root menu, listing waiting orders and the help request", () => {
    const r = ussdStep(ctx(), "");
    expect(r.end).toBe(false);
    expect(r.text.startsWith("CON Hello Mukamana · Nyambika")).toBe(true);
    expect(r.text).toContain("3. Approve an order (2)");
    expect(r.text).toContain("4. Allow admin to help me (!)");
    expect(ussdStep(ctx({ pendingAssist: null }), "").text).not.toContain("4.");
  });

  it("answers sales and next payout and ends the session", () => {
    expect(ussdStep(ctx(), "1")).toMatchObject({ end: true, text: expect.stringContaining("This month: 3 sold, RWF 54,000") });
    const p = ussdStep(ctx(), "2");
    expect(p.end).toBe(true);
    expect(p.text).toContain("pays you RWF 36,000 on 1 Dec");
    expect(p.text).toContain("RWF 18,000");
  });

  it("approves an order in three steps and emits exactly one action", () => {
    expect(ussdStep(ctx(), "3").text).toContain("1. NY-AAA111 Imigongo umushanana RWF 38,000");
    expect(ussdStep(ctx(), "3*2").text).toContain("NY-BBB222: Uruziga skirt (Gold, L)");
    expect(ussdStep(ctx(), "3*2").action).toBeUndefined();
    const ok = ussdStep(ctx(), "3*2*1");
    expect(ok).toMatchObject({ end: true, action: { type: "ACCEPT_ORDER", orderId: "o2" } });
    expect(ussdStep(ctx(), "3*2*2")).toMatchObject({ end: true, action: undefined });
    expect(ussdStep(ctx({ orders: [] }), "3")).toMatchObject({ end: true, text: "END No orders waiting." });
  });

  it("handles invalid input without ending the session", () => {
    expect(ussdStep(ctx(), "9")).toMatchObject({ end: false, text: expect.stringContaining("Invalid choice") });
    expect(ussdStep(ctx(), "3*7")).toMatchObject({ end: false, path: ["3"] });
    expect(ussdStep(ctx(), "3*1*5")).toMatchObject({ end: false, path: ["3", "1"] });
  });

  it("0 goes back a level and exits at the root", () => {
    expect(normalisePath("3*2*0")).toEqual(["3"]);
    expect(normalisePath("3*0*1")).toEqual(["1"]);
    expect(normalisePath("0")).toBeNull();
    expect(ussdStep(ctx(), "3*0")).toMatchObject({ end: false, path: [] });
    expect(ussdStep(ctx(), "3*0*1").text).toContain("This month");
    expect(ussdStep(ctx(), "0")).toMatchObject({ end: true, text: "END Thank you. Have a good day!" });
  });

  it("records consent or refusal for assisted mode only from the maker's own menu", () => {
    expect(ussdStep(ctx(), "4").text).toContain("Grace wants to help you add products and accept orders for 30 days");
    expect(ussdStep(ctx(), "4*1").action).toEqual({ type: "GRANT_ASSIST", grantId: "g1" });
    expect(ussdStep(ctx(), "4*2").action).toEqual({ type: "DENY_ASSIST", grantId: "g1" });
    expect(ussdStep(ctx({ pendingAssist: null }), "4*1")).toMatchObject({ end: true, action: undefined });
  });

  it("speaks Kinyarwanda by default and switches language", () => {
    expect(ussdStep(ctx({ locale: "rw" }), "").text).toContain("Muraho Mukamana");
    expect(ussdStep(ctx({ locale: "rw" }), "1").text).toContain("Uku kwezi: 3 byagurishijwe");
    expect(ussdStep(ctx({ locale: "rw" }), "5*3")).toMatchObject({ end: true, action: { type: "SET_LOCALE", locale: "fr" }, text: "END Langue modifiée." });
  });
});

describe("assisted-mode consent (E31)", () => {
  const t0 = new Date("2026-11-11T10:00:00Z");
  const active = { status: "ACTIVE", scopes: ["PRODUCTS", "ORDERS"], expiresAt: new Date("2026-12-11T10:00:00Z"), revokedAt: null };

  it("allows on-behalf actions only with an active, unexpired, in-scope grant", () => {
    expect(assistAllowed(active, "PRODUCTS", t0)).toEqual({ ok: true });
    expect(assistAllowed(null, "PRODUCTS", t0)).toEqual({ ok: false, reason: "NO_CONSENT" });
    expect(assistAllowed({ ...active, status: "PENDING" }, "ORDERS", t0)).toEqual({ ok: false, reason: "PENDING" });
    expect(assistAllowed({ ...active, revokedAt: t0 }, "ORDERS", t0)).toEqual({ ok: false, reason: "REVOKED" });
    expect(assistAllowed({ ...active, status: "DENIED" }, "ORDERS", t0)).toEqual({ ok: false, reason: "REVOKED" });
    expect(assistAllowed(active, "ORDERS", new Date("2026-12-11T10:00:00Z"))).toEqual({ ok: false, reason: "EXPIRED" });
    expect(assistAllowed({ ...active, scopes: ["ORDERS"] }, "PRODUCTS", t0)).toEqual({ ok: false, reason: "OUT_OF_SCOPE" });
  });

  it("accepts the maker's code once, within its lifetime and attempt budget", () => {
    const g = { id: "g1", status: "PENDING", codeHash: hashCode("g1", "123456"), attempts: 0, createdAt: t0 };
    expect(checkCode(g, "123456", t0)).toEqual({ ok: true });
    expect(checkCode(g, " 123456 ", t0)).toEqual({ ok: true });
    expect(checkCode(g, "654321", t0)).toEqual({ ok: false, reason: "WRONG" });
    expect(checkCode({ ...g, id: "other" }, "123456", t0)).toEqual({ ok: false, reason: "WRONG" }); // code bound to its grant
    expect(checkCode(g, "123456", new Date(t0.getTime() + (CODE_TTL_MIN + 1) * 60_000))).toEqual({ ok: false, reason: "EXPIRED" });
    expect(checkCode({ ...g, attempts: MAX_CODE_ATTEMPTS }, "123456", t0)).toEqual({ ok: false, reason: "LOCKED" });
    expect(checkCode({ ...g, status: "ACTIVE" }, "123456", t0)).toEqual({ ok: false, reason: "NOT_PENDING" });
  });
});
