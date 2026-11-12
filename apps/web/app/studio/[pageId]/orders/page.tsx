"use client";

import { useMemo, useRef, useState } from "react";
import { MoreActions } from "@/components/ios";
import { Badge, Empty, Icon, Note, ScreenSkeleton, SButton, SectionTitle, StudioSheet, type IconName } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { ORDER_LABEL, type OrderView } from "@/lib/orders";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

const ACTION: Record<string, string> = {
  ACCEPTED: "Accept",
  DECLINED: "Decline",
  IN_PREPARATION: "Start making",
  READY: "Ready for pickup",
  SHIPPED: "Send out",
  DELIVERED: "Mark delivered",
  CANCELLED: "Cancel",
  RESOLVED: "Resolve",
};
const SECONDARY = ["DECLINED", "CANCELLED"];

const LANES: { key: string; title: string; hint: string; icon: IconName; statuses: string[]; accent: string }[] = [
  { key: "new", title: "Needs you", hint: "Paid, waiting for you to accept", icon: "inbox", statuses: ["PAID", "DISPUTED", "NEW", "AWAITING_PAYMENT"], accent: "bg-terra" },
  { key: "accepted", title: "Confirmed", hint: "Start making when ready", icon: "check", statuses: ["ACCEPTED"], accent: "bg-sky" },
  { key: "making", title: "Making", hint: "On your table", icon: "scissors", statuses: ["IN_PREPARATION"], accent: "bg-violet" },
  { key: "out", title: "Ready & on the way", hint: "Pickup or delivery", icon: "truck", statuses: ["READY", "SHIPPED"], accent: "bg-gold" },
  { key: "done", title: "Done", hint: "Delivered, completed or closed", icon: "sparkle", statuses: ["DELIVERED", "COMPLETED", "RESOLVED", "DECLINED", "CANCELLED"], accent: "bg-mint" },
];

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

