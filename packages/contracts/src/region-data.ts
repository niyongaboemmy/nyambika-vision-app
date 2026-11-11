/**
 * Region data and phone rules (E41) without zod: EAC country defaults, wallets, phone normalisation,
 * region ranking and shipping zones. Re-exported from the package root (`region.ts`); browser code imports
 * `@nyambika/contracts/region-data`.
 */
import type { CurrencyCode } from "./money";

// ---------------------------------------------------------------- regions

export const REGION_CODES = ["RW", "KE", "UG", "TZ"] as const;
export type RegionCode = (typeof REGION_CODES)[number];

export const WALLETS = ["MTN_MOMO", "AIRTEL_MONEY", "MPESA"] as const;
export type Wallet = (typeof WALLETS)[number];
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
