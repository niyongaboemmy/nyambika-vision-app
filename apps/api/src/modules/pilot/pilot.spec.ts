import { describe, expect, it } from "vitest";
import { assign, bucket, isLive, pickVariant } from "./assign";
import { buildKpis, rag, recomputeEconomics, recommend, STUDY_ASSUMPTIONS, STUDY_BASE_MONTHLY_RESULT, unitEconomics, type PilotRaw } from "./kpis";
import { sanitizeProps, pseudonymise } from "./pilot.service";
import { nps, normalCdf, percentile, zTest } from "./stats";

describe("experiment assignment", () => {
  const arms = [
    { key: "3", weight: 50 },
    { key: "2", weight: 50 },
  ];

  it("is deterministic per user and experiment", () => {
    for (let i = 0; i < 50; i++) {
      const u = `user-${i}`;
      expect(assign(u, "looks.initial_count", arms)).toBe(assign(u, "looks.initial_count", arms));
      expect(bucket(u, "x")).toBe(bucket(u, "x"));
    }
  });

  it("buckets are independent across experiments", () => {
    const same = Array.from({ length: 400 }, (_, i) => `u${i}`).filter((u) => assign(u, "a", arms) === assign(u, "b", arms)).length;
    expect(same).toBeGreaterThan(140);
    expect(same).toBeLessThan(260);
  });

  it("respects weights (75/25) within sampling error", () => {
    const w = [
      { key: "text", weight: 75 },
      { key: "voice", weight: 25 },
    ];
    const n = 4000;
    const voice = Array.from({ length: n }, (_, i) => assign(`shopper-${i}`, "muse.voice", w)).filter((v) => v === "voice").length;
    expect(voice / n).toBeGreaterThan(0.22);
    expect(voice / n).toBeLessThan(0.28);
  });

  it("picks by cumulative weight and handles edge weights", () => {
    expect(pickVariant(arms, 0)).toBe("3");
    expect(pickVariant(arms, 0.4999)).toBe("3");
    expect(pickVariant(arms, 0.5)).toBe("2");
    expect(pickVariant(arms, 0.9999)).toBe("2");
    expect(pickVariant([{ key: "a", weight: 0 }, { key: "b", weight: 10 }], 0)).toBe("b");
    expect(pickVariant([{ key: "a", weight: 0 }, { key: "b", weight: 0 }], 0.7)).toBe("a");
    expect(() => pickVariant([], 0.1)).toThrow();
  });

  it("only RUNNING experiments inside their window are live", () => {
    const now = new Date("2027-03-10T10:00:00Z");
    expect(isLive({ status: "DRAFT", startsAt: null, endsAt: null }, now)).toBe(false);
    expect(isLive({ status: "RUNNING", startsAt: null, endsAt: null }, now)).toBe(true);
    expect(isLive({ status: "RUNNING", startsAt: new Date("2027-03-11"), endsAt: null }, now)).toBe(false);
    expect(isLive({ status: "RUNNING", startsAt: new Date("2027-03-01"), endsAt: new Date("2027-03-10T10:00:00Z") }, now)).toBe(false);
    expect(isLive({ status: "PAUSED", startsAt: null, endsAt: null }, now)).toBe(false);
  });
});

describe("statistics", () => {
  it("normal CDF matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 4);
  });

  it("two-proportion z-test matches a textbook example", () => {
    // 200/1000 vs 250/1000: pooled p = .225, se = .018675, z = 2.677, p ≈ .0074
    const t = zTest(200, 1000, 250, 1000);
    expect(t.pA).toBeCloseTo(0.2);
    expect(t.pB).toBeCloseTo(0.25);
    expect(t.z!).toBeCloseTo(2.677, 2);
    expect(t.p!).toBeCloseTo(0.0074, 3);
    expect(t.significant).toBe(true);
    expect(t.lift!).toBeCloseTo(0.25);
    expect(t.ci![0]).toBeGreaterThan(0);
  });

  it("is symmetric and non-significant for small differences", () => {
    const a = zTest(50, 200, 55, 200);
    const b = zTest(55, 200, 50, 200);
    expect(a.z!).toBeCloseTo(-b.z!, 8);
    expect(a.p!).toBeCloseTo(b.p!, 8);
    expect(a.significant).toBe(false);
  });

  it("returns nulls without data or variance", () => {
    expect(zTest(0, 0, 5, 10).z).toBeNull();
    expect(zTest(0, 10, 0, 10).p).toBeNull();
    expect(zTest(10, 10, 10, 10).significant).toBe(false);
  });

  it("percentile and NPS", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(nps([10, 9, 8, 7, 6, 0])).toBe(0);
    expect(nps([10, 10, 9, 8])).toBe(75);
    expect(nps([])).toBeNull();
  });
});

const base: PilotRaw = {
  cohortPages: 24,
  activePages: 22,
  activeCoops: 4,
  paidPages: 8,
  selfManagingPages: 18,
  newShoppers: 520,
  shoppersWithTwin: 290,
  shoppersWithTryOn: 505,
  firstLookLatenciesMs: [9000, 11000, 12000, 14000, 30000],
  lookViewers: 480,
  lookViewersWhoHeldOrContacted: 130,
  billedGenerations: 1200,
  generationCostRwf: 1200 * 95,
  deliveredGenerations: 1200,
  withheldGenerations: 18,
  holdOrders: 120,
  paidOrders: 90,
  paidOrderValueRwf: 90 * 32_000,
  surveyAnswered: 200,
  surveyHelped: 150,
  npsScores: [10, 9, 8, 7],
  privacyIncidents: 0,
  pageAllowanceGenerations: 400,
  shopperPaidGenerations: 700,
  pilotDays: 26,
};

