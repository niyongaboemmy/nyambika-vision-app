"use client";

import { InfoTip } from "@/components/kit";
import { Chip, Icon } from "@/components/studio";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Rising {
  key: string;
  dimension: "colour" | "pattern" | "occasion";
  value: string;
  label: string;
  region: string;
  growth: number;
  perWeek: number;
  series: (number | null)[];
  text: string;
  stability: number;
}
interface Gap {
  key: string;
  colour: string;
  category: string;
  occasion: string | null;
  asks: number;
  makers: number;
  youMakeIt: boolean;
  text: string;
}
interface Hint {
  key: string;
  category: string;
  best: string;
  worst: string;
  lift: number;
  text: string;
}
type Trends =
  | { enabled: false }
  | { enabled: true; k: number; weeks: string[]; rising: Rising[]; gaps: Gap[]; priceHints: Hint[]; suppressed: { rising: number; gaps: number; priceBands: number }; unstableHidden: number; writer: string; synthetic: boolean };

const SWATCH: Record<string, string> = {
  gold: "#D9A21B",
  indigo: "#2F3E9E",
  teal: "#12857F",
  crimson: "#B0213A",
  terracotta: "#C8553D",
  "forest-green": "#2E6B3A",
  "royal-purple": "#6A3FA0",
  black: "#1E1B1A",
};
const DIM_ICON = { colour: "palette", pattern: "layers", occasion: "sparkle" } as const;

/** Weekly bars; weeks below k are suppressed and drawn as an empty dashed slot, never as a small number. */
function WeekBars({ series, label }: { series: (number | null)[]; label: string }) {
  const max = Math.max(1, ...series.map((x) => x ?? 0));
  const shown = series.filter((x) => x !== null).length;
  return (
    <div className="flex h-10 items-end gap-[3px]" role="img" aria-label={`${label}: weekly shoppers over ${series.length} weeks, ${series.length - shown} weeks hidden for privacy`}>
      {series.map((v, i) =>
        v === null ? (
          <span key={i} className="h-2 flex-1 rounded-sm border border-dashed border-cocoa-3/60" />
        ) : (
          <span key={i} className={`flex-1 rounded-t-[4px] ${i >= series.length - 2 ? "bg-terra-ink" : "bg-paper-3"}`} style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
        ),
      )}
    </div>
  );
}

/** R4 spike "Trends" card (flag insights.trends_spike): k-anonymous market signals across Nyambika. */
export function TrendsCard({ pageId }: { pageId: string }) {
  const { locale } = useSession();
  const { data } = useApi<Trends>(`/pages/${pageId}/trends?locale=${locale}`);
  if (!data || !data.enabled) return null;
  const empty = !data.rising.length && !data.gaps.length && !data.priceHints.length;
  return (
    <section aria-labelledby="trends-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wider text-violet-ink">Market trends · spike</p>
          <h2 id="trends-title" className="font-display text-xl font-black tracking-tight text-cocoa">What shoppers want right now</h2>
        </div>
        <Chip tone="violet">k ≥ {data.k} shoppers per number</Chip>
      </div>
      {empty ? (
        <p className="st-card flex items-center gap-2 rounded-[22px] p-4 text-sm font-semibold text-cocoa-2"><Icon name="clock" className="size-4 shrink-0" />Not enough shoppers yet · next week</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {data.rising.length > 0 && (
            <div className="st-card rounded-[22px] p-4 lg:col-span-2">
              <h3 className="flex items-center gap-1.5 font-extrabold text-cocoa"><Icon name="trend" className="size-4 text-terra-ink" /> Rising in the last 2 weeks</h3>
              <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {data.rising.slice(0, 6).map((r, i) => (
                  <li key={r.key} className="animate-rise rounded-2xl bg-paper p-3 ring-1 ring-inset ring-hairline" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="flex items-center gap-2">
                      {r.dimension === "colour" ? (
                        <span className="size-7 shrink-0 rounded-full ring-2 ring-white shadow" style={{ background: SWATCH[r.value] ?? "#999" }} aria-hidden />
                      ) : (
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-ink"><Icon name={DIM_ICON[r.dimension]} className="size-4" /></span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-extrabold capitalize text-cocoa">{r.label}</span>
                        <span className="block text-[11px] font-semibold text-cocoa-2">{r.region === "ALL" ? "All Rwanda" : r.region} · ≈{r.perWeek}/week</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-black text-mint-ink">+{Math.round(r.growth * 100)}%</span>
                    </div>
                    <div className="mt-2"><WeekBars series={r.series} label={r.label} /></div>
                    <p className="mt-2 line-clamp-2 text-xs leading-snug text-cocoa-2" title={r.text}>{r.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-3">
            {data.gaps.length > 0 && (
              <div className="rounded-[22px] bg-gradient-to-br from-amber-100 to-white p-4 ring-1 ring-inset ring-black/5">
                <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-gold-ink"><Icon name="sparkle" className="size-3.5" /> Many asks, few makers</h3>
                <ul className="mt-2 space-y-2.5">
                  {data.gaps.map((g) => (
                    <li key={g.key}>
                      <p className="flex items-center gap-2 text-sm font-extrabold capitalize text-cocoa">
                        <span className="size-4 rounded-full ring-2 ring-white" style={{ background: SWATCH[g.colour] ?? "#999" }} aria-hidden />
                        {g.colour.replace("-", " ")} {g.category}{g.occasion ? ` · ${g.occasion}` : ""}
                      </p>
                      <p className="mt-0.5 text-[13px] leading-snug text-cocoa">{g.text}</p>
                      {g.youMakeIt && <Chip tone="gold" className="mt-1">You make {g.category}</Chip>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.priceHints.length > 0 && (
              <div className="rounded-[22px] bg-gradient-to-br from-sky-100 to-white p-4 ring-1 ring-inset ring-black/5">
                <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-sky-800"><Icon name="wallet" className="size-3.5" /> Price sweet spot</h3>
                {data.priceHints.map((h) => <p key={h.key} className="mt-2 text-[13px] font-semibold leading-snug text-cocoa">{h.text}</p>)}
                <p className="mt-1.5 text-[11px] text-cocoa-2">A hint, not a promise</p>
              </div>
            )}
          </div>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-cocoa-2">
        <Chip tone="violet"><Icon name="sparkle" className="size-3.5" />{data.writer.startsWith("llm") ? "AI-worded · aggregates" : "Aggregates only"}</Chip>
        <Chip>{data.suppressed.rising + data.suppressed.gaps + data.suppressed.priceBands} small groups hidden</Chip>
        {data.synthetic && <Chip tone="gold">Synthetic data</Chip>}
        <InfoTip label="How trends stay private">
          Every number comes from at least {data.k} different shoppers, sales numbers from at least 3 makers with none dominating; small groups are hidden{data.unstableHidden ? ` (${data.unstableHidden} too unstable)` : ""}.
        </InfoTip>
      </p>
    </section>
  );
}
