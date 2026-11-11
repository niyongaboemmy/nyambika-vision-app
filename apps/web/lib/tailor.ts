import type { MorphLength, MorphSleeve, MorphSpec, MorphTemplateInput, Measurements, SizeRecommendation } from "@nyambika/contracts";
import type { IconName } from "@/components/icons";

export interface MorphTemplateView {
  customizable: boolean;
  productId: string;
  title?: string;
  category?: string;
  basePriceRwf?: number;
  madeToOrder: boolean;
  leadTimeDays?: number;
  options?: MorphTemplateInput;
  lengths?: MorphLength[];
  sleeves?: MorphSleeve[];
  variants?: { id: string; colourName: string; colourHex: string; sizes: string[] }[];
  maker: { pageId: string; name: string; handle: string; memberType: string } | null;
}

export interface MorphRenderView {
  renderId: string;
  status: "QUEUED" | "GENERATING" | "GUARDING" | "DELIVERED" | "WITHHELD" | "FAILED";
  image: string | null;
  c2pa: { signed: boolean; sha256: string; model: string } | null;
  guardPassed: boolean | null;
  spec?: MorphSpec;
  price?: { totalRwf: number; lines: { label: string; deltaRwf: number }[] };
}

export interface CustomOrderView {
  id: string;
  code: string;
  status: string;
  title: string;
  spec: MorphSpec;
  size: string | null;
  note: string;
  estimateRwf: number;
  quote: { priceRwf: number; depositPct: number; depositRwf: number; balanceRwf: number; leadTimeDays: number; note: string; at: string } | null;
  image: string | null;
  previewShared: boolean;
  productImage: string | null;
  colour: { name: string; hex: string } | null;
  product: { id: string; title: string; category: string } | null;
  service: { id: string; title: string } | null;
  page: { id: string; name: string; handle: string; whatsapp: string; sector: string };
  orderId: string | null;
  readyBy: string | null;
  fitting: { id: string; startsAt: string; durationMin: number; location: string } | null;
  measurementShare: { id: string; active: boolean; expiresAt: string; revokedAt: string | null } | null;
  payments: { stage: "DEPOSIT" | "BALANCE"; amountRwf: number; status: string; at: string }[];
  events: { status: string; note: string; at: string }[];
  createdAt: string;
  updatedAt: string;
  buyer?: { name: string | null; phone: string };
}

export interface MeasurementsView {
  profile: Measurements | null;
  source: string | null;
  updatedAt: string | null;
  twinSize: string | null;
  prefill: Measurements | null;
  shares: { id: string; page: { id: string; name: string; handle: string } | null; customOrder: { id: string; code: string; title: string } | null; expiresAt: string; revokedAt: string | null; active: boolean }[];
}

export interface TailorServiceView {
  id: string;
  pageId: string;
  title: string;
  description: string;
  startingPriceRwf: number;
  leadTimeDays: number;
  requiredMeasurements: string[];
  active: boolean;
}

export type { SizeRecommendation };

export const CO_LABEL: Record<string, string> = {
  REQUESTED: "Waiting for a quote",
  QUOTED: "Quote ready",
  DEPOSIT_PENDING: "Approve the deposit on your phone",
  DEPOSIT_PAID: "Deposit paid",
  CUTTING: "Cutting",
  SEWING: "Sewing",
  FITTING: "Fitting",
  FINISHING: "Finishing",
  READY: "Ready · pay the balance",
  BALANCE_PENDING: "Approve the balance on your phone",
  BALANCE_PAID: "Fully paid",
  DELIVERED: "Delivered",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};

export const CO_TAILOR_LABEL: Record<string, string> = {
  ...CO_LABEL,
  REQUESTED: "New request",
  QUOTED: "Quote sent",
  DEPOSIT_PENDING: "Deposit pending",
  READY: "Ready · balance due",
  BALANCE_PENDING: "Balance pending",
};

/** Journey shown as a progress rail on both sides. */
export const JOURNEY = ["REQUESTED", "QUOTED", "DEPOSIT_PAID", "CUTTING", "SEWING", "FITTING", "FINISHING", "READY", "BALANCE_PAID", "DELIVERED"] as const;

export function journeyIndex(status: string) {
  const alias: Record<string, string> = { DEPOSIT_PENDING: "QUOTED", BALANCE_PENDING: "READY" };
  return JOURNEY.indexOf((alias[status] ?? status) as (typeof JOURNEY)[number]);
}

/**
 * `glyph` is the SF-style icon to render with `<Icon name={glyph} />`. `icon` is kept (empty) only so older
 * call sites that printed the emoji keep compiling; render `glyph` instead.
 */
export const MEASUREMENT_LABEL: Record<string, { label: string; hint: string; glyph: IconName; icon: string }> = {
  heightCm: { label: "Height", hint: "Barefoot, back to a wall", glyph: "ruler", icon: "" },
  bustCm: { label: "Bust / chest", hint: "Fullest part, tape level", glyph: "dress", icon: "" },
  waistCm: { label: "Waist", hint: "Narrowest part, above the navel", glyph: "needle", icon: "" },
  hipsCm: { label: "Hips", hint: "Fullest part of the hips", glyph: "person", icon: "" },
  inseamCm: { label: "Inseam", hint: "Crotch to ankle", glyph: "move", icon: "" },
  shoulderCm: { label: "Shoulder", hint: "Shoulder point to shoulder point", glyph: "user", icon: "" },
  sleeveCm: { label: "Arm length", hint: "Shoulder to wrist, arm relaxed", glyph: "hand", icon: "" },
  neckCm: { label: "Neck", hint: "Around the base of the neck", glyph: "ring", icon: "" },
};

export const hueColour = (h: number) => `hsl(${h} 72% 50%)`;

export function specChips(spec: MorphSpec, colour?: string | null) {
  const out: string[] = [];
  if (spec.hue !== null && spec.hue !== undefined) out.push(`Custom colour ${Math.round(spec.hue)}°`);
  else if (colour) out.push(colour);
  if (spec.length) out.push(`${cap(spec.length)} length`);
  if (spec.sleeve) out.push(`${cap(spec.sleeve)} sleeves`);
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const kigaliTime = (d: string | number | Date, opts: Intl.DateTimeFormatOptions) => new Date(d).toLocaleString("en-GB", { timeZone: "Africa/Kigali", ...opts });
