/**
 * E40 Export & DPP readiness · E41 EAC multi-region (FR-ORD-08, FR-DPP-01..04, NFR-SCL-04).
 *
 * Money is always an integer amount of ISO 4217 minor units plus a currency code. No floats:
 * FX rates are decimal strings and conversion uses BigInt rational arithmetic with half-even rounding.
 * Converted amounts are for display only ("≈"); charges are always in the maker's own currency.
 */
import { z } from "zod";

// ---------------------------------------------------------------- currencies

export const CURRENCY_CODES = ["RWF", "KES", "UGX", "TZS", "USD", "EUR"] as const;
export const CurrencyCode = z.enum(CURRENCY_CODES);
export type CurrencyCode = z.infer<typeof CurrencyCode>;

/** ISO 4217 exponents (RWF and UGX have no minor unit; Stripe treats them as zero-decimal too). */
export const CURRENCIES: Record<CurrencyCode, { exponent: number; name: string; symbol: string }> = {
  RWF: { exponent: 0, name: "Rwandan franc", symbol: "RWF" },
  KES: { exponent: 2, name: "Kenyan shilling", symbol: "KES" },
  UGX: { exponent: 0, name: "Ugandan shilling", symbol: "UGX" },
  TZS: { exponent: 2, name: "Tanzanian shilling", symbol: "TZS" },
  USD: { exponent: 2, name: "US dollar", symbol: "USD" },
  EUR: { exponent: 2, name: "Euro", symbol: "EUR" },
};

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export function isCurrency(c: string): c is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(c);
}

