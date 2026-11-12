"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Chip, ErrorNote, Screen, Spinner, TopBar } from "@/components/ui";
import { api, ApiError, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/icons";

interface Mandate {
  id: string;
  state: "open" | "confirmed" | "canceled" | "expired";
  agent: { name: string; verified: boolean };
  maker: { name: string; handle: string; verified: boolean; sector: string; district: string };
  paidTo: string;
  items: { title: string; colourName: string; size: string; qty: number; unitPriceRwf: number; image: string | null; makerName: string }[];
  subtotalRwf: number;
  deliveryFeeRwf: number;
  leadTimeDays: number;
  expiresAt: string;
  orderId: string | null;
}

const HOLD_MS = 1200;

function useCountdown(iso: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return null;
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  return { left: s, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
}

/**
 * User-mandate confirmation (FR-AGT-04): an AI assistant prepared a cart; the shopper sees exactly what,
 * from whom and for how much, and confirms with the same hold-to-buy gesture. Then the Mobile Money push.
 */
export default function ConfirmMandate() {
  const { token } = useParams<{ token: string }>();
  const { me, loading, t } = useSession();
  const router = useRouter();
  const [m, setM] = useState<Mandate | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [delivery, setDelivery] = useState<"DELIVERY" | "PICKUP">("PICKUP");
  const [wallet, setWallet] = useState<"MTN_MOMO" | "AIRTEL_MONEY">("MTN_MOMO");
  const [address, setAddress] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const clock = useCountdown(m?.expiresAt);

  useEffect(() => {
    if (loading) return;
    api<Mandate>(`/agent-mandates/${token}`)
      .then(setM)
      .catch((e: ApiError) => setLoadError({ status: e.status, message: e.message }));
  }, [token, loading, me?.id]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const fee = delivery === "DELIVERY" ? (m?.deliveryFeeRwf ?? 0) : 0;
  const total = (m?.subtotalRwf ?? 0) + fee;
  const needsAddress = delivery === "DELIVERY" && address.trim().length < 4;
  const expired = m?.state === "expired" || (clock !== null && clock.left === 0);

  function begin() {
    if (busy || needsAddress || expired) return;
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
      const r = await api<{ orderId: string }>(`/agent-mandates/${token}/confirm`, { method: "POST", json: { delivery, wallet, address, payerPhone: me!.phone } });
      router.push(`/orders/${r.orderId}?fresh=1`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setProgress(0);
    }
  }
  async function decline() {
    await api(`/agent-mandates/${token}/decline`, { method: "POST" }).catch(() => undefined);
    setDeclined(true);
  }

  if (loadError) {
    const msg = loadError.status === 410 ? t("mandate.expired") : loadError.message;
    return (
      <Screen>
        <TopBar />
        <main className="grid min-h-[70dvh] place-items-center px-6 text-center">
          <div className="space-y-3">
            <span aria-hidden><Icon name="hourglass" className="size-12 text-gold" /></span>
            <p className="font-display text-2xl font-black">{msg}</p>
            <Link href="/" className="text-sm text-gold underline">Nyambika</Link>
          </div>
        </main>
      </Screen>
    );
  }
  if (!m) {
    return (
      <Screen>
        <TopBar />
        <main className="space-y-3 px-4" aria-busy="true">
          <div className="h-24 animate-pulse rounded-3xl bg-white/10" />
          <div className="h-40 animate-pulse rounded-3xl bg-white/10" />
          <div className="h-24 animate-pulse rounded-3xl bg-white/10" />
        </main>
      </Screen>
    );
  }

  const r = 52;
  const c = 2 * Math.PI * r;
  const closed = declined || m.state !== "open" || expired;
  return (
    <Screen>
      <TopBar />
      <main className="space-y-4 px-4 pb-12">
        <section className="animate-rise space-y-2 pt-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-txt/85">
            <span aria-hidden className="orb size-5 rounded-full" />
            {t("mandate.eyebrow")} · <b className="text-white">{m.agent.name}</b>
            {m.agent.verified && <span className="rounded-full bg-mint/20 px-2 py-0.5 text-[11px] font-bold text-mint">✓ {t("mandate.verifiedAgent")}</span>}
          </p>
          <h1 className="font-display text-[34px] font-black leading-[1.05] tracking-tight">
            <span className="text-grad">{t("mandate.title")}</span>
          </h1>
        </section>

        <section aria-label="Maker" className="glass flex items-center gap-3 rounded-3xl p-3.5">
          <Avatar name={m.maker.name} size={48} ring />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{m.maker.name} {m.maker.verified && <span className="text-mint" title="Verified member">✓</span>}</p>
            <p className="text-xs text-mut">{m.maker.sector} · {m.maker.district} · ready in {Math.max(1, m.leadTimeDays)} day{m.leadTimeDays > 1 ? "s" : ""}</p>
          </div>
          <Link href={`/m/${m.maker.handle}`} className="glass rounded-full px-3 py-1.5 text-xs font-semibold">Their page</Link>
        </section>

        <section aria-label="Items" className="glass divide-y divide-white/10 rounded-3xl">
          {m.items.map((i, n) => (
            <div key={n} className="flex items-center gap-3 p-3">
              {i.image ? <img src={i.image} alt="" className="h-20 w-16 shrink-0 rounded-2xl bg-white/5 object-cover" /> : <div className="h-20 w-16 shrink-0 rounded-2xl bg-white/10" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-tight">{i.qty > 1 ? `${i.qty} × ` : ""}{i.title}</p>
                <p className="text-sm text-mut">{i.colourName} · size {i.size}{i.makerName ? ` · by ${i.makerName}` : ""}</p>
              </div>
              <p className="shrink-0 font-display font-black tabular-nums">{rwf(i.unitPriceRwf * i.qty)}</p>
            </div>
          ))}
          <div className="flex items-baseline justify-between p-3.5">
            <span className="text-sm text-mut">Total{fee ? ` incl. delivery ${rwf(fee)}` : ""}</span>
            <span className="font-display text-2xl font-black tabular-nums">{rwf(total)}</span>
          </div>
        </section>

        <section className="rounded-3xl bg-gold/10 p-4 text-sm leading-relaxed" role="note">
          <p><Icon name="lock" className="mr-1 inline size-4 align-[-3px]" />{t("mandate.paidTo")} <b className="text-white">{m.paidTo}</b>. Nyambika never holds your money.</p>
          <p className="mt-1 text-txt/85">{t("mandate.nothingYet")}</p>
          {m.state === "open" && clock && !expired && <p className="mt-2 text-xs text-mut"><Icon name="clock" className="mr-1 inline size-3.5 align-[-2px]" />{t("mandate.expires")} {clock.label}</p>}
        </section>

        {declined ? (
          <p role="status" className="glass rounded-3xl p-5 text-center font-semibold">{t("mandate.declined")}</p>
        ) : m.state === "confirmed" ? (
          <div role="status" className="glass space-y-3 rounded-3xl p-5 text-center">
            <p className="font-semibold">{t("mandate.used")}</p>
            {m.orderId && <Link href={`/orders/${m.orderId}`} className="text-gold underline">Open your order</Link>}
          </div>
        ) : closed ? (
          <p role="status" className="glass rounded-3xl p-5 text-center font-semibold">{expired ? t("mandate.expired") : t("mandate.declined")}</p>
        ) : !me ? (
          <div className="space-y-3">
            <Button className="w-full" onClick={() => router.push(`/signin?next=${encodeURIComponent(`/confirm/${token}`)}`)}>{t("mandate.signIn")}</Button>
            <button type="button" onClick={decline} className="mx-auto block min-h-11 px-4 text-sm text-mut underline">{t("mandate.decline")}</button>
          </div>
        ) : (
          <section aria-label="Confirm" className="space-y-4">
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Delivery</legend>
              <div className="flex flex-wrap gap-2">
                <Chip active={delivery === "PICKUP"} onClick={() => setDelivery("PICKUP")}><Icon name="store" className="size-4" /> Pickup in {m.maker.sector} · free</Chip>
                <Chip active={delivery === "DELIVERY"} onClick={() => setDelivery("DELIVERY")}><Icon name="moto" className="size-4" /> Delivery · +{rwf(m.deliveryFeeRwf)}</Chip>
              </div>
            </fieldset>
            {delivery === "DELIVERY" && (
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address (e.g. KG 7 Ave, Kacyiru)" aria-label="Delivery address" className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
            )}
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-mut">Pay with</legend>
              <div className="flex flex-wrap gap-2">
                <Chip active={wallet === "MTN_MOMO"} onClick={() => setWallet("MTN_MOMO")}><span aria-hidden className="size-2.5 rounded-full bg-[#ffcc00]" /> MTN MoMo · {me.phone.slice(-4).padStart(8, "•")}</Chip>
                <Chip active={wallet === "AIRTEL_MONEY"} onClick={() => setWallet("AIRTEL_MONEY")}><span aria-hidden className="size-2.5 rounded-full bg-[#e40000]" /> Airtel Money</Chip>
              </div>
            </fieldset>
            <ErrorNote error={error} />
            <div className="flex flex-col items-center gap-2 pt-1">
              <button
                type="button"
                aria-label={`${t("mandate.hold")}: ${rwf(total)} to ${m.paidTo}`}
                onPointerDown={begin}
                onPointerUp={cancel}
                onPointerLeave={cancel}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) begin(); }}
                onKeyUp={cancel}
                onContextMenu={(e) => e.preventDefault()}
                disabled={needsAddress}
                className="relative grid size-36 select-none place-items-center rounded-full touch-none disabled:opacity-50"
              >
                <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
                  <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,.15)" strokeWidth="8" fill="none" />
                  <circle cx="60" cy="60" r={r} stroke="#F2B84B" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
                </svg>
                <span className="grad-cta grid size-28 place-items-center rounded-full px-2 text-center font-display text-base font-black leading-tight motion-safe:transition-transform" style={{ transform: `scale(${1 - progress * 0.06})` }}>
                  {busy ? <Spinner /> : <><Icon name="hand" className="mx-auto size-6" />{t("mandate.hold")}</>}
                </span>
              </button>
              <p className="text-center text-xs text-mut">Press and hold 1 second · then approve {rwf(total)} with your PIN</p>
              {needsAddress && <p className="text-xs text-gold">Add a delivery address to continue</p>}
            </div>
            <button type="button" onClick={decline} className="mx-auto block min-h-11 px-4 text-sm text-mut underline">{t("mandate.decline")}</button>
          </section>
        )}
      </main>
    </Screen>
  );
}
