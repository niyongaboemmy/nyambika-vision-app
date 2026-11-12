"use client";

import { normalizePhone, WALLET_LABEL, type Wallet } from "@nyambika/contracts/region-data";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddToBag } from "@/components/bag";
import { DiscountField, type AppliedDiscount } from "@/components/growth-offer";
import { WalletPhone, type CheckoutResult } from "@/components/region-pay";
import { SizeNotes, useSizeRecommendation } from "@/components/size-hint";
import { SPRING } from "@/components/look-rail";
import { Icon } from "@/components/icons";
import { Chip, ErrorNote, Sheet, Spinner } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import type { Look } from "@/lib/looks";
import type { OrderView } from "@/lib/orders";
import { useCommerce, useRegion, type Commerce } from "@/lib/region";
import { haptic } from "@/lib/native";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { useNeedSignIn } from "@/lib/auth-ask";
import { go, takeResume } from "@/lib/use-nav";

const HOLD_MS = 1200;
const DELIVERY_FEE = 2000;

/** Hold to buy (prototype v2 · 14/15/16): auto-filled size, delivery and wallet; one press-and-hold. */
export function HoldToBuy({ look, autoOpen = false }: { look: Look; /** E35: open the sheet straight away (hand-off from the VR showroom / runway). */ autoOpen?: boolean }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen && Boolean(me));
  const needSignIn = useNeedSignIn();
  // Navigation pass: back from a detour that started in this sheet (add measurements), it opens again; an
  // `autoOpen` hand-off waits for the session instead of being dropped while it loads.
  const resumeKey = `${look.id}|${look.variant.id}`;
  const autoDone = useRef(false);
  useEffect(() => {
    if (!me) return;
    if (takeResume("buy", resumeKey) || (autoOpen && !autoDone.current)) setOpen(true);
    autoDone.current = true;
  }, [me, resumeKey, autoOpen]);
  const twinSize = me?.twinSize && look.variant.sizes.includes(me.twinSize) ? me.twinSize : null;
  const [size, setSize] = useState(twinSize ?? look.variant.sizes[Math.min(1, look.variant.sizes.length - 1)]);
  const [delivery, setDelivery] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [wallet, setWallet] = useState<"MTN_MOMO" | "AIRTEL_MONEY">("MTN_MOMO");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null);
  const key = useRef<string>("");
  // Hardening pass 1 (E41): pages outside Rwanda sell in their own currency and wallets through the region checkout.
  const commerce = useCommerce(look.maker.handle);
  const regional = commerce && commerce.currency !== "RWF" ? commerce : null;

  // E32: profile vs size chart recommendation (falls back to the twin estimate server-side).
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
      haptic("success");
      go(router, `/orders/${o.id}?fresh=1`, "push");
    } catch (e) {
      setError(e); // ApiError: DAILY/limit/offline codes render calmly via ErrorNote → LimitState
      setBusy(false);
      key.current = "";
      throw e;
    }
  }

  // Signed out: Buy still shows; it signs in on a sheet over this screen, then opens the buy sheet here.
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          haptic("light");
          if (!(await needSignIn("Sign in to buy"))) return;
          setOpen(true);
          track("buy_sheet_opened", { lookId: look.id });
        }}
        className="grad-cta inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-5 text-[15px] font-bold text-white shadow-[0_10px_28px_-10px_rgba(139,92,246,.8)] transition-transform duration-300 active:scale-95 disabled:opacity-60"
        style={{ transitionTimingFunction: SPRING }}
        disabled={!look.variant.inStock}
      >
        <Icon name="bag" className="size-[18px]" />
        {look.variant.inStock ? "Buy" : "Sold out"}
      </button>
      {me && <Sheet open={open} onClose={() => !busy && setOpen(false)}>
        <div className="max-h-[80dvh] overflow-y-auto overscroll-contain pr-1">
        <h3 className="font-display text-2xl font-black">{look.product.title}{look.product.madeToOrder ? " · tailor-made" : ""}</h3>
        <p className="flex flex-wrap items-center gap-x-1 text-sm text-mut">{look.maker.name}{look.maker.verified && <Icon name="checkCircle" className="size-3.5 text-mint" />} · {look.variant.colourName} · ready {eta}</p>

        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Size</p>
            <div className="flex flex-wrap gap-2">
              {look.variant.sizes.map((s) => (
                <Chip key={s} active={s === size} onClick={() => { picked.current = true; setSize(s); }}>{s === recSize ? <><Icon name="ruler" className="size-4" />{s} · {rec!.basis === "PROFILE" ? t("size.recommended") : t("buy.sizeFromTwin")}</> : s === twinSize && !recSize ? <><Icon name="ruler" className="size-4" />{s} · {t("buy.sizeFromTwin")}</> : s}</Chip>
              ))}
            </div>
            <SizeNotes rec={recSize ? rec : null} size={size} resumeKey={resumeKey} />
          </div>
          {commerce === undefined ? (
            <div className="h-40 animate-pulse rounded-2xl bg-white/5" aria-hidden />
          ) : regional ? (
            <RegionHold look={look} commerce={regional} size={size} eta={eta} busy={busy} setBusy={setBusy} />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Chip active={delivery === "DELIVERY"} onClick={() => setDelivery("DELIVERY")}><Icon name="moto" className="size-4" />Delivery {eta} · +{rwf(DELIVERY_FEE)}</Chip>
                <Chip active={delivery === "PICKUP"} onClick={() => setDelivery("PICKUP")}><Icon name="store" className="size-4" />Pickup in {look.maker.sector}</Chip>
              </div>
              {delivery === "DELIVERY" && (
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address (e.g. KG 7 Ave, Kacyiru)" aria-label="Delivery address" className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
              )}
              <div className="flex flex-wrap gap-2">
                <Chip active={wallet === "MTN_MOMO"} onClick={() => setWallet("MTN_MOMO")}><span aria-hidden className="size-2.5 rounded-full bg-[#ffcb05]" />MTN MoMo · {me.phone.slice(-4).padStart(8, "•")}</Chip>
                <Chip active={wallet === "AIRTEL_MONEY"} onClick={() => setWallet("AIRTEL_MONEY")}><span aria-hidden className="size-2.5 rounded-full bg-[#e40000]" />Airtel Money</Chip>
              </div>
              <DiscountField variantId={look.variant.id} open={open} onChange={setDiscount} />
              <p className="flex flex-wrap items-center justify-center gap-x-1 pt-2 text-center text-sm"><Icon name="lock" className="size-4 text-gold" /> {t("buy.paidTo")} <b>{look.maker.madeBy[0] ? `${look.maker.madeBy[0]}, ${look.maker.name}` : look.maker.name}</b> · {rwf(total)}</p>
              <ErrorNote error={error} />
              <HoldRing label={`${t("buy.title")}: ${rwf(total)}`} disabled={busy || needsAddress} busy={busy} onHeld={submit} hint="Press and hold 1 second · then your MoMo PIN" />
              {needsAddress && <p className="text-center text-xs text-gold">Add a delivery address to continue</p>}
              <AddToBag look={look} size={size} />
            </>
          )}
        </div>
        </div>
      </Sheet>}
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
      haptic("success");
      go(router, `/orders/${r.orderId}?fresh=1`, "push");
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
        <Chip active={delivery === "DELIVERY"} onClick={() => setDelivery("DELIVERY")}><Icon name="moto" className="size-4" />In {commerce.country} {eta} · +{show(commerce.domesticDeliveryMinor, commerce.currency).primary}</Chip>
        <Chip active={delivery === "PICKUP"} onClick={() => setDelivery("PICKUP")}><Icon name="store" className="size-4" />Pickup in {look.maker.sector}</Chip>
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
        <p className="mt-1 inline-flex flex-wrap items-center justify-center gap-x-1 text-xs text-mut"><Icon name="lock" className="size-3.5 text-gold" /> {t("buy.paidTo")} {look.maker.name} in {commerce.currency} · offers auto-apply</p>
      </div>
      <ErrorNote error={error} />
      <HoldRing
        label={`${t("buy.title")}: ${shown.primary}`}
        disabled={busy || !method || !phoneOk || needsAddress}
        busy={busy}
        onHeld={submit}
        hint={`Press and hold 1 second · then approve in ${method ? WALLET_LABEL[method] : "your wallet"}`}
      />
      {needsAddress && <p className="text-center text-xs text-gold">Add a delivery address to continue</p>}
      {commerce.taxNote && <p className="text-center text-[11px] text-mut">{commerce.taxNote}</p>}
    </>
  );
}

