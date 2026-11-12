import { z } from "zod";

/**
 * E35 Maker Space 3D shelf, VR showroom and virtual fashion shows (FR-VR-01..05, 07, 08).
 * Pure rules shared by the API (validation, reminders, live snapshots) and the web (runway clock, room layout).
 */

export const SHOW = {
  /** Seconds before the first look walks (title card) and after the last one (finale). */
  introSec: 6,
  outroSec: 8,
  walkSec: 14,
  minItems: 1,
  maxItems: 12,
  /** The live page opens (lobby, viewer count) this long before the start. */
  doorsOpenMin: 15,
  /** One WhatsApp reminder this long before the start (or right away if the RSVP comes later). */
  reminderLeadMin: 60,
  maxLeadDays: 90,
  /** A show may be scheduled "now" (go live) with this much grace for clocks and form time. */
  pastGraceSec: 120,
} as const;

/** Reactions viewers can send (kept small so the live bar fits a 360 px phone). */
export const REACTIONS = ["🔥", "😍", "👏", "✨", "💃"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** FR-VR-08: the room's whole initial payload stays under 25 MB; each garment is ≤ 2 MB (E27 budget). */
export const SHOWROOM_BUDGET = { totalBytes: 25 * 1024 * 1024, maxItems: 12, roomItems: 36, mannequins: 5 } as const;

/** Synthetic runway models (Monk-scale swatches, standard sizes). Never a shopper's twin. */
export const RUNWAY_SKINS = ["#A07E56", "#825C43", "#604134", "#3A312A"] as const;
export const RUNWAY_SIZES = ["S", "M", "L"] as const;

export const ShowInput = z.object({
  title: z.string().trim().min(3, "Give the show a name").max(80),
  description: z.string().trim().max(400).default(""),
  startsAt: z.string().datetime({ offset: true }),
  items: z
    .array(z.object({ productId: z.string().min(1), variantId: z.string().min(1).optional() }))
    .min(SHOW.minItems, "Pick at least one piece")
    .max(SHOW.maxItems, `Up to ${SHOW.maxItems} pieces per show`),
  walkSec: z.number().int().min(8).max(30).default(SHOW.walkSec),
  modelSkin: z.enum(RUNWAY_SKINS).default("#825C43"),
  modelSize: z.enum(RUNWAY_SIZES).default("M"),
});
export type ShowInput = z.infer<typeof ShowInput>;

export const BoothInput = z.object({
  enabled: z.boolean(),
  banner: z.string().trim().max(80).default(""),
  featured: z.array(z.string().min(1)).max(SHOWROOM_BUDGET.mannequins).default([]),
});
export type BoothInput = z.infer<typeof BoothInput>;

export type ShowPhase = "CANCELLED" | "UPCOMING" | "DOORS_OPEN" | "LIVE" | "ENDED";

export const showDurationSec = (items: number, walkSec: number = SHOW.walkSec) => SHOW.introSec + items * walkSec + SHOW.outroSec;

export function showPhase(s: { status: string; startsAt: Date | string; items: number; walkSec: number }, now = new Date()): ShowPhase {
  if (s.status === "CANCELLED") return "CANCELLED";
  const start = new Date(s.startsAt).getTime();
  const t = now.getTime();
  if (t < start - SHOW.doorsOpenMin * 60_000) return "UPCOMING";
  if (t < start) return "DOORS_OPEN";
  if (t < start + showDurationSec(s.items, s.walkSec) * 1000) return "LIVE";
  return "ENDED";
}

export type RunwayStage = "before" | "intro" | "walk" | "outro" | "after";
export interface RunwayCursor {
  stage: RunwayStage;
  /** Look index on the runway (walk stage), else the nearest one. */
  index: number;
  /** 0..1 progress through the current stage. */
  t: number;
  /** Seconds since the show started (negative before). */
  elapsed: number;
}

/**
 * Where the runway is at `elapsedSec` after the start. Every viewer computes this from the server clock, so
 * all of them see the same look at the same moment; replay feeds it a local clock from 0.
 */
export function runwayCursor(elapsedSec: number, items: number, walkSec: number = SHOW.walkSec): RunwayCursor {
  const e = elapsedSec;
  if (e < 0) return { stage: "before", index: 0, t: 0, elapsed: e };
  if (e < SHOW.introSec) return { stage: "intro", index: 0, t: e / SHOW.introSec, elapsed: e };
  const w = e - SHOW.introSec;
  if (w < items * walkSec) {
    const index = Math.floor(w / walkSec);
    return { stage: "walk", index, t: (w - index * walkSec) / walkSec, elapsed: e };
  }
  const o = w - items * walkSec;
  if (o < SHOW.outroSec) return { stage: "outro", index: Math.max(0, items - 1), t: o / SHOW.outroSec, elapsed: e };
  return { stage: "after", index: Math.max(0, items - 1), t: 1, elapsed: e };
}

/**
 * The walk of one look as a function of its 0..1 progress: out along the runway, a turn at the front, back.
 * z runs from the back (−runwayHalf) to the front (+runwayHalf); yaw 0 faces the audience.
 */
export function walkPose(t: number, runwayHalf = 4.2): { z: number; yaw: number; moving: boolean; opacity: number } {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (t < 0.42) {
    const k = ease(clamp(t / 0.42));
    return { z: -runwayHalf + k * 2 * runwayHalf * 0.9, yaw: 0, moving: true, opacity: clamp(t / 0.06) };
  }
  if (t < 0.6) {
    const k = ease(clamp((t - 0.42) / 0.18));
    return { z: runwayHalf * 0.8, yaw: k * Math.PI, moving: false, opacity: 1 };
  }
  const k = ease(clamp((t - 0.6) / 0.4));
  return { z: runwayHalf * 0.8 - k * 2 * runwayHalf * 0.9, yaw: Math.PI, moving: true, opacity: clamp((1 - t) / 0.08) };
}

/** Schedule checks beyond the schema (time window, duplicate pieces). Returns problems, empty when fine. */
export function scheduleProblems(input: { startsAt: string; items: { productId: string }[] }, now = new Date()): string[] {
  const problems: string[] = [];
  const start = new Date(input.startsAt).getTime();
  if (Number.isNaN(start)) problems.push("Pick a date and time");
  else {
    if (start < now.getTime() - SHOW.pastGraceSec * 1000) problems.push("That time has passed. Pick a time from now on.");
    if (start > now.getTime() + SHOW.maxLeadDays * 86400_000) problems.push(`Schedule at most ${SHOW.maxLeadDays} days ahead`);
  }
  const ids = input.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) problems.push("Each piece can walk only once per show");
  return problems;
}

