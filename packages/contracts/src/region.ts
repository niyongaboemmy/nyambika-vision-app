/**
 * E40 Export & DPP readiness · E41 EAC multi-region (FR-ORD-08, FR-DPP-01..04, NFR-SCL-04).
 *
 * Money is always an integer amount of ISO 4217 minor units plus a currency code. No floats:
 * FX rates are decimal strings and conversion uses BigInt rational arithmetic with half-even rounding.
 * Converted amounts are for display only ("≈"); charges are always in the maker's own currency.
 */
import { z } from "zod";
import { CURRENCY_CODES } from "./money";
import { REGION_CODES, WALLETS } from "./region-data";

export * from "./money";
export * from "./region-data";

// zod enums for the API (same names as the types, so `CurrencyCode.parse(x)` and `type CurrencyCode` both work)
export const CurrencyCode = z.enum(CURRENCY_CODES);
export type CurrencyCode = z.infer<typeof CurrencyCode>;
export const RegionCode = z.enum(REGION_CODES);
export type RegionCode = z.infer<typeof RegionCode>;
export const Wallet = z.enum(WALLETS);
export type Wallet = z.infer<typeof Wallet>;

// ---------------------------------------------------------------- inputs

export const ShopperPrefsInput = z.object({
  displayCurrency: CurrencyCode.optional(),
  country: RegionCode.optional(),
  crossBorder: z.boolean().optional(),
});

export const RegionCheckoutInput = z.object({
  variantId: z.string().min(1),
  size: z.string().min(1).max(10),
  method: z.enum(["MPESA", "MTN_MOMO", "AIRTEL_MONEY", "CARD"]),
  payerPhone: z.string().max(20).optional(),
  delivery: z.enum(["PICKUP", "DELIVERY", "SHIP"]),
  shipCountry: z.string().length(2).optional(),
  address: z.string().trim().max(240).default(""),
  discountCode: z.string().trim().max(24).optional().nullable(),
  displayCurrency: CurrencyCode.optional(),
  lookId: z.string().optional(),
});
export type RegionCheckoutInput = z.infer<typeof RegionCheckoutInput>;

export const ShippingZoneInput = z.object({
  name: z.string().trim().min(2).max(40),
  countries: z.array(z.string().regex(/^([A-Z]{2}|\*)$/)).min(1).max(60),
  fee: z.string().trim().min(1).max(14),
  etaDays: z.number().int().min(1).max(60),
  active: z.boolean().default(true),
});

// ---------------------------------------------------------------- Digital Product Passport

/**
 * DPP data (FR-DPP-01/03). Field names follow the draft EU ESPR textile DPP vocabulary where one exists
 * (draft alignment only: the delegated act is expected in 2027). `extensions` keeps room for new fields.
 */
export const PassportData = z.object({
  materials: z
    .array(z.object({ fibre: z.string().trim().min(2).max(40), percent: z.number().int().min(1).max(100), origin: z.string().trim().max(60).default(""), recycled: z.boolean().default(false) }))
    .max(8)
    .default([]),
  fabric: z.object({ type: z.string().trim().max(80).default(""), origin: z.string().trim().max(80).default("") }).default({ type: "", origin: "" }),
  origin: z
    .object({
      country: z.string().length(2).default("RW"),
      district: z.string().trim().max(60).default(""),
      cooperative: z.string().trim().max(80).default(""),
      makers: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
      handmade: z.boolean().default(true),
    })
    .default({ country: "RW", district: "", cooperative: "", makers: [], handmade: true }),
  production: z.object({ date: z.string().max(10).default(""), batch: z.string().trim().max(40).default("") }).default({ date: "", batch: "" }),
  process: z.array(z.object({ step: z.string().trim().min(2).max(60), by: z.string().trim().max(60).default(""), place: z.string().trim().max(60).default("") })).max(12).default([]),
  care: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
  repair: z
    .object({ offered: z.boolean().default(false), services: z.array(z.string().trim().min(2).max(60)).max(8).default([]), contact: z.string().trim().max(80).default("") })
    .default({ offered: false, services: [], contact: "" }),
  certifications: z.array(z.object({ name: z.string().trim().min(2).max(80), issuer: z.string().trim().max(80).default(""), reference: z.string().trim().max(60).default("") })).max(8).default([]),
  /** Placeholder until a methodology (e.g. PEFCR Apparel) is chosen. null = not assessed. */
  carbon: z.object({ kgCo2e: z.number().min(0).max(1000).nullable().default(null), method: z.string().max(80).default("not assessed") }).default({ kgCo2e: null, method: "not assessed" }),
  claims: z.object({ madeIn: z.string().trim().max(40).default(""), impactStory: z.string().trim().max(600).default("") }).default({ madeIn: "", impactStory: "" }),
  gtin: z.string().regex(/^(\d{8}|\d{12,14})?$/).default(""),
  extensions: z.record(z.string(), z.string().max(200)).default({}),
});
export type PassportData = z.infer<typeof PassportData>;

export const PassportInput = z.object({ data: PassportData, note: z.string().trim().max(160).default("") });

/** Fibre composition must add up to exactly 100% when given. */
export function validatePassport(d: PassportData): string[] {
  const issues: string[] = [];
  if (d.materials.length) {
    const total = d.materials.reduce((a, m) => a + m.percent, 0);
    if (total !== 100) issues.push(`Fibre composition adds up to ${total}%, it must be 100%`);
    const names = d.materials.map((m) => m.fibre.toLowerCase());
    if (new Set(names).size !== names.length) issues.push("Each fibre should be listed once");
  }
  if (d.repair.offered && !d.repair.services.length) issues.push("List at least one repair or alteration service");
  if (d.production.date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(d.production.date)) issues.push("Production date should look like 2026-10 or 2026-10-14");
  return issues;
}

/** Field-level diff between two passport versions, for the history view. */
export function passportDiff(a: PassportData | null, b: PassportData): string[] {
  if (!a) return ["first version"];
  const keys = Object.keys(b) as (keyof PassportData)[];
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

/**
 * Draft EU textile DPP field map (ESPR, JTC-24 working drafts). Shown on the passport page and in the
 * ADR as *draft alignment*; names may change when the delegated act is published.
 */
export const EU_DPP_DRAFT_FIELDS: Record<string, string> = {
  materials: "fibreComposition",
  "fabric.origin": "materialOrigin",
  "origin.country": "countryOfManufacturing",
  "origin.cooperative": "manufacturer",
  "origin.makers": "manufacturerContributors",
  "production.batch": "batchNumber",
  "production.date": "dateOfManufacturing",
  process: "manufacturingProcessSteps",
  care: "careInstructions",
  repair: "repairServices",
  certifications: "certificationsAndLabels",
  carbon: "carbonFootprint",
  gtin: "uniqueProductIdentifier",
};

/**
 * GS1 Digital Link-compatible URI (FR-DPP-02): `https://<domain>/01/<GTIN-14>` when the maker has a GTIN
 * (the web app resolves it to the passport), else the plain passport path `/p/<productId>`.
 */
export function passportUri(base: string, productId: string, gtin?: string | null) {
  const b = base.replace(/\/$/, "");
  return gtin ? `${b}/01/${gtin.padStart(14, "0")}` : `${b}/p/${productId}`;
}
