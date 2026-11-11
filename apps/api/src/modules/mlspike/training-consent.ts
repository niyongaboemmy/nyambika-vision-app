/**
 * R4 spike: consent gating for training-data contributions (pure, no Nest imports).
 *
 * Purposes on the existing hash-chained consent ledger:
 *   TRAINING_DATA_GARMENT:<pageId>              the maker opts the page's garment photos in (or out)
 *   TRAINING_DATA_GARMENT:<pageId>:<productId>  per-product override (include one piece, or keep one out)
 * The latest record per purpose wins. A product record overrides the page; without one the page decides.
 * Default is OUT: no record means nothing is contributed.
 *
 * Only maker catalogue photos (`public/media/...`) can ever be contributed. Shopper data (twins, looks,
 * wardrobe, avatars, clips, measurements, private storage) is refused by `assertCatalogueImage`, whatever the caller.
 */
export const TRAINING_PURPOSE = "TRAINING_DATA_GARMENT";
export const pagePurpose = (pageId: string) => `${TRAINING_PURPOSE}:${pageId}`;
export const productPurpose = (pageId: string, productId: string) => `${TRAINING_PURPOSE}:${pageId}:${productId}`;

export const GARMENTS = ["dress", "umushanana", "shirt", "skirt", "trousers"] as const;
export const PATTERNS = ["imigongo", "kitenge", "wax", "solid"] as const;
export const COLOURS = ["terracotta", "indigo", "gold", "teal", "crimson", "forest-green", "royal-purple", "black"] as const;

export interface LedgerRow {
  id: string;
  userId: string;
  purpose: string;
  granted: boolean;
  createdAt: Date;
}
export interface ConsentEntry {
  granted: boolean;
  recordId: string;
  userId: string;
  at: Date;
}
export interface TrainingConsentState {
  page: ConsentEntry | null;
  products: Record<string, ConsentEntry>;
}
export type Eligibility =
  | { eligible: true; consentRecordId: string; consentedAt: Date; scope: "page" | "product"; makerConsentRecordIds?: string[] }
  | { eligible: false; reason: "NOT_OPTED_IN" | "PAGE_WITHDRAWN" | "PRODUCT_EXCLUDED" | "MAKER_NOT_CONSENTED" | "MAKER_WITHDRAWN" };

/**
 * Cooperative pages: the piece is the credited maker's work, so the coop admin's yes is not enough.
 *   TRAINING_DATA_MAKER:<pageId>:<coopMemberId>  recorded by the maker's own account; latest record wins, default OUT.
 * Separate prefix on purpose: `consentState` must never read it as a product override.
 */
export const MAKER_TRAINING_PURPOSE = "TRAINING_DATA_MAKER";
export const makerPurpose = (pageId: string, coopMemberId: string) => `${MAKER_TRAINING_PURPOSE}:${pageId}:${coopMemberId}`;

/** Latest maker decision per coop member on one page. */
export function makerConsents(pageId: string, rows: LedgerRow[]): Record<string, ConsentEntry> {
  const prefix = `${MAKER_TRAINING_PURPOSE}:${pageId}:`;
  const out: Record<string, ConsentEntry> = {};
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (r.purpose.startsWith(prefix)) out[r.purpose.slice(prefix.length)] = { granted: r.granted, recordId: r.id, userId: r.userId, at: r.createdAt };
  }
  return out;
}

/**
 * Page/product consent (admin) AND, on a cooperative page, every credited maker's own consent. A piece no maker is
 * credited for is the cooperative's own work: the admin decides alone. A withdrawal by either side takes it out.
 */
export function coopEligibility(state: TrainingConsentState, productId: string, credited: string[], makers: Record<string, ConsentEntry>): Eligibility {
  const base = productEligibility(state, productId);
  if (!base.eligible || !credited.length) return base;
  const ids: string[] = [];
  for (const m of credited) {
    const c = makers[m];
    if (!c) return { eligible: false, reason: "MAKER_NOT_CONSENTED" };
    if (!c.granted) return { eligible: false, reason: "MAKER_WITHDRAWN" };
    ids.push(c.recordId);
  }
  return { ...base, makerConsentRecordIds: ids };
}

