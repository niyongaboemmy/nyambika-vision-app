"use client";

import { CURRENCY_CODES, formatMoney, type CurrencyCode } from "@nyambika/contracts/money";
import { normalizePhone, REGIONS, REGION_CODES, WALLET_LABEL, type Wallet } from "@nyambika/contracts/region-data";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Chip, Sheet } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { COUNTRY_NAMES, useCommerce, useRegion, type Commerce, type OrderMoney } from "@/lib/region";
import { useSession } from "@/lib/session";

const WALLET_ICON: Record<Wallet, string> = { MTN_MOMO: "🟡", AIRTEL_MONEY: "🔴", MPESA: "🟢" };

/** Pay-with chips + the payer's wallet number for the maker's country. Shared by the Maker Space sheet and Looks hold-to-buy. */
export function WalletPhone<M extends Wallet | "CARD">({ commerce, methods, method, onMethod, phone, onPhone }: { commerce: Commerce; methods: readonly M[]; method: M | undefined; onMethod: (m: M) => void; phone: string; onPhone: (p: string) => void }) {
  const { t } = useSession();
  const phoneCheck = method && method !== "CARD" ? normalizePhone(phone, commerce.region) : null;
  return (
    <>
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">{t("region.payWith")}</legend>
        <div className="flex flex-wrap gap-2">
          {methods.map((m) => (
            <Chip key={m} active={method === m} onClick={() => onMethod(m)}>{m === "CARD" ? `💳 ${t("region.card")}` : `${WALLET_ICON[m as Wallet]} ${WALLET_LABEL[m as Wallet]}`}</Chip>
          ))}
        </div>
        {!methods.length && <p className="text-sm text-gold">This maker takes orders on WhatsApp for now.</p>}
      </fieldset>
      {method && method !== "CARD" && (
        <div>
          <label htmlFor="payer" className="text-xs font-semibold text-mut">{WALLET_LABEL[method as Wallet]} number ({REGIONS[commerce.region].name})</label>
          <input id="payer" inputMode="tel" value={phone} onChange={(e) => onPhone(e.target.value)} placeholder={commerce.phoneExample} aria-invalid={phone.length > 3 && !phoneCheck?.ok} className="glass mt-1 h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
          {phone.length > 3 && phoneCheck && !phoneCheck.ok && <p className="mt-1 text-xs text-gold">{phoneCheck.message}</p>}
        </div>
      )}
    </>
  );
}

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

export function RegionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useSession();
  const { prefs, fx, update } = useRegion();
  const router = useRouter();
  const set = async (p: Parameters<typeof update>[0]) => {
    navigator.vibrate?.(8);
    await update(p);
    router.refresh();
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <h2 className="font-display text-2xl font-black">{t("region.showPricesIn")}</h2>
      <fieldset className="mt-3">
        <legend className="sr-only">{t("region.showPricesIn")}</legend>
        <div className="flex flex-wrap gap-2">
          {CURRENCY_CODES.map((c) => (
            <Chip key={c} active={prefs.displayCurrency === c} onClick={() => void set({ displayCurrency: c })}>{c}</Chip>
          ))}
        </div>
      </fieldset>
      <p className="mt-2 text-xs text-mut">{t("region.approxNote")}{fx ? ` Rates: ${fx.source === "dev-fixed-synthetic" ? "synthetic dev rates" : fx.source}, ${new Date(fx.fetchedAt).toLocaleDateString("en-GB")}.` : ""}</p>

      <fieldset className="mt-5">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-mut">{t("region.country")}</legend>
        <div className="flex flex-wrap gap-2">
          {REGION_CODES.map((c) => (
            <Chip key={c} active={prefs.country === c} onClick={() => void set({ country: c })}>{REGIONS[c].flag} {REGIONS[c].name}</Chip>
          ))}
        </div>
      </fieldset>

      <label className="glass mt-5 flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl px-4">
        <span>
          <span className="block font-semibold">{t("region.crossBorder")}</span>
          <span className="block text-xs text-mut">{t("region.crossBorderHint")}</span>
        </span>
        <input type="checkbox" role="switch" className="size-6 accent-[#F2B84B]" checked={prefs.crossBorder} onChange={(e) => void set({ crossBorder: e.target.checked })} />
      </label>
      <Button variant="glass" className="mt-5 w-full" onClick={onClose}>Done</Button>
    </Sheet>
  );
}