/** FR-VR-05: one reminder per RSVP, inside the lead window, never for a cancelled or finished show. */
export function reminderDue(
  show: { status: string; startsAt: Date; items: number; walkSec: number },
  rsvp: { remindedAt: Date | null },
  now = new Date(),
): boolean {
  if (rsvp.remindedAt || show.status !== "SCHEDULED") return false;
  const start = show.startsAt.getTime();
  const end = start + showDurationSec(show.items, show.walkSec) * 1000;
  return now.getTime() >= start - SHOW.reminderLeadMin * 60_000 && now.getTime() < end;
}

/** Fixed-window reaction limit per viewer: a burst of taps is fine, a flood is not. */
export const REACTION_LIMIT = { perWindow: 12, windowSec: 10 } as const;

export interface ShelfSource {
  products: { id: string; title: string; priceRwf: number; category: string; variants: { id: string; colourName: string; colourHex: string; imagePath: string | null }[] }[];
  /** Approved, ready garment assets by variant id. */
  assets: Map<string, { variantId: string; glbPath: string; posterPath: string | null; heightM: number | null; bytes: number | null; size: string }>;
  featured?: string[];
}

export interface ShelfItem {
  productId: string;
  title: string;
  priceRwf: number;
  category: string;
  variantId: string;
  colourName: string;
  /** Null for a piece shown as its cut-out photo on a stand (no approved 3D model yet). */
  glbPath: string | null;
  posterPath: string | null;
  photoPath: string | null;
  heightM: number;
  bytes: number;
  size: string;
  featured: boolean;
  colours: { variantId: string; colourName: string; colourHex: string; glbPath: string | null; posterPath: string | null }[];
}

/** Display height (m) of a photo stand-in by category, so flat pieces sit at a believable scale. */
const FLAT_HEIGHT: Record<string, number> = { shirt: 0.75, "t-shirt": 0.7, top: 0.7, blouse: 0.7, jacket: 0.8, skirt: 0.75 };

/**
 * The 3D shelf / showroom line-up: one entry per product that has at least one approved 3D colour, featured
 * pieces first (in the maker's order), then the page order; capped by count and by the 25 MB room budget.
 * With `includeFlat` (the showroom), products without a 3D model join as their cut-out photo on a stand, so
 * every published piece with a photo is in the room.
 */
