"use client";

import { normalizePhone, WALLET_LABEL, type Wallet } from "@nyambika/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddToBag } from "@/components/bag";
import { DiscountField, type AppliedDiscount } from "@/components/growth-offer";
import { WalletPhone, type CheckoutResult } from "@/components/region";
import { SizeNotes, useSizeRecommendation } from "@/components/size-hint";
import { Chip, ErrorNote, Sheet, Spinner } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import type { Look } from "@/lib/looks";
import type { OrderView } from "@/lib/orders";
import { useCommerce, useRegion, type Commerce } from "@/lib/region";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

const HOLD_MS = 1200;
const DELIVERY_FEE = 2000;

/** Hold to buy (prototype v2 · 14/15/16): auto-filled size, delivery and wallet; one press-and-hold. */
export function HoldToBuy({ look, autoOpen = false }: { look: Look; /** E35: open the sheet straight away (hand-off from the VR showroom / runway). */ autoOpen?: boolean }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const twinSize = me?.twinSize && look.variant.sizes.includes(me.twinSize) ? me.twinSize : null;
  const [size, setSize] = useState(twinSize ?? look.variant.sizes[Math.min(1, look.variant.sizes.length - 1)]);
  const [delivery, setDelivery] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [wallet, setWallet] = useState<"MTN_MOMO" | "AIRTEL_MONEY">("MTN_MOMO");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const key = useRef<string>("");
  // Hardening pass 1 (E41): pages outside Rwanda sell in their own currency and wallets through the region checkout.
  const commerce = useCommerce(look.maker.handle);
  const regional = commerce && commerce.currency !== "RWF" ? commerce : null;

  // E32: profile ↔ size chart recommendation (falls back to the twin estimate server-side).
  const rec = useSizeRecommendation(look.product.id, look.variant.id, open);
  const recSize = rec && look.variant.sizes.includes(rec.size) ? rec.size : null;
  const picked = useRef(false);
  useEffect(() => { if (recSize && !picked.current) setSize(recSize); }, [recSize]);

  const total = look.product.priceRwf - (discount?.amountRwf ?? 0) + (delivery === "DELIVERY" ? DELIVERY_FEE : 0);
  const eta = new Date(Date.now() + Math.max(1, look.product.leadTimeDays + (delivery === "DELIVERY" ? 1 : 0)) * 86400_000).toLocaleDateString("en-GB", { weekday: "short" });
  const needsAddress = delivery === "DELIVERY" && address.trim().length < 4;

  async function submit() {
    setBusy(true);
    setError(null);
    navigator.vibrate?.([20, 40, 20]);
    key.current ||= crypto.randomUUID();
    try {
      const o = await api<OrderView>("/orders", {
        method: "POST",
        headers: { "idempotency-key": key.current },
        json: { lookId: look.id || undefined, variantId: look.variant.id, size, delivery, wallet, payerPhone: me!.phone, address, discountCode: discount?.code ?? undefined },
      });
      track("hold_started", { lookId: look.id, orderId: o.id, pageId: look.maker.pageId });
      router.push(`/orders/${o.id}?fresh=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      key.current = "";
      throw e;
    }
  }

  if (!me) return null;
  return (
    <>
      <button onClick={() => { setOpen(true); track("buy_sheet_opened", { lookId: look.id }); }} className="grad-cta shrink-0 rounded-2xl px-4 py-2 text-sm font-bold" disabled={!look.variant.inStock}>
        ✋ {look.variant.inStock ? "Buy" : "Sold out"}
      </button>
      <Sheet open={open} onClose={() => !busy && setOpen(false)}>
        <div className="max-h-[80dvh] overflow-y-auto overscroll-contain pr-1">
        <h3 className="font-display text-2xl font-black">{look.product.title}{look.product.madeToOrder ? " · tailor-made" : ""}</h3>
        <p className="text-sm text-mut">{regional ? `${regional.flag} ` : ""}{look.maker.name} {look.maker.verified && "✓"} · {look.variant.colourName} · ready {eta}</p>

        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Size</p>
            <div className="flex flex-wrap gap-2">
              {look.variant.sizes.map((s) => (
                <Chip key={s} active={s === size} onClick={() => { picked.current = true; setSize(s); }}>{s === recSize ? `📏 ${s} · ${rec!.basis === "PROFILE" ? t("size.recommended") : t("buy.sizeFromTwin")} ✓` : s === twinSize && !recSize ? `📏 ${s} · ${t("buy.sizeFromTwin")} ✓` : s}</Chip>
              ))}
            </div>
            <SizeNotes rec={recSize ? rec : null} size={size} />
          </div>
          {commerce === undefined ? (
            <div className="h-40 animate-pulse rounded-2xl bg-white/5" aria-hidden />
          ) : regional ? (
            <RegionHold look={look} commerce={regional} size={size} eta={eta} busy={busy} setBusy={setBusy} />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Chip active={delivery === "DELIVERY"} onClick={() => setDelivery("DELIVERY")}>🛵 Delivery {eta} · +{rwf(DELIVERY_FEE)}</Chip>
                <Chip active={delivery === "PICKUP"} onClick={() => setDelivery("PICKUP")}>🏪 Pickup in {look.maker.sector}</Chip>
              </div>
              {delivery === "DELIVERY" && (
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address (e.g. KG 7 Ave, Kacyiru)" aria-label="Delivery address" className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
              )}
              <div className="flex flex-wrap gap-2">
                <Chip active={wallet === "MTN_MOMO"} onClick={() => setWallet("MTN_MOMO")}>🟡 MTN MoMo · {me.phone.slice(-4).padStart(8, "•")}</Chip>
                <Chip active={wallet === "AIRTEL_MONEY"} onClick={() => setWallet("AIRTEL_MONEY")}>🔴 Airtel Money</Chip>
              </div>
              <DiscountField variantId={look.variant.id} open={open} onChange={setDiscount} />
              <p className="pt-2 text-center text-sm">🔐 {t("buy.paidTo")} <b>{look.maker.madeBy[0] ? `${look.maker.madeBy[0]}, ${look.maker.name}` : look.maker.name}</b> · {rwf(total)}</p>
              <ErrorNote error={error} />
              <HoldRing label={`${t("buy.title")}: ${rwf(total)}`} disabled={busy || needsAddress} busy={busy} onHeld={submit} hint="Press and hold 1 second · then approve with your Mobile Money PIN" />
              {needsAddress && <p className="text-center text-xs text-gold">Add a delivery address to continue</p>}
              <AddToBag look={look} size={size} />
            </>
          )}
        </div>
        </div>
      </Sheet>
    </>
  );
}

/**
 * The same hold-to-buy for a page outside Rwanda: the page's currency (with the shopper's ≈ display price),
 * that country's wallets, charged in the maker's currency through `/region/checkout`. No conversion is charged.
 */
function RegionHold({ look, commerce, size, eta, busy, setBusy }: { look: Look; commerce: Commerce; size: string; eta: string; busy: boolean; setBusy: (b: boolean) => void }) {
  const { me, t } = useSession();
  const { prefs, show } = useRegion();
  const router = useRouter();
  const [delivery, setDelivery] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<Wallet | undefined>(commerce.wallets[0]);
  const [phone, setPhone] = useState(() => (me?.phone && normalizePhone(me.phone, commerce.region).ok ? me.phone : ""));
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");

  const price = commerce.prices[look.product.id];
  if (price == null) return <p className="rounded-2xl bg-white/5 p-4 text-sm text-gold">This maker hasn&apos;t set a {commerce.currency} price for this piece yet. Ask them on WhatsApp.</p>;
  const total = price + (delivery === "DELIVERY" ? commerce.domesticDeliveryMinor : 0);
  const shown = show(total, commerce.currency);
  const phoneOk = method ? normalizePhone(phone, commerce.region).ok : false;
  const needsAddress = delivery === "DELIVERY" && address.trim().length < 4;

  async function submit() {
    setBusy(true);
    setError(null);
    navigator.vibrate?.([20, 40, 20]);
    key.current ||= crypto.randomUUID();
    try {
      const r = await api<CheckoutResult>("/region/checkout", {
        method: "POST",
        headers: { "idempotency-key": key.current },
        json: { lookId: look.id || undefined, variantId: look.variant.id, size, method, payerPhone: phone, delivery, address, discountCode: code.trim() || undefined, displayCurrency: prefs.displayCurrency },
      });
      track("hold_started", { lookId: look.id, orderId: r.orderId, pageId: look.maker.pageId, method, currency: commerce.currency });
      router.push(`/orders/${r.orderId}?fresh=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      key.current = "";
      throw e;
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Chip active={delivery === "DELIVERY"} onClick={() => setDelivery("DELIVERY")}>🛵 In {commerce.country} {eta} · +{show(commerce.domesticDeliveryMinor, commerce.currency).primary}</Chip>
        <Chip active={delivery === "PICKUP"} onClick={() => setDelivery("PICKUP")}>🏪 Pickup in {look.maker.sector}</Chip>
      </div>
      {delivery === "DELIVERY" && (
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address" aria-label="Delivery address" className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
      )}
      <WalletPhone commerce={commerce} methods={commerce.wallets} method={method} onMethod={setMethod} phone={phone} onPhone={setPhone} />
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Discount code (optional)" aria-label="Discount code" maxLength={24} className="glass h-11 w-full rounded-2xl px-4 text-sm uppercase outline-none placeholder:normal-case placeholder:text-white/40" />
      <div className="rounded-2xl bg-gradient-to-br from-violet/25 to-terra/20 p-4 text-center">
        <p className="text-xs uppercase tracking-widest text-mut">{t("region.charged")}</p>
        <p className="font-display text-3xl font-black">{shown.primary}</p>
        {shown.approx && <p className="text-sm text-txt/80">{shown.approx} <span className="text-mut">· reference only</span></p>}
        <p className="mt-1 text-xs text-mut">🔐 {t("buy.paidTo")} {look.maker.name} in {commerce.currency} · maker-funded offers apply automatically</p>
      </div>
      <ErrorNote error={error} />
      <HoldRing
        label={`${t("buy.title")}: ${shown.primary}`}
        disabled={busy || !method || !phoneOk || needsAddress}
        busy={busy}
        onHeld={submit}
        hint={`Press and hold 1 second · then approve the ${method ? WALLET_LABEL[method] : "wallet"} prompt on your phone`}
      />
      {needsAddress && <p className="text-center text-xs text-gold">Add a delivery address to continue</p>}
      {commerce.taxNote && <p className="text-center text-[11px] text-mut">{commerce.taxNote}</p>}
    </>
  );
}

/** The press-and-hold ring (pointer + keyboard). `onHeld` rejecting resets the ring. */
function HoldRing({ label, disabled, busy, onHeld, hint }: { label: string; disabled: boolean; busy: boolean; onHeld: () => Promise<void>; hint: string }) {
  const { t } = useSession();
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  function begin() {
    if (disabled) return;
    started.current = performance.now();
    navigator.vibrate?.(10);
    const tick = () => {
      const p = Math.min(1, (performance.now() - started.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) return void onHeld().catch(() => setProgress(0));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }
  function cancel() {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (!busy) setProgress(0);
  }

  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="mt-2 flex flex-col items-center gap-2">
      <button
        aria-label={label}
        onPointerDown={begin}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) begin(); }}
        onKeyUp={cancel}
        onContextMenu={(e) => e.preventDefault()}
        className="relative grid size-36 select-none place-items-center rounded-full touch-none"
      >
        <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
          <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,.15)" strokeWidth="8" fill="none" />
          <circle cx="60" cy="60" r={r} stroke="#F2B84B" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
        </svg>
        <span className="grad-cta grid size-28 place-items-center rounded-full text-center font-display text-lg font-black leading-tight" style={{ transform: `scale(${1 - progress * 0.06})` }}>
          {busy ? <Spinner /> : progress > 0 ? <>{t("buy.holding")}</> : <>✋<br />{t("buy.title")}</>}
        </span>
      </button>
      <p className="text-center text-xs text-mut">{hint}</p>
    </div>
  );
}