// ------------------------------------------------------------------------------ checkout

export interface CheckoutResult {
  orderId: string;
  code: string;
  status: string;
  money: OrderMoney;
  stripe?: { clientSecret: string; account: string; mode: "mock" | "test" | "live"; publishableKey: string | null };
}

// RegionBuy (wallet / card checkout) lives in region-buy.tsx and loads when a product sheet opens (JS budget pass).

// ------------------------------------------------------------------------------ order page

/** Order money panel (currency-aware total, method, and the dev wallet prompt). Renders nothing for legacy RWF orders. */
export function useOrderMoney(orderId: string, status: string | undefined) {
  const [m, setM] = useState<OrderMoney | null>(null);
  useEffect(() => {
    if (!status) return;
    let alive = true;
    void api<OrderMoney & { legacy?: boolean }>(`/region/orders/${orderId}/money`).then((x) => alive && setM(x.legacy ? null : x)).catch(() => undefined);
    return () => void (alive = false);
  }, [orderId, status]);
  return m;
}

export function OrderMoneyPanel({ money: m, payee, onChange }: { money: OrderMoney | null; payee: string; onChange: () => void }) {
  const { t } = useSession();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  if (!m) return null;
  const wallet = m.method !== "CARD";
  const simulated = wallet && m.payment?.provider === "wallet-mock" && m.payment.status === "PENDING" && process.env.NODE_ENV !== "production";
  async function decide(approve: boolean) {
    setBusy(true);
    await api(`/region/mock/wallet/${m!.payment!.ref}`, { method: "POST", json: { pin: pin || "1234", approve } }).catch(() => undefined);
    setBusy(false);
    onChange();
  }
  return (
    <section className="glass space-y-2 rounded-3xl p-4" aria-label="Payment">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-2xl font-black">{m.total}</p>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold">{m.methodLabel}</span>
      </div>
      {m.display && <p className="text-sm text-mut">{m.display.text} at checkout · reference only, charged in {m.currency}</p>}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-mut">Item</dt><dd className="text-right">{formatMoney(m.itemsMinor, m.currency)}</dd>
        {m.discountMinor > 0 && <><dt className="text-mut">Maker offer</dt><dd className="text-right text-mint">−{formatMoney(m.discountMinor, m.currency)}</dd></>}
        <dt className="text-mut">{m.shipCountry ? `Shipping to ${COUNTRY_NAMES[m.shipCountry] ?? m.shipCountry}` : "Delivery"}</dt><dd className="text-right">{formatMoney(m.deliveryMinor, m.currency)}</dd>
        {m.refundedMinor > 0 && <><dt className="text-mut">Refunded</dt><dd className="text-right text-gold">{formatMoney(m.refundedMinor, m.currency)}</dd></>}
      </dl>
      <p className="text-xs text-mut">🔐 {t("buy.paidTo")} {payee}{m.method === "CARD" ? " (their own Stripe account)" : ""}.</p>
      {simulated && (
        <div className="mt-2 rounded-2xl border border-mint/40 bg-mint/10 p-3" role="group" aria-label="Simulated phone prompt">
          <p className="text-sm font-semibold">📲 {t("region.approve")}</p>
          <p className="text-xs text-mut">Dev simulator: this is what the {m.methodLabel} prompt on {m.payment?.ref.startsWith("MPESA") ? "the Safaricom" : "the"} phone asks.</p>
          <p className="mt-2 text-sm">Pay <b>{m.total}</b> to <b>{payee}</b>?</p>
          <div className="mt-2 flex gap-2">
            <input aria-label={`${m.methodLabel} PIN`} inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN" className="h-11 w-24 rounded-xl bg-black/30 px-3 font-mono text-white outline-none" />
            <Button className="min-h-11 flex-1" disabled={busy || pin.length < 4} onClick={() => decide(true)}>Approve</Button>
            <Button variant="glass" className="min-h-11" disabled={busy} onClick={() => decide(false)}>Decline</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Small "Product passport" link for the product sheet (FR-DPP-02). */
export function PassportLink({ productId }: { productId: string }) {
  const { t } = useSession();
  return (
    <Link href={`/p/${productId}`} className="glass inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-semibold">
      🪪 {t("region.passport")} <span aria-hidden className="text-mut">→</span>
    </Link>
  );
}
