import type { MorphSpec } from "@nyambika/contracts";
import { z } from "zod";

/** R4 spike (not committed): physics drape + fit heatmap + tailor pattern-to-3D. Off unless this flag is on. */
export const DRAPE_SPIKE = {
  flag: "fit.heatmap_spike",
  modelId: "drape-pbd-cpu@0.1",
  evalKind: "DRAPE_SPIKE",
  disclaimer: "Experimental physics preview. Visual guidance only: real fabric, cut and body differ.",
  timeoutMs: 45_000,
  evalTimeoutMs: { smoke: 120_000, quick: 600_000, full: 1_800_000 },
} as const;

export const GARMENTS = ["a_line_dress", "wrap_skirt", "shirt"] as const;
export const FABRICS = ["cotton", "kitenge", "jersey"] as const;
export const SLEEVES = ["none", "short", "long"] as const;
export const SIZES = ["S", "M", "L", "XL", "XXL", "3XL"] as const;
export type Garment = (typeof GARMENTS)[number];

export const PatternParams = z.object({
  length_cm: z.number().min(30).max(140).optional(),
  ease_cm: z.number().min(-6).max(20).default(0),
  sleeve: z.enum(SLEEVES).optional(),
});

export const TwinDrapeInput = z.object({
  garment: z.enum(GARMENTS).default("a_line_dress"),
  size: z.enum(SIZES).optional(),
  fabric: z.enum(FABRICS).default("cotton"),
  params: PatternParams.default({ ease_cm: 0 }),
});

export const PatternPreviewInput = z.object({
  garment: z.enum(GARMENTS).optional(),
  fabric: z.enum(FABRICS).default("cotton"),
  params: PatternParams.default({ ease_cm: 0 }),
});

export const EvalInput = z.object({ scope: z.enum(["smoke", "quick", "full"]).default("quick") });

const CATEGORY: Record<string, Garment> = {
  dress: "a_line_dress", gown: "a_line_dress", kitenge: "a_line_dress", umushanana: "a_line_dress", bridal: "a_line_dress", wrap: "wrap_skirt",
  skirt: "wrap_skirt", shirt: "shirt", top: "shirt", blouse: "shirt", jacket: "shirt", suit: "shirt",
};

/** Seeded pattern type for a catalogue category (spike covers three garment types). */
export function garmentForCategory(category: string | null | undefined): Garment {
  return CATEGORY[(category ?? "").toLowerCase()] ?? "a_line_dress";
}

const LENGTH_CM: Record<Garment, Record<string, number>> = {
  a_line_dress: { mini: 78, knee: 95, midi: 112, maxi: 132 },
  wrap_skirt: { mini: 42, knee: 60, midi: 74, maxi: 92 },
  shirt: { mini: 58, knee: 66, midi: 72, maxi: 80 },
};

/** Default pattern params from the customer's morph choices (FR-CAT-07 spec) and height. */
export function paramsFromSpec(garment: Garment, spec: Pick<MorphSpec, "length" | "sleeve"> | null | undefined, heightCm?: number) {
  const scale = heightCm ? heightCm / 165 : 1;
  const len = LENGTH_CM[garment][spec?.length ?? "knee"] ?? LENGTH_CM[garment].knee;
  const sleeve = garment === "wrap_skirt" ? "none" : spec?.sleeve === "sleeveless" ? "none" : spec?.sleeve === "long" ? "long" : spec?.sleeve ? "short" : garment === "shirt" ? "short" : "none";
  return { length_cm: Math.round(Math.min(140, Math.max(30, len * scale))), ease_cm: 0, sleeve: sleeve as (typeof SLEEVES)[number] };
}

/** Only the four girth/length fields a synthetic body needs ever leave the API for a tailor preview. */
export function bodyFields(m: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ["heightCm", "bustCm", "waistCm", "hipsCm", "inseamCm", "shoulderCm", "sleeveCm", "neckCm"]) {
    const v = m?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export interface DrapeEvalReport {
  kind: string;
  model_id: string;
  passed: boolean;
  gate: Record<string, boolean>;
  thresholds: Record<string, number>;
  summary: Record<string, unknown>;
  licence?: string;
  commercial_use?: boolean;
  scope?: string;
  runs?: unknown[];
  sizing?: unknown[];
  disagreements?: unknown[];
  expert_checklist?: unknown[];
}

/** Model-registry eval record (AI-BM-04) for a drape harness run. Kind DRAPE_SPIKE never activates anything. */
export function toEvalRecord(report: DrapeEvalReport, createdBy: string | null) {
  if (report.kind !== DRAPE_SPIKE.evalKind) throw new Error(`Unexpected eval kind ${report.kind}`);
  return {
    modelId: DRAPE_SPIKE.modelId,
    kind: DRAPE_SPIKE.evalKind,
    modelVersion: report.model_id,
    passed: Boolean(report.passed) && report.model_id === DRAPE_SPIKE.modelId,
    licence: report.licence ?? "",
    commercialUse: Boolean(report.commercial_use),
    summary: JSON.parse(JSON.stringify({ ...report.summary, gate: report.gate, thresholds: report.thresholds, scope: report.scope ?? "quick", spike: true })) as Record<string, never>,
    report: JSON.parse(JSON.stringify({ runs: report.runs ?? [], sizing: report.sizing ?? [], disagreements: report.disagreements ?? [], expertChecklist: report.expert_checklist ?? [] })) as Record<string, never>,
    createdBy,
  };
}