/** Latest ledger record per training purpose of one page (rows may come from several page managers). */
export function consentState(pageId: string, rows: LedgerRow[]): TrainingConsentState {
  const page = pagePurpose(pageId);
  const prefix = `${page}:`;
  const state: TrainingConsentState = { page: null, products: {} };
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const e = { granted: r.granted, recordId: r.id, userId: r.userId, at: r.createdAt };
    if (r.purpose === page) state.page = e;
    else if (r.purpose.startsWith(prefix)) state.products[r.purpose.slice(prefix.length)] = e;
  }
  return state;
}

export function productEligibility(state: TrainingConsentState, productId: string): Eligibility {
  const p = state.products[productId];
  if (p) return p.granted ? { eligible: true, consentRecordId: p.recordId, consentedAt: p.at, scope: "product" } : { eligible: false, reason: "PRODUCT_EXCLUDED" };
  if (state.page?.granted) return { eligible: true, consentRecordId: state.page.recordId, consentedAt: state.page.at, scope: "page" };
  return { eligible: false, reason: state.page ? "PAGE_WITHDRAWN" : "NOT_OPTED_IN" };
}

/** A grant → withdrawal transition needs a tombstone so the next dataset version drops the items. */
export function needsTombstone(before: ConsentEntry | null | undefined, grantedNow: boolean) {
  return Boolean(before?.granted) && !grantedNow;
}

const SHOPPER_MARKERS = ["private/", "twin", "look", "wardrobe", "avatar", "poll", "custom-orders", "motion", "partner", "video", "clip", "measurement", "persona"];

export class ShopperDataError extends Error {}

/** Throws unless the path is maker catalogue media. Called for every item before it reaches the gateway. */
export function assertCatalogueImage(path: string | null | undefined): string {
  const p = (path ?? "").replace(/\\/g, "/");
  if (!p.startsWith("public/media/") || p.includes("..")) throw new ShopperDataError(`Not catalogue media: ${p || "(empty)"}`);
  // Token match (ids are random cuids, so substring matching would misfire on e.g. "...clip...").
  const tokens = new Set(p.slice("public/media/".length).toLowerCase().split(/[/._-]+/));
  if (SHOPPER_MARKERS.some((m) => tokens.has(m.replace(/\/$/, "")) || tokens.has(`${m}s`))) throw new ShopperDataError(`Looks like shopper data: ${p}`);
  return p;
}

const COLOUR_ALIASES: Record<string, (typeof COLOURS)[number]> = {
  forest: "forest-green",
  "forest green": "forest-green",
  green: "forest-green",
  emerald: "forest-green",
  "royal purple": "royal-purple",
  purple: "royal-purple",
  red: "crimson",
  "black white": "black",
  "black & white": "black",
};

export function normaliseColour(name: string | null | undefined): (typeof COLOURS)[number] | null {
  const n = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if ((COLOURS as readonly string[]).includes(n.replace(/ /g, "-"))) return n.replace(/ /g, "-") as (typeof COLOURS)[number];
  return COLOUR_ALIASES[n] ?? null;
}

export function normaliseCategory(c: string | null | undefined): (typeof GARMENTS)[number] | null {
  const n = (c ?? "").trim().toLowerCase();
  if ((GARMENTS as readonly string[]).includes(n)) return n as (typeof GARMENTS)[number];
  if (n === "trouser" || n === "pants") return "trousers";
  return null;
}

/** Pattern family from product style tags, when the maker set one (seed catalogue has none → unknown). */
export function patternFromStyles(styles: string[]): (typeof PATTERNS)[number] | null {
  for (const s of styles) {
    const n = s.toLowerCase();
    if ((PATTERNS as readonly string[]).includes(n)) return n as (typeof PATTERNS)[number];
  }
  return null;
}
