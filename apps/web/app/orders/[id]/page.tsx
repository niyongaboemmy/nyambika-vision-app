"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Chip, ErrorNote, Screen, Spinner, TopBar } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { ORDER_LABEL, type OrderView } from "@/lib/orders";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

/** Order: MoMo approval → “Paid ✓ directly to the maker” → ambient timeline (prototype v2 · 15/16/17). */
function Order() {
  const { id } = useParams<{ id: string }>();
  const fresh = useSearchParams().get("fresh") === "1";
  const { t } = useSession();
  const { data: o, setData, error } = useApi<OrderView>(`/orders/${id}`);

  useEffect(() => {
    if (!o || o.status !== "AWAITING_PAYMENT") return;
    const tm = setTimeout(async () => setData(await api<OrderView>(`/orders/${id}`)), 1500);
    return () => clearTimeout(tm);
  }, [o, id, setData]);

  if (error) return <Screen><div className="p-6 pt-20"><ErrorNote error={error} /></div></Screen>;
  if (!o) return <Screen><div className="grid min-h-dvh place-items-center"><Spinner /></div></Screen>;

  const justPaid = fresh && o.status === "PAID";
  return (
    <Screen>
      <TopBar back="/orders" title={o.code} />
      <main className="space-y-4 px-4 pb-10">
        {o.status === "AWAITING_PAYMENT" && (
          <section className="glass flex flex-col items-center gap-3 rounded-3xl p-6 text-center" role="status">
            <span className="text-5xl">📲</span>
            <p className="font-display text-xl font-black">{t("buy.approve")}</p>
            <p className="text-sm text-mut">{rwf(o.totalRwf)} to <b className="text-white">{o.payoutLabel}</b> · {o.wallet === "MTN_MOMO" ? "MTN MoMo" : "Airtel Money"}</p>
            <Spinner />
            {process.env.NODE_ENV !== "production" && (
              <Link href="/dev/handset" target="_blank" className="text-xs text-gold underline">Open simulated handset (dev)</Link>
            )}
          </section>
        )}

        {justPaid && (
          <section className="flex animate-rise flex-col items-center gap-2 rounded-3xl bg-gradient-to-br from-mint/30 to-violet/20 p-6 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-mint text-4xl text-ink">✓</span>
            <p className="font-display text-3xl font-black">{t("buy.paid")}</p>
            <p className="text-sm">{t("buy.paidDirect")} <b>{o.payoutLabel}</b> · {rwf(o.totalRwf)}</p>
            <p className="text-xs text-mut">Nyambika never holds your money. The maker has your order on WhatsApp.</p>
          </section>
        )}

        <section className="glass flex gap-3 rounded-3xl p-3">
          {o.image && <img src={o.image} alt="" className="h-24 w-20 rounded-2xl object-cover" />}
          <div className="min-w-0 flex-1">
            {(o.items?.length ?? 0) > 1 ? (
              <ul className="space-y-0.5">{o.items!.map((i, n) => <li key={n}><span className="font-semibold">{i.qty} × {i.title}</span> <span className="text-sm text-mut">· {i.colourName} · {i.size}</span></li>)}</ul>
            ) : (
              <>
                <p className="font-semibold">{o.item.title}</p>
                <p className="text-sm text-mut">{o.item.colourName} · size {o.item.size}{o.item.makerName ? ` · made by ${o.item.makerName}` : ""}</p>
              </>
            )}
            <p className="text-sm">{rwf(o.totalRwf)} · {o.deliveryMode === "DELIVERY" ? `delivery to ${o.address}` : "pickup"}</p>
            <Link href={`/m/${o.page.handle}`} className="text-sm text-gold">{o.page.name} →</Link>
          </div>
        </section>

        {/* Ambient: live activity style tracker */}
        <section className="glass rounded-3xl p-4">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{ORDER_LABEL[o.status] ?? o.status}</p>
            {o.readyBy && !["CANCELLED", "DELIVERED", "COMPLETED"].includes(o.status) && (
              <span className="text-xs text-mut">ready by {new Date(o.readyBy).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
            )}
          </div>
          <Progress status={o.status} />
          <ol className="mt-4 space-y-3 border-l border-white/15 pl-4">
            {o.events.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-gold" />
                <p className="text-sm font-semibold">{ORDER_LABEL[e.status] ?? e.status}</p>
                {e.note && <p className="text-xs text-mut">{e.note}</p>}
                <p className="text-[11px] text-mut">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <a href={`https://wa.me/${o.page.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Muraho! About my order ${o.code}`)}`} target="_blank" rel="noreferrer" className="glass inline-flex min-h-12 items-center justify-center rounded-2xl font-semibold">💬 Message maker</a>
          {o.next.includes("COMPLETED") && (
            <Button onClick={async () => setData(await api(`/orders/${o.id}/transition`, { method: "POST", json: { to: "COMPLETED" } }))}>I received it</Button>
          )}
        </div>

        {["DELIVERED", "COMPLETED"].includes(o.status) && !o.review && <Review id={o.id} onDone={setData} />}
        {o.review && <p className="text-center text-sm text-mut">You rated {"★".repeat(o.review.rating)}</p>}
      </main>
    </Screen>
  );
}

const STEPS = ["PAID", "ACCEPTED", "IN_PREPARATION", "SHIPPED", "DELIVERED"];
function Progress({ status }: { status: string }) {
  const idx = status === "READY" ? 3 : status === "COMPLETED" ? 4 : STEPS.indexOf(status);
  return (
    <div className="mt-3 flex gap-1.5" aria-hidden>
      {STEPS.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-gradient-to-r from-terra to-gold" : "bg-white/15"}`} />)}
    </div>
  );
}

function Review({ id, onDone }: { id: string; onDone: (o: OrderView) => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  return (
    <form className="glass space-y-3 rounded-3xl p-4" onSubmit={async (e) => { e.preventDefault(); onDone(await api(`/orders/${id}/review`, { method: "POST", json: { rating, text } })); }}>
      <p className="font-semibold">How was it?</p>
      <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <Chip key={n} active={n <= rating} onClick={() => setRating(n)}>★</Chip>)}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Fit, fabric, service…" className="glass min-h-20 w-full rounded-2xl p-3 outline-none placeholder:text-white/40" />
      <Button className="w-full">Post review</Button>
    </form>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Order />
    </Suspense>
  );
}
