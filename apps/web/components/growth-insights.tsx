"use client";

import Link from "next/link";
import { useState } from "react";
import { Fact, InfoTip } from "@/components/kit";
import { Icon, Skeleton } from "@/components/studio";
import { rwf } from "@/lib/api";
import { SOURCE_LABEL, type Insights, type Suggestion } from "@/lib/growth";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const TONE: Record<Suggestion["tone"], string> = {
  violet: "from-violet-100 to-white text-violet-ink",
  gold: "from-amber-100 to-white text-gold-ink",
  mint: "from-emerald-100 to-white text-mint-ink",
  sky: "from-sky-100 to-white text-sky-800",
};

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Long suggestion text: 3 lines, tap to expand (an animated disclosure instead of a wall of text). */
function SuggestionText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 80;
  if (!long) return <p className="mt-1.5 text-[15px] font-semibold leading-snug text-cocoa">{text}</p>;
  return (
    <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="st-press mt-1.5 block w-full text-left">
      <span className={`block text-[15px] font-semibold leading-snug text-cocoa ${open ? "" : "line-clamp-2"}`}>{text}</span>
      <span className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-bold opacity-80">
        {open ? "Less" : "More"} <Icon name="chevron" className={`size-3.5 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </span>
    </button>
  );
}

/** AI suggestions as swipeable cards (rule-based; rephrased by the LLM when enabled). */
export function SuggestionCards({ items, writer }: { items: Suggestion[]; writer: Insights["writer"] }) {
  return (
    <div>
      <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
        {items.map((s, i) => (
          <li key={s.key} className={`animate-rise min-w-[82%] snap-start rounded-[22px] bg-gradient-to-br p-4 ring-1 ring-inset ring-black/5 sm:min-w-0 ${TONE[s.tone]}`} style={{ animationDelay: `${i * 50}ms` }}>
            <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider"><Icon name="sparkle" className="size-3.5" /> Suggestion</p>
            <SuggestionText text={s.text} />
            {s.action && (
              <Link href={s.action.href} className="st-press mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-bold text-cocoa ring-1 ring-inset ring-hairline hover:ring-cocoa-3">
                {s.action.label} <Icon name="chevron" className="size-4" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Fact icon="sparkle">{writer === "llm" ? "Written by AI" : "From your numbers"}</Fact>
        <Fact icon="shield">Aggregates only</Fact>
        <InfoTip label="About suggestions">{writer === "llm" ? "Written by AI from your page's numbers (aggregates only)." : "Based on your page's numbers (aggregates only, never shopper photos)."}</InfoTip>
      </div>
    </div>
  );
}

/** Insights v2 (FR-ANL-01/03): traffic sources, try-on → sale by product, best posting times, AI suggestions. */
export function GrowthInsights({ pageId, compact = false }: { pageId: string; compact?: boolean }) {
  const { locale } = useSession();
  const { data: a } = useApi<Insights>(`/pages/${pageId}/insights?locale=${locale}`);
  if (!a)
    return (
      <div className="space-y-3">
        <Skeleton className="h-36" />
        {!compact && <Skeleton className="h-48" />}
      </div>
    );
  const maxSrc = Math.max(1, ...a.sources.map((s) => s.n));
  const maxHour = Math.max(1, ...a.hours);
  const top = a.hours
    .map((v, h) => ({ v, h }))
    .sort((x, y) => y.v - x.v)
    .filter((x) => x.v > 0)
    .slice(0, 2);
  return (
    <div className="space-y-4">
      <SuggestionCards items={compact ? a.suggestions.slice(0, 3) : a.suggestions} writer={a.writer} />
      <div className={`grid grid-cols-1 gap-3 ${compact ? "md:grid-cols-2" : "lg:grid-cols-2"}`}>
        <section aria-labelledby="src-title" className="st-card rounded-[22px] p-4">
          <h3 id="src-title" className="font-extrabold text-cocoa">Where visitors come from</h3>
          <p className="text-xs text-cocoa-2">{a.visits} Maker Space visits · last {a.periodDays} days</p>
          {a.sources.length === 0 ? (
            <p className="mt-3 text-sm text-cocoa-2">No visits yet. Share a story card on WhatsApp to open the first door.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {a.sources.slice(0, compact ? 4 : 8).map((s) => (
                <li key={s.source}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-bold text-cocoa">{SOURCE_LABEL[s.source] ?? s.source}</span>
                    <span className="shrink-0 tabular-nums text-cocoa-2">{s.n} · {Math.round(s.share * 100)}%</span>
                  </div>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-paper-2">
                    <span className={`block h-full rounded-full ${s.source.startsWith("wa") || s.source === "broadcast" ? "bg-emerald-500" : s.source.startsWith("qr") ? "bg-violet-500" : "bg-gradient-to-r from-terra to-violet"}`} style={{ width: `${(s.n / maxSrc) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="hours-title" className="st-card rounded-[22px] p-4">
          <h3 id="hours-title" className="font-extrabold text-cocoa">Best time to post</h3>
          <p className="text-xs text-cocoa-2">{top.length ? `Busiest around ${top.map((t) => hh(t.h)).join(" and ")} (Kigali time)` : "Not enough activity yet"}</p>
          <div className="mt-3 flex h-24 items-end gap-[3px]" role="img" aria-label={`Activity by hour of day. ${top.length ? `Peak at ${hh(top[0].h)}` : "No activity yet"}.`}>
            {a.hours.map((v, h) => (
              <span key={h} className={`flex-1 rounded-t-md ${top.some((t) => t.h === h) ? "bg-terra-ink" : "bg-paper-3"}`} style={{ height: `${Math.max(4, (v / maxHour) * 100)}%` }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] font-bold text-cocoa-2"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </section>
      </div>
      {!compact && (
        <section aria-labelledby="conv-title" className="st-card rounded-[22px] p-4">
          <h3 id="conv-title" className="font-extrabold text-cocoa">Try-on → sale by product</h3>
          <p className="text-xs text-cocoa-2">Looks generated on shoppers vs paid orders, last {a.periodDays} days</p>
          <ul className="mt-3 space-y-2.5">
            {a.byProduct.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-paper-2">{p.image ? <img src={p.image} alt="" className="size-full object-cover" /> : <Icon name="hanger" className="size-5 text-cocoa-3" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold text-cocoa">{p.title}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${p.looks >= 8 && p.conversion < 0.05 ? "bg-amber-100 text-gold-ink" : "bg-emerald-50 text-mint-ink"}`}>{p.looks ? `${Math.round(p.conversion * 100)}%` : "—"}</span>
                  </span>
                  <span className="text-xs tabular-nums text-cocoa-2">{p.looks} try-ons · {p.sales} sold · {rwf(p.priceRwf)} · {p.colours} colour{p.colours === 1 ? "" : "s"}</span>
                </span>
              </li>
            ))}
            {a.byProduct.length === 0 && <li className="text-sm text-cocoa-2">Publish products to see how they convert.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Studio home card: one line on the home page. */
export function GrowthHomeCard({ pageId }: { pageId: string }) {
  return (
    <section aria-labelledby="grow-home" className="space-y-3">
      <div className="flex items-end justify-between">
        <h2 id="grow-home" className="font-display text-xl font-black tracking-tight text-cocoa">Grow your page</h2>
        <Link href={`/studio/${pageId}/grow`} className="text-sm font-bold text-violet-ink underline-offset-2 hover:underline">Share kit &amp; offers</Link>
      </div>
      <GrowthInsights pageId={pageId} compact />
    </section>
  );
}
