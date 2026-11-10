import type { Intent } from "@nyambika/contracts";

/** Classify a variant colour into the Muse's canonical colour words by hue. */
export function colourWords(hex: string): string[] {
  const n = parseInt(hex.replace("#", ""), 16);
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
  if (s < 0.18) return l < 0.3 ? ["black"] : l > 0.8 ? ["white"] : ["black", "white"];
  if (h < 8 || h >= 345) return ["red"];
  if (h < 20) return ["red", "orange"];
  if (h < 40) return l < 0.35 ? ["brown", "orange"] : ["orange", "red"];
  if (h < 65) return ["yellow", "gold"];
  if (h < 165) return ["green"];
  if (h < 200) return ["green", "blue"];
  if (h < 250) return ["blue", "indigo"];
  if (h < 290) return ["purple", "indigo"];
  return ["pink", "purple"];
}

export interface Candidate {
  productId: string;
  pageId: string;
  priceRwf: number;
  category: string;
  fabric: string;
  occasions: string[];
  styles: string[];
  madeToOrder: boolean;
  leadTimeDays: number;
  featured: boolean;
  rating: number;
  district: string;
  sector: string;
  variants: { id: string; colourHex: string; colourName: string; inStock: boolean }[];
}

export interface Ranked {
  productId: string;
  pageId: string;
  variantId: string;
  score: number;
  reasons: string[];
}

const daysUntil = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000) : null);

/** Deterministic jitter so equal scores don't always favour the same maker. */
const jitter = (id: string, seed: string) => {
  let h = 2166136261;
  for (const c of id + seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 10000;
};

export function score(c: Candidate, intent: Intent, seed: string): Ranked | null {
  const reasons: string[] = [];
  let s = 0;
  const inStock = c.variants.filter((v) => v.inStock);
  if (!inStock.length) return null;

  if (intent.budgetMax) {
    if (c.priceRwf > intent.budgetMax) s -= 6;
    else {
      s += 1;
      reasons.push("within budget");
    }
  }
  if (intent.occasion && c.occasions.includes(intent.occasion)) {
    s += 3;
    reasons.push(intent.occasion);
  }
  const catHit = intent.categories.some((k) => k === c.category || (k === "kitenge" && /kitenge/i.test(c.fabric)));
  if (intent.categories.length && catHit) {
    s += 3;
    reasons.push(c.category);
  } else if (intent.categories.length) s -= 1;
  const styleHits = intent.styles.filter((x) => c.styles.includes(x));
  s += styleHits.length * 1.5;
  if (styleHits.length) reasons.push(styleHits.join(", "));

  // Pick the variant that best matches the requested colours.
  let variant = inStock[0];
  if (intent.colours.length) {
    const match = inStock.find((v) => colourWords(v.colourHex).some((w) => intent.colours.includes(w)));
    if (match) {
      variant = match;
      s += 2.5;
      reasons.push(match.colourName.toLowerCase());
    }
  }
  if (intent.location) {
    const loc = intent.location.toLowerCase();
    if ([c.district, c.sector].some((x) => x.toLowerCase() === loc)) {
      s += 1;
      reasons.push(`in ${c.sector}`);
    }
  }
  // A tailor can't deliver a made-to-order piece after the event.
  const days = daysUntil(intent.date);
  if (days !== null && c.madeToOrder && c.leadTimeDays > days) s -= 4;
  else if (days !== null && c.madeToOrder) reasons.push(`ready in ${c.leadTimeDays} days`);

  s += c.rating * 0.3 + (c.featured ? 0.3 : 0) + jitter(c.productId, seed);
  return { productId: c.productId, pageId: c.pageId, variantId: variant.id, score: s, reasons };
}

/** Fair exposure: interleave makers so consecutive looks come from different pages. */
export function diversify<T extends { pageId: string }>(sorted: T[], limit: number): T[] {
  const buckets = new Map<string, T[]>();
  for (const r of sorted) buckets.set(r.pageId, [...(buckets.get(r.pageId) ?? []), r]);
  const out: T[] = [];
  while (out.length < limit && [...buckets.values()].some((b) => b.length)) {
    for (const b of buckets.values()) {
      const next = b.shift();
      if (next) out.push(next);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function rank(cands: Candidate[], intent: Intent, seed: string, limit = 9): Ranked[] {
  const scored = cands.map((c) => score(c, intent, seed)).filter((x): x is Ranked => x !== null);
  scored.sort((a, b) => b.score - a.score);
  // Diversify among strong matches first, then the rest, so fairness never buries relevance.
  const top = scored[0]?.score ?? 0;
  const strong = scored.filter((r) => r.score >= top - 3);
  const rest = scored.filter((r) => r.score < top - 3);
  return [...diversify(strong, limit), ...diversify(rest, limit)].slice(0, limit);
}
