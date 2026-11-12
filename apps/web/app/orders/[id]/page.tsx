"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AmbientOrder } from "@/components/ambient-order";
import { LimitState } from "@/components/limit-state";
import { PushAsk } from "@/components/push-ask";
import { Button, Chip, ErrorNote, Screen, Spinner, TopBar } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { haptic } from "@/lib/native";
import { ORDER_LABEL, type OrderView } from "@/lib/orders";
import { useSession } from "@/lib/session";
import { OrderMoneyPanel, useOrderMoney } from "@/components/region-pay";
import { useApi } from "@/lib/use-api";
import { Icon } from "@/components/icons";

/** Order: MoMo approval → “Paid ✓ directly to the maker” → ambient timeline (prototype v2 · 15/16/17). */
function Order() {
  const { id } = useParams<{ id: string }>();
  const fresh = useSearchParams().get("fresh") === "1";
  const { t } = useSession();
  const router = useRouter();
  const [actionError, setActionError] = useState<unknown>(null);
  const { data: o, setData, error } = useApi<OrderView>(`/orders/${id}`);
  const money = useOrderMoney(id, o?.status); // E40/E41: charged currency + method (null for legacy RWF orders)
  const amount = money ? money.total : o ? rwf(o.totalRwf) : "";

  useEffect(() => {
    if (!o || o.status !== "AWAITING_PAYMENT") return;
    // Polling must never throw into the void (unhandled rejection): a failed poll just tries again next tick.
    const tm = setTimeout(() => void api<OrderView>(`/orders/${id}`).then(setData, () => setData({ ...o })), 1500);
    return () => clearTimeout(tm);
  }, [o, id, setData]);

  const paidNow = fresh && o?.status === "PAID";
  useEffect(() => {
    if (paidNow) haptic("success");
  }, [paidNow]);

  if (error) return <Screen><div className="p-6 pt-20"><ErrorNote error={error} /></div></Screen>;
  const paymentFailed = o?.status === "CANCELLED" && o.payment?.status === "FAILED";
  if (!o) return <Screen><div className="grid min-h-dvh place-items-center"><Spinner /></div></Screen>;

  const justPaid = fresh && o.status === "PAID";
  return (
    <Screen>
      <TopBar back="/orders" title={o.code} />
      <main className="space-y-4 px-4 pb-10">
        {o.status === "AWAITING_PAYMENT" && (
          <section className="glass flex flex-col items-center gap-3 rounded-3xl p-6 text-center" role="status">
            <span className="grid size-16 place-items-center rounded-2xl bg-white/10 text-gold" aria-hidden><Icon name="phone" className="size-8" /></span>
            <p className="font-display text-xl font-black">{t("buy.approve")}</p>
            <p className="text-sm text-mut">{amount} to <b className="text-white">{o.payoutLabel}</b> · {money ? money.methodLabel : o.wallet === "MTN_MOMO" ? "MTN MoMo" : "Airtel Money"}</p>
            <Spinner />
            {process.env.NODE_ENV !== "production" && (
              <Link href="/dev/handset" target="_blank" className="text-xs text-gold underline">Open simulated handset (dev)</Link>
            )}
          </section>
        )}
        {o.status === "AWAITING_PAYMENT" && <PushAsk moment="paid" />}

        {paymentFailed && (
          <LimitState error={{ status: 402, body: { code: "PAYMENT_FAILED" } }} onRetry={() => router.push(`/m/${o.page.handle}`)} />
        )}

        {justPaid && (
          <section className="flex animate-rise flex-col items-center gap-2 rounded-3xl bg-gradient-to-br from-mint/30 to-violet/20 p-6 text-center">
            <span className="grid size-20 place-items-center rounded-full bg-mint text-4xl text-ink">✓</span>
            <p className="font-display text-3xl font-black">{t("buy.paid")}</p>
            <p className="text-sm">{t("buy.paidDirect")} <b>{o.payoutLabel}</b> · {amount}</p>
            <p className="flex items-center gap-1.5 text-xs text-mut"><Icon name="chat" className="size-3.5" /> Maker notified on WhatsApp</p>
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
            <p className="text-sm font-semibold">{amount}</p>
            <p className="flex items-center gap-1 text-xs text-mut"><Icon name={o.deliveryMode === "DELIVERY" ? "moto" : "store"} className="size-3.5 shrink-0" /><span className="truncate">{o.deliveryMode === "DELIVERY" ? o.address : "Pickup"}</span></p>
            <Link href={`/m/${o.page.handle}`} className="hit mt-0.5 inline-block text-sm text-gold">{o.page.name} →</Link>
          </div>
        </section>

        <OrderMoneyPanel money={money} payee={o.payoutLabel} onChange={async () => setData(await api<OrderView>(`/orders/${id}`))} />

        {/* Ambient: the same state model as push, the iOS Live Activity and the Android Live Update (E38). */}
        {o.status !== "AWAITING_PAYMENT" && <AmbientOrder order={o} />}
        {["PAID", "ACCEPTED", "IN_PREPARATION"].includes(o.status) && <PushAsk moment="live" />}
        <section className="glass rounded-3xl p-4">
          <ol className="space-y-3 border-l border-white/15 pl-4">
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
          <a href={`https://wa.me/${o.page.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Muraho! About my order ${o.code}`)}`} target="_blank" rel="noreferrer" className="glass press inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl font-semibold"><Icon name="chat" className="size-5" /> Message maker</a>
          {o.next.includes("COMPLETED") && (
            <Button onClick={() => void api<OrderView>(`/orders/${o.id}/transition`, { method: "POST", json: { to: "COMPLETED" } }).then(setData, setActionError)}>I received it</Button>
          )}
        </div>

        <ErrorNote error={actionError} />
        {["DELIVERED", "COMPLETED"].includes(o.status) && !o.review && <Review id={o.id} onDone={setData} />}
        {o.review && <p className="text-center text-sm text-mut">You rated {"★".repeat(o.review.rating)}</p>}
      </main>
    </Screen>
  );
}

function Review({ id, onDone }: { id: string; onDone: (o: OrderView) => void }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [err, setErr] = useState<unknown>(null);
  return (
    <form className="glass space-y-3 rounded-3xl p-4" onSubmit={(e) => { e.preventDefault(); setErr(null); void api<OrderView>(`/orders/${id}/review`, { method: "POST", json: { rating, text } }).then(onDone, setErr); }}>
      <p className="font-semibold">How was it?</p>
      <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <Chip key={n} active={n <= rating} onClick={() => setRating(n)}>★</Chip>)}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Fit, fabric, service…" className="glass min-h-20 w-full rounded-2xl p-3 outline-none placeholder:text-white/40" />
      <ErrorNote error={err} />
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
