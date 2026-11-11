"use client";

import { api } from "./api";

/** E27 3D garment + AR, E28 motion preview: types and on-demand loaders. */

export interface Garment3d {
  variantId: string;
  colourName: string;
  colourHex: string;
  glb: string;
  poster: string | null;
  dimensions: { width: number; height: number; depth: number };
  triangles: number;
  size: string;
}

export interface Product3d {
  productId: string;
  title?: string;
  label: string;
  assets: Garment3d[];
}

export interface Studio3dAsset {
  id: string;
  status: "QUEUED" | "GENERATING" | "READY" | "FAILED";
  progress: number;
  approved: boolean;
  glb: string | null;
  poster: string | null;
  bytes: number | null;
  triangles: number | null;
  dimensions: { width: number; height: number; depth: number } | null;
  size: string;
  modelVersion: string;
  error: string | null;
}

export interface Studio3d {
  productId: string;
  label: string;
  costRwf: number;
  allowance: { cap: number | null; used: number };
  published: boolean;
  variants: { variantId: string; colourName: string; colourHex: string; hasCutout: boolean; asset: Studio3dAsset | null }[];
}

export interface MotionClip {
  id: string;
  lookId: string;
  status: "QUEUED" | "GENERATING" | "GUARDING" | "DELIVERED" | "WITHHELD" | "FAILED";
  rendering: boolean;
  progress: number;
  webp: string | null;
  mp4: string | null;
  poster: string | null;
  frames: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  source: string | null;
  credits: number;
  c2pa: { signed: boolean; sha256: string; model: string } | null;
  label: string;
}

export interface MotionState {
  clip: MotionClip | null;
  eligible: boolean;
  reason: string | null;
  quote: { source: "FREE_QUOTA" | "PAGE_ALLOWANCE" | "CREDITS"; credits: number; costRwf: number; label: string };
}

const cache = new Map<string, Promise<Product3d | null>>();
/** Public 3D assets of a product (approved only). Cached per page view; failures mean "no 3D". */
export function load3d(productId: string) {
  if (!cache.has(productId)) cache.set(productId, api<Product3d>(`/xr/public/products/${productId}/3d`).catch(() => null));
  return cache.get(productId)!;
}

/** Pinned, self-hosted <model-viewer> (BSD-3-Clause, v4.4.0), injected only when a viewer opens (customer JS budget). */
export const MODEL_VIEWER_SRC = "/vendor/model-viewer-4.4.0.min.js";
let loader: Promise<void> | null = null;
export function loadModelViewer(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (customElements.get("model-viewer")) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = MODEL_VIEWER_SRC;
    s.onerror = () => {
      loader = null;
      reject(new Error("3D viewer failed to load"));
    };
    document.head.appendChild(s);
    customElements.whenDefined("model-viewer").then(() => resolve());
  });
  return loader;
}

/** FR-3D-08: no WebGL2 → images instead of 3D. */
export function hasWebGL2() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const fmtM = (m: number) => `${m.toFixed(2)} m`;
export const fmtMB = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