/** Hold-to-buy pill (pointer + keyboard): a progress bar fills the button while held; `onHeld` rejecting resets it. */
function HoldRing({ label, disabled, busy, onHeld, hint }: { label: string; disabled: boolean; busy: boolean; onHeld: () => Promise<void>; hint: string }) {
  const { t } = useSession();
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const half = useRef(false);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  function begin() {
    if (disabled) return;
    started.current = performance.now();
    half.current = false;
    haptic("light");
    const tick = () => {
      const p = Math.min(1, (performance.now() - started.current) / HOLD_MS);
      setProgress(p);
      if (p > 0.5 && !half.current) {
        half.current = true;
        haptic("light");
      }
      if (p >= 1) return void onHeld().catch(() => setProgress(0));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }
  function cancel() {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (!busy) setProgress(0);
  }

  return (
    // The pill stays pinned at the bottom of the scrolling sheet so the primary action is always in reach.
    <div className="sticky bottom-0 z-10 -mx-5 mt-2 flex flex-col items-center gap-2 bg-gradient-to-t from-ink-2 from-60% to-transparent px-5 pb-1 pt-5">
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onPointerDown={begin}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); begin(); } }}
        onKeyUp={cancel}
        onContextMenu={(e) => e.preventDefault()}
        className={`grad-cta relative h-14 w-full select-none overflow-hidden rounded-full text-white shadow-[0_12px_32px_-12px_rgba(139,92,246,.8)] touch-none transition-[transform,opacity] duration-300 [-webkit-touch-callout:none] ${disabled && !busy ? "opacity-50" : ""}`}
        style={{ transform: `scale(${1 - progress * 0.03})`, transitionTimingFunction: SPRING }}
      >
        {/* Progress bar: a light fill sweeps across the button while it is held. */}
        <span aria-hidden className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${progress * 100}%`, transition: progress === 0 ? `width 360ms ${SPRING}` : "none" }} />
        <span aria-hidden className="relative flex h-full items-center justify-center gap-2 px-4 text-[15px] font-bold">
          {busy ? <Spinner /> : <Icon name="hand" className="size-5 shrink-0" />}
          <span className="truncate">{busy ? label : progress > 0 ? t("buy.holding") : label}</span>
        </span>
      </button>
      <p className="text-center text-xs text-mut">{hint}</p>
    </div>
  );
}
