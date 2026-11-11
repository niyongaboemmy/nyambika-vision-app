"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AddToBag } from "@/components/bag";
import { SizeNotes, useSizeRecommendation } from "@/components/size-hint";
import { Chip, ErrorNote, Sheet, Spinner } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import type { Look } from "@/lib/looks";
import type { OrderView } from "@/lib/orders";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

const HOLD_MS = 1200;
const DELIVERY_FEE = 2000;

/** Hold to buy (prototype v2 · 14/15/16): auto-filled size, delivery and wallet; one press-and-hold. */
export function HoldToBuy({ look }: { look: Look }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const twinSize = me?.twinSize && look.variant.sizes.includes(me.twinSize) ? me.twinSize : null;
  const [size, setSize] = useState(twinSize ?? look.variant.sizes[Math.min(1, look.variant.sizes.length - 1)]);
  const [delivery, setDelivery] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [wallet, setWallet] = useState<"MTN_MOMO" | "AIRTEL_MONEY">("MTN_MOMO");
  const [address, setAddress] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const key = useRef<string>("");

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  // E32: profile ↔ size chart recommendation (falls back to the twin estimate server-side).
  const rec = useSizeRecommendation(look.product.id, look.variant.id, open);
  const recSize = rec && look.variant.sizes.includes(rec.size) ? rec.size : null;
  const picked = useRef(false);
  useEffect(() => { if (recSize && !picked.current) setSize(recSize); }, [recSize]);

  const total = look.product.priceRwf + (delivery === "DELIVERY" ? DELIVERY_FEE : 0);
  const eta = new Date(Date.now() + Math.max(1, look.product.leadTimeDays + (delivery === "DELIVERY" ? 1 : 0)) * 86400_000).toLocaleDateString("en-GB", { weekday: "short" });

  function begin() {
    if (busy || (delivery === "DELIVERY" && address.trim().length < 4)) return;
    key.current ||= crypto.randomUUID();
    started.current = performance.now();
    navigator.vibrate?.(10);
    const tick = () => {
      const p = Math.min(1, (performance.now() - started.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) return void submit();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function cancel() {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (!busy) setProgress(0);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    navigator.vibrate?.([20, 40, 20]);
    try {
      const o = await api<OrderView>("/orders", {
        method: "POST",
        headers: { "idempotency-key": key.current },
        json: { lookId: look.id, variantId: look.variant.id, size, delivery, wallet, payerPhone: me!.phone, address },
      });
      track("hold_started", { lookId: look.id, orderId: o.id, pageId: look.maker.pageId });
      router.push(`/orders/${o.id}?fresh=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setProgress(0);
      key.current = "";
    }
  }

  if (!me) return null;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <>
      <button onClick={() => { setOpen(true); track("buy_sheet_opened", { lookId: look.id }); }} className="grad-cta shrink-0 rounded-2xl px-4 py-2 text-sm font-bold" disabled={!look.variant.inStock}>
        ✋ {look.variant.inStock ? "Buy" : "Sold out"}
      </button>
      <Sheet open={open} onClose={() => !busy && setOpen(false)}>
        <h3 className="font-display text-2xl font-black">{look.product.title}{look.product.madeToOrder ? " · tailor-made" : ""}</h3>
        <p className="text-sm text-mut">{look.maker.name} {look.maker.verified && "✓"} · {look.variant.colourName} · ready {eta}</p>

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
        </div>

        <p className="mt-5 text-center text-sm">🔐 {t("buy.paidTo")} <b>{look.maker.madeBy[0] ? `${look.maker.madeBy[0]}, ${look.maker.name}` : look.maker.name}</b> · {rwf(total)}</p>
        <ErrorNote error={error} />

        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            aria-label={`${t("buy.title")}: ${rwf(total)}`}
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
          <p className="text-xs text-mut">Press and hold 1 second · then approve with your Mobile Money PIN</p>
          {delivery === "DELIVERY" && address.trim().length < 4 && <p className="text-xs text-gold">Add a delivery address to continue</p>}
        </div>
        <AddToBag look={look} size={size} />
      </Sheet>
    </>
  );
}
