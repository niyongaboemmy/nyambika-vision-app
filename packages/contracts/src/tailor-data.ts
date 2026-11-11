/**
 * Tailor, morph and size logic (E23/E24/E32) without zod, for browser bundles
 * (`@nyambika/contracts/tailor-data`). The zod schemas live in `tailor.ts`, which re-exports all of this.
 */

// ==== E23 Live morph · E24 Tailor custom orders · E32 Size recommendation ====

export const MORPH_LENGTHS = ["mini", "knee", "midi", "maxi"] as const;
export const MORPH_SLEEVES = ["sleeveless", "short", "elbow", "long"] as const;
export type MorphLength = (typeof MORPH_LENGTHS)[number];
export type MorphSleeve = (typeof MORPH_SLEEVES)[number];

/** The colour ring snaps to 15° steps so nearby drags share a cached cut-out and render. */
export const HUE_STEP = 15;
export const quantizeHue = (h: number) => (((Math.round(h / HUE_STEP) * HUE_STEP) % 360) + 360) % 360;

export type MorphSpec = { hue: number | null; length: MorphLength | null; sleeve: MorphSleeve | null };

/** Tailor template for a customizable product (FR-TRY-16); mirrors the `MorphTemplateInput` schema's output. */
export type MorphTemplateInput = {
  enabled: boolean;
  colourEnabled: boolean;
  colourDeltaRwf: number;
  baseLength: MorphLength;
  baseSleeve: MorphSleeve;
  lengths: Partial<Record<MorphLength, number | null>>;
  sleeves: Partial<Record<MorphSleeve, number | null>>;
  leadTimeDays: number;
};

export interface PriceLine {
  label: string;
  deltaRwf: number;
}

/** Price = base + tailor-set option deltas. Base options (and an untouched colour) cost nothing extra. */
export function morphPrice(baseRwf: number, t: MorphTemplateInput, spec: MorphSpec): { totalRwf: number; lines: PriceLine[] } {
  const lines: PriceLine[] = [];
  if (spec.hue !== null && t.colourEnabled && t.colourDeltaRwf) lines.push({ label: "Custom colour", deltaRwf: t.colourDeltaRwf });
  if (spec.length && spec.length !== t.baseLength) {
    const d = t.lengths[spec.length];
    if (d === null || d === undefined) throw new Error(`Length ${spec.length} isn't offered`);
    if (d) lines.push({ label: `${cap(spec.length)} length`, deltaRwf: d });
  }
  if (spec.sleeve && spec.sleeve !== t.baseSleeve) {
    const d = t.sleeves[spec.sleeve];
    if (d === null || d === undefined) throw new Error(`${cap(spec.sleeve)} sleeves aren't offered`);
    if (d) lines.push({ label: `${cap(spec.sleeve)} sleeves`, deltaRwf: d });
  }
  const totalRwf = Math.max(0, baseRwf + lines.reduce((s, l) => s + l.deltaRwf, 0));
  return { totalRwf, lines };
}

/** Options the shopper can pick: the base option plus any option with a non-null delta. */
export function offered<T extends string>(all: readonly T[], base: T, table: Partial<Record<T, number | null>>): T[] {
  return all.filter((k) => k === base || (table[k] !== null && table[k] !== undefined));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Measurement profile (FR-SIZE-01/04/08) ────────────────────────────────────

export const MEASUREMENT_FIELDS = ["heightCm", "bustCm", "waistCm", "hipsCm", "inseamCm", "shoulderCm", "sleeveCm", "neckCm"] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];
export type Measurements = Partial<Record<MeasurementField, number>>;

export const MEASUREMENT_LIMITS: Record<MeasurementField, [number, number]> = {
  heightCm: [90, 220],
  bustCm: [50, 180],
  waistCm: [40, 180],
  hipsCm: [50, 200],
  inseamCm: [40, 110],
  shoulderCm: [25, 65],
  sleeveCm: [30, 90],
  neckCm: [25, 60],
};

/** Body measurements implied by the twin's size estimate (a suggestion only; the shopper confirms). */
export const TWIN_SIZE_PREFILL: Record<string, Measurements> = {
  XS: { heightCm: 158, bustCm: 78, waistCm: 61, hipsCm: 86, inseamCm: 74, shoulderCm: 35, sleeveCm: 56, neckCm: 32 },
  S: { heightCm: 162, bustCm: 83, waistCm: 66, hipsCm: 90, inseamCm: 75, shoulderCm: 37, sleeveCm: 57, neckCm: 33 },
  M: { heightCm: 165, bustCm: 90, waistCm: 72, hipsCm: 97, inseamCm: 76, shoulderCm: 38, sleeveCm: 58, neckCm: 34 },
  L: { heightCm: 167, bustCm: 97, waistCm: 80, hipsCm: 104, inseamCm: 77, shoulderCm: 40, sleeveCm: 59, neckCm: 36 },
  XL: { heightCm: 168, bustCm: 106, waistCm: 89, hipsCm: 113, inseamCm: 77, shoulderCm: 42, sleeveCm: 60, neckCm: 38 },
  XXL: { heightCm: 168, bustCm: 116, waistCm: 99, hipsCm: 123, inseamCm: 77, shoulderCm: 44, sleeveCm: 61, neckCm: 40 },
};

// ── Size recommendation (FR-SIZE-02, E32) ─────────────────────────────────────

/** One size-chart row; each measurement is an inclusive [min, max] cm range. */
export interface SizeChartRow {
  size: string;
  bustCm?: [number, number];
  chestCm?: [number, number];
  waistCm?: [number, number];
  hipsCm?: [number, number];
}

