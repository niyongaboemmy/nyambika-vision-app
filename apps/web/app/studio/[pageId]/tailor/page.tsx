"use client";

import Link from "next/link";
import { useState } from "react";
import { Empty } from "@/components/studio";
import { Bento, DeskNav, StatusChip } from "@/components/tailor-studio";
import { rwf } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { CO_TAILOR_LABEL, kigaliTime, specChips, type CustomOrderView } from "@/lib/tailor";
import { useManagedPage } from "../layout";

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "open", label: "To do", match: (s) => ["REQUESTED", "DEPOSIT_PAID", "CUTTING", "SEWING", "FITTING", "FINISHING", "BALANCE_PAID"].includes(s) },
  { key: "waiting", label: "Waiting", match: (s) => ["QUOTED", "DEPOSIT_PENDING", "READY", "BALANCE_PENDING"].includes(s) },
  { key: "done", label: "Done", match: (s) => ["DELIVERED", "DECLINED", "CANCELLED"].includes(s) },
  { key: "all", label: "All", match: () => true },
];

/** Custom-orders inbox (E24 studio): image-first cards with clear status chips. */
export default function TailorDesk() {
  const { page } = useManagedPage();
  const { data } = useApi<CustomOrderView[]>(`/pages/${page.id}/custom-orders`);
  const [filter, setFilter] = useState("open");
  const f = FILTERS.find((x) => x.key === filter)!;
  const rows = (data ?? []).filter((o) => f.match(o.status));
  const newCount = data?.filter((o) => o.status === "REQUESTED").length ?? 0;
  const making = data?.filter((o) => ["DEPOSIT_PAID", "CUTTING", "SEWING", "FITTING", "FINISHING"].includes(o.status)).length ?? 0;
  const deposits = data?.flatMap((o) => o.payments).filter((p) => p.status === "SUCCESSFUL").reduce((s, p) => s + p.amountRwf, 0) ?? 0;
  const fittings = data?.filter((o) => o.fitting && new Date(o.fitting.startsAt).getTime() > Date.now()).length ?? 0;

  return (
    <div>
      <DeskNav pageId={page.id} />
      <div className="grid grid-cols-2 gap-3">
        <Bento label="New requests" value={newCount} hint={newCount ? "Quote today" : "All answered"} accent="bg-gradient-to-br from-amber-200 to-orange-200 text-stone-900" />
        <Bento label="On the table" value={making} hint="Cutting → finishing" />
        <Bento label="Fittings booked" value={fittings} hint="Upcoming" />
        <Bento label="Paid to you" value={<span className="text-xl">{rwf(deposits)}</span>} hint="Via MoMo" accent="bg-stone-900 text-white" />
      </div>

      <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Filter">
        {FILTERS.map((x) => {
          const on = x.key === filter;
          const n = data?.filter((o) => x.match(o.status)).length;
          return (
            <button key={x.key} role="tab" aria-selected={on} onClick={() => setFilter(x.key)} className={`st-press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ${on ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-300"}`}>
              {x.label}
              {n !== undefined && <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${on ? "bg-white/20" : "bg-stone-100"}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {!data && [0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-3xl bg-stone-200" />)}
        {data && rows.length === 0 && <Empty icon="scissors" title={filter === "open" ? "Nothing to do" : "No orders here"}>{filter === "open" ? "New requests land here and on WhatsApp." : null}</Empty>}
        {rows.map((o) => (
          <Link key={o.id} href={`/studio/${page.id}/tailor/${o.id}`} className="group flex gap-3 rounded-3xl bg-white p-3 ring-1 ring-stone-200 transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-900">
            <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-2xl bg-stone-100">
              {o.image || o.productImage ? <img loading="lazy" decoding="async" src={o.image ?? o.productImage!} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-3xl" aria-hidden>✂️</span>}
              {o.spec.hue !== null && <span className="absolute bottom-1.5 left-1.5 size-5 rounded-full ring-2 ring-white" style={{ background: `hsl(${o.spec.hue} 72% 50%)` }} aria-label={`Custom colour ${o.spec.hue}°`} />}
              {o.image && <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">AI preview</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-bold">{o.title}</p>
              </div>
              <p className="text-sm text-stone-600">{o.buyer?.name ?? o.buyer?.phone} · {o.code}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {specChips(o.spec).map((c) => <span key={c} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700">{c}</span>)}
                {o.size && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700">Size {o.size}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusChip status={o.status} label={CO_TAILOR_LABEL[o.status] ?? o.status} />
                <span className="text-sm font-semibold">{o.quote ? rwf(o.quote.priceRwf) : `~${rwf(o.estimateRwf)}`}</span>
              </div>
              {o.fitting && <p className="mt-1 text-xs text-stone-600">📅 {kigaliTime(o.fitting.startsAt, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
