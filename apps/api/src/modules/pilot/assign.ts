import { createHash } from "node:crypto";

export interface Variant {
  key: string;
  weight: number;
}

/** Deterministic bucket in [0, 1): sha256(userId + ":" + experimentKey), first 32 bits. */
export function bucket(userId: string, experimentKey: string): number {
  const h = createHash("sha256").update(`${userId}:${experimentKey}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}

/** Weighted pick by bucket. Zero/negative weights never win; all-zero falls back to the control (first). */
export function pickVariant(variants: Variant[], b: number): string {
  if (!variants.length) throw new Error("Experiment has no variants");
  const total = variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return variants[0].key;
  let acc = 0;
  const target = b * total;
  for (const v of variants) {
    acc += Math.max(0, v.weight);
    if (target < acc) return v.key;
  }
  return variants[variants.length - 1].key;
}

export function assign(userId: string, experimentKey: string, variants: Variant[]): string {
  return pickVariant(variants, bucket(userId, experimentKey));
}

export interface ExperimentLike {
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Only RUNNING experiments inside their window assign; everything else means "use the default". */
export function isLive(e: ExperimentLike, now = new Date()): boolean {
  if (e.status !== "RUNNING") return false;
  if (e.startsAt && now < e.startsAt) return false;
  if (e.endsAt && now >= e.endsAt) return false;
  return true;
}