function assertMinor(n: number) {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Money must be an integer number of minor units (got ${n})`);
}

/** "4,500.50" / "4500.5" → 450050 for KES. Rejects more decimals than the currency allows. */
export function parseMajor(input: string, currency: CurrencyCode): number {
  const exp = CURRENCIES[currency].exponent;
  const s = input.trim().replace(/[,\s_]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`Not an amount: "${input}"`);
  const frac = m[3] ?? "";
  if (frac.length > exp) throw new RangeError(`${currency} has ${exp} decimal place(s)`);
  const minor = BigInt(m[2] + frac.padEnd(exp, "0"));
  const n = Number(m[1] ? -minor : minor);
  assertMinor(n);
  return n;
}

/** Minor units → plain major string without grouping ("4500.50"). */
export function toMajorString(amountMinor: number, currency: CurrencyCode): string {
  assertMinor(amountMinor);
  const exp = CURRENCIES[currency].exponent;
  const neg = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(exp + 1, "0");
  const whole = exp ? digits.slice(0, -exp) : digits;
  const frac = exp ? digits.slice(-exp) : "";
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** "KES 4,500" (cents only shown when non-zero, unless `cents: true`). Integer-only formatting. */
export function formatMoney(amountMinor: number, currency: CurrencyCode, opts: { cents?: boolean; approx?: boolean } = {}): string {
  const major = toMajorString(Math.abs(amountMinor), currency);
  const [whole, frac = ""] = major.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const showFrac = frac && (opts.cents || /[1-9]/.test(frac));
  return `${opts.approx ? "≈ " : ""}${amountMinor < 0 ? "−" : ""}${CURRENCIES[currency].symbol} ${grouped}${showFrac ? `.${frac}` : ""}`;
}

/** Integer division of BigInts with round-half-even (banker's rounding). */
export function divRoundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError("Division by zero");
  if (den < 0n) return divRoundHalfEven(-num, -den);
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = a / den;
  const r = a - q * den;
  const twice = r * 2n;
  let out = q;
  if (twice > den || (twice === den && q % 2n === 1n)) out = q + 1n;
  return neg ? -out : out;
}

/** Decimal rate string ("129.5") → exact rational. */
export function parseRate(rate: string): { num: bigint; den: bigint } {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) throw new RangeError(`Bad rate "${rate}"`);
  const frac = m[2] ?? "";
  const num = BigInt(m[1] + frac);
  if (num === 0n) throw new RangeError("Rate must be positive");
  return { num, den: 10n ** BigInt(frac.length) };
}

/** Units of `quote` per 1 USD, as decimal strings (FxRate rows). USD itself is implicitly "1". */
export type RateTable = Partial<Record<CurrencyCode, string>>;

/**
 * Convert minor units between currencies via USD cross rates, exactly, rounding once (half-even).
 * Used for "≈" display only; never to compute a charge.
 */
export function convertMinor(amountMinor: number, from: CurrencyCode, to: CurrencyCode, rates: RateTable): number {
  assertMinor(amountMinor);
  if (from === to) return amountMinor;
  const rFrom = parseRate(from === "USD" ? "1" : (rates[from] ?? missing(from)));
  const rTo = parseRate(to === "USD" ? "1" : (rates[to] ?? missing(to)));
  const eFrom = 10n ** BigInt(CURRENCIES[from].exponent);
  const eTo = 10n ** BigInt(CURRENCIES[to].exponent);
  // to_minor = from_minor / eFrom / rateFrom * rateTo * eTo
  const num = BigInt(amountMinor) * rTo.num * rFrom.den * eTo;
  const den = rTo.den * rFrom.num * eFrom;
  const n = Number(divRoundHalfEven(num, den));
  assertMinor(n);
  return n;
}

function missing(c: string): never {
  throw new RangeError(`No FX rate for ${c}`);
}

/** Basis-point share of an amount (e.g. VAT 1600 bp = 16%), half-even. */
export function shareBp(amountMinor: number, bp: number): number {
  assertMinor(amountMinor);
  if (!Number.isInteger(bp)) throw new RangeError("bp must be an integer");
  return Number(divRoundHalfEven(BigInt(amountMinor) * BigInt(bp), 10_000n));
}

/** VAT contained in a VAT-inclusive price (price × bp / (10000 + bp)), half-even. */
export function vatIncluded(amountMinor: number, bp: number): number {
  assertMinor(amountMinor);
  return Number(divRoundHalfEven(BigInt(amountMinor) * BigInt(bp), 10_000n + BigInt(bp)));
}

export function sumMinor(...amounts: number[]): number {
  const n = amounts.reduce((a, b) => a + b, 0);
  assertMinor(n);
  return n;
}

/** Display line for a price: the charge in the maker's currency plus an optional "≈" in the shopper's currency. */
export function displayPrice(charge: Money, display: CurrencyCode | null | undefined, rates: RateTable | null | undefined) {
  const primary = formatMoney(charge.amountMinor, charge.currency);
  if (!display || display === charge.currency || !rates) return { primary, approx: null as string | null, approxMinor: null as number | null };
  try {
    const approxMinor = convertMinor(charge.amountMinor, charge.currency, display, rates);
    return { primary, approx: formatMoney(approxMinor, display, { approx: true }), approxMinor };
  } catch {
    return { primary, approx: null, approxMinor: null };
  }
}

// ---------------------------------------------------------------- regions

export const REGION_CODES = ["RW", "KE", "UG", "TZ"] as const;
export const RegionCode = z.enum(REGION_CODES);
export type RegionCode = z.infer<typeof RegionCode>;

export const WALLETS = ["MTN_MOMO", "AIRTEL_MONEY", "MPESA"] as const;
export const Wallet = z.enum(WALLETS);
export type Wallet = z.infer<typeof Wallet>;
export const WALLET_LABEL: Record<Wallet, string> = { MTN_MOMO: "MTN MoMo", AIRTEL_MONEY: "Airtel Money", MPESA: "M-Pesa" };

export interface RegionDefaults {
  code: RegionCode;
  name: string;
  flag: string;
  currency: CurrencyCode;
  dialCode: string;
  /** National significant number after the dial code. */
  phonePattern: RegExp;
  phoneExample: string;
  wallets: Wallet[];
  languages: string[];
  vatRateBp: number;
}

/** Static defaults; the RegionConfig table holds the editable per-country launch config. */
export const REGIONS: Record<RegionCode, RegionDefaults> = {
  RW: { code: "RW", name: "Rwanda", flag: "🇷🇼", currency: "RWF", dialCode: "250", phonePattern: /^7[2389]\d{7}$/, phoneExample: "0788 123 456", wallets: ["MTN_MOMO", "AIRTEL_MONEY"], languages: ["rw", "en", "fr"], vatRateBp: 1800 },
  KE: { code: "KE", name: "Kenya", flag: "🇰🇪", currency: "KES", dialCode: "254", phonePattern: /^(?:7\d{8}|1[01]\d{7})$/, phoneExample: "0712 345 678", wallets: ["MPESA", "AIRTEL_MONEY"], languages: ["sw", "en"], vatRateBp: 1600 },
  UG: { code: "UG", name: "Uganda", flag: "🇺🇬", currency: "UGX", dialCode: "256", phonePattern: /^7[0-9]\d{7}$/, phoneExample: "0772 123 456", wallets: ["MTN_MOMO", "AIRTEL_MONEY"], languages: ["en", "sw"], vatRateBp: 1800 },
  TZ: { code: "TZ", name: "Tanzania", flag: "🇹🇿", currency: "TZS", dialCode: "255", phonePattern: /^[67]\d{8}$/, phoneExample: "0754 123 456", wallets: ["MPESA", "AIRTEL_MONEY"], languages: ["sw", "en"], vatRateBp: 1800 },
};

export function isRegion(c: string): c is RegionCode {
  return (REGION_CODES as readonly string[]).includes(c);
}

export type PhoneResult = { ok: true; e164: string; country: RegionCode } | { ok: false; message: string };

/** Normalise "0712 345 678", "712345678", "254712345678" or "+254712345678" and validate it for one country. */
export function normalizePhone(input: string, country: RegionCode): PhoneResult {
  const r = REGIONS[country];
  const raw = input.trim().replace(/[\s\-().]/g, "");
  let nsn: string;
  if (raw.startsWith("+")) {
    if (!raw.startsWith(`+${r.dialCode}`)) return { ok: false, message: `Use a ${r.name} number (+${r.dialCode} …), e.g. ${r.phoneExample}` };
    nsn = raw.slice(r.dialCode.length + 1);
  } else if (raw.startsWith("00" + r.dialCode)) nsn = raw.slice(r.dialCode.length + 2);
  else if (raw.startsWith(r.dialCode) && raw.length === r.dialCode.length + 9) nsn = raw.slice(r.dialCode.length);
  else if (raw.startsWith("0")) nsn = raw.slice(1);
  else nsn = raw;
  if (!/^\d+$/.test(nsn) || !r.phonePattern.test(nsn)) return { ok: false, message: `${r.name} numbers look like ${r.phoneExample}` };
  return { ok: true, e164: `+${r.dialCode}${nsn}`, country };
}

/**
 * Sign-in phone (hardening pass 1, E41). A national number is read for the chosen country (the sign-in
 * country selector, else Rwanda) and validated with that country's rules; a full international number
 * (+… / 00…) wins over the selector. Rwanda keeps its original lenient reading (07… → +250…), so every
 * existing account signs in exactly as before.
 */
export function signInPhone(input: string, country: RegionCode = "RW"): PhoneResult {
  const raw = input.trim().replace(/[\s\-().]/g, "");
  const intl = /^(\+|00)/.test(raw);
  const digits = raw.replace(/^(\+|00)/, "").replace(/\D/g, "");
  const target = intl ? (REGION_CODES.find((c) => digits.startsWith(REGIONS[c].dialCode)) ?? null) : country;
  if (target && target !== "RW") return normalizePhone(intl ? `+${digits}` : raw, target);
  // Rwanda (and numbers outside the EAC regions): the original normalisation, unchanged.
  const e164 = digits.startsWith("250") ? `+${digits}` : digits.startsWith("07") ? `+250${digits.slice(1)}` : `+${digits}`;
  if (!/^\+[0-9]{9,15}$/.test(e164)) return { ok: false, message: `${REGIONS.RW.name} numbers look like ${REGIONS.RW.phoneExample}` };
  return { ok: true, e164, country: target ?? country };
}

/** Country of an E.164 number among the supported EAC regions. */
export function countryOfPhone(e164: string): RegionCode | null {
  for (const c of REGION_CODES) if (e164.startsWith(`+${REGIONS[c].dialCode}`) && normalizePhone(e164, c).ok) return c;
  return null;
}

/** Wallets a page can take, given its country config and which merchant accounts it has. */
export function walletsFor(region: RegionCode, has: Partial<Record<Wallet, boolean>>): Wallet[] {
  return REGIONS[region].wallets.filter((w) => has[w]);
}

// ---------------------------------------------------------------- region-aware ranking

export interface RankablePage {
  region: RegionCode;
  /** The maker opted in to sell to shoppers in other countries. */
  crossBorder: boolean;
}

/**
 * Shoppers see makers in their own country first; other countries only appear when the shopper
 * opted in to cross-border shopping AND the maker opted in to selling cross-border. Stable within groups.
 */
export function rankByRegion<T extends RankablePage>(items: T[], shopper: { country: RegionCode; crossBorder: boolean }): (T & { crossBorderListing: boolean })[] {
  const home = items.filter((i) => i.region === shopper.country).map((i) => ({ ...i, crossBorderListing: false }));
  if (!shopper.crossBorder) return home;
  const away = items.filter((i) => i.region !== shopper.country && i.crossBorder).map((i) => ({ ...i, crossBorderListing: true }));
  return [...home, ...away];
}

// ---------------------------------------------------------------- shipping

export interface ShippingZoneLike {
  id: string;
  name: string;
  countries: string[];
  currency: CurrencyCode;
  feeMinor: number;
  etaDays: number;
  active: boolean;
}

/** Flat fee by zone: the first active zone that lists the destination country (or "*" for rest of world). */
export function pickZone<Z extends ShippingZoneLike>(zones: Z[], country: string): Z | null {
  const c = country.toUpperCase();
  return zones.find((z) => z.active && z.countries.includes(c)) ?? zones.find((z) => z.active && z.countries.includes("*")) ?? null;
}

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
