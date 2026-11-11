import { describe, expect, it } from "vitest";
import {
  assertCatalogueImage,
  consentState,
  needsTombstone,
  normaliseCategory,
  normaliseColour,
  pagePurpose,
  productEligibility,
  productPurpose,
  ShopperDataError,
  type LedgerRow,
} from "./training-consent";
import { bootstrapStability, computeTrends, K_MIN, makerRuleOk, privacyAudit, regionOf, stableView, weeksBack, type Signal, type SupplyRow } from "./trends";
import { syntheticSignals } from "./trends-seed";

const at = (m: number) => new Date(Date.UTC(2026, 10, 1, 0, m));
const row = (purpose: string, granted: boolean, m: number, id = `r${m}`): LedgerRow => ({ id, userId: "u1", purpose, granted, createdAt: at(m) });

describe("training-data consent gating", () => {
  it("is out by default and in after a page opt-in", () => {
    expect(productEligibility(consentState("pg", []), "p1")).toEqual({ eligible: false, reason: "NOT_OPTED_IN" });
    const s = consentState("pg", [row(pagePurpose("pg"), true, 1)]);
    expect(productEligibility(s, "p1")).toMatchObject({ eligible: true, consentRecordId: "r1", scope: "page" });
  });

  it("lets one product be kept out, or opted in alone, and the latest record wins", () => {
    const rows = [row(pagePurpose("pg"), true, 1), row(productPurpose("pg", "p2"), false, 2), row(productPurpose("pg", "p3"), true, 3)];
    const s = consentState("pg", rows);
    expect(productEligibility(s, "p1").eligible).toBe(true);
    expect(productEligibility(s, "p2")).toEqual({ eligible: false, reason: "PRODUCT_EXCLUDED" });
    const withdrawn = consentState("pg", [...rows, row(pagePurpose("pg"), false, 4)]);
    expect(productEligibility(withdrawn, "p1")).toEqual({ eligible: false, reason: "PAGE_WITHDRAWN" });
    expect(productEligibility(withdrawn, "p3")).toMatchObject({ eligible: true, scope: "product" });
  });

  it("ignores other pages and other purposes", () => {
    const s = consentState("pg", [row(pagePurpose("pg2"), true, 1), row("TRYON_GENERATION", true, 2), row(`${pagePurpose("pg")}x`, true, 3)]);
    expect(s.page).toBeNull();
    expect(Object.keys(s.products)).toEqual([]);
  });

  it("tombstones only a grant → withdrawal transition", () => {
    const granted = { granted: true, recordId: "a", userId: "u", at: at(1) };
    expect(needsTombstone(granted, false)).toBe(true);
    expect(needsTombstone(granted, true)).toBe(false);
    expect(needsTombstone(null, false)).toBe(false);
  });

  it("refuses shopper data by code and accepts catalogue media", () => {
    expect(assertCatalogueImage("public/media/pg1/v1-photo.png")).toBe("public/media/pg1/v1-photo.png");
    for (const bad of ["private/twins/u1.bin", "private/looks/l.png", "public/personas/persona-1.png", "public/media/../private/twins/x", "public/media/u1/wardrobe/a.png", "", null]) {
      expect(() => assertCatalogueImage(bad)).toThrow(ShopperDataError);
    }
    // ids are random: a cuid containing "clip" must not be mistaken for a video clip
    expect(assertCatalogueImage("public/media/cmclipxyz/abc-photo.png")).toBeTruthy();
  });

  it("normalises catalogue labels", () => {
    expect(normaliseColour("Forest green")).toBe("forest-green");
    expect(normaliseColour("Red")).toBe("crimson");
    expect(normaliseColour("Lilac")).toBeNull();
    expect(normaliseCategory("Umushanana")).toBe("umushanana");
  });
});

const NOW = new Date("2026-11-11T10:00:00Z");
const weeks = weeksBack(NOW, 8);
const ask = (i: number, w: number, extra: Partial<Signal> = {}): Signal => ({ week: weeks[w], region: "Kigali", source: "ASK", colour: "gold", category: "umushanana", occasion: "wedding", pseudoId: `p${i}`, ...extra });

