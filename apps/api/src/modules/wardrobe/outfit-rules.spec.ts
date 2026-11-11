import { describe, expect, it } from "vitest";
import { compatible, evaluate, harmony, type Piece, reminderDue, renderOrder, slotOf, suggestOutfits } from "./outfit-rules";

let n = 0;
const piece = (category: string, colourHex: string, over: Partial<Piece> = {}): Piece => {
  n += 1;
  return {
    productId: `p${n}`,
    variantId: `v${n}`,
    pageId: "page",
    title: `${category} ${n}`,
    category,
    colourName: colourHex,
    colourHex,
    occasions: ["office", "wedding"],
    priceRwf: 20000,
    owned: false,
    ...over,
  };
};

const INDIGO = "#2F3E9E";
const BLUE = "#2B6CB0";
const ORANGE = "#E07B20";
const GREEN = "#2E7D4F";
const BLACK = "#1C1C1C";
const TERRA = "#C8553D";

describe("category compatibility", () => {
  it("wears a dress alone and pairs exactly one top with one skirt", () => {
    expect(slotOf("Dress")).toBe("FULL");
    expect(slotOf("umushanana")).toBe("FULL");
    expect(slotOf("shirt")).toBe("TOP");
    expect(slotOf("skirt")).toBe("BOTTOM");
    expect(slotOf("shoes")).toBeNull();
    expect(compatible([{ category: "dress" }])).toBe(true);
    expect(compatible([{ category: "shirt" }, { category: "skirt" }])).toBe(true);
    expect(compatible([{ category: "skirt" }, { category: "shirt" }])).toBe(true);
    expect(compatible([{ category: "dress" }, { category: "skirt" }])).toBe(false);
    expect(compatible([{ category: "shirt" }, { category: "shirt" }])).toBe(false);
    expect(compatible([{ category: "shirt" }])).toBe(false);
    expect(compatible([{ category: "skirt" }])).toBe(false);
  });

  it("renders the skirt before the top so the top sits over the waistband", () => {
    const order = renderOrder([piece("shirt", INDIGO), piece("skirt", BLACK)]);
    expect(order.map((p) => p.category)).toEqual(["skirt", "shirt"]);
  });
});

describe("colour harmony by hue", () => {
  it("accepts neutrals, analogous, split and complementary pairs; rejects clashes", () => {
    expect(harmony(BLACK, ORANGE)).toMatchObject({ ok: true, kind: "neutral" });
    expect(harmony(INDIGO, BLUE)).toMatchObject({ ok: true, kind: "analogous" });
    expect(harmony(INDIGO, ORANGE)).toMatchObject({ ok: true, kind: "complementary" });
    expect(harmony(GREEN, BLUE)).toMatchObject({ ok: false, kind: "clash" });
    expect(harmony(TERRA, GREEN).ok).toBe(true); // ~136° apart: split-complementary
  });
});

describe("evaluate", () => {
  it("rejects outfits outside the occasion, over budget or with more than two new pieces", () => {
    const top = piece("shirt", INDIGO, { owned: true, occasions: ["office"] });
    const skirt = piece("skirt", BLACK, { occasions: ["office"], priceRwf: 30000 });
    expect(evaluate([top, skirt], "office", 50000)).not.toBeNull();
    expect(evaluate([top, skirt], "office", 20000)).toBeNull(); // budget
    expect(evaluate([top, piece("skirt", BLACK, { occasions: ["church"] })], "office", null)).toBeNull(); // occasion
    expect(evaluate([top, piece("skirt", ORANGE, { occasions: [] })], "office", null)!.score).toBeLessThan(evaluate([top, skirt], "office", null)!.score); // untagged ok but lower
    expect(evaluate([piece("shirt", GREEN, { owned: true }), piece("skirt", BLUE)], "office", null)).toBeNull(); // clash
  });

  it("prefers owned + new over rewear-only and all-new", () => {
    const ownedTop = piece("shirt", INDIGO, { owned: true });
    const newSkirt = piece("skirt", BLACK);
    const ownedDress = piece("dress", TERRA, { owned: true });
    const newDress = piece("dress", TERRA);
    const mixed = evaluate([ownedTop, newSkirt], "office", null)!;
    const rewear = evaluate([ownedDress], "office", null)!;
    const allNew = evaluate([newDress], "office", null)!;
    expect(mixed.score).toBeGreaterThan(rewear.score);
    expect(rewear.score).toBeGreaterThan(allNew.score);
    expect(mixed.reasons.join(" ")).toMatch(/Rewears your/);
  });
});