export function shapeShelf(
  src: ShelfSource,
  max: number = SHOWROOM_BUDGET.maxItems,
  budgetBytes: number = SHOWROOM_BUDGET.totalBytes,
  includeFlat = false,
): ShelfItem[] {
  const featured = src.featured ?? [];
  const items: ShelfItem[] = [];
  for (const p of src.products) {
    const colours = p.variants.filter((v) => src.assets.has(v.id));
    if (!colours.length) {
      const photos = includeFlat ? p.variants.filter((v) => v.imagePath) : [];
      if (!photos.length) continue;
      items.push({
        productId: p.id,
        title: p.title,
        priceRwf: p.priceRwf,
        category: p.category,
        variantId: photos[0].id,
        colourName: photos[0].colourName,
        glbPath: null,
        posterPath: photos[0].imagePath,
        photoPath: photos[0].imagePath,
        heightM: FLAT_HEIGHT[p.category.toLowerCase()] ?? 1.1,
        bytes: 0,
        size: "",
        featured: featured.includes(p.id),
        colours: photos.map((v) => ({ variantId: v.id, colourName: v.colourName, colourHex: v.colourHex, glbPath: null, posterPath: v.imagePath })),
      });
      continue;
    }
    const first = colours[0];
    const a = src.assets.get(first.id)!;
    items.push({
      productId: p.id,
      title: p.title,
      priceRwf: p.priceRwf,
      category: p.category,
      variantId: first.id,
      colourName: first.colourName,
      glbPath: a.glbPath,
      posterPath: a.posterPath,
      photoPath: first.imagePath,
      heightM: a.heightM ?? 1.1,
      bytes: a.bytes ?? 0,
      size: a.size,
      featured: featured.includes(p.id),
      colours: colours.map((v) => ({ variantId: v.id, colourName: v.colourName, colourHex: v.colourHex, glbPath: src.assets.get(v.id)!.glbPath, posterPath: src.assets.get(v.id)!.posterPath })),
    });
  }
  const rank = (i: ShelfItem) => (i.featured ? featured.indexOf(i.productId) : featured.length + items.indexOf(i));
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));
  const out: ShelfItem[] = [];
  let bytes = 0;
  for (const i of sorted) {
    if (out.length >= max) break;
    if (bytes + i.bytes > budgetBytes) continue;
    bytes += i.bytes;
    out.push(i);
  }
  return out;
}

export interface Placement {
  kind: "mannequin" | "rail";
  x: number;
  z: number;
  /** Yaw so the piece faces the room centre. */
  rotY: number;
}

/**
 * Room layout: up to five mannequins on an arc in front of the entrance, the rest on two curved rails along
 * the side walls. The visitor starts at (0, 0, 3.2) looking towards −z.
 */
export function roomLayout(count: number, mannequins: number = SHOWROOM_BUDGET.mannequins): Placement[] {
  const out: Placement[] = [];
  const m = Math.min(count, mannequins);
  const arcR = 3.1;
  for (let i = 0; i < m; i++) {
    const span = m === 1 ? 0 : Math.min(110, 28 * (m - 1));
    const deg = m === 1 ? 0 : -span / 2 + (span * i) / (m - 1);
    const a = (deg * Math.PI) / 180;
    const x = Math.sin(a) * arcR;
    const z = -Math.cos(a) * arcR + 0.4;
    out.push({ kind: "mannequin", x, z, rotY: Math.atan2(-x, -z) });
  }
  const rest = count - m;
  const railR = 5.4;
  const perSide = Math.ceil(rest / 2);
  // 17° apart for a few pieces; tighter (≥ 6.5°, about 0.6 m on the rail) so a full room never wraps behind.
  const step = perSide > 1 ? Math.max(6.5, Math.min(17, (165 - 62) / (perSide - 1))) : 17;
  for (let i = 0; i < rest; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const slot = Math.floor(i / 2);
    const deg = 62 + slot * step;
    const a = (deg * Math.PI) / 180;
    const x = side * Math.sin(a) * railR;
    const z = -Math.cos(a) * railR + 0.4;
    out.push({ kind: "rail", x, z, rotY: Math.atan2(-x, -z) });
  }
  return out;
}

/** Showroom palettes from the Maker Space theme (FR-VR-03 branding without 3D skills). */
export const SHOWROOM_THEMES: Record<string, { primary: string; secondary: string; deep: string }> = {
  terra: { primary: "#E0703F", secondary: "#F2B84B", deep: "#3a2140" },
  indigo: { primary: "#2B4EA2", secondary: "#38BDF8", deep: "#1b1838" },
  forest: { primary: "#1F7A4D", secondary: "#34D399", deep: "#14241f" },
  violet: { primary: "#6D28D9", secondary: "#C084FC", deep: "#22163a" },
};