describe("trend computation + k-anonymity", () => {
  it("publishes a rising colour only when every recent week and the baseline reach k", () => {
    const signals: Signal[] = [];
    for (let w = 0; w < 6; w++) for (let i = 0; i < 10; i++) signals.push(ask(i + w * 10, w));
    for (let w = 6; w < 8; w++) for (let i = 0; i < 25; i++) signals.push(ask(1000 + i + w * 30, w));
    const t = computeTrends(signals, [], { now: NOW });
    const gold = t.rising.find((r) => r.key === "colour:gold:ALL")!;
    expect(gold.growth).toBeCloseTo(1.5, 1);
    expect(gold.series.every((x) => x === null || x >= K_MIN)).toBe(true);
    // Same data with only 9 shoppers in the last week: suppressed, not shown as small.
    const lastWeek = signals.filter((s) => s.week === weeks[7]);
    const thin = signals.filter((s) => s.week !== weeks[7]).concat(lastWeek.slice(0, 9));
    expect(new Set(thin.filter((s) => s.week === weeks[7]).map((s) => s.pseudoId)).size).toBe(9);
    const t2 = computeTrends(thin, [], { now: NOW });
    expect(t2.rising.find((r) => r.key === "colour:gold:ALL")).toBeUndefined();
    expect(t2.suppressed.rising).toBeGreaterThan(0);
  });

  it("never lets k drop below 10", () => {
    expect(computeTrends([], [], { k: 3 }).k).toBe(10);
  });

  it("counts distinct people, not events (one shopper asking 50 times is one)", () => {
    const spam = Array.from({ length: 50 }, () => ask(1, 7, { colour: "lilac" }));
    const t = computeTrends(spam, [], { now: NOW });
    expect(t.gaps.find((g) => g.colour === "lilac")).toBeUndefined();
    expect(t.rising.find((r) => r.value === "lilac")).toBeUndefined();
  });

  it("finds demand vs supply gaps from public supply", () => {
    const signals = Array.from({ length: 30 }, (_, i) => ask(i, 6 + (i % 2)));
    const supply: SupplyRow[] = [
      { pageId: "m1", category: "umushanana", colours: ["gold"], occasions: ["wedding"], patterns: [] },
      { pageId: "m2", category: "umushanana", colours: ["teal"], occasions: ["wedding"], patterns: [] },
    ];
    const t = computeTrends(signals, supply, { now: NOW, viewerPageId: "m2" });
    expect(t.gaps[0]).toMatchObject({ colour: "gold", category: "umushanana", occasion: "wedding", makers: 1, youMakeIt: true });
    expect(t.gaps[0].asks % 5).toBe(0);
  });

  it("maker rule: ≥ 3 makers, ≥ 2 other than the viewer, none above 60 %", () => {
    expect(makerRuleOk(new Map([["a", 5], ["b", 5]])).ok).toBe(false);
    expect(makerRuleOk(new Map([["a", 7], ["b", 2], ["c", 1]])).reason).toBe("one maker dominates");
    expect(makerRuleOk(new Map([["a", 4], ["b", 3], ["c", 3]])).ok).toBe(true);
    expect(makerRuleOk(new Map([["a", 4], ["b", 3], ["c", 3]]), "a").ok).toBe(true);
  });

  it("maps districts to regions", () => {
    expect(regionOf("Gasabo")).toBe("Kigali");
    expect(regionOf("")).toBe("Rwanda");
    expect(regionOf("musanze")).toBe("Musanze");
  });
});

describe("synthetic signals: planted trends, privacy audit, bootstrap stability", () => {
  const makers = Array.from({ length: 12 }, (_, i) => `maker-${i}`);
  const signals = syntheticSignals({ now: NOW, makers, shoppers: 1200 });
  const supply: SupplyRow[] = makers.map((m, i) => ({ pageId: m, category: ["dress", "umushanana", "shirt", "skirt"][i % 4], colours: i === 1 ? ["gold"] : ["indigo", "teal"], occasions: ["wedding", "party"], patterns: [] }));

  it("recovers the planted trends and suppresses the small / dominated cells", () => {
    const t = computeTrends(signals, supply, { now: NOW, viewerPageId: "maker-3" });
    const keys = t.rising.map((r) => r.key);
    expect(keys).toContain("colour:gold:ALL");
    expect(keys).toContain("pattern:imigongo:ALL");
    expect(keys).toContain("occasion:graduation:ALL");
    expect(keys.some((k) => k.includes("lilac"))).toBe(false);
    expect(t.gaps.some((g) => g.colour === "gold" && g.category === "umushanana")).toBe(true);
    const trousers = t.priceBands.find((c) => c.category === "trousers" && c.band === ">70k");
    expect(trousers?.conversion ?? null).toBeNull();
    expect(t.priceHints.find((h) => h.category === "dress")).toMatchObject({ best: "20-40k" });
  });

  it("passes the independent privacy audit for every viewer", () => {
    for (const viewer of [null, "maker-0", "maker-5"]) {
      const t = computeTrends(signals, supply, { now: NOW, viewerPageId: viewer });
      const a = privacyAudit(t, signals, viewer);
      expect(a.violations).toEqual([]);
      expect(a.checked).toBeGreaterThan(20);
    }
  });

  it("the audit catches a cell published below k", () => {
    const t = computeTrends(signals, supply, { now: NOW });
    const forged = { ...t, gaps: [...t.gaps, { key: "gap:lilac|dress|party", colour: "lilac", category: "dress", occasion: "party", asks: 5, makers: 0, ratio: 6, youMakeIt: false }] };
    expect(privacyAudit(forged, signals).passed).toBe(false);
  });

  it("is stable under bootstrap resampling of shoppers", () => {
    const s = bootstrapStability(signals, supply, { now: NOW, B: 12, seed: 7 });
    expect(s.risingTopJaccard).toBeGreaterThanOrEqual(0.5);
    expect(s.itemStability["colour:gold:ALL"]).toBeGreaterThanOrEqual(0.7);
    const view = stableView(s);
    expect(view.rising.length).toBeGreaterThan(0);
    expect(view.rising.every((r) => s.itemStability[r.key] >= 0.7)).toBe(true);
  });
});
