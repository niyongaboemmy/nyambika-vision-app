/**
 * E39 "See it on video" pure rules: pricing, availability, clip validation, served-model check.
 * Free of Nest/Prisma so they are unit-tested.
 */
import { motionCostRwf, pickVideoSource, quoteLabel, type UsageSource } from "../xr/xr-rules";

/** Premium credit action like E28 motion (FR-VID-04), but heavier: a per-frame try-on of a whole clip. */
export const VIDEO_TRYON = {
  kind: "VIDEO_TRYON",
  credits: 5,
  freeWeekly: 0,
  dailyCap: 3,
  minFrames: 6,
  maxFrames: 24,
  maxFrameBytes: 160 * 1024,
  consent: "VIDEO_CLIP_UPLOAD",
  flag: "video.tryon",
  tier: "VIDEO_TRYON",
  label: "AI video try-on",
} as const;

export const VIDEO_JOB = "videotryon";
export const VIDEO_RENDERING = new Set(["QUEUED", "GENERATING", "GUARDING"]);

export const videoCostRwf = () => motionCostRwf(VIDEO_TRYON.credits);

export function videoQuote(s: { pageAllowanceOn: boolean; pageCap: number | null; pageUnitsUsed: number }): { source: UsageSource; credits: number; costRwf: number; label: string } {
  const source = pickVideoSource({ freeUsedThisWeek: 0, freeWeekly: VIDEO_TRYON.freeWeekly, units: VIDEO_TRYON.credits, ...s });
  return { source, credits: VIDEO_TRYON.credits, costRwf: source === "CREDITS" ? videoCostRwf() : 0, label: quoteLabel(source, VIDEO_TRYON.credits) };
}

/** Shown to shoppers only while the kill switch is on AND a VIDEO_TRYON model is ACTIVE (it passed the NLB gate). */
export function videoAvailable(flagEnabled: boolean | undefined, activeModel: { id: string } | null) {
  return flagEnabled !== false && Boolean(activeModel);
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

export function videoEligibility(generationStatus: string | null, todayCount: number): Eligibility {
  if (generationStatus !== "DELIVERED") return { ok: false, reason: "Wait for the look to finish first." };
  if (todayCount >= VIDEO_TRYON.dailyCap) return { ok: false, reason: `Daily video limit reached (${VIDEO_TRYON.dailyCap}). Try again tomorrow.` };
  return { ok: true };
}

/** Frames extracted on the device from the shopper's clip: JPEG/PNG/WebP base64, bounded count and size. */
export function validateClip(frames: string[] | undefined): string[] {
  const errs: string[] = [];
  if (!frames || frames.length < VIDEO_TRYON.minFrames) return [`A clip needs at least ${VIDEO_TRYON.minFrames} frames.`];
  if (frames.length > VIDEO_TRYON.maxFrames) errs.push(`At most ${VIDEO_TRYON.maxFrames} frames.`);
  for (const f of frames) {
    const head = Buffer.from(f.slice(0, 24), "base64");
    const jpeg = head[0] === 0xff && head[1] === 0xd8;
    const png = head.subarray(1, 4).toString("latin1") === "PNG";
    const webp = head.subarray(8, 12).toString("latin1") === "WEBP";
    if (!jpeg && !png && !webp) {
      errs.push("Frames must be JPEG, PNG or WebP.");
      break;
    }
    if ((f.length * 3) / 4 > VIDEO_TRYON.maxFrameBytes) {
      errs.push("A frame is too large.");
      break;
    }
  }
  return errs;
}

/** NLB: only the exact activated model may reach a shopper; a result from any other version is discarded. */
export function servedByActivatedModel(activeModelId: string, reportedVersion: string | undefined) {
  return reportedVersion === activeModelId;
}

export function mapGatewayStatus(s: string): "GENERATING" | "DELIVERED" | "WITHHELD" | "FAILED" {
  if (s === "DELIVERED" || s === "WITHHELD" || s === "FAILED") return s;
  return "GENERATING";
}