describe("suggestOutfits", () => {
  it("returns 3 diverse suggestions combining owned pieces with 1–2 new items within budget", () => {
    const owned = [piece("shirt", INDIGO, { owned: true, title: "Indigo shirt" }), piece("skirt", BLACK, { owned: true, title: "Black skirt" })];
    const catalogue = [
      piece("skirt", BLUE, { priceRwf: 18000 }),
      piece("skirt", ORANGE, { priceRwf: 22000 }),
      piece("skirt", GREEN, { priceRwf: 21000 }),
      piece("shirt", TERRA, { priceRwf: 20000 }),
      piece("shirt", BLUE, { priceRwf: 19000 }),
      piece("dress", TERRA, { priceRwf: 90000 }),
      piece("shirt", INDIGO, { priceRwf: 15000, occasions: ["party"] }),
    ];
    const out = suggestOutfits({ owned, catalogue, occasion: "office", budgetMax: 40000 });
    expect(out).toHaveLength(3);
    for (const o of out) {
      expect(compatible(o.pieces)).toBe(true);
      expect(o.pieces.some((p) => p.owned)).toBe(true);
      const news = o.pieces.filter((p) => !p.owned);
      expect(news.length).toBeGreaterThanOrEqual(1);
      expect(news.length).toBeLessThanOrEqual(2);
      expect(o.newCostRwf).toBeLessThanOrEqual(40000);
      expect(o.pieces.every((p) => p.occasions.includes("office"))).toBe(true);
    }
    // The over-budget dress and the party-only shirt never appear.
    const used = out.flatMap((o) => o.pieces.map((p) => p.variantId));
    expect(used).not.toContain(catalogue[5].variantId);
    expect(used).not.toContain(catalogue[6].variantId);
    // No new item is suggested twice.
    const news = out.flatMap((o) => o.pieces.filter((p) => !p.owned).map((p) => p.variantId));
    expect(new Set(news).size).toBe(news.length);
  });

  it("falls back to a rewear and palette-matched new pieces when nothing pairs", () => {
    const owned = [piece("dress", TERRA, { owned: true, occasions: ["wedding"] })];
    const catalogue = [piece("dress", "#D9653B", { occasions: ["wedding"] }), piece("dress", GREEN, { occasions: ["wedding"] }), piece("dress", "#B04A2E", { occasions: ["wedding"] })];
    const out = suggestOutfits({ owned, catalogue, occasion: "wedding", budgetMax: null });
    expect(out[0].pieces[0].owned).toBe(true); // rewear ranks first
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((o) => o.pieces.length === 1)).toBe(true);
  });

  it("never suggests buying a product the shopper already owns, in any colour", () => {
    const owned = piece("dress", TERRA, { owned: true, productId: "same" });
    const out = suggestOutfits({ owned: [owned], catalogue: [piece("dress", "#D9653B", { productId: "same" }), piece("dress", "#B04A2E")], occasion: "office", budgetMax: null });
    expect(out.filter((o) => o.pieces.some((p) => !p.owned && p.productId === "same"))).toEqual([]);
    expect(out).toHaveLength(2);
  });

  it("skips pieces whose category can't be rendered", () => {
    const out = suggestOutfits({ owned: [piece("shoes", BLACK, { owned: true })], catalogue: [piece("hat", BLACK)], occasion: "office", budgetMax: null });
    expect(out).toEqual([]);
  });
});

describe("event reminders", () => {
  const now = new Date("2026-11-11T09:00:00Z");
  it("is due once, 0–3 days before the event, when an outfit is ready", () => {
    const inDays = (d: number) => new Date(now.getTime() + d * 86400_000);
    expect(reminderDue({ date: inDays(3), reminderSentAt: null }, true, now)).toBe(true);
    expect(reminderDue({ date: inDays(0), reminderSentAt: null }, true, now)).toBe(true);
    expect(reminderDue({ date: inDays(5), reminderSentAt: null }, true, now)).toBe(false);
    expect(reminderDue({ date: inDays(-1), reminderSentAt: null }, true, now)).toBe(false);
    expect(reminderDue({ date: inDays(2), reminderSentAt: null }, false, now)).toBe(false);
    expect(reminderDue({ date: inDays(2), reminderSentAt: now }, true, now)).toBe(false);
  });
});
