"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Chip, ErrorNote, Screen, Spinner, TopBar } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { CO_LABEL, JOURNEY, journeyIndex, kigaliTime, specChips, type CustomOrderView } from "@/lib/tailor";

const PENDING = ["DEPOSIT_PENDING", "BALANCE_PENDING"];

/** Shopper side of a custom order (E24): quote → deposit → fitting → progress → balance → delivered. */
function CustomOrder() {
  const { id } = useParams<{ id: string }>();
  const fresh = useSearchParams().get("fresh") === "1";
  const { data: o, setData, error, reload } = useApi<CustomOrderView>(`/custom-orders/${id}`);
  const [wallet, setWallet] = useState<"MTN_MOMO" | "AIRTEL_MONEY">("MTN_MOMO");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live while waiting for the tailor or for a PIN.
  useEffect(() => {
    if (!o || ["DELIVERED", "DECLINED", "CANCELLED"].includes(o.status)) return;
    const tm = setTimeout(() => void reload(), PENDING.includes(o.status) ? 1500 : 5000);
    return () => clearTimeout(tm);
  }, [o, reload]);

  async function act(path: string, json: object = {}) {
    setBusy(true);
    setErr(null);
    try {
      setData(await api<CustomOrderView>(`/custom-orders/${id}/${path}`, { method: "POST", json }));
      navigator.vibrate?.(12);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Screen><div className="p-6 pt-20"><ErrorNote error={error} /></div></Screen>;
  if (!o) return <Screen><div className="space-y-3 p-4 pt-20"><div className="h-40 rounded-3xl skeleton" /><div className="h-24 rounded-3xl skeleton" /></div></Screen>;

  const step = journeyIndex(o.status);
  const first = o.page.name.split(" ")[0];
  const pendingPay = o.payments.at(-1)?.status === "PENDING" && PENDING.includes(o.status) ? o.payments.at(-1)! : null;
  return (
    <Screen>
      <TopBar back="/custom" title={o.code} />
      <main className="space-y-4 px-4 pb-12">
        {fresh && o.status === "REQUESTED" && (
          <section className="flex animate-rise flex-col items-center gap-1.5 rounded-3xl bg-gradient-to-br from-violet/30 to-terra/25 p-5 text-center">
            <span className="text-4xl">🪡</span>
            <p className="font-display text-2xl font-black">Sent to {o.page.name}</p>
            <p className="text-sm text-txt/85">Price, deposit and date soon · on WhatsApp</p>
          </section>
        )}

        <section className="relative overflow-hidden rounded-3xl bg-ink-3">
          <div className="flex gap-3 p-3">
            {o.image || o.productImage ? (
              <img src={o.image ?? o.productImage!} alt={o.image ? `${o.title}, AI preview` : o.title} className="h-36 w-28 shrink-0 rounded-2xl bg-black/40 object-cover" />
            ) : (
              <div className="grid h-36 w-28 place-items-center rounded-2xl bg-white/10 text-4xl" aria-hidden>✂️</div>
            )}
            <div className="min-w-0 flex-1 py-1">
              <p className="font-display text-xl font-black leading-tight">{o.title}</p>
              <Link href={`/m/${o.page.handle}`} className="text-sm text-gold">{o.page.name} →</Link>
              <div className="mt-2 flex flex-wrap gap-1">
                {specChips(o.spec, o.colour?.name).map((c) => <span key={c} className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold">{c}</span>)}
                {o.size && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold">Size {o.size}</span>}
              </div>
              {o.image && <p className="mt-2 text-[11px] text-mut">✨ AI preview · {o.previewShared ? "a copy was shared with the tailor" : "only you see it"}</p>}
            </div>
          </div>
        </section>

        <section className="glass rounded-3xl p-4" aria-label="Progress">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-lg font-black">{CO_LABEL[o.status] ?? o.status}</p>
            {o.quote && step >= 2 && step < JOURNEY.length - 1 && o.readyBy && <span className="text-xs text-mut">ready {kigaliTime(o.readyBy, { weekday: "short", day: "numeric", month: "short" })}</span>}
          </div>
          <div className="mt-3 flex gap-1" aria-hidden>
            {JOURNEY.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${i <= step ? "bg-gradient-to-r from-terra to-gold" : "bg-white/15"}`} />)}
          </div>
        </section>

        {pendingPay && (
          <section className="glass flex flex-col items-center gap-2 rounded-3xl p-5 text-center" role="status">
            <span className="text-4xl">📲</span>
            <p className="font-display text-lg font-black">Approve {rwf(pendingPay.amountRwf)} on your phone</p>
            <p className="text-sm text-mut">Paid directly to <b className="text-white">{o.page.name}</b></p>
            <Spinner />
            {process.env.NODE_ENV !== "production" && <Link href="/dev/handset" target="_blank" className="text-xs text-gold underline">Open simulated handset (dev)</Link>}
          </section>
        )}

        {o.status === "REQUESTED" && (
          <section className="glass rounded-3xl p-4 text-sm">
            <p>Your estimate: <b>{rwf(o.estimateRwf)}</b>. {first} usually replies the same day.</p>
            <Button variant="ghost" className="mt-1 -ml-2" disabled={busy} onClick={() => act("cancel")}>Cancel request</Button>
          </section>
        )}

        {o.quote && o.status === "QUOTED" && (
          <section className="animate-rise rounded-3xl border border-gold/40 bg-gold/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gold">Quote from {first}</p>
            <p className="mt-1 font-display text-3xl font-black">{rwf(o.quote.priceRwf)}</p>
            <p className="text-sm text-txt/85">Ready {o.quote.leadTimeDays} days after deposit{o.quote.note ? ` · “${o.quote.note}”` : ""}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-2xl bg-black/30 p-3"><p className="text-mut">Deposit now ({o.quote.depositPct}%)</p><p className="font-bold">{rwf(o.quote.depositRwf)}</p></div>
              <div className="rounded-2xl bg-black/30 p-3"><p className="text-mut">Balance when ready</p><p className="font-bold">{rwf(o.quote.balanceRwf)}</p></div>
            </div>
            <Wallets wallet={wallet} setWallet={setWallet} />
            <Button className="mt-3 w-full" disabled={busy} onClick={() => act("accept", { wallet })}>Accept & pay deposit {rwf(o.quote.depositRwf)}</Button>
            <button className="mt-2 w-full text-center text-sm text-mut underline" disabled={busy} onClick={() => act("cancel")}>Not now, cancel</button>
          </section>
        )}

        {o.status === "READY" && o.quote && o.quote.balanceRwf > 0 && (
          <section className="animate-rise rounded-3xl bg-gradient-to-br from-mint/25 to-violet/20 p-4">
            <p className="font-display text-xl font-black">Your piece is ready ✨</p>
            <p className="text-sm text-txt/85">Pay the balance · collect{o.page.sector ? ` in ${o.page.sector}` : ""}</p>
            <Wallets wallet={wallet} setWallet={setWallet} />
            <Button className="mt-3 w-full" disabled={busy} onClick={() => act("pay-balance", { wallet })}>Pay balance {rwf(o.quote.balanceRwf)}</Button>
          </section>
        )}

        {["DEPOSIT_PAID", "CUTTING", "SEWING", "FITTING", "FINISHING"].includes(o.status) && <Fitting order={o} onBooked={setData} />}
        {o.fitting && !["DEPOSIT_PAID", "CUTTING", "SEWING", "FITTING", "FINISHING"].includes(o.status) && (
          <p className="glass rounded-2xl px-4 py-3 text-sm">📅 Fitting {kigaliTime(o.fitting.startsAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {o.fitting.location}</p>
        )}

        {o.measurementShare && (
          <section className="glass flex items-center gap-3 rounded-3xl p-4 text-sm">
            <span className="text-2xl" aria-hidden>📏</span>
            <div className="min-w-0 flex-1">
              {o.measurementShare.active ? (
                <p>Measurements shared with {first} until <b>{kigaliTime(o.measurementShare.expiresAt, { day: "numeric", month: "short" })}</b></p>
              ) : (
                <p className="text-mut">Sharing ended{o.measurementShare.revokedAt ? "" : " (expired)"}</p>
              )}
            </div>
            {o.measurementShare.active && (
              <button disabled={busy} className="min-h-11 shrink-0 rounded-xl border border-white/20 px-3 font-semibold" onClick={async () => { await api(`/measurements/shares/${o.measurementShare!.id}/revoke`, { method: "POST" }); await reload(); }}>Stop sharing</button>
            )}
          </section>
        )}

        <ErrorNote error={err} />

        <section className="glass rounded-3xl p-4">
          <p className="mb-3 text-sm font-semibold">Updates</p>
          <ol className="space-y-3 border-l border-white/15 pl-4">
            {o.events.slice().reverse().map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[21px] top-1 size-2.5 rounded-full ${i === 0 ? "bg-gold shadow-[0_0_10px_#f2b84b]" : "bg-white/40"}`} />
                <p className="text-sm font-semibold">{CO_LABEL[e.status] ?? e.status.replace(/_/g, " ").toLowerCase()}</p>
                {e.note && <p className="text-xs text-mut">{e.note}</p>}
                <p className="text-[11px] text-mut">{kigaliTime(e.at, { dateStyle: "medium", timeStyle: "short" })}</p>
              </li>
            ))}
          </ol>
        </section>

        <a href={`https://wa.me/${o.page.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Muraho! About my custom order ${o.code}`)}`} target="_blank" rel="noreferrer" className="glass flex min-h-12 items-center justify-center rounded-2xl font-semibold">💬 Message {first}</a>
      </main>
    </Screen>
  );
}

function Wallets({ wallet, setWallet }: { wallet: string; setWallet: (w: "MTN_MOMO" | "AIRTEL_MONEY") => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Pay with">
      <Chip active={wallet === "MTN_MOMO"} onClick={() => setWallet("MTN_MOMO")}>🟡 MTN MoMo</Chip>
      <Chip active={wallet === "AIRTEL_MONEY"} onClick={() => setWallet("AIRTEL_MONEY")}>🔴 Airtel Money</Chip>
    </div>
  );
}

interface Slot { id: string; startsAt: string; durationMin: number; location: string; mine: boolean }

/** Fitting booking: day pills → time chips (FR-SIZE-07). */
function Fitting({ order, onBooked }: { order: CustomOrderView; onBooked: (o: CustomOrderView) => void }) {
  const { data: slots, reload } = useApi<Slot[]>(`/custom-orders/${order.id}/slots`);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const days = [...new Set((slots ?? []).map((s) => kigaliTime(s.startsAt, { year: "numeric", month: "2-digit", day: "2-digit" })))];
  const active = day ?? days[0] ?? null;
  async function book(slotId: string) {
    setBusy(true);
    setErr(null);
    try {
      onBooked(await api<CustomOrderView>(`/custom-orders/${order.id}/book`, { method: "POST", json: { slotId } }));
      navigator.vibrate?.([10, 30, 10]);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass rounded-3xl p-4">
      <p className="font-display text-lg font-black">📅 {order.fitting ? "Your fitting" : "Book a fitting"}</p>
      {order.fitting && (
        <p className="mt-1 text-sm">
          <b>{kigaliTime(order.fitting.startsAt, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b> · {order.fitting.location} · {order.fitting.durationMin} min
        </p>
      )}
      {!slots ? (
        <div className="mt-3 h-20 rounded-2xl skeleton" />
      ) : slots.length === 0 ? (
        <p className="mt-2 text-sm text-mut">No open times yet</p>
      ) : (
        <>
          <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1" role="tablist" aria-label="Day">
            {days.map((d) => {
              const s = slots.find((x) => kigaliTime(x.startsAt, { year: "numeric", month: "2-digit", day: "2-digit" }) === d)!;
              return (
                <button key={d} role="tab" aria-selected={d === active} onClick={() => setDay(d)} className={`flex min-w-16 shrink-0 flex-col items-center rounded-2xl px-3 py-2 ${d === active ? "grad-cta text-white" : "bg-white/10"}`}>
                  <span className="text-[11px] uppercase tracking-wide">{kigaliTime(s.startsAt, { weekday: "short" })}</span>
                  <span className="font-display text-lg font-black">{kigaliTime(s.startsAt, { day: "numeric" })}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {slots.filter((s) => kigaliTime(s.startsAt, { year: "numeric", month: "2-digit", day: "2-digit" }) === active).map((s) => (
              <Chip key={s.id} active={s.mine} onClick={() => !busy && !s.mine && book(s.id)}>
                {kigaliTime(s.startsAt, { hour: "2-digit", minute: "2-digit" })}{s.mine ? " ✓" : ""}
              </Chip>
            ))}
          </div>
        </>
      )}
      <ErrorNote error={err} />
      <p className="mt-2 text-xs text-mut">📲 WhatsApp reminder the day before</p>
    </section>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CustomOrder />
    </Suspense>
  );
}