const CHART_KEYS = ["bustCm", "waistCm", "hipsCm"] as const;
type ChartKey = (typeof CHART_KEYS)[number];
const AREA: Record<ChartKey, string> = { bustCm: "bust", waistCm: "waist", hipsCm: "hips" };

/** Which measurements matter for a category (skirts ignore the bust, shirts ignore the hips less). */
export function relevantKeys(category: string): ChartKey[] {
  const c = category.toLowerCase();
  if (c === "skirt") return ["waistCm", "hipsCm"];
  if (["shirt", "top", "blouse", "jacket"].includes(c)) return ["bustCm", "waistCm"];
  return ["bustCm", "waistCm", "hipsCm"];
}

export interface SizeRecommendation {
  size: string;
  confidence: "high" | "medium" | "low";
  basis: "PROFILE" | "TWIN";
  notes: string[];
  /** Per-area fit of the recommended size, cm outside the range (+ tight, − loose). */
  fit: { area: string; offCm: number }[];
}

/**
 * Map a measurement profile to a size chart. Tightness weighs 3× looseness (a roomy dress can be
 * taken in; a tight one can't be let out much). Fit notes name areas that are snug or roomy and
 * point at the neighbouring size that would fix them.
 */
export function recommendSize(m: Measurements, rows: SizeChartRow[], category = "dress", offered?: string[]): SizeRecommendation | null {
  const usable = rows.filter((r) => !offered || offered.includes(r.size));
  const keys = relevantKeys(category).filter((k) => m[k] !== undefined && usable.some((r) => range(r, k)));
  if (!usable.length || !keys.length) return null;
  const scored = usable.map((r, i) => {
    const fit = keys
      .filter((k) => range(r, k))
      .map((k) => {
        const [lo, hi] = range(r, k)!;
        const v = m[k]!;
        return { key: k, area: AREA[k], offCm: v > hi ? v - hi : v < lo ? v - lo : 0 };
      });
    const score = fit.reduce((s, f) => s + (f.offCm > 0 ? f.offCm * 3 : -f.offCm), 0);
    return { row: r, i, fit, score };
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  const best = scored[0];
  const notes: string[] = [];
  const up = usable[best.i + 1]?.size;
  const down = usable[best.i - 1]?.size;
  for (const f of best.fit) {
    if (f.offCm > 0) notes.push(`Snug at ${f.area}${up ? `; consider ${up}` : ""}`);
    else if (f.offCm <= -4) notes.push(`Roomy at ${f.area}${down ? `; ${down} may fit closer` : ""}`);
  }
  const worst = Math.max(0, ...best.fit.map((f) => Math.abs(f.offCm)));
  const confidence = keys.length >= 2 && worst === 0 ? "high" : worst <= 3 ? "medium" : "low";
  if (!notes.length) notes.push(confidence === "high" ? "True to your measurements" : "Close to your measurements");
  return { size: best.row.size, confidence, basis: "PROFILE", notes, fit: best.fit.map(({ area, offCm }) => ({ area, offCm })) };
}

function range(r: SizeChartRow, k: ChartKey): [number, number] | undefined {
  return k === "bustCm" ? (r.bustCm ?? r.chestCm) : r[k];
}

/** Fallback when there is no profile or no usable chart: the twin's estimated size. */
export function twinSizeRecommendation(twinSize: string | null, offered: string[]): SizeRecommendation | null {
  if (!twinSize || !offered.includes(twinSize)) return null;
  return { size: twinSize, confidence: "low", basis: "TWIN", notes: ["From your twin's size estimate. Add measurements for a closer fit."], fit: [] };
}

// ── Measurement share (FR-SIZE-04) ────────────────────────────────────────────

export const DEFAULT_SHARE_DAYS = 14;
export const MAX_SHARE_DAYS = 60;

export function shareExpiry(from: Date, days = DEFAULT_SHARE_DAYS) {
  const d = Math.min(MAX_SHARE_DAYS, Math.max(1, Math.round(days)));
  return new Date(from.getTime() + d * 86400_000);
}

export function shareActive(s: { expiresAt: Date | string; revokedAt: Date | string | null }, now = new Date()) {
  return !s.revokedAt && new Date(s.expiresAt).getTime() > now.getTime();
}

// ── Custom order workflow (FR-SIZE-06/07) ─────────────────────────────────────

export const CUSTOM_ORDER_STATUSES = [
  "REQUESTED",
  "QUOTED",
  "DEPOSIT_PENDING",
  "DEPOSIT_PAID",
  "CUTTING",
  "SEWING",
  "FITTING",
  "FINISHING",
  "READY",
  "BALANCE_PENDING",
  "BALANCE_PAID",
  "DELIVERED",
  "DECLINED",
  "CANCELLED",
] as const;
export type CustomOrderStatus = (typeof CUSTOM_ORDER_STATUSES)[number];

/** Tailor-driven progress after the deposit, in order. Skipping ahead is allowed, going back is not. */
export const PROGRESS_STEPS = ["CUTTING", "SEWING", "FITTING", "FINISHING", "READY"] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];

export function canProgress(from: CustomOrderStatus, to: ProgressStep) {
  const order = ["DEPOSIT_PAID", ...PROGRESS_STEPS] as string[];
  const i = order.indexOf(from);
  return i >= 0 && order.indexOf(to) > i;
}

export function depositSplit(priceRwf: number, depositPct: number) {
  const depositRwf = Math.round((priceRwf * depositPct) / 100 / 100) * 100;
  return { depositRwf: Math.min(priceRwf, depositRwf), balanceRwf: Math.max(0, priceRwf - depositRwf) };
}

