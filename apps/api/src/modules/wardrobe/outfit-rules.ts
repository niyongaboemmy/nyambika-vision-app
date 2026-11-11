/**
 * Outfit combination rules for "Restyle for an event" (FR-WRD-03).
 * Pure functions so the rules can be reasoned about and unit-tested without a database.
 *
 * 1. Category compatibility: a full-length piece (dress, umushanana, …) is worn alone;
 *    otherwise exactly one top + one bottom (skirt).
 * 2. Colour harmony by hue: neutrals go with anything; analogous (≤ 35°), split/triadic (110–150°)
 *    and complementary (≥ 150°) pairs pass; 35–110° pairs clash.
 * 3. Occasion match: every piece must be tagged for the occasion (untagged pieces are allowed, scored lower).
 * 4. Budget: the new items' total must fit the event budget.
 * Preference: owned piece(s) + 1–2 new maker items; owned-only rewear and all-new outfits only fill gaps.
 */

export type Slot = "FULL" | "TOP" | "BOTTOM";

export interface Piece {
  productId: string;
  variantId: string;
  pageId: string;
  title: string;
  category: string;
  colourName: string;
  colourHex: string;
  occasions: string[];
  priceRwf: number;
  owned: boolean;
}

export interface Outfit {
  pieces: Piece[];
  score: number;
  newCostRwf: number;
  reasons: string[];
}

const FULL = new Set(["dress", "umushanana", "kitenge", "gown", "bridal", "wrap", "jumpsuit"]);
const TOP = new Set(["shirt", "top", "blouse", "jacket"]);
const BOTTOM = new Set(["skirt"]);

export function slotOf(category: string): Slot | null {
  const c = category.toLowerCase();
  if (FULL.has(c)) return "FULL";
  if (TOP.has(c)) return "TOP";
  if (BOTTOM.has(c)) return "BOTTOM";
  return null;
}

/** Valid silhouettes: [FULL] alone, or [TOP, BOTTOM] in any order. */
export function compatible(pieces: Pick<Piece, "category">[]): boolean {
  const slots = pieces.map((p) => slotOf(p.category));
  if (slots.some((s) => s === null)) return false;
  if (slots.length === 1) return slots[0] === "FULL";
  if (slots.length === 2) return slots.includes("TOP") && slots.includes("BOTTOM");
  return false;
}