/** Member order inbox as status lanes (FR-ORD-04/06/11): swipe on phones, columns on desktop. */
export default function Orders() {
  const { page, refreshBadges } = useManagedPage();
  const { data, reload, loading } = useApi<OrderView[]>(`/pages/${page.id}/orders`);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lanesRef = useRef<HTMLDivElement>(null);

  const lanes = useMemo(() => LANES.map((l) => ({ ...l, orders: (data ?? []).filter((o) => l.statuses.includes(o.status)) })), [data]);
  const current = data?.find((o) => o.id === open) ?? null;

  async function move(id: string, to: string) {
    setBusy(id + to);
    setErr(null);
    try {
      await api(`/orders/${id}/transition`, { method: "POST", json: { to } });
      navigator.vibrate?.(12);
      await Promise.all([reload(), refreshBadges?.()]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const actions = (o: OrderView, full?: boolean) => {
    const next = o.next.filter((n) => ACTION[n]);
    if (!next.length) return null;
    const primary = next.filter((n) => !SECONDARY.includes(n));
    const secondary = next.filter((n) => SECONDARY.includes(n));
    return (
      <div className={`flex items-center gap-2 ${full ? "" : "pt-1"}`}>
        {primary.map((n) => (
          <SButton key={n} disabled={busy === o.id + n} onClick={() => move(o.id, n)} className="flex-1 px-3">
            {ACTION[n]}
          </SButton>
        ))}
        {secondary.length > 0 && (
          <MoreActions
            label={`More actions for order ${o.code}`}
            title={`${o.item.title} · ${o.code}`}
            className="size-11 shrink-0 bg-white ring-1 ring-inset ring-hairline"
            actions={secondary.map((n) => ({ label: ACTION[n], icon: "x", destructive: true, disabled: busy === o.id + n, onSelect: () => move(o.id, n) }))}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Orders"
        eyebrow={data ? `${data.length} total` : undefined}
        action={
          <a href={`/api/pages/${page.id}/orders.csv`} className="st-press inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-3.5 text-sm font-bold text-cocoa ring-1 ring-inset ring-hairline hover:ring-cocoa-3">
            <Icon name="download" className="size-4" /> Export CSV
          </a>
        }
      />
      <Note error={err} />
      {loading && !data && <ScreenSkeleton variant="list" />}
      {data?.length === 0 && (
        <Empty icon="inbox" title="No orders yet">
          Paid orders land here and on WhatsApp
        </Empty>
      )}

      {data && data.length > 0 && (
        <>
          {/* Lane jump bar (phones) */}
          <div role="group" aria-label="Jump to lane" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 2xl:hidden">
            {lanes.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => lanesRef.current?.querySelector(`#lane-${l.key}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
                className="st-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-bold text-cocoa ring-1 ring-inset ring-hairline"
              >
                <span aria-hidden className={`size-2 rounded-full ${l.accent}`} />
                {l.title}
                <span className="rounded-full bg-paper-2 px-1.5 tabular-nums">{l.orders.length}</span>
              </button>
            ))}
          </div>

          <div ref={lanesRef} className="st-snap no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 lg:-mx-8 lg:px-8 2xl:mx-0 2xl:grid 2xl:grid-cols-5 2xl:overflow-visible 2xl:px-0">
            {lanes.map((l) => (
              <section key={l.key} id={`lane-${l.key}`} aria-labelledby={`lane-${l.key}-t`} className="flex w-[84%] max-w-[340px] shrink-0 flex-col gap-2.5 rounded-[26px] bg-paper-2/70 p-2.5 ring-1 ring-inset ring-hairline sm:w-[46%] lg:w-[290px] 2xl:w-auto 2xl:max-w-none">
                <header className="flex items-center gap-2 px-1.5 pt-1">
                  <span aria-hidden className={`grid size-7 place-items-center rounded-xl text-white ${l.accent}`}><Icon name={l.icon} className="size-4" /></span>
                  <h3 id={`lane-${l.key}-t`} className="min-w-0 flex-1 truncate text-sm font-extrabold text-cocoa">{l.title}</h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-black tabular-nums text-cocoa">{l.orders.length}</span>
                </header>
                {l.orders.length === 0 && <p className="rounded-2xl border border-dashed border-paper-3 px-3 py-6 text-center text-xs text-cocoa-2">{l.hint}</p>}
                {l.orders.map((o) => (
                  <article key={o.id} data-order-card className="st-card animate-pop space-y-2 rounded-[20px] p-3">
                    <button type="button" data-order-open onClick={() => setOpen(o.id)} className="flex w-full items-start gap-2.5 text-left">
                      <span className="sr-only">Open order {o.code}: </span>
                      {o.image ? <img loading="lazy" decoding="async" src={o.image} alt="" className="h-16 w-13 shrink-0 rounded-xl object-cover" /> : <span className="grid h-16 w-13 shrink-0 place-items-center rounded-xl bg-paper-2"><Icon name="hanger" className="size-5 text-cocoa-3" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold text-cocoa">{o.item.title}</span>
                        <span className="block truncate text-xs text-cocoa-2">{o.item.colourName} · {o.item.size} · {o.code}</span>
                        <span className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-sm font-black tabular-nums text-cocoa">{rwf(o.totalRwf)}</span>
                          <span className="text-[11px] font-semibold text-cocoa-2">{ago(o.createdAt)}</span>
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge value={o.status} label={ORDER_LABEL[o.status]} />
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-cocoa-2">
                        <Icon name={o.deliveryMode === "DELIVERY" ? "truck" : "store"} className="size-3.5" />
                        {o.deliveryMode === "DELIVERY" ? "Delivery" : "Pickup"}
                      </span>
                    </div>
                    {actions(o)}
                  </article>
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      <StudioSheet open={!!current} onClose={() => setOpen(null)} title={current ? `Order ${current.code}` : "Order"} footer={current ? actions(current, true) : undefined}>
        {current && (
          <div className="space-y-4">
            <div className="flex gap-3">
              {current.image && <img loading="lazy" decoding="async" src={current.image} alt="" className="h-28 w-22 rounded-2xl object-cover" />}
              <div className="min-w-0 space-y-1">
                <p className="font-display text-lg font-black leading-tight text-cocoa">{current.item.title}</p>
                <p className="text-sm text-cocoa-2">{current.item.colourName} · size {current.item.size}</p>
                <p className="text-lg font-black tabular-nums text-cocoa">{rwf(current.totalRwf)}</p>
                <Badge value={current.status} label={ORDER_LABEL[current.status]} />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-200">
              <Icon name="wallet" className="size-5 shrink-0 text-mint-ink" />
              <p className="text-sm text-mint-ink">
                <strong>Paid to {current.payoutLabel}</strong> · {current.payment?.status.toLowerCase() ?? "no payment yet"}
                {current.payment?.reconciled ? " · reconciled" : ""}
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-white p-3.5 text-sm ring-1 ring-inset ring-hairline">
              <dt className="font-semibold text-cocoa-2">Buyer</dt>
              <dd className="text-cocoa">{current.buyer?.name ?? "—"} · <a className="font-bold underline" href={`tel:${current.buyer?.phone}`}>{current.buyer?.phone}</a></dd>
              <dt className="font-semibold text-cocoa-2">{current.deliveryMode === "DELIVERY" ? "Deliver to" : "Pickup"}</dt>
              <dd className="text-cocoa">{current.deliveryMode === "DELIVERY" ? current.address : "At your place"}{current.deliveryFeeRwf ? ` · fee ${rwf(current.deliveryFeeRwf)}` : ""}</dd>
              {current.readyBy && (
                <>
                  <dt className="font-semibold text-cocoa-2">Ready by</dt>
                  <dd className="text-cocoa">{new Date(current.readyBy).toLocaleDateString()}</dd>
                </>
              )}
              {current.item.makerName && (
                <>
                  <dt className="font-semibold text-cocoa-2">Maker</dt>
                  <dd className="text-cocoa">{current.item.makerName}</dd>
                </>
              )}
            </dl>
            {current.events.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-extrabold text-cocoa">Timeline</p>
                <ol className="relative space-y-3 border-l-2 border-hairline pl-4">
                  {[...current.events].reverse().map((e, i) => (
                    <li key={i} className="relative">
                      <span aria-hidden className={`absolute -left-[23px] top-1 size-3 rounded-full ring-4 ring-paper ${i === 0 ? "bg-terra" : "bg-paper-3"}`} />
                      <p className="text-sm font-bold text-cocoa">{ORDER_LABEL[e.status] ?? e.status}</p>
                      <p className="text-xs text-cocoa-2">{new Date(e.at).toLocaleString()}{e.note ? ` · ${e.note}` : ""}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {current.review && (
              <p className="rounded-2xl bg-amber-50 p-3 text-sm text-gold-ink ring-1 ring-inset ring-amber-200">
                <span className="mr-1 inline-flex align-[-2px]" role="img" aria-label={`${current.review.rating} of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <Icon key={n} name="star" filled={n <= current.review!.rating} className="size-4" />)}</span> “{current.review.text}”
              </p>
            )}
          </div>
        )}
      </StudioSheet>
    </div>
  );
}
