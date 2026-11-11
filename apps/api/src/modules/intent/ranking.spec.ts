import { describe, expect, it } from "vitest";
import type { Intent } from "@nyambika/contracts";
import { colourWords, diversify, rank, visibleForShopper, type Candidate } from "./ranking";

const base: Intent = { occasion: null, date: null, budgetMax: null, styles: [], colours: [], categories: [], size: null, location: null, language: "en", source: "text", parser: "rules" };

const cand = (id: string, pageId: string, o: Partial<Candidate> = {}): Candidate => ({
  productId: id,
  pageId,
  priceRwf: 30000,
  category: "dress",
  fabric: "Cotton kitenge",
  occasions: ["wedding"],
  styles: ["elegant"],
  madeToOrder: false,
  leadTimeDays: 1,
  featured: false,
  rating: 4.5,
  district: "Gasabo",
  sector: "Remera",
  variants: [{ id: `${id}-v`, colourHex: "#2B4EA2", colourName: "Indigo", inStock: true }],
  ...o,
});

describe("ranking", () => {
  it("classifies colours by hue", () => {
    expect(colourWords("#C8553D")).toContain("orange");
    expect(colourWords("#2B4EA2")).toContain("blue");
    expect(colourWords("#1F7A4D")).toContain("green");
    expect(colourWords("#111111")).toEqual(["black"]);
  });

  it("drops over-budget items below in-budget ones", () => {
    const r = rank([cand("a", "p1", { priceRwf: 80000 }), cand("b", "p2", { priceRwf: 40000 })], { ...base, budgetMax: 50000 }, "s");
    expect(r[0].productId).toBe("b");
  });

  it("penalises made-to-order pieces that cannot be ready before the event", () => {
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const r = rank(
      [cand("slow", "p1", { madeToOrder: true, leadTimeDays: 7 }), cand("ready", "p2")],
      { ...base, occasion: "wedding", date: tomorrow },
      "s",
    );
    expect(r[0].productId).toBe("ready");
  });

  it("interleaves makers for fair exposure", () => {
    const out = diversify(
      [{ pageId: "a" }, { pageId: "a" }, { pageId: "a" }, { pageId: "b" }, { pageId: "c" }].map((x, i) => ({ ...x, i })),
      4,
    );
    expect(out.slice(0, 3).map((x) => x.pageId)).toEqual(["a", "b", "c"]);
  });

  it("keeps strong matches ahead of weak ones from other makers", () => {
    const r = rank(
      [
        cand("shirtA", "p1", { category: "shirt", occasions: ["office"] }),
        cand("shirtB", "p1", { category: "shirt", occasions: ["office"] }),
        cand("dress", "p2", { category: "dress", occasions: ["wedding"] }),
      ],
      { ...base, categories: ["shirt"], occasion: "office" },
      "s",
    );
    expect(r.map((x) => x.productId).slice(0, 2).sort()).toEqual(["shirtA", "shirtB"]);
  });

  it("skips products with nothing in stock", () => {
    const r = rank([cand("x", "p", { variants: [{ id: "v", colourHex: "#000000", colourName: "Black", inStock: false }] })], base, "s");
    expect(r).toHaveLength(0);
  });
});

describe("visibleForShopper (E41 region rule for looks, error sweep)", () => {
  const regions = [
    { pageId: "ke", region: "KE", crossBorder: false },
    { pageId: "ke-x", region: "KE", crossBorder: true },
  ];
  it("a Rwandan shopper sees Rwandan pages (no region row = RW) but not Kenyan ones", () => {
    expect([...visibleForShopper(["rw", "ke", "ke-x"], regions, { country: "RW", crossBorder: false })]).toEqual(["rw"]);
  });
  it("cross-border opt-in adds only pages listed cross-border", () => {
    expect([...visibleForShopper(["rw", "ke", "ke-x"], regions, { country: "RW", crossBorder: true })]).toEqual(["rw", "ke-x"]);
  });
  it("a Kenyan shopper sees Kenyan pages", () => {
    expect([...visibleForShopper(["rw", "ke", "ke-x"], regions, { country: "KE", crossBorder: false })]).toEqual(["ke", "ke-x"]);
  });
});
