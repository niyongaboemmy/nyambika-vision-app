"use client";

import { CURRENCY_CODES, formatMoney, normalizePhone, pickZone, REGIONS, REGION_CODES, WALLET_LABEL, type CurrencyCode, type Wallet } from "@nyambika/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, ErrorNote, Sheet, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { MakerProduct, MakerSpace } from "@/lib/maker";
import { COUNTRY_NAMES, useRegion, type Commerce, type OrderMoney } from "@/lib/region";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

const WALLET_ICON: Record<Wallet, string> = { MTN_MOMO: "🟡", AIRTEL_MONEY: "🔴", MPESA: "🟢" };

/** A price in the maker's currency, with "≈" in the shopper's display currency when it differs (E40). */
export function Price({ minor, currency, className = "", approxClassName = "text-mut" }: { minor: number; currency: CurrencyCode; className?: string; approxClassName?: string }) {
  const { show } = useRegion();
  const d = show(minor, currency);
  return (
    <span className={className}>
      {d.primary}
      {d.approx && <span className={`ml-1.5 text-[0.85em] font-medium ${approxClassName}`}>{d.approx}</span>}
    </span>
  );
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

interface CheckoutResult {
  orderId: string;
  code: string;
  status: string;
  money: OrderMoney;
  stripe?: { clientSecret: string; account: string; mode: "mock" | "test" | "live"; publishableKey: string | null };
}

/** Buy in the maker's own currency: regional wallets (M-Pesa, MoMo, Airtel) or an international card. */
export function RegionBuy({ maker, product, variantIndex, commerce }: { maker: MakerSpace; product: MakerProduct; variantIndex: number; commerce: Commerce }) {
  const { me, t } = useSession();
  const { prefs, show } = useRegion();
  const router = useRouter();
  const v = product.variants[Math.min(variantIndex, product.variants.length - 1)];
  const price = commerce.prices[product.id];
  const home = prefs.country === commerce.region;
  const shipCountries = useMemo(() => [...new Set(commerce.zones.flatMap((z) => (z.countries.includes("*") ? Object.keys(COUNTRY_NAMES) : z.countries)))].filter((c) => c !== commerce.region), [commerce]);
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(v.sizes[Math.min(1, v.sizes.length - 1)]);
  const [delivery, setDelivery] = useState<"PICKUP" | "DELIVERY" | "SHIP">(home ? "DELIVERY" : shipCountries.length ? "SHIP" : "PICKUP");
  const [shipCountry, setShipCountry] = useState(shipCountries.includes(prefs.country) ? prefs.country : (shipCountries[0] ?? ""));
  const methods = [...commerce.wallets, ...(commerce.card.enabled ? (["CARD"] as const) : [])];
  const [method, setMethod] = useState<(typeof methods)[number] | undefined>(home ? methods[0] : commerce.card.enabled ? "CARD" : methods[0]);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<CheckoutResult | null>(null);
  const key = useRef("");

  useEffect(() => {
    if (open && me?.phone && !phone && normalizePhone(me.phone, commerce.region).ok) setPhone(me.phone);
  }, [open, me, phone, commerce.region]);

  if (price == null) return null;
  const zone = delivery === "SHIP" ? pickZone(commerce.zones, shipCountry) : null;
  const deliveryMinor = delivery === "DELIVERY" ? commerce.domesticDeliveryMinor : delivery === "SHIP" ? (zone?.feeMinor ?? 0) : 0;
  const total = price + deliveryMinor;
  const totalShown = show(total, commerce.currency);
  const phoneCheck = method && method !== "CARD" ? normalizePhone(phone, commerce.region) : null;
  const ready = method && (delivery === "PICKUP" || address.trim().length >= 4) && (delivery !== "SHIP" || zone) && (!phoneCheck || phoneCheck.ok);

  async function pay() {
    if (!method || !ready) return;
    setBusy(true);
    setError(null);
    key.current ||= crypto.randomUUID();
    navigator.vibrate?.([12, 30, 12]);
    try {
      const r = await api<CheckoutResult>("/region/checkout", {
        method: "POST",
        headers: { "idempotency-key": key.current },
        json: { variantId: v.id, size, method, payerPhone: method === "CARD" ? undefined : phone, delivery, shipCountry: delivery === "SHIP" ? shipCountry : undefined, address, discountCode: code.trim() || undefined, displayCurrency: prefs.displayCurrency },
      });
      track("region_checkout_started", { pageId: maker.id, productId: product.id, method, currency: commerce.currency });
      if (r.stripe) setCard(r);
      else router.push(`/orders/${r.orderId}?fresh=1`);
    } catch (e) {
      setError((e as Error).message);
      key.current = "";
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button className="col-span-2" onClick={() => (me ? setOpen(true) : router.push(`/signin?next=/m/${maker.handle}`))} disabled={!v.inStock}>
        🛍️ {t("region.buy")} · {formatMoney(price, commerce.currency)}
      </Button>
      <Sheet open={open} onClose={() => !busy && (setOpen(false), setCard(null))}>
        <div className="max-h-[78dvh] overflow-y-auto overscroll-contain pr-1">
          {card?.stripe ? (
            <CardStep result={card} payee={maker.name} onDone={(id) => router.push(`/orders/${id}?fresh=1`)} />
          ) : (
            <>
              <h3 className="font-display text-2xl font-black">{product.title}</h3>
              <p className="text-sm text-mut">{commerce.flag} {maker.name} · {v.colourName} · {t("buy.paidTo")} {maker.name}</p>

              <div className="mt-4 space-y-4">
                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Size</legend>
                  <div className="flex flex-wrap gap-2">{v.sizes.map((s) => <Chip key={s} active={s === size} onClick={() => setSize(s)}>{s}</Chip>)}</div>
                </fieldset>

                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Delivery</legend>
                  <div className="flex flex-wrap gap-2">
                    <Chip active={delivery === "DELIVERY"} onClick={() => setDelivery("DELIVERY")}>🛵 In {commerce.country} · +{formatMoney(commerce.domesticDeliveryMinor, commerce.currency)}</Chip>
                    <Chip active={delivery === "PICKUP"} onClick={() => setDelivery("PICKUP")}>🏪 Pickup in {maker.sector}</Chip>
                    {shipCountries.length > 0 && <Chip active={delivery === "SHIP"} onClick={() => setDelivery("SHIP")}>✈️ {t("region.ship")}</Chip>}
                  </div>
                </fieldset>
                {delivery === "SHIP" && (
                  <div className="glass rounded-2xl p-3">
                    <label className="block text-xs font-semibold text-mut" htmlFor="ship-to">Ship to</label>
                    <select id="ship-to" value={shipCountry} onChange={(e) => setShipCountry(e.target.value)} className="mt-1 h-11 w-full rounded-xl bg-ink-3 px-3 text-white outline-none">
                      {shipCountries.map((c) => <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c}</option>)}
                    </select>
                    {zone ? (
                      <p className="mt-2 text-sm">{zone.name} · flat {formatMoney(zone.feeMinor, zone.currency)} · about {zone.etaDays} days</p>
                    ) : (
                      <p className="mt-2 text-sm text-gold">The maker doesn't ship there yet.</p>
                    )}
                  </div>
                )}
                {delivery !== "PICKUP" && (
                  <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={delivery === "SHIP" ? "Street, city, postcode" : "Delivery address"} aria-label="Delivery address" className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
                )}

                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">{t("region.payWith")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {methods.map((m) => (
                      <Chip key={m} active={method === m} onClick={() => setMethod(m)}>{m === "CARD" ? `💳 ${t("region.card")}` : `${WALLET_ICON[m]} ${WALLET_LABEL[m]}`}</Chip>
                    ))}
                  </div>
                  {!methods.length && <p className="text-sm text-gold">This maker takes orders on WhatsApp for now.</p>}
                </fieldset>
                {method && method !== "CARD" && (
                  <div>
                    <label htmlFor="payer" className="text-xs font-semibold text-mut">{WALLET_LABEL[method]} number ({REGIONS[commerce.region].name})</label>
                    <input id="payer" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={commerce.phoneExample} aria-invalid={phone.length > 3 && !phoneCheck?.ok} className="glass mt-1 h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
                    {phone.length > 3 && phoneCheck && !phoneCheck.ok && <p className="mt-1 text-xs text-gold">{phoneCheck.message}</p>}
                  </div>
                )}
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Discount code (optional)" aria-label="Discount code" maxLength={24} className="glass h-11 w-full rounded-2xl px-4 text-sm uppercase outline-none placeholder:normal-case placeholder:text-white/40" />
              </div>

              <div className="mt-5 rounded-2xl bg-gradient-to-br from-violet/25 to-terra/20 p-4 text-center">
                <p className="text-xs uppercase tracking-widest text-mut">{t("region.charged")}</p>
                <p className="font-display text-3xl font-black">{totalShown.primary}</p>
                {totalShown.approx && <p className="text-sm text-txt/80">{totalShown.approx} <span className="text-mut">· reference only</span></p>}
                <p className="mt-1 text-xs text-mut">Paid directly to {maker.name}{method === "CARD" ? "'s own Stripe account" : ""} · maker-funded offers apply automatically</p>
              </div>
              <ErrorNote error={error} />
              <Button className="mt-4 w-full text-lg" disabled={!ready || busy} onClick={pay}>
                {busy ? <Spinner /> : method === "CARD" ? `Continue to card · ${totalShown.primary}` : `${t("region.buy")} · ${totalShown.primary}`}
              </Button>
              {commerce.taxNote && <p className="mt-3 text-center text-[11px] text-mut">{commerce.taxNote}</p>}
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

declare global {
  interface Window {
    Stripe?: (pk: string, opts: { stripeAccount: string }) => {
      elements: (o: { clientSecret: string; appearance: object }) => { create: (t: "payment") => { mount: (el: HTMLElement) => void } };
      confirmPayment: (o: { elements: unknown; redirect: "if_required"; confirmParams?: object }) => Promise<{ error?: { message?: string } }>;
    };
  }
}

/** Card step: Stripe Payment Element on the maker's connected account, or an offline mock with the same flow. */
function CardStep({ result, payee, onDone }: { result: CheckoutResult; payee: string; onDone: (orderId: string) => void }) {
  const s = result.stripe!;
  const [cardNo, setCardNo] = useState("4242 4242 4242 4242");
  const [exp, setExp] = useState("12 / 30");
  const [cvc, setCvc] = useState("123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<unknown>(null);
  const stripeRef = useRef<ReturnType<NonNullable<Window["Stripe"]>> | null>(null);

  useEffect(() => {
    if (s.mode === "mock" || !s.publishableKey) return;
    const boot = () => {
      if (!window.Stripe || !mountRef.current) return;
      const stripe = window.Stripe(s.publishableKey!, { stripeAccount: s.account }); // direct charge on the maker's account
      const elements = stripe.elements({ clientSecret: s.clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#F2B84B", colorBackground: "#15131b", borderRadius: "14px" } } });
      elements.create("payment").mount(mountRef.current);
      stripeRef.current = stripe;
      elementsRef.current = elements;
    };
    if (window.Stripe) return boot();
    const tag = document.createElement("script");
    tag.src = "https://js.stripe.com/v3";
    tag.onload = boot;
    document.head.appendChild(tag);
  }, [s]);

  async function waitPaid() {
    for (let i = 0; i < 20; i++) {
      const m = await api<OrderMoney>(`/region/orders/${result.orderId}/money`);
      if (m.payment && m.payment.status !== "PENDING") return m.payment.status;
      await new Promise((r) => setTimeout(r, 500));
    }
    return "PENDING";
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (s.mode === "mock") {
        const r = await api<{ status: string; error?: string | null }>("/region/stripe/mock/confirm", { method: "POST", json: { clientSecret: s.clientSecret, card: cardNo } });
        if (r.status !== "succeeded") throw new Error(r.error ?? "Payment failed");
      } else {
        const r = await stripeRef.current!.confirmPayment({ elements: elementsRef.current, redirect: "if_required" });
        if (r.error) throw new Error(r.error.message ?? "Payment failed");
      }
      navigator.vibrate?.([20, 40, 20]);
      await waitPaid();
      onDone(result.orderId);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-2xl font-black">Pay by card</h3>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-mut">{s.mode === "mock" ? "Stripe · offline test mock" : s.mode === "test" ? "Stripe test mode" : "Stripe"}</span>
      </div>
      <p className="mt-1 text-sm text-mut">{result.money.total}{result.money.display ? ` · ${result.money.display.text}` : ""} to <b className="text-white">{payee}</b>. Your bank sets the final rate if your card isn&apos;t in {result.money.currency}.</p>
      {s.mode === "mock" ? (
        <div className="relative mt-4 overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-ink-3 to-ink-2 p-4">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-[conic-gradient(from_180deg,rgba(242,184,75,.35),rgba(139,92,246,.35),transparent_70%)] blur-2xl" />
          <div className="relative space-y-3">
            <label className="block text-xs font-semibold text-mut">Card number
              <input inputMode="numeric" autoComplete="cc-number" value={cardNo} onChange={(e) => setCardNo(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-white/15 bg-black/30 px-3 font-mono text-base tracking-wider text-white outline-none focus:border-gold" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-mut">Expiry
                <input autoComplete="cc-exp" value={exp} onChange={(e) => setExp(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-white/15 bg-black/30 px-3 font-mono text-white outline-none focus:border-gold" />
              </label>
              <label className="block text-xs font-semibold text-mut">CVC
                <input inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(e) => setCvc(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-white/15 bg-black/30 px-3 font-mono text-white outline-none focus:border-gold" />
              </label>
            </div>
            <p className="text-[11px] text-mut">Test cards: 4242 4242 4242 4242 succeeds · 4000 0000 0000 0002 is declined. No real card is charged.</p>
          </div>
        </div>
      ) : (
        <div ref={mountRef} className="mt-4 min-h-40 rounded-3xl border border-white/15 bg-ink-3 p-3" />
      )}
      <ErrorNote error={error} />
      <Button className="mt-4 w-full text-lg" disabled={busy} onClick={confirm}>{busy ? <Spinner /> : `Pay ${result.money.total}`}</Button>
      <p className="mt-2 text-center text-[11px] text-mut">🔐 Charged on {payee}&apos;s own Stripe account. Nyambika never holds the money.</p>
    </div>
  );
}

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
