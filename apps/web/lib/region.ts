"use client";

import { displayPrice, isCurrency, isRegion, type CurrencyCode, type RateTable, type RegionCode } from "@nyambika/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/** E40/E41 shopper regional preferences + FX snapshot, shared by every price on the page. */
export interface RegionPrefs {
  displayCurrency: CurrencyCode;
  country: RegionCode;
  crossBorder: boolean;
}

export interface FxSnapshot {
  base: "USD";
  rates: RateTable;
  source: string;
  fetchedAt: string;
  stale: boolean;
}

export interface Commerce {
  pageId: string;
  region: RegionCode;
  country: string;
  flag: string;
  currency: CurrencyCode;
  wallets: ("MTN_MOMO" | "AIRTEL_MONEY" | "MPESA")[];
  crossBorder: boolean;
  card: { enabled: boolean; mode: "mock" | "test" | "live" };
  domesticDeliveryMinor: number;
  prices: Record<string, number | null>;
  zones: { id: string; name: string; countries: string[]; currency: CurrencyCode; feeMinor: number; etaDays: number; active: boolean }[];
  passports: string[];
  taxNote: string;
  legalEntity: string;
  phoneExample: string;
}

export interface OrderMoney {
  currency: CurrencyCode;
  totalMinor: number;
  itemsMinor: number;
  deliveryMinor: number;
  discountMinor: number;
  refundedMinor: number;
  method: string;
  methodLabel: string;
  shipCountry: string | null;
  total: string;
  display: { currency: string; totalMinor: number; text: string; source: string | null; at: string | null } | null;
  payment: { provider: string; ref: string; status: string; connectedAccount: string | null; refundedMinor: number } | null;
}

const COOKIE = { cur: "nya_cur", cc: "nya_cc", xb: "nya_xb" };
const YEAR = 60 * 60 * 24 * 365;

function readCookie(name: string) {
  if (typeof document === "undefined") return null;
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? null;
}
function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
}

let fxCache: Promise<FxSnapshot | null> | null = null;
const listeners = new Set<(p: RegionPrefs) => void>();

function cookiePrefs(): Partial<RegionPrefs> {
  const cur = readCookie(COOKIE.cur);
  const cc = readCookie(COOKIE.cc);
  const xb = readCookie(COOKIE.xb);
  return { ...(cur && isCurrency(cur) ? { displayCurrency: cur } : {}), ...(cc && isRegion(cc) ? { country: cc } : {}), ...(xb ? { crossBorder: xb === "1" } : {}) };
}

/** Display preferences (cookie for everyone, saved server-side when signed in) + FX rates. */
export function useRegion() {
  const { me } = useSession();
  const [prefs, setPrefs] = useState<RegionPrefs>({ displayCurrency: "RWF", country: "RW", crossBorder: false, ...cookiePrefs() });
  const [fx, setFx] = useState<FxSnapshot | null>(null);

  useEffect(() => {
    fxCache ??= api<FxSnapshot>("/region/fx").catch(() => null);
    void fxCache.then(setFx);
    const l = (p: RegionPrefs) => setPrefs(p);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    // Server prefs (or phone-country defaults) win unless the shopper already chose in this browser.
    void api<RegionPrefs>("/region/prefs")
      .then((s) => setPrefs({ ...s, ...cookiePrefs() }))
      .catch(() => undefined);
  }, [me?.id]);

  const update = useCallback(
    async (next: Partial<RegionPrefs>) => {
      const merged = { ...prefs, ...next };
      writeCookie(COOKIE.cur, merged.displayCurrency);
      writeCookie(COOKIE.cc, merged.country);
      writeCookie(COOKIE.xb, merged.crossBorder ? "1" : "0");
      listeners.forEach((l) => l(merged));
      if (me) await api("/region/prefs", { method: "PUT", json: next }).catch(() => undefined);
    },
    [prefs, me],
  );

  const show = useCallback((amountMinor: number, currency: CurrencyCode) => displayPrice({ amountMinor, currency }, prefs.displayCurrency, fx?.rates), [prefs.displayCurrency, fx]);

  return { prefs, fx, update, show };
}

export const COUNTRY_NAMES: Record<string, string> = {
  RW: "Rwanda", KE: "Kenya", UG: "Uganda", TZ: "Tanzania", BI: "Burundi", GB: "United Kingdom", DE: "Germany", FR: "France", BE: "Belgium", NL: "Netherlands", US: "United States", CA: "Canada", IE: "Ireland", IT: "Italy", ES: "Spain", SE: "Sweden",
};
