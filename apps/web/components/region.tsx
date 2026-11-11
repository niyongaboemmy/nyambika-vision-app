"use client";

import type { CurrencyCode } from "@nyambika/contracts/money";
import { REGIONS } from "@nyambika/contracts/region-data";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { rwf } from "@/lib/api";
import { useCommerce, useRegion } from "@/lib/region";
import { useSession } from "@/lib/session";

const RegionSheet = dynamic(() => import("@/components/region-sheet").then((m) => m.RegionSheet), { ssr: false });

/** A price in the maker's currency, with "≈" in the shopper's display currency when it differs (E40). */
export function Price({ minor, currency, className = "", approxClassName = "text-mut" }: { minor: number; currency: CurrencyCode; className?: string; approxClassName?: string }) {
  const { show } = useRegion();
  const d = show(minor, currency);
  return (
    <span className={className}>
      {d.primary}
      {d.approx && <span className={`${approxClassName.includes("block") ? "" : "ml-1.5 "}text-[0.85em] font-medium ${approxClassName}`}>{d.approx}</span>}
    </span>
  );
}

/** A look's price in its maker's currency (hardening pass 1: KES/UGX/TZS pages no longer show an RWF figure in the Looks feed). */
export function LookPrice({ handle, productId, priceRwf }: { handle: string; productId: string; priceRwf: number }) {
  const c = useCommerce(handle);
  if (c === undefined) return <span className="inline-block h-4 w-24 animate-pulse rounded bg-white/10 align-middle" aria-hidden />;
  if (!c || c.currency === "RWF") return <>{rwf(priceRwf)}</>;
  const minor = c.prices[productId];
  return minor == null ? <>{c.currency} · ask the maker</> : <Price minor={minor} currency={c.currency} />;
}

/** Pill that opens the country / display-currency / cross-border sheet. */
export function RegionPill({ className = "" }: { className?: string }) {
  const { prefs } = useRegion();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`glass inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${className}`} aria-label={`Country ${REGIONS[prefs.country].name}, prices shown in ${prefs.displayCurrency}. Change`}>
        <span aria-hidden>{REGIONS[prefs.country].flag}</span> {prefs.displayCurrency}
        <span aria-hidden className="text-mut">▾</span>
      </button>
      <RegionSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// JS budget pass: checkout (RegionBuy) is in region-buy.tsx, the country sheet in region-sheet.tsx, and wallet entry +
// order money in region-pay.tsx, so pages that only show a price or the pill skip that code.
export type { CheckoutResult } from "./region-pay";

/** Small "Product passport" link for the product sheet (FR-DPP-02). */
export function PassportLink({ productId }: { productId: string }) {
  const { t } = useSession();
  return (
    <Link href={`/p/${productId}`} className="glass inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold">
      🪪 {t("region.passport")} <span aria-hidden className="text-mut">→</span>
    </Link>
  );
}
