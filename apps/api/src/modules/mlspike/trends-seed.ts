import { createHash } from "node:crypto";
import { PRICE_BANDS, weeksBack, type Signal } from "./trends";

/**
 * Synthetic trend signals for the R4 spike (dev/staging only; every row is flagged `synthetic`).
 * 8 weeks × 4 regions of made-up shoppers with planted, documented trends so the card has something true
 * to say and the evaluation has a ground truth:
 *   • gold rising for weddings (umushanana) in the last 2 weeks, strongest in Kigali   → demand/supply gap
 *   • forest-green rising nationally · imigongo rising · graduation season rising
 *   • dresses convert best at 20–40k, worst above 70k                                   → price-band hint
 *   • a rare colour (lilac) asked by a handful of shoppers                              → must be suppressed (k)
 *   • trousers above 70k sold by one maker only                                         → must be suppressed (dominance)
 */
const REGIONS: [string, number][] = [["Kigali", 0.55], ["Musanze", 0.15], ["Huye", 0.15], ["Rubavu", 0.15]];
const COLOURS: [string, number][] = [["indigo", 18], ["teal", 15], ["crimson", 14], ["terracotta", 12], ["gold", 9], ["forest-green", 8], ["royal-purple", 8], ["black", 8]];
const PATTERNS: [string, number][] = [["kitenge", 40], ["wax", 30], ["solid", 20], ["imigongo", 10]];
const OCCASIONS: [string, number][] = [["wedding", 25], ["church", 20], ["party", 20], ["office", 20], ["casual", 12], ["graduation", 3]];
const CATEGORIES: [string, number][] = [["dress", 40], ["umushanana", 20], ["shirt", 15], ["skirt", 15], ["trousers", 10]];
const BAND_WEIGHT: Record<string, number> = { "<20k": 20, "20-40k": 35, "40-70k": 30, ">70k": 15 };
const CONVERSION: Record<string, number> = { "<20k": 0.14, "20-40k": 0.2, "40-70k": 0.1, ">70k": 0.06 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T extends string>(r: () => number, items: [T, number][], boost: Partial<Record<T, number>> = {}): T {
  const w = items.map(([v, x]) => x * (boost[v] ?? 1));
  let t = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    t -= w[i];
    if (t <= 0) return items[i][0];
  }
  return items[items.length - 1][0];
}

export interface SeedOptions {
  now?: Date;
  shoppers?: number;
  makers: string[]; // page ids that receive try-ons / orders
  seed?: number;
}

export function syntheticSignals(o: SeedOptions): Signal[] {
  const r = rng(o.seed ?? 2026);
  const weeks = weeksBack(o.now ?? new Date(), 8);
  const n = o.shoppers ?? 1600;
  const out: Signal[] = [];
  const pid = (i: number) => createHash("sha256").update(`synthetic-shopper:${i}`).digest("hex").slice(0, 32);
  const makers = o.makers.length ? o.makers : ["synthetic-maker"];
  const trouserMaker = makers[0];
  for (let i = 0; i < n; i++) {
    const region = pick(r, REGIONS);
    const pseudoId = pid(i);
    weeks.forEach((week, wi) => {
      const recent = wi >= weeks.length - 2;
      if (r() > 0.32) return;
      const kigali = region === "Kigali";
      const occasion = pick(r, OCCASIONS, recent ? { graduation: 4, wedding: kigali ? 1.6 : 1.2 } : {});
      const category = pick(r, CATEGORIES, occasion === "wedding" && recent ? { umushanana: 1.8 } : {});
      const colour = pick(r, COLOURS, recent ? { gold: occasion === "wedding" ? (kigali ? 3.2 : 2.0) : 1.3, "forest-green": 1.8 } : {});
      const pattern = pick(r, PATTERNS, recent ? { imigongo: 2.2 } : {});
      const budget = pick(r, Object.entries(BAND_WEIGHT) as [string, number][]);
      out.push({ week, region, source: "ASK", category, colour, pattern, occasion, priceBand: budget, pseudoId, pageId: null });
      // Try-ons on 1–2 pieces near the ask; orders by price-band conversion.
      const tries = 1 + (r() < 0.5 ? 1 : 0);
      for (let t = 0; t < tries; t++) {
        const band = t === 0 ? budget : PRICE_BANDS[Math.min(3, PRICE_BANDS.indexOf(budget as never) + 1)];
        let page = makers[Math.floor(r() * makers.length)];
        if (category === "trousers" && band === ">70k") page = trouserMaker;
        out.push({ week, region, source: "TRYON", category, colour, pattern, occasion, priceBand: band, pseudoId, pageId: page });
        const conv = CONVERSION[band] * (category === "dress" ? 1.3 : 1);
        if (r() < conv) out.push({ week, region, source: "ORDER", category, colour, pattern, occasion, priceBand: band, pseudoId, pageId: page });
      }
    });
  }
  // Rare colour asked by 6 shoppers: must never appear (k = 10).
  for (let i = 0; i < 6; i++) out.push({ week: weeks[7], region: "Huye", source: "ASK", category: "dress", colour: "lilac", pattern: "solid", occasion: "party", priceBand: "20-40k", pseudoId: pid(90_000 + i), pageId: null });
  return out;
}