describe("KPI computations", () => {
  it("RAG bands", () => {
    expect(rag(0.5, 0.5, "min")).toBe("green");
    expect(rag(0.41, 0.5, "min")).toBe("amber");
    expect(rag(0.39, 0.5, "min")).toBe("red");
    expect(rag(15, 15, "max")).toBe("green");
    expect(rag(17.9, 15, "max")).toBe("amber");
    expect(rag(18.1, 15, "max")).toBe("red");
    expect(rag(0, 0, "zero")).toBe("green");
    expect(rag(1, 0, "zero")).toBe("red");
    expect(rag(null, 1, "min")).toBe("none");
  });

  it("computes every Phase-2 KPI from raw counts", () => {
    const k = Object.fromEntries(buildKpis(base).map((r) => [r.key, r]));
    expect(k.twin_rate.actual).toBeCloseTo(290 / 520);
    expect(k.twin_rate.rag).toBe("green");
    expect(k.first_look_p50.actual).toBe(12);
    expect(k.look_hold_contact.actual).toBeCloseTo(130 / 480);
    expect(k.gens_per_order.actual).toBeCloseTo(13.3, 1);
    expect(k.hold_to_buy.actual).toBeCloseTo(0.75);
    expect(k.paid_pages.actual).toBeCloseTo(1 / 3);
    expect(k.self_managing.actual).toBeCloseTo(0.75);
    expect(k.helped_decide.actual).toBeCloseTo(0.75);
    expect(k.helped_decide.detail).toContain("NPS 50");
    expect(k.guard_failure.actual).toBeCloseTo(18 / 1218);
    expect(k.cost_per_generation.actual).toBe(95);
    expect(k.cost_per_generation.display).toBe("RWF 95");
    expect(k.privacy_incidents.rag).toBe("green");
    expect(Object.values(k).every((r) => r.rag === "green")).toBe(true);
  });

  it("handles an empty pilot without dividing by zero", () => {
    const empty = buildKpis({ ...base, newShoppers: 0, shoppersWithTwin: 0, firstLookLatenciesMs: [], lookViewers: 0, billedGenerations: 0, paidOrders: 0, holdOrders: 0, deliveredGenerations: 0, withheldGenerations: 0, surveyAnswered: 0, cohortPages: 0, npsScores: [] });
    const k = Object.fromEntries(empty.map((r) => [r.key, r]));
    expect(k.twin_rate.rag).toBe("none");
    expect(k.gens_per_order.display).toBe("—");
    expect(k.first_look_p50.actual).toBeNull();
  });

  it("caps active pages at amber without 3 cooperatives", () => {
    const k = buildKpis({ ...base, activeCoops: 2 }).find((r) => r.key === "active_pages")!;
    expect(k.rag).toBe("amber");
  });
});

describe("unit economics and Gate 3", () => {
  it("reproduces the feasibility study §10.3 / §10.5 base case", () => {
    const e = unitEconomics(STUDY_ASSUMPTIONS);
    expect(e.proContribution).toBe(15_010); // ≈ RWF 15,000
    expect(e.businessContribution).toBe(32_250);
    expect(e.orderContribution).toBe(906); // ≈ RWF 900
    expect(Math.abs(e.monthlyResult - STUDY_BASE_MONTHLY_RESULT)).toBeLessThan(25_000);
  });

  it("recomputes with pilot actuals and judges the break-even path", () => {
    const good = recomputeEconomics({ costPerGenRwf: 80, proPriceRwf: null, proAllowance: null, businessPriceRwf: null, businessAllowance: null, allowanceUse: 0.4, aovRwf: 32_000, uncoveredTriesPerOrder: 4, paidPageConversion: 0.33 });
    expect(good.pilot.inputs.costPerGenRwf).toBe(80);
    expect(good.pilot.monthlyResult).toBeGreaterThan(good.plan.monthlyResult);
    expect(good.withinBreakEvenPath).toBe(true);
    const bad = recomputeEconomics({ costPerGenRwf: 160, proPriceRwf: 15_000, proAllowance: 200, businessPriceRwf: null, businessAllowance: null, allowanceUse: 0.8, aovRwf: 18_000, uncoveredTriesPerOrder: 12, paidPageConversion: 0.1 });
    expect(bad.pilot.orderContribution).toBeLessThan(0);
    expect(bad.withinBreakEvenPath).toBe(false);
  });

  it("recommends Scale, Iterate or Pivot by rule", () => {
    expect(recommend(buildKpis(base), true).decision).toBe("Scale");
    const privacy = recommend(buildKpis({ ...base, privacyIncidents: 1 }), true);
    expect(privacy.decision).toBe("Iterate");
    expect(privacy.reasons.join(" ")).toMatch(/Privacy/);
    expect(recommend(buildKpis({ ...base, paidOrders: 60, billedGenerations: 1200 }), true).decision).toBe("Iterate");
    const weak = buildKpis({ ...base, shoppersWithTwin: 100, lookViewersWhoHeldOrContacted: 40, surveyHelped: 80 });
    expect(recommend(weak, false).decision).toBe("Pivot");
    expect(recommend(weak, true).decision).toBe("Iterate");
  });
});

describe("analytics privacy", () => {
  it("pseudonymises ids stably and irreversibly", () => {
    expect(pseudonymise("user-1")).toBe(pseudonymise("user-1"));
    expect(pseudonymise("user-1")).not.toContain("user-1");
    expect(pseudonymise("user-1")).toHaveLength(32);
  });

  it("drops unknown keys and PII-looking values", () => {
    const p = sanitizeProps({ lookId: "ck123", phone: "+250788000001", source: "+250 788 000 001", channel: "a@b.rw", index: 3, onTwin: true, name: "Aline" });
    expect(p).toEqual({ lookId: "ck123", index: 3, onTwin: true });
  });
});
