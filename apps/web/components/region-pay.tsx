"use client";

/** Wallet entry and order money for regional checkout (E40/E41), split from region.tsx (JS budget pass). */

import { formatMoney } from "@nyambika/contracts/money";
import { normalizePhone, REGIONS, WALLET_LABEL, type Wallet } from "@nyambika/contracts/region-data";
import { useEffect, useState } from "react";
import { Button, Chip } from "@/components/ui";
import { api } from "@/lib/api";
import { COUNTRY_NAMES, type Commerce, type OrderMoney } from "@/lib/region";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/icons";

/** Brand-colour dot per wallet (no emoji). */
const WALLET_DOT: Record<Wallet, string> = { MTN_MOMO: "#ffcb05", AIRTEL_MONEY: "#e40000", MPESA: "#4caf50" };

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
            <Chip key={m} active={method === m} onClick={() => onMethod(m)}>{m === "CARD" ? <><Icon name="wallet" className="size-4" /> {t("region.card")}</> : <><span aria-hidden className="size-2.5 rounded-full" style={{ background: WALLET_DOT[m as Wallet] }} /> {WALLET_LABEL[m as Wallet]}</>}</Chip>
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

export interface CheckoutResult {
  orderId: string;
  code: string;
  status: string;
  money: OrderMoney;
  stripe?: { clientSecret: string; account: string; mode: "mock" | "test" | "live"; publishableKey: string | null };
}

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
      <p className="flex items-center gap-1.5 text-xs text-mut"><Icon name="lock" className="size-3.5 shrink-0" /> {t("buy.paidTo")} {payee}{m.method === "CARD" ? " (their own Stripe account)" : ""}.</p>
      {simulated && (
        <div className="mt-2 rounded-2xl border border-mint/40 bg-mint/10 p-3" role="group" aria-label="Simulated phone prompt">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Icon name="phone" className="size-4" /> {t("region.approve")}</p>
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
