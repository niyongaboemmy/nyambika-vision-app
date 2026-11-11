import { ConflictException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

/**
 * E39 NLB gate on the model registry (AI-BM-01..05, FR-VID-03): a model in a gated tier can be activated
 * for shoppers only with a passing NLB evaluation for its exact version, run within the last quarter, on a
 * licence that allows commercial use. Pure decision + a thin Prisma wrapper used by `PATCH /admin/models/:id`.
 */
export const NLB_GATED_TIERS: Record<string, string> = { VIDEO_TRYON: "NLB_VIDEO" };
export const EVAL_MAX_AGE_DAYS = 92; // AI-BM-04: re-run quarterly

export interface GateModel {
  id: string;
  tier: string;
}
export interface GateEval {
  kind: string;
  modelVersion: string;
  passed: boolean;
  commercialUse: boolean;
  createdAt: Date;
  summary: unknown;
}
export type GateDecision = { ok: true; evalRequired: boolean } | { ok: false; code: string; reason: string };

export function activationDecision(model: GateModel, latest: GateEval | null, now = new Date()): GateDecision {
  const kind = NLB_GATED_TIERS[model.tier];
  if (!kind) return { ok: true, evalRequired: false };
  if (!latest || latest.kind !== kind) {
    return { ok: false, code: "NO_EVAL", reason: `No NLB evaluation on record for ${model.id}. Run the NLB video eval first.` };
  }
  if (latest.modelVersion !== model.id) {
    return { ok: false, code: "VERSION_MISMATCH", reason: `The last eval was for ${latest.modelVersion}, not ${model.id}. Re-run the NLB for this version.` };
  }
  if (!latest.passed) {
    const failing = (latest.summary as { failing_subgroups?: string[]; error?: string | null } | null) ?? {};
    const detail = failing.error ? failing.error : failing.failing_subgroups?.length ? `failing subgroups: ${failing.failing_subgroups.slice(0, 6).join(", ")}` : "thresholds not met";
    return { ok: false, code: "EVAL_FAILED", reason: `The last NLB eval of ${model.id} did not pass (${detail}).` };
  }
  if (!latest.commercialUse) {
    return { ok: false, code: "LICENCE", reason: `${model.id} is not licensed for commercial use (AI-BM-05).` };
  }
  const ageDays = (now.getTime() - latest.createdAt.getTime()) / 86400_000;
  if (ageDays > EVAL_MAX_AGE_DAYS) {
    return { ok: false, code: "EVAL_STALE", reason: `The last NLB eval of ${model.id} is ${Math.floor(ageDays)} days old; re-run it (quarterly).` };
  }
  return { ok: true, evalRequired: true };
}

type Db = Pick<PrismaClient, "modelVersion" | "modelEval">;

/** Throws 409 NLB_GATE unless the model may be activated. Returns the decision for auditing. */
export async function assertActivationAllowed(db: Db, modelId: string, now = new Date()) {
  const model = await db.modelVersion.findUniqueOrThrow({ where: { id: modelId } });
  const kind = NLB_GATED_TIERS[model.tier];
  const latest = kind ? await db.modelEval.findFirst({ where: { modelId, kind }, orderBy: { createdAt: "desc" } }) : null;
  const d = activationDecision(model, latest, now);
  if (!d.ok) throw new ConflictException({ message: d.reason, code: "NLB_GATE", reason: d.code });
  return d;
}
