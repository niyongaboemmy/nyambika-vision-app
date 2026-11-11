"use client";

/** E33 3D twin + E34 3D try-on / AR mirror: types, loaders and pure geometry for the AR overlay. */

export type AvatarStatus = "QUEUED" | "BUILDING" | "READY" | "REJECTED" | "WITHHELD" | "FAILED";
export type Checks = Record<string, { pass: boolean; note: string }>;

export interface Avatar3dView {
  id: string;
  version: number;
  source: "TURNAROUND" | "PERSONA" | "MEASUREMENTS";
  persona: number | null;
  status: AvatarStatus;
  building: boolean;
  progress: number;
  glb: string | null;
  poster: string | null;
  triangles: number | null;
  joints: number | null;
  checks: { ok: boolean; checks: Checks } | null;
  eval: { passed: boolean; skin_tone_delta: number; proportion_error: number } | null;
  skinHex: string | null;
  bodySize: string | null;
  measurements: Record<string, number> | null;
  error: string | null;
  label: string;
}

export interface Twin3dState {
  consent: boolean;
  avatar: Avatar3dView | null;
  ready: Avatar3dView | null;
  hasPhotoTwin: boolean;
  twinSize: string | null;
  hasProfile: boolean;
  personas: number;
  arMirrorPilot: boolean;
  label: string;
  disclaimer: string;
}

export interface FitView {
  id: string;
  variantId: string;
  size: string;
  status: "QUEUED" | "READY" | "FAILED";
  glb: string | null;
  poster: string | null;
  fit: { fit: "tight" | "regular" | "relaxed"; ease_m: number; length_m: number } | null;
  error: string | null;
  disclaimer: string;
}

export interface GarmentInfo {
  productId: string;
  title: string;
  category: string;
  supported: boolean;
  variantId: string;
  sizes: string[];
  recommended: string;
  colours: { variantId: string; colourName: string; colourHex: string; cutout: string | null }[];
  cutout: string | null;
}

export interface WardrobeItem {
  variantId: string;
  productId: string;
  title: string;
  category: string;
  colourName: string;
  colourHex: string;
  cutout: string | null;
  fromLook: boolean;
}

export interface Turnaround {
  persona: number;
  synthetic: boolean;
  yaws: number[];
  frames: string[];
}

/** Monk Skin Tone scale (approximate sRGB) for body-shape avatars without photos (FR-AVA-06). */
export const SKIN_SWATCHES = ["#F6EDE4", "#F3E7DB", "#F7EAD0", "#EADABA", "#D7BD96", "#A07E56", "#825C43", "#604134", "#3A312A", "#292420"];
export const hexToRgb01 = (h: string) => [1, 3, 5].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000);

export const POSES = [
  { id: "Idle", label: "Idle" },
  { id: "Turn", label: "Turn" },
  { id: "Walk", label: "Walk" },
] as const;
export type Pose = (typeof POSES)[number]["id"];

export function isLowEnd() {
  if (typeof navigator === "undefined") return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (navigator.hardwareConcurrency ?? 8) <= 2 || (mem !== undefined && mem <= 2);
}

// ── MediaPipe Tasks Vision (on-device pose), loaded only when the AR mirror starts ──────────────────────
/** Pinned exact version (released 2026-04-27). The ~11 MB WASM runtime comes from jsDelivr; the 5.8 MB model is self-hosted. */
export const MEDIAPIPE_VERSION = "0.10.35";
export const MEDIAPIPE_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
export const POSE_MODEL = "/vendor/mediapipe/pose_landmarker_lite-f16-v1.task";

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
export interface PoseTracker {
  detect(video: HTMLVideoElement, ts: number): Landmark[] | null;
  close(): void;
}

interface VisionModule {
  FilesetResolver: { forVisionTasks(base: string): Promise<unknown> };
  PoseLandmarker: {
    createFromOptions(fs: unknown, o: object): Promise<{ detectForVideo(v: HTMLVideoElement, ts: number): { landmarks: Landmark[][] }; close(): void }>;
  };
}

