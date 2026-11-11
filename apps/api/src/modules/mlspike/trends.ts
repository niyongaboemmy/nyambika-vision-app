/**
 * R4 spike: advanced trend insights for members (pure, no Nest imports).
 *
 * Input is pseudonymised `TrendSignal` rows (ASK from Muse intent chips, TRYON from looks, ORDER from paid
 * orders) plus the public catalogue supply. Output is aggregate-only and k-anonymous:
 *   • every published number is computed from ≥ K distinct shoppers (cells below K are suppressed, not shown
 *     as "0" or "<10"), and weekly series points below K are null;
 *   • numbers derived from sales (price-band conversion) also need ≥ MIN_MAKERS makers, ≥ MIN_MAKERS − 1 of
 *     them other than the viewing member, and no maker above DOMINANCE_MAX of the cell's orders, so no single
 *     maker's sales can be inferred, including by a member subtracting their own;
 *   • counts are shown rounded to 5, growth as a percentage.
 * `privacyAudit` independently re-derives every published cell from the raw signals; `bootstrapStability`
 * resamples shoppers to keep only signals that survive resampling.
 */
export const K_MIN = 10;
export const MIN_MAKERS = 3;
export const DOMINANCE_MAX = 0.6;
export const RISING_MIN_GROWTH = 0.25;
export const STABILITY_MIN = 0.7;
export const PRICE_BANDS = ["<20k", "20-40k", "40-70k", ">70k"] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];
export const DIMENSIONS = ["colour", "pattern", "occasion"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Source = "ASK" | "TRYON" | "ORDER";

export interface Signal {
  week: string; // YYYY-MM-DD (Monday)
  region: string;
  source: Source;
  category?: string | null;
  colour?: string | null;
  pattern?: string | null;
  occasion?: string | null;
  priceBand?: string | null;
  pseudoId: string;
  pageId?: string | null;
}
export interface SupplyRow {
  pageId: string;
  category: string;
  colours: string[];
  occasions: string[];
  patterns: string[];
}
export interface TrendOptions {
  now?: Date;
  weeks?: number; // series length
  recentWeeks?: number;
  k?: number;
  viewerPageId?: string | null;
}

export interface RisingItem {
  key: string;
  dimension: Dimension;
  value: string;
  region: string;
  growth: number;
  perWeek: number; // rounded to 5
  series: (number | null)[];
}
export interface GapItem {
  key: string;
  colour: string;
  category: string;
  occasion: string | null;
  asks: number; // rounded to 5
  makers: number; // public catalogue count
  ratio: number;
  youMakeIt: boolean;
}
export interface BandCell {
  category: string;
  band: string;
  conversion: number | null; // null = suppressed
  reason?: string;
}
export interface PriceHint {
  key: string;
  category: string;
  best: string;
  worst: string;
  bestConversion: number;
  worstConversion: number;
  lift: number;
}
export interface TrendsResult {
  k: number;
  weeks: string[];
  rising: RisingItem[];
  gaps: GapItem[];
  priceBands: BandCell[];
  priceHints: PriceHint[];
  suppressed: { rising: number; gaps: number; priceBands: number };
}

export const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

export function weekOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

export function weeksBack(now: Date, n: number): string[] {
  const last = new Date(`${weekOf(now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(last.getTime() - (n - 1 - i) * 7 * 86400_000).toISOString().slice(0, 10));
}

export function priceBand(rwf: number): PriceBand {
  return rwf < 20_000 ? "<20k" : rwf < 40_000 ? "20-40k" : rwf < 70_000 ? "40-70k" : ">70k";
}

const KIGALI = new Set(["gasabo", "nyarugenge", "kicukiro", "kigali"]);
export function regionOf(district: string | null | undefined): string {
  const d = (district ?? "").trim().toLowerCase();
  if (!d) return "Rwanda";
  if (KIGALI.has(d)) return "Kigali";
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Maker-side disclosure rule for any number derived from orders. */
export function makerRuleOk(ordersByMaker: Map<string, number>, viewerPageId?: string | null): { ok: boolean; reason?: string } {
  const total = [...ordersByMaker.values()].reduce((a, b) => a + b, 0);
  if (ordersByMaker.size < MIN_MAKERS) return { ok: false, reason: "fewer than 3 makers" };
  const others = [...ordersByMaker.keys()].filter((p) => p !== viewerPageId).length;
  if (others < MIN_MAKERS - 1) return { ok: false, reason: "too few other makers" };
  const top = Math.max(...ordersByMaker.values());
  if (total && top / total > DOMINANCE_MAX) return { ok: false, reason: "one maker dominates" };
  return { ok: true };
}

// ── rising colours / patterns / occasions ────────────────────────────────────

function risingFor(signals: Signal[], weeks: string[], recentWeeks: number, k: number, region: string) {
  const out: RisingItem[] = [];
  let suppressed = 0;
  const demand = signals.filter((s) => s.source !== "ORDER" && (region === "ALL" || s.region === region));
  for (const dim of DIMENSIONS) {
    const byValue = new Map<string, Map<string, Set<string>>>();
    for (const s of demand) {
      const v = s[dim];
      if (!v) continue;
      let w = byValue.get(v);
      if (!w) byValue.set(v, (w = new Map()));
      let set = w.get(s.week);
      if (!set) w.set(s.week, (set = new Set()));
      set.add(s.pseudoId);
    }
    for (const [value, w] of byValue) {
      const counts = weeks.map((wk) => w.get(wk)?.size ?? 0);
      const recent = counts.slice(-recentWeeks);
      const base = counts.slice(0, -recentWeeks);
      const baseUnion = new Set<string>();
      for (const wk of weeks.slice(0, -recentWeeks)) for (const p of w.get(wk) ?? []) baseUnion.add(p);
      if (recent.some((c) => c < k) || baseUnion.size < k) {
        suppressed++;
        continue;
      }
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const baseAvg = Math.max(1, base.reduce((a, b) => a + b, 0) / Math.max(1, base.length));
      const growth = recentAvg / baseAvg - 1;
      if (growth < RISING_MIN_GROWTH) continue;
      out.push({
        key: `${dim}:${value}:${region}`,
        dimension: dim,
        value,
        region,
        growth: Math.round(growth * 100) / 100,
        perWeek: round5(recentAvg),
        series: counts.map((c) => (c >= k ? round5(c) : null)),
      });
    }
  }
  return { items: out.sort((a, b) => b.growth - a.growth), suppressed };
}

// ── demand vs supply gaps ────────────────────────────────────────────────────

function gapsFor(signals: Signal[], supply: SupplyRow[], weeks: string[], k: number, viewerPageId?: string | null) {
  const window = new Set(weeks.slice(-4));
  const recentWeeks = new Set(weeks.slice(-2));
  const asks = new Map<string, Set<string>>();
  const recent = new Map<string, Set<string>>(); // last 2 weeks: used only to rank (rising demand first)
  for (const s of signals) {
    if (s.source !== "ASK" || !window.has(s.week) || !s.colour || !s.category) continue;
    for (const occ of [s.occasion ?? null, null]) {
      const key = `${s.colour}|${s.category}|${occ ?? ""}`;
      let set = asks.get(key);
      if (!set) asks.set(key, (set = new Set()));
      set.add(s.pseudoId);
      if (recentWeeks.has(s.week)) {
        let r = recent.get(key);
        if (!r) recent.set(key, (r = new Set()));
        r.add(s.pseudoId);
      }
      if (!s.occasion) break;
    }
  }
  const rank = new Map<string, number>();
  const mine = new Set(supply.filter((r) => r.pageId === viewerPageId).map((r) => r.category));
  const out: GapItem[] = [];
  let suppressed = 0;
  for (const [key, people] of asks) {
    if (people.size < k) {
      suppressed++;
      continue;
    }
    const [colour, category, occ] = key.split("|");
    const occasion = occ || null;
    const makers = new Set(supply.filter((r) => r.category === category && r.colours.includes(colour) && (!occasion || r.occasions.includes(occasion))).map((r) => r.pageId)).size;
    if (makers > 3) continue;
    rank.set(`gap:${key}`, (recent.get(key)?.size ?? 0) / Math.max(1, makers));
    out.push({ key: `gap:${key}`, colour, category, occasion, asks: round5(people.size), makers, ratio: Math.round((people.size / Math.max(1, makers)) * 10) / 10, youMakeIt: mine.has(category) });
  }
  // Prefer the most specific statement (with occasion) when both exist for the same colour × category.
  const specific = new Set(out.filter((g) => g.occasion).map((g) => `${g.colour}|${g.category}`));
  return { items: out.filter((g) => g.occasion || !specific.has(`${g.colour}|${g.category}`)).sort((a, b) => (rank.get(b.key) ?? 0) - (rank.get(a.key) ?? 0)), suppressed };
}

// ── price-band conversion hints (sales-derived: maker rule applies) ──────────

function bandsFor(signals: Signal[], weeks: string[], k: number, viewerPageId?: string | null) {
  const window = new Set(weeks);
  type Agg = { tryon: Set<string>; buyers: Set<string>; makers: Map<string, number> };
  const cells = new Map<string, Agg>();
  for (const s of signals) {
    if (!window.has(s.week) || !s.category || !s.priceBand || s.source === "ASK") continue;
    const key = `${s.category}|${s.priceBand}`;
    let a = cells.get(key);
    if (!a) cells.set(key, (a = { tryon: new Set(), buyers: new Set(), makers: new Map() }));
    if (s.source === "TRYON") a.tryon.add(s.pseudoId);
    else {
      a.buyers.add(s.pseudoId);
      if (s.pageId) a.makers.set(s.pageId, (a.makers.get(s.pageId) ?? 0) + 1);
    }
  }
  const out: BandCell[] = [];
  let suppressed = 0;
  for (const [key, a] of cells) {
    const [category, band] = key.split("|");
    let reason: string | undefined;
    if (a.tryon.size < k) reason = "fewer than k shoppers tried on";
    else if (a.buyers.size < k) reason = "fewer than k buyers";
    else {
      const r = makerRuleOk(a.makers, viewerPageId);
      if (!r.ok) reason = r.reason;
    }
    if (reason) suppressed++;
    out.push({ category, band, conversion: reason ? null : Math.round((a.buyers.size / a.tryon.size) * 1000) / 1000, reason });
  }
  out.sort((x, y) => x.category.localeCompare(y.category) || PRICE_BANDS.indexOf(x.band as PriceBand) - PRICE_BANDS.indexOf(y.band as PriceBand));
  const hints: PriceHint[] = [];
  for (const category of new Set(out.map((c) => c.category))) {
    const pub = out.filter((c) => c.category === category && c.conversion !== null) as (BandCell & { conversion: number })[];
    if (pub.length < 2) continue;
    const best = pub.reduce((a, b) => (b.conversion > a.conversion ? b : a));
    const worst = pub.reduce((a, b) => (b.conversion < a.conversion ? b : a));
    if (worst.conversion > 0 && best.conversion / worst.conversion >= 1.5) {
      hints.push({ key: `price:${category}`, category, best: best.band, worst: worst.band, bestConversion: best.conversion, worstConversion: worst.conversion, lift: Math.round((best.conversion / worst.conversion) * 10) / 10 });
    }
  }
  return { cells: out, hints: hints.sort((a, b) => b.lift - a.lift), suppressed };
}

export function computeTrends(signals: Signal[], supply: SupplyRow[], opts: TrendOptions = {}): TrendsResult {
  const k = Math.max(K_MIN, opts.k ?? K_MIN); // k can be raised, never lowered below 10
  const weeks = weeksBack(opts.now ?? new Date(), opts.weeks ?? 8);
  const recentWeeks = opts.recentWeeks ?? 2;
  const regions = ["ALL", ...new Set(signals.map((s) => s.region))].sort((a, b) => (a === "ALL" ? -1 : b === "ALL" ? 1 : a.localeCompare(b)));
  const rising: RisingItem[] = [];
  let risingSuppressed = 0;
  for (const r of regions) {
    const res = risingFor(signals, weeks, recentWeeks, k, r);
    rising.push(...res.items);
    risingSuppressed += res.suppressed;
  }
  const gaps = gapsFor(signals, supply, weeks, k, opts.viewerPageId);
  const bands = bandsFor(signals, weeks, k, opts.viewerPageId);
  return {
    k,
    weeks,
    rising: rising.sort((a, b) => b.growth - a.growth),
    gaps: gaps.items,
    priceBands: bands.cells,
    priceHints: bands.hints,
    suppressed: { rising: risingSuppressed, gaps: gaps.suppressed, priceBands: bands.suppressed },
  };
}

// ── privacy audit (independent re-derivation) ────────────────────────────────

export function privacyAudit(result: TrendsResult, signals: Signal[], viewerPageId?: string | null): { passed: boolean; violations: string[]; checked: number } {
  const v: string[] = [];
  let checked = 0;
  const k = result.k;
  if (k < K_MIN) v.push(`k=${k} is below the minimum ${K_MIN}`);
  const distinct = (f: (s: Signal) => boolean) => new Set(signals.filter(f).map((s) => s.pseudoId)).size;
  for (const r of result.rising) {
    result.weeks.forEach((wk, i) => {
      const n = distinct((s) => s.source !== "ORDER" && s.week === wk && s[r.dimension] === r.value && (r.region === "ALL" || s.region === r.region));
      checked++;
      if (r.series[i] !== null && n < k) v.push(`${r.key} week ${wk}: ${n} < k`);
      if (i >= result.weeks.length - 2 && n < k) v.push(`${r.key} recent week ${wk}: ${n} < k`);
    });
  }
  const window = new Set(result.weeks.slice(-4));
  for (const g of result.gaps) {
    checked++;
    const n = distinct((s) => s.source === "ASK" && window.has(s.week) && s.colour === g.colour && s.category === g.category && (!g.occasion || s.occasion === g.occasion));
    if (n < k) v.push(`${g.key}: ${n} askers < k`);
  }
  const all = new Set(result.weeks);
  for (const c of result.priceBands) {
    if (c.conversion === null) continue;
    checked++;
    const inCell = (s: Signal) => all.has(s.week) && s.category === c.category && s.priceBand === c.band;
    const tryon = distinct((s) => inCell(s) && s.source === "TRYON");
    const buyers = distinct((s) => inCell(s) && s.source === "ORDER");
    if (tryon < k || buyers < k) v.push(`price ${c.category} ${c.band}: ${tryon} try-on / ${buyers} buyers < k`);
    const makers = new Map<string, number>();
    for (const s of signals) if (inCell(s) && s.source === "ORDER" && s.pageId) makers.set(s.pageId, (makers.get(s.pageId) ?? 0) + 1);
    const rule = makerRuleOk(makers, viewerPageId);
    if (!rule.ok) v.push(`price ${c.category} ${c.band}: ${rule.reason}`);
  }
  return { passed: v.length === 0, violations: v, checked };
}

// ── bootstrap stability ──────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 1;
};

/** Cluster bootstrap over shoppers (all of a shopper's signals move together; duplicates count as new people). */
export function bootstrapStability(signals: Signal[], supply: SupplyRow[], opts: TrendOptions & { B?: number; seed?: number; top?: number } = {}) {
  const B = opts.B ?? 30;
  const top = opts.top ?? 5;
  const rnd = mulberry32(opts.seed ?? 42);
  const byPerson = new Map<string, Signal[]>();
  for (const s of signals) {
    const l = byPerson.get(s.pseudoId);
    if (l) l.push(s);
    else byPerson.set(s.pseudoId, [s]);
  }
  const people = [...byPerson.keys()];
  const full = computeTrends(signals, supply, opts);
  // Rank stability is measured on the national list (what every member sees first); regional items are judged by
  // per-item stability below, since near-tied small regional cells legitimately swap places between resamples.
  const national = (xs: RisingItem[]) => xs.filter((r) => r.region === "ALL").slice(0, top).map((r) => r.key);
  const fullRising = national(full.rising);
  const fullGaps = full.gaps.slice(0, 3).map((g) => g.key);
  const fullHints = full.priceHints.map((h) => h.key);
  const seen = new Map<string, number>();
  let risingJ = 0;
  let gapJ = 0;
  let hintJ = 0;
  for (let b = 0; b < B; b++) {
    const sample: Signal[] = [];
    for (let i = 0; i < people.length; i++) {
      const p = people[Math.floor(rnd() * people.length)];
      for (const s of byPerson.get(p)!) sample.push({ ...s, pseudoId: `${s.pseudoId}#${i}` });
    }
    const r = computeTrends(sample, supply, opts);
    for (const key of new Set([...r.rising.map((x) => x.key), ...r.gaps.map((g) => g.key), ...r.priceHints.map((h) => h.key)])) seen.set(key, (seen.get(key) ?? 0) + 1);
    risingJ += jaccard(fullRising, national(r.rising));
    gapJ += jaccard(fullGaps, r.gaps.slice(0, 3).map((g) => g.key));
    hintJ += jaccard(fullHints, r.priceHints.map((h) => h.key));
  }
  const itemStability: Record<string, number> = {};
  for (const key of [...full.rising.map((x) => x.key), ...full.gaps.map((g) => g.key), ...full.priceHints.map((h) => h.key)]) itemStability[key] = Math.round(((seen.get(key) ?? 0) / B) * 100) / 100;
  return {
    B,
    risingTopJaccard: Math.round((risingJ / B) * 100) / 100,
    gapTopJaccard: Math.round((gapJ / B) * 100) / 100,
    priceHintJaccard: Math.round((hintJ / B) * 100) / 100,
    itemStability,
    full,
  };
}

/** What the member sees: only stable items (≥ STABILITY_MIN across resamples). */
export function stableView(stab: ReturnType<typeof bootstrapStability>, limits = { rising: 5, gaps: 3, hints: 2 }) {
  const ok = (key: string) => (stab.itemStability[key] ?? 0) >= STABILITY_MIN;
  const f = stab.full;
  const national = f.rising.filter((r) => r.region === "ALL" && ok(r.key));
  const regional = f.rising.filter((r) => r.region !== "ALL" && ok(r.key) && !national.some((n) => n.dimension === r.dimension && n.value === r.value));
  return {
    k: f.k,
    weeks: f.weeks,
    rising: [...national.slice(0, limits.rising), ...regional.slice(0, 2)],
    gaps: f.gaps.filter((g) => ok(g.key)).slice(0, limits.gaps),
    priceHints: f.priceHints.filter((h) => ok(h.key)).slice(0, limits.hints),
    stability: Object.fromEntries(Object.entries(stab.itemStability)),
    suppressed: f.suppressed,
    unstableHidden: [...f.rising, ...f.gaps, ...f.priceHints].filter((x) => !ok(x.key)).length,
  };
}
