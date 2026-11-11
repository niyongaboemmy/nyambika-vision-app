"use client";

import { depositSplit, PROGRESS_STEPS, type Measurements } from "@nyambika/contracts";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { garmentForCategory, PatternPreview3D } from "@/components/drape-spike";
import { Card, Field, Input, Note, SButton, Textarea } from "@/components/studio";
import { DeskNav, StatusChip } from "@/components/tailor-studio";
import { api, ApiError, rwf } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { CO_TAILOR_LABEL, JOURNEY, journeyIndex, kigaliTime, MEASUREMENT_LABEL, specChips, type CustomOrderView } from "@/lib/tailor";
import { useManagedPage } from "../../layout";

const STEP_LABEL: Record<string, string> = { CUTTING: "✂️ Cutting", SEWING: "🧵 Sewing", FITTING: "👗 Fitting", FINISHING: "✨ Finishing", READY: "✅ Ready" };

/** One custom order, tailor side: quote composer, measurements (only while shared), progress, delivery. */
export default function TailorOrder() {
  const { orderId } = useParams<{ orderId: string }>();
  const { page } = useManagedPage();
  const { data: o, setData, error } = useApi<CustomOrderView>(`/custom-orders/${orderId}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(path: string, json: object = {}) {
    setBusy(true);
    setErr(null);
    try {
      setData(await api<CustomOrderView>(`/custom-orders/${orderId}/${path}`, { method: "POST", json }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Note error={error} />;
  if (!o) return <div className="h-64 animate-pulse rounded-3xl bg-stone-200" />;
  const step = journeyIndex(o.status);
  const progressFrom = ["DEPOSIT_PAID", ...PROGRESS_STEPS] as string[];
  const canStep = progressFrom.includes(o.status) && o.status !== "READY";

  return (
    <div className="space-y-4 pb-28">
      <DeskNav pageId={page.id} />
      <Link href={`/studio/${page.id}/tailor`} className="text-sm font-semibold text-stone-600">← All custom orders</Link>

      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <figure className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-3xl bg-stone-900 sm:max-w-none">
          {o.image ? (
            <img src={o.image} alt={`${o.title}, customer's AI preview`} className="aspect-[9/16] w-full object-contain" />
          ) : o.productImage ? (
            <img src={o.productImage} alt={o.title} className="aspect-[4/5] w-full object-cover" />
          ) : (
            <div className="grid aspect-[4/5] place-items-center text-5xl" aria-hidden>✂️</div>
          )}
          <figcaption className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
            {o.image ? "Customer's AI preview (shared copy)" : o.previewShared ? "Preview" : "Your product photo · preview not shared"}
          </figcaption>
        </figure>

        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-2xl font-black leading-tight">{o.title}</h2>
              <p className="text-sm text-stone-600">{o.code} · {kigaliTime(o.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
            <StatusChip status={o.status} label={CO_TAILOR_LABEL[o.status] ?? o.status} />
          </div>
          <div className="flex gap-1" aria-hidden>
            {JOURNEY.map((s, i) => <span key={s} className={`h-2 flex-1 rounded-full ${i <= step ? "bg-stone-900" : "bg-stone-200"}`} />)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {specChips(o.spec, o.colour?.name).map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-semibold ring-1 ring-stone-300">
                {c.startsWith("Custom colour") && <span className="size-3.5 rounded-full" style={{ background: `hsl(${o.spec.hue} 72% 50%)` }} />}
                {c}
              </span>
            ))}
            {o.size && <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold ring-1 ring-stone-300">Usual size {o.size}</span>}
          </div>
          <Card className="space-y-1 text-sm">
            <p><b>{o.buyer?.name ?? "Customer"}</b> · <a className="underline" href={`tel:${o.buyer?.phone}`}>{o.buyer?.phone}</a></p>
            {o.note && <p className="text-stone-700">“{o.note}”</p>}
            <p className="text-stone-600">Estimate from your prices: <b>{rwf(o.estimateRwf)}</b></p>
            {o.fitting && <p>📅 Fitting <b>{kigaliTime(o.fitting.startsAt, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b> · {o.fitting.location}</p>}
          </Card>
        </div>
      </div>

      <MeasurementsCard order={o} />
      <PatternPreview3D orderId={o.id} shareActive={Boolean(o.measurementShare?.active)} defaultGarment={o.product ? garmentForCategory(o.product.category) : undefined} />

      {["REQUESTED", "QUOTED"].includes(o.status) && <QuoteComposer order={o} busy={busy} onSend={(q) => act("quote", q)} onDecline={() => act("decline", { note: "Sorry, I can't take this one" })} />}

      {o.quote && !["REQUESTED", "QUOTED"].includes(o.status) && (
        <Card className="grid grid-cols-3 gap-2 text-center text-sm">
          <div><p className="text-stone-500">Price</p><p className="text-lg font-black">{rwf(o.quote.priceRwf)}</p></div>
          <div><p className="text-stone-500">Deposit</p><p className="text-lg font-black">{rwf(o.quote.depositRwf)}</p><p className="text-xs">{o.payments.some((p) => p.stage === "DEPOSIT" && p.status === "SUCCESSFUL") ? "✅ paid" : "pending"}</p></div>
          <div><p className="text-stone-500">Balance</p><p className="text-lg font-black">{rwf(o.quote.balanceRwf)}</p><p className="text-xs">{o.payments.some((p) => p.stage === "BALANCE" && p.status === "SUCCESSFUL") ? "✅ paid" : o.quote.balanceRwf ? "at pickup" : "—"}</p></div>
        </Card>
      )}

      {canStep && (
        <Card className="space-y-3">
          <h3 className="font-bold">Update the customer</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PROGRESS_STEPS.map((s) => {
              const done = progressFrom.indexOf(o.status) >= progressFrom.indexOf(s);
              return (
                <SButton key={s} variant={done ? "ghost" : "outline"} disabled={busy || done} onClick={() => act("progress", { to: s })} className={`min-h-14 ${done ? "line-through opacity-60" : ""}`}>
                  {STEP_LABEL[s]}
                </SButton>
              );
            })}
          </div>
          <p className="text-xs text-stone-500">Each step sends a WhatsApp update. “Ready” asks the customer to pay the balance.</p>
        </Card>
      )}

      {(o.status === "BALANCE_PAID" || (o.status === "READY" && o.quote && !o.quote.balanceRwf)) && (
        <SButton className="min-h-14 w-full text-base" disabled={busy} onClick={() => act("deliver")}>📦 Mark as delivered</SButton>
      )}
      {o.status === "READY" && o.quote?.balanceRwf ? <Note ok={`Waiting for the customer to pay the balance (${rwf(o.quote.balanceRwf)}).`} /> : null}
      <Note error={err} />

      <Card>
        <h3 className="mb-2 font-bold">Timeline</h3>
        <ol className="space-y-2 border-l-2 border-stone-200 pl-4">
          {o.events.slice().reverse().map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className={`absolute -left-[23px] top-1.5 size-3 rounded-full ${i === 0 ? "bg-stone-900" : "bg-stone-300"}`} />
              <p className="font-semibold">{CO_TAILOR_LABEL[e.status] ?? e.status.replace(/_/g, " ").toLowerCase()}</p>
              {e.note && <p className="text-stone-600">{e.note}</p>}
              <p className="text-xs text-stone-500">{kigaliTime(e.at, { dateStyle: "medium", timeStyle: "short" })}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function QuoteComposer({ order, busy, onSend, onDecline }: { order: CustomOrderView; busy: boolean; onSend: (q: object) => void; onDecline: () => void }) {
  const [price, setPrice] = useState(String(order.quote?.priceRwf ?? Math.round(order.estimateRwf / 500) * 500));
  const [pct, setPct] = useState(order.quote?.depositPct ?? 50);
  const [days, setDays] = useState(order.quote?.leadTimeDays ?? 7);
  const [note, setNote] = useState(order.quote?.note ?? "");
  const n = Number(price) || 0;
  const split = depositSplit(n, pct);
  return (
    <Card className="space-y-4 ring-2 ring-amber-300">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-black">{order.quote ? "Update your quote" : "Send a quote"}</h3>
        {order.quote && <span className="text-xs text-stone-500">sent {kigaliTime(order.quote.at, { day: "numeric", month: "short" })}</span>}
      </div>
      <button type="button" onClick={() => setPrice(String(Math.round(order.estimateRwf / 500) * 500))} className="w-full rounded-2xl bg-amber-50 p-3 text-left text-sm ring-1 ring-amber-200">
        ✨ <b>Suggested {rwf(Math.round(order.estimateRwf / 500) * 500)}</b>: your base price plus the morph options you set. Tap to use it.
      </button>
      <Field label="Price (RWF)">
        <Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} className="text-2xl font-black" />
      </Field>
      <Field label="Deposit" group>
        <div className="grid grid-cols-4 gap-2">
          {[30, 50, 70, 100].map((p) => (
            <button key={p} type="button" aria-pressed={pct === p} onClick={() => setPct(p)} className={`min-h-12 rounded-xl text-sm font-bold ${pct === p ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-300"}`}>{p}%</button>
          ))}
        </div>
        <span className="block text-sm text-stone-600">Deposit now {rwf(split.depositRwf)} · balance at pickup {rwf(split.balanceRwf)}</span>
      </Field>
      <Field label="Ready in" group>
        <div className="flex items-center gap-3">
          <button type="button" aria-label="Fewer days" onClick={() => setDays(Math.max(1, days - 1))} className="size-12 rounded-xl bg-white text-xl font-bold ring-1 ring-stone-300">−</button>
          <span className="min-w-20 text-center text-xl font-black" aria-live="polite">{days} days</span>
          <button type="button" aria-label="More days" onClick={() => setDays(Math.min(120, days + 1))} className="size-12 rounded-xl bg-white text-xl font-bold ring-1 ring-stone-300">+</button>
        </div>
      </Field>
      <Field label="Note for the customer (optional)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Fully lined bodice, one fitting included" className="min-h-16" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SButton className="min-h-12 flex-1" disabled={busy || n < 1000} onClick={() => onSend({ priceRwf: n, depositPct: pct, leadTimeDays: days, note })}>{order.quote ? "Update quote" : `Send quote · ${rwf(n)}`}</SButton>
        <SButton variant="ghost" disabled={busy} onClick={onDecline}>Decline</SButton>
      </div>
    </Card>
  );
}

/** Measurements are fetched (and audit-logged) only on demand, and only while the share is active. */
function MeasurementsCard({ order }: { order: CustomOrderView }) {
  const [m, setM] = useState<{ measurements: Measurements; expiresAt: string } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "denied">("idle");
  const active = order.measurementShare?.active;
  useEffect(() => {
    setM(null);
    setState("idle");
  }, [order.id, active]);
  async function open() {
    setState("loading");
    try {
      setM(await api(`/custom-orders/${order.id}/measurements`));
      setState("idle");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 403 ? "denied" : "idle");
    }
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">📏 Measurements</h3>
        {order.measurementShare && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${active ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700"}`}>
            {active ? `shared until ${kigaliTime(order.measurementShare.expiresAt, { day: "numeric", month: "short" })}` : "share ended"}
          </span>
        )}
      </div>
      {!order.measurementShare && <p className="text-sm text-stone-600">The customer didn't share measurements. Ask them to share, or take them at the fitting.</p>}
      {active && !m && <SButton variant="outline" onClick={open} disabled={state === "loading"}>{state === "loading" ? "Opening…" : "View measurements"}</SButton>}
      {state === "denied" && <Note error="The share has ended. Measurements are no longer visible." />}
      {m && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(m.measurements).map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
              <p className="text-xs font-semibold text-stone-500">{MEASUREMENT_LABEL[k]?.label ?? k}</p>
              <p className="text-2xl font-black">{v}<span className="text-sm font-semibold text-stone-500"> cm</span></p>
            </div>
          ))}
        </div>
      )}
      {active && <p className="text-xs text-stone-500">Each view is logged. Visible only while the customer's share is active and only for this order.</p>}
    </Card>
  );
}