export async function loadPoseTracker(): Promise<PoseTracker> {
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${MEDIAPIPE_BASE}/vision_bundle.mjs`)) as VisionModule;
  const fileset = await mod.FilesetResolver.forVisionTasks(`${MEDIAPIPE_BASE}/wasm`);
  const make = (delegate: "GPU" | "CPU") =>
    mod.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: POSE_MODEL, delegate }, runningMode: "VIDEO", numPoses: 1 });
  const lm = await make("GPU").catch(() => make("CPU"));
  return {
    detect: (video, ts) => lm.detectForVideo(video, ts).landmarks?.[0] ?? null,
    close: () => lm.close(),
  };
}

// ── AR overlay geometry (pure; unit-testable) ────────────────────────────────────────────────────────────
/** BlazePose landmark ids. */
export const LM = { nose: 0, lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 } as const;

export interface Pt {
  x: number;
  y: number;
}
export interface Anchors {
  /** Image rows (px) of the garment's top line and of the body's hip line on the garment. */
  topRow: number;
  hipRow: number;
  /** Garment width (px) at those rows. */
  topWidth: number;
  hipWidth: number;
  centreX: number;
  /** Where the garment's top sits on the body: shoulder line, or the waist for skirts. */
  topAt: "shoulders" | "waist";
}

/** Fraction of the garment length where the hip line falls, by category (body proportions in avatar_body.py). */
export function hipFraction(category: string) {
  const c = category.toLowerCase();
  if (c === "skirt") return 0.24;
  if (["shirt", "top", "blouse", "jacket", "suit"].includes(c)) return 0.66;
  if (["umushanana", "gown", "bridal"].includes(c)) return 0.37;
  return 0.45;
}

/** Garment anchors from the cut-out alpha (row extents), computed once per image. */
export function anchorsFromAlpha(alpha: Uint8ClampedArray, w: number, h: number, category: string): Anchors | null {
  const rowExtent = (y: number) => {
    let l = -1;
    let r = -1;
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] > 127) {
        if (l < 0) l = x;
        r = x;
      }
    }
    return l < 0 ? null : { l, r };
  };
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) if (rowExtent(y)) (top < 0 ? (top = y) : null, (bottom = y));
  if (top < 0 || bottom - top < 8) return null;
  const len = bottom - top;
  const topRow = Math.round(top + len * 0.06);
  const hipRow = Math.round(top + len * hipFraction(category));
  const a = rowExtent(topRow);
  const b = rowExtent(hipRow);
  if (!a || !b) return null;
  return { topRow: top, hipRow, topWidth: a.r - a.l, hipWidth: b.r - b.l, centreX: (a.l + a.r + b.l + b.r) / 4, topAt: category.toLowerCase() === "skirt" ? "waist" : "shoulders" };
}

export interface Strip {
  /** Source rows in the garment image. */
  sy: number;
  sh: number;
  /** Destination centre, rotation (rad) and scales. */
  cx: number;
  cy: number;
  angle: number;
  sx: number;
  syScale: number;
}

/**
 * Strip warp of the garment onto the tracked body (canvas px): the image's top line maps to the shoulder line
 * (or the waist), its hip line to the hip line; each horizontal strip is scaled between the shoulder and hip
 * widths and rotated with the torso axis, so the garment follows leaning and turning.
 */
export function warpStrips(a: Anchors, imgH: number, shoulders: [Pt, Pt], hips: [Pt, Pt], n = 24): Strip[] {
  const mid = (p: [Pt, Pt]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const dist = (p: [Pt, Pt]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const S = mid(shoulders);
  const H = mid(hips);
  const top = a.topAt === "waist" ? { x: S.x + (H.x - S.x) * 0.62, y: S.y + (H.y - S.y) * 0.62 } : S;
  // Garment shoulders sit outside the shoulder joints; the hip line is ~1.6x the hip-joint distance.
  const topW = a.topAt === "waist" ? dist(hips) * 1.35 : dist(shoulders) * 1.22;
  const hipW = dist(hips) * 1.62;
  const axis = { x: H.x - top.x, y: H.y - top.y };
  const angle = Math.atan2(axis.x, axis.y) * -1;
  const rowsToHip = Math.max(1, a.hipRow - a.topRow);
  const pxPerRow = Math.hypot(axis.x, axis.y) / rowsToHip;
  const strips: Strip[] = [];
  const sh = Math.ceil((imgH - a.topRow) / n);
  for (let i = 0; i < n; i++) {
    const sy = a.topRow + i * sh;
    if (sy >= imgH) break;
    const centreRow = sy + sh / 2;
    const t = (centreRow - a.topRow) / rowsToHip; // 0 at top line, 1 at hips
    const wImg = a.topWidth + (a.hipWidth - a.topWidth) * Math.min(1, Math.max(0, t));
    const wDst = t <= 1 ? topW + (hipW - topW) * Math.max(0, t) : hipW;
    strips.push({
      sy,
      sh: Math.min(sh, imgH - sy),
      cx: top.x + axis.x * t,
      cy: top.y + axis.y * t,
      angle,
      sx: wDst / Math.max(1, t <= 1 ? wImg : a.hipWidth),
      syScale: pxPerRow,
    });
  }
  return strips;
}

/** Exponential smoothing of landmarks (jitter), stronger when the body is still. */
export function smoothLandmarks(prev: Pt[] | null, next: Pt[], alpha = 0.45): Pt[] {
  if (!prev || prev.length !== next.length) return next;
  return next.map((p, i) => ({ x: prev[i].x + (p.x - prev[i].x) * alpha, y: prev[i].y + (p.y - prev[i].y) * alpha }));
}