export function hsl(hex: string) {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

const isNeutral = (c: { s: number; l: number }) => c.s < 0.18 || c.l < 0.14 || c.l > 0.9;

export type HarmonyKind = "neutral" | "analogous" | "split" | "complementary" | "clash";

export function harmony(a: string, b: string): { ok: boolean; kind: HarmonyKind; score: number } {
  const x = hsl(a);
  const y = hsl(b);
  if (isNeutral(x) || isNeutral(y)) return { ok: true, kind: "neutral", score: 0.8 };
  const raw = Math.abs(x.h - y.h);
  const d = raw > 180 ? 360 - raw : raw;
  if (d <= 35) return { ok: true, kind: "analogous", score: 1 };
  if (d >= 150) return { ok: true, kind: "complementary", score: 0.9 };
  if (d >= 110) return { ok: true, kind: "split", score: 0.65 };
  return { ok: false, kind: "clash", score: 0 };
}

export function occasionFit(p: Pick<Piece, "occasions">, occasion: string): number {
  if (!occasion || occasion === "any") return 1;
  if (p.occasions.includes(occasion)) return 1;
  return p.occasions.length === 0 ? 0.4 : 0;
}

const HARMONY_COPY: Record<HarmonyKind, string> = {
  neutral: "a neutral that goes with anything",
  analogous: "neighbouring colours, calm and polished",
  split: "a bold split-colour pairing",
  complementary: "complementary colours that pop",
  clash: "",
};

/** Score one candidate, or return null when a hard rule fails. */
export function evaluate(pieces: Piece[], occasion: string, budgetMax: number | null): Outfit | null {
  if (!compatible(pieces)) return null;
  const newPieces = pieces.filter((p) => !p.owned);
  if (newPieces.length > 2) return null;
  const newCostRwf = newPieces.reduce((s, p) => s + p.priceRwf, 0);
  if (budgetMax != null && newCostRwf > budgetMax) return null;
  const fits = pieces.map((p) => occasionFit(p, occasion));
  if (fits.some((f) => f === 0)) return null;
  const reasons: string[] = [];
  let colour = 0.8;
  if (pieces.length === 2) {
    const h = harmony(pieces[0].colourHex, pieces[1].colourHex);
    if (!h.ok) return null;
    colour = h.score;
    reasons.push(`${pieces[0].colourName} + ${pieces[1].colourName}: ${HARMONY_COPY[h.kind]}`);
  }
  const owned = pieces.filter((p) => p.owned).length;
  const mix = owned > 0 && newPieces.length > 0 ? 1.2 : owned > 0 ? 0.5 : 0.3;
  if (owned && newPieces.length) reasons.push(`Rewears your ${pieces.filter((p) => p.owned).map((p) => p.title).join(" and ")}`);
  else if (owned) reasons.push(`Rewear: nothing new to buy`);
  else reasons.push(`All new, picked to match colours you already own`);
  if (occasion && fits.every((f) => f === 1)) reasons.push(`Made for ${occasion.replace("-", " ")}`);
  const budgetPenalty = budgetMax ? (newCostRwf / budgetMax) * 0.3 : newCostRwf / 400_000;
  const score = fits.reduce((s, f) => s + f, 0) / fits.length + colour + mix - budgetPenalty;
  return { pieces, score: Math.round(score * 1000) / 1000, newCostRwf, reasons };
}

/** Render order on the twin: bottoms first, tops over the waistband, full pieces alone. */
export function renderOrder(pieces: Piece[]): Piece[] {
  const rank: Record<Slot, number> = { BOTTOM: 0, TOP: 1, FULL: 2 };
  return [...pieces].sort((a, b) => rank[slotOf(a.category)!] - rank[slotOf(b.category)!]);
}

/**
 * Build up to `limit` outfit suggestions from what the shopper owns plus the live catalogue.
 * Diversity: a new item appears in at most one suggestion, preferring a different product each time.
 */
export function suggestOutfits(input: { owned: Piece[]; catalogue: Piece[]; occasion: string; budgetMax: number | null; limit?: number }): Outfit[] {
  const { occasion, budgetMax } = input;
  const limit = input.limit ?? 3;
  // Never suggest buying something you already own, not even in another colour.
  const ownedProducts = new Set(input.owned.map((p) => p.productId));
  const owned = input.owned.filter((p) => slotOf(p.category));
  const fresh = input.catalogue.filter((p) => slotOf(p.category) && !ownedProducts.has(p.productId)).map((p) => ({ ...p, owned: false }));
  const by = (pool: Piece[], s: Slot) => pool.filter((p) => slotOf(p.category) === s);

  const candidates: Outfit[] = [];
  const push = (pieces: Piece[]) => {
    const o = evaluate(pieces, occasion, budgetMax);
    if (o) candidates.push(o);
  };
  // Preferred: owned + new.
  for (const t of by(owned, "TOP")) for (const b of by(fresh, "BOTTOM")) push([t, b]);
  for (const b of by(owned, "BOTTOM")) for (const t of by(fresh, "TOP")) push([t, b]);
  // Rewear.
  for (const f of by(owned, "FULL")) push([f]);
  for (const t of by(owned, "TOP")) for (const b of by(owned, "BOTTOM")) push([t, b]);
  // All new, but only in colours that harmonise with something the shopper owns (or anything if nothing owned).
  const palette = owned.map((p) => p.colourHex);
  const matchesPalette = (hex: string) => !palette.length || palette.some((c) => harmony(c, hex).ok);
  for (const f of by(fresh, "FULL")) if (matchesPalette(f.colourHex)) push([f]);
  for (const t of by(fresh, "TOP")) for (const b of by(fresh, "BOTTOM")) if (matchesPalette(t.colourHex) || matchesPalette(b.colourHex)) push([t, b]);

  candidates.sort((a, b) => b.score - a.score);
  const picked: Outfit[] = [];
  const newUsed = new Set<string>();
  const productUsed = new Set<string>();
  // Pass 1: every new product at most once. Pass 2 (only if short): another colour of a product is fine.
  for (const strict of [true, false]) {
    for (const c of candidates) {
      if (picked.length >= limit) break;
      if (picked.some((p) => p.pieces.map((x) => x.variantId).sort().join() === c.pieces.map((x) => x.variantId).sort().join())) continue;
      const news = c.pieces.filter((p) => !p.owned);
      if (news.some((p) => newUsed.has(p.variantId) || (strict && productUsed.has(p.productId)))) continue;
      picked.push({ ...c, pieces: renderOrder(c.pieces) });
      for (const p of news) {
        newUsed.add(p.variantId);
        productUsed.add(p.productId);
      }
    }
  }
  return picked;
}

/** "Wedding in 3 days: your outfit is ready" goes out once, when the event is 0–3 days away. */
export function reminderDue(e: { date: Date; reminderSentAt: Date | null }, hasReadyOutfit: boolean, now = new Date()): boolean {
  if (e.reminderSentAt || !hasReadyOutfit) return false;
  const days = daysUntil(e.date, now);
  return days >= 0 && days <= 3;
}

export function daysUntil(date: Date, now = new Date()) {
  const a = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / 86400_000);
}
