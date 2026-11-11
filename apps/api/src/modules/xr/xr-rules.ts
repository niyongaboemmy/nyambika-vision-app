/**
 * E27/E28 pure rules: pricing, metering source order, budgets. Kept free of Nest/Prisma so they are unit-tested.
 */

export type UsageSource = "FREE_QUOTA" | "PAGE_ALLOWANCE" | "CREDITS";

/** 3D garment (FR-3D-07): one ASSET_3D unit per colour, billed to the page allowance. */
export const ASSET_3D = { kind: "ASSET_3D", costRwf: 150, maxGlbBytes: 2 * 1024 * 1024, maxTriangles: 50_000, maxPosterBytes: 300 * 1024 } as const;

/** Motion preview (FR-VID-04): a premium action worth several look credits. */
export const MOTION = { kind: "VIDEO", credits: 3, creditRwf: 110, freeWeekly: 1, dailyCap: 5, minFrames: 36, maxFrames: 60 } as const;
export const motionCostRwf = (credits: number = MOTION.credits) => credits * MOTION.creditRwf;

export const DEFAULT_SOURCE_ORDER: UsageSource[] = ["FREE_QUOTA", "PAGE_ALLOWANCE", "CREDITS"];

export interface VideoSourceState {
  freeUsedThisWeek: number;
  freeWeekly?: number;
  pageAllowanceOn: boolean;
  /** null when the page has no subscription. */
  pageCap: number | null;
  pageUnitsUsed: number;
  units?: number;
  order?: UsageSource[];
}

/**
 * FR-PLAN-03 consumption order for a premium video: the shopper's free weekly motion quota, then the
 * page's allowance (only if the page enabled it and it has room for every unit), then the shopper's
 * own credits. The order is host-configurable; CREDITS is always the fallback.
 */
export function pickVideoSource(s: VideoSourceState): UsageSource {
  const units = s.units ?? MOTION.credits;
  for (const src of s.order ?? DEFAULT_SOURCE_ORDER) {
    if (src === "FREE_QUOTA" && s.freeUsedThisWeek < (s.freeWeekly ?? MOTION.freeWeekly)) return src;
    if (src === "PAGE_ALLOWANCE" && s.pageAllowanceOn && s.pageCap !== null && s.pageUnitsUsed + units <= s.pageCap) return src;
    if (src === "CREDITS") return src;
  }
  return "CREDITS";
}

export function quoteLabel(source: UsageSource, credits: number = MOTION.credits) {
  if (source === "FREE_QUOTA") return "Free this week";
  if (source === "PAGE_ALLOWANCE") return "Covered by the maker";
  return `${credits} credits · RWF ${motionCostRwf(credits).toLocaleString("en-US")}`;
}

/** Page allowance check for 3D generation. No subscription = pay-as-you-go (always allowed, still metered). */
export function allowanceAllows(cap: number | null, used: number, units: number) {
  if (cap === null) return true;
  return used + units <= cap;
}

/** The size the 3D model is scaled to: M when sewn, else the middle size of the chart. */
export function pickModelSize(sizes: string[]): string {
  const clean = sizes.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!clean.length || clean.includes("M")) return "M";
  return clean[Math.floor((clean.length - 1) / 2)];
}

/** Validate what the gateway returned against the asset budget (FR-3D-03) before storing it. */
export function checkAssetBudget(r: { bytes: number; triangles: number; posterBytes: number; glbHead: Buffer }) {
  const problems: string[] = [];
  if (r.glbHead.subarray(0, 4).toString("latin1") !== "glTF" || r.glbHead.readUInt32LE(4) !== 2) problems.push("not a glTF 2.0 binary");
  if (r.bytes > ASSET_3D.maxGlbBytes) problems.push(`GLB ${r.bytes} B over ${ASSET_3D.maxGlbBytes} B`);
  if (r.triangles > ASSET_3D.maxTriangles) problems.push(`${r.triangles} triangles over ${ASSET_3D.maxTriangles}`);
  if (r.posterBytes > ASSET_3D.maxPosterBytes) problems.push(`poster ${r.posterBytes} B over ${ASSET_3D.maxPosterBytes} B`);
  return problems;
}

/** Persona used for the look when the shopper has no twin (encoded in the generation cache key). */
export function personaFromCacheKey(cacheKey: string): number {
  const m = /^persona-(\d+):/.exec(cacheKey);
  return m ? Number(m[1]) : 2;
}

export type MotionEligibility = { ok: true } | { ok: false; reason: string };

/** FR-VID-01: motion is made only from an approved (delivered, guard-passed) still. */
export function motionEligibility(look: { generationStatus: string | null }, todayCount: number): MotionEligibility {
  if (look.generationStatus !== "DELIVERED") return { ok: false, reason: "Wait for the look to finish first." };
  if (todayCount >= MOTION.dailyCap) return { ok: false, reason: `Daily motion limit reached (${MOTION.dailyCap}). Try again tomorrow.` };
  return { ok: true };
}

export const RENDERING = new Set(["QUEUED", "GENERATING", "GUARDING"]);
