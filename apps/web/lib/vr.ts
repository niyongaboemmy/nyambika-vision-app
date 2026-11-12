"use client";

import type { ShowPhase } from "@nyambika/contracts";
import type { Look } from "./looks";

/** E35 3D shelf, VR showroom and virtual fashion shows: types and helpers shared by the shopper screens. */

export interface ShelfColour {
  variantId: string;
  colourName: string;
  colourHex: string;
  /** Null when the colour has no approved 3D model (shown as its photo). */
  glb: string | null;
  poster: string | null;
}

export interface ShelfItemView {
  productId: string;
  title: string;
  priceRwf: number;
  category: string;
  variantId: string;
  colourName: string;
  /** Null in the showroom for pieces shown as their photo on a stand (no approved 3D model yet). */
  glb: string | null;
  poster: string | null;
  photo: string | null;
  heightM: number;
  bytes: number;
  size: string;
  featured: boolean;
  colours: ShelfColour[];
}

export interface ShowCard {
  id: string;
  title: string;
  startsAt: string;
  phase: ShowPhase;
  items: number;
  cover: string | null;
}

export interface Shelf {
  pageId: string;
  handle: string;
  showroom: boolean;
  items: ShelfItemView[];
  shows: ShowCard[];
}

export interface Palette {
  primary: string;
  secondary: string;
  deep: string;
}

export interface MakerCard {
  pageId: string;
  name: string;
  handle: string;
  memberType: string;
  verified: boolean;
  sector: string;
  whatsapp: string;
  madeBy: string[];
}

export interface RoomItem extends ShelfItemView {
  product: Look["product"];
  variants: { id: string; colourName: string; colourHex: string; sizes: string[]; inStock: boolean }[];
}

export interface Showroom {
  page: MakerCard & { theme: string; palette: Palette; story: string; rating: number };
  banner: string;
  items: RoomItem[];
  budget: { totalBytes: number; limitBytes: number };
  shows: ShowCard[];
  label: string;
}

export interface ShowItem {
  position: number;
  status: "QUEUED" | "READY" | "FALLBACK" | "FAILED";
  runway: { glb: string; poster: string | null } | null;
  garment: { glb: string; poster: string | null } | null;
  photo: string | null;
  product: Look["product"];
  variant: Look["variant"];
  variants: Look["variants"];
}

export interface ShowView {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  walkSec: number;
  durationSec: number;
  phase: ShowPhase;
  serverNow: string;
  cover: string | null;
  runwayStatus: string;
  model: { skin: string; size: string; label: string };
  rsvps: number;
  going: boolean;
  maker: MakerCard & { theme: string; palette: Palette };
  items: ShowItem[];
}

export interface ShowSnapshot {
  id: string;
  phase: ShowPhase;
  serverNow: string;
  startsAt: string;
  viewers: number;
  reactions: Record<string, number>;
  recent: { id: string; emoji: string; offsetMs: number }[];
  runwayStatus: string;
}

/**
 * A Look-shaped object so the existing hold-to-buy sheet (HoldToBuy) can sell a piece straight from the
 * showroom or the runway. No look exists (id ""), so the order is placed for the variant alone.
 */
export function lookFor(maker: MakerCard, product: Look["product"], variant: Look["variant"], variants: Look["variants"], image: string | null): Look {
  return {
    id: "",
    rank: 0,
    saved: false,
    status: "DELIVERED",
    image,
    onTwin: false,
    tier: "3D",
    c2pa: null,
    guardPassed: null,
    latencyMs: null,
    intentSessionId: "",
    product,
    variant,
    variants,
    maker,
  };
}

export function fmtWhen(iso: string, locale = "en-GB") {
  return new Date(iso).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
}

export function countdown(ms: number) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** WebXR availability (immersive-vr). Untested on Quest / Android XR / Vision Pro hardware. */
export async function xrSupported(): Promise<boolean> {
  const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
  if (!xr?.isSessionSupported) return false;
  try {
    return await xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
}

/** Low-end phones get no shadows, fewer lights and a lower pixel ratio (FR-VR-08 initial view budget). */
export function lowEnd() {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 3 || Boolean(n.connection?.saveData);
}
