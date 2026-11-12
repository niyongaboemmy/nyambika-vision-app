"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { ADMIN_TABS, adminTabHref } from "../tabs";
import { Card, Chip, Empty, Icon, Kpi, Meter, Note, ScreenSkeleton, SButton, Select, Switch } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { InfoTip } from "@/components/kit";
import { Group, GroupRow } from "@/components/ios";
import type { IconName } from "@/components/icons";

type Rag = "green" | "amber" | "red" | "none";
interface KpiRow {
  key: string;
  label: string;
  target: number;
  targetLabel: string;
  direction: "min" | "max" | "zero";
  unit: "pct" | "num" | "sec" | "rwf";
  actual: number | null;
  display: string;
  rag: Rag;
  n: number;
  critical: boolean;
  detail?: string;
}
interface ZTest {
  arm: string;
  metric: string;
  pA: number;
  pB: number;
  diff: number;
  z: number | null;
  p: number | null;
  significant: boolean;
  ci: [number, number] | null;
}
interface Experiment {
  key: string;
  name: string;
  description: string;
  status: string;
  primaryMetric: string;
  startsAt: string | null;
  exposed: number;
  variants: { key: string; weight: number }[];
  arms: { key: string; weight: number; n: number; metrics: Record<string, number>; generationsPerUser: number }[];
  tests: ZTest[];
}
interface Econ {
  proContribution: number;
  businessContribution: number;
  orderContribution: number;
  totalContribution: number;
  monthlyResult: number;
  inputs: Record<string, number>;
}
interface Summary {
  generatedAt: string;
  synthetic: boolean;
  allowlist: boolean;
  cohort: { name: string; start: string; end: string; days: number; pages: number; shoppers: number };
  kpis: KpiRow[];
  funnel: { steps: { name: string; actors: number; events: number }[]; side: { name: string; actors: number; events: number }[] };
  hypercare: { days: { day: string; costRwf: number; generations: number; withheld: number; guardRate: number; incidents: number }[]; incidents: { id: string; kind: string; summary: string; createdAt: string; resolvedAt: string | null }[] };
  experiments: Experiment[];
  economics: { plan: Econ; pilot: Econ; withinBreakEvenPath: boolean; scale: number; tolerance: number };
  recommendation: { decision: "Scale" | "Iterate" | "Pivot"; reasons: string[] };
}

const RAG: Record<Rag, { tone: "mint" | "gold" | "red" | "stone"; label: string; icon: IconName }> = {
  green: { tone: "mint", label: "On target", icon: "checkCircle" },
  amber: { tone: "gold", label: "Near target", icon: "alert" },
  red: { tone: "red", label: "Off target", icon: "x" },
  none: { tone: "stone", label: "No data", icon: "minus" },
};
const STEP_LABEL: Record<string, string> = {
  muse_ask: "Asked the Muse",
  intent_parsed: "Intent understood",
  look_viewed: "Saw a look",
  look_saved: "Saved a look",
  buy_sheet_opened: "Opened buy sheet",
  hold_started: "Held to buy",
  order_paid: "Paid the maker",
  twin_created: "Created a twin",
  maker_space_viewed: "Visited a Maker Space",
  maker_contacted: "Contacted a maker",
  circle_poll_created: "Asked their circle",
};
const METRIC_LABEL: Record<string, string> = { twin_created: "Twin created", hold_started: "Held to buy", order_paid: "Paid order", look_saved: "Saved a look" };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Pilot & evaluation (plan §8, §21, Gate 3): KPIs with RAG, funnel, experiments, hypercare and the Gate 3 export. */
export default function PilotAdmin() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me?.isHost) router.replace("/signin?next=/admin/pilot");
  }, [loading, me, router]);
  const { data, reload, error } = useApi<Summary>(me?.isHost ? "/admin/pilot" : null);
  if (!me?.isHost) return null;
  return (
    <AdminShell tabs={ADMIN_TABS} tab="Pilot" onTab={(t) => t !== "Pilot" && router.push(adminTabHref(t))}>
      {error && <Note error={error} />}
      {!data ? <ScreenSkeleton /> : <Dashboard s={data} reload={reload} />}
    </AdminShell>
  );
}

function Dashboard({ s, reload }: { s: Summary; reload: () => Promise<void> }) {
  const green = s.kpis.filter((k) => k.rag === "green").length;
  const measured = s.kpis.filter((k) => k.rag !== "none").length;
  const dayOf = Math.min(s.cohort.days, 26);
  return (
    <div className="space-y-6">
      {s.synthetic && (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-gold-ink">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" /> <span className="flex-1">Synthetic data · rehearsal only</span><InfoTip label="About synthetic pilot data">Seeded by seed-pilot (phones +25078999xxxx). Use it to rehearse the Gate 3 review, not to decide.</InfoTip>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <section className="st-hero relative col-span-2 overflow-hidden rounded-[28px] p-5 lg:p-6" aria-labelledby="g3">
          <div aria-hidden className="orb absolute -right-12 -top-12 size-44 rounded-full opacity-20 blur-2xl motion-safe:animate-orb" />
          <p className="relative flex items-center gap-2 text-sm font-extrabold text-violet-ink"><Icon name="flag" className="size-4" /> Gate 3 recommendation</p>
          <h2 id="g3" className="relative mt-1 font-display text-4xl font-black tracking-tight text-cocoa lg:text-5xl">{s.recommendation.decision}</h2>
          <ul className="relative mt-3 space-y-1 text-sm text-cocoa-2">
            {s.recommendation.reasons.slice(0, 4).map((r) => <li key={r} className="flex gap-2"><span aria-hidden>·</span>{r}</li>)}
          </ul>
          <div className="relative mt-4 flex flex-wrap gap-2">
            <a href="/api/admin/pilot/gate3?format=md" download className="st-press st-cta inline-flex min-h-11 items-center gap-2 rounded-2xl px-4 text-sm font-bold text-white"><Icon name="download" className="size-4" /> Gate 3 report (.md)</a>
            <a href="/api/admin/pilot/gate3?format=json" download className="st-press inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-bold text-cocoa"><Icon name="download" className="size-4" /> JSON</a>
          </div>
        </section>
        <Kpi label="Pilot day" value={`${dayOf} / 26`} hint={`${new Date(s.cohort.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} → ${new Date(s.cohort.end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`} />
        <Kpi label="KPIs on target" value={`${green} / ${measured}`} tone="mint" warn={measured > 0 && green / measured < 0.75} hint="Scale: ≥ 75%, no red" />
        <Kpi label="Cohort" value={`${s.cohort.pages} pages`} hint={`${s.cohort.shoppers} shoppers`} tone="violet" />
        <AllowlistCard on={s.allowlist} reload={reload} />
      </div>

      <section aria-labelledby="kpis" className="space-y-3">
        <div>
          <h2 id="kpis" className="font-display text-xl font-black tracking-tight text-cocoa">Phase 2 KPIs (plan §21)</h2>
          <p className="text-sm text-cocoa-2">Cohort · pilot window</p>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {s.kpis.map((k) => <KpiCard key={k.key} k={k} />)}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Funnel steps={s.funnel.steps} side={s.funnel.side} />
        <Economics e={s.economics} />
      </div>

      <section aria-labelledby="exp" className="space-y-3">
        <h2 id="exp" className="font-display text-xl font-black tracking-tight text-cocoa">Experiments (plan §8.1)</h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {s.experiments.map((e) => <ExperimentCard key={e.key} e={e} reload={reload} />)}
        </div>
      </section>

      <Hypercare h={s.hypercare} reload={reload} />
      <CohortPanel />
    </div>
  );
}

function KpiCard({ k }: { k: KpiRow }) {
  const r = RAG[k.rag];
  const max = k.direction === "zero" ? 1 : k.target;
  return (
    <li className={`st-card space-y-2 rounded-[22px] p-4 ${k.rag === "red" ? "!border-red-200" : k.rag === "amber" ? "!border-amber-300 !bg-amber-50/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold text-cocoa-2">{k.label}{k.critical && <span className="ml-1 text-violet-ink" title="Critical for unit economics or trust"><Icon name="star" filled className="inline size-3.5 align-[-2px]" /><span className="sr-only">critical</span></span>}</p>
        <Chip tone={r.tone}><Icon name={r.icon} className="size-3.5" />{r.label}</Chip>
      </div>
      <p className="font-display text-2xl font-black tabular-nums text-cocoa">{k.display}</p>
      {k.actual !== null &&
        (k.direction === "min" ? (
          <div className="h-2.5 overflow-hidden rounded-full bg-paper-2" role="meter" aria-label={`${k.label} against target`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={k.actual}>
            <div className={`h-full rounded-full ${k.rag === "green" ? "bg-gradient-to-r from-emerald-500 to-emerald-600" : "bg-gradient-to-r from-terra to-violet"}`} style={{ width: `${Math.max(2, Math.min(1, k.actual / max) * 100)}%` }} />
          </div>
        ) : (
          <Meter value={k.direction === "zero" ? (k.actual > 0 ? 1 : 0) : k.actual} max={max} label={`${k.label} against target`} />
        ))}
      <p className="flex flex-wrap justify-between gap-x-3 text-[11px] font-semibold text-cocoa-2">
        <span>Target {k.targetLabel}</span>
        <span>n = {k.n.toLocaleString("en-US")}{k.detail ? ` · ${k.detail}` : ""}</span>
      </p>
    </li>
  );
}

function AllowlistCard({ on, reload }: { on: boolean; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="st-card flex min-w-0 flex-col gap-1.5 rounded-[22px] p-4 [&>label]:min-h-11 [&>label]:items-center">
      <p className="text-xs font-bold text-cocoa-2">Closed pilot allowlist</p>
      <p className="text-sm font-bold text-cocoa">{on ? "On · cohort shoppers only" : "Off · everyone can ask"}</p>
      <Switch
        checked={on}
        disabled={busy}
        ariaLabel="Closed pilot allowlist"
        onChange={async (v) => {
          setBusy(true);
          await api("/admin/flags/pilot.allowlist", { method: "PATCH", json: { enabled: v } }).catch(() => {});
          await reload();
          setBusy(false);
        }}
      />
    </div>
  );
}

/** Horizontal funnel: one hue (magnitude), direct labels, step-to-step conversion written out. */
function Funnel({ steps, side }: { steps: Summary["funnel"]["steps"]; side: Summary["funnel"]["side"] }) {
  const [table, setTable] = useState(false);
  const top = Math.max(1, ...steps.map((s) => s.actors));
  const W = 320;
  const row = 34;
  const H = steps.length * row;
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-black tracking-tight text-cocoa">Shopper funnel</h2>
          <p className="flex items-center gap-1 text-sm text-cocoa-2">Shoppers per step<InfoTip label="About the funnel">Distinct pseudonymous shoppers or devices per step · % of those who asked.</InfoTip></p>
        </div>
        <SButton variant="ghost" className="!px-3 text-xs" onClick={() => setTable((t) => !t)}>{table ? "Chart" : "Table"}</SButton>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-cocoa-2"><th className="py-1 font-bold">Step</th><th className="text-right font-bold">Shoppers</th><th className="text-right font-bold">Events</th><th className="text-right font-bold">Of askers</th></tr></thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={s.name} className="border-t border-hairline">
                <td className="py-1.5">{STEP_LABEL[s.name] ?? s.name}</td>
                <td className="text-right tabular-nums">{s.actors}</td>
                <td className="text-right tabular-nums">{s.events}</td>
                <td className="text-right tabular-nums">{i ? pct(s.actors / top) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Funnel: ${steps.map((s) => `${STEP_LABEL[s.name]} ${s.actors}`).join(", ")}`}>
          {steps.map((s, i) => {
            const w = Math.max(3, (s.actors / top) * (W - 110));
            return (
              <g key={s.name} transform={`translate(0 ${i * row})`}>
                <title>{`${STEP_LABEL[s.name]}: ${s.actors} shoppers (${pct(s.actors / top)} of those who asked)`}</title>
                <rect x="0" y="0" width={W} height={row - 2} fill="transparent" />
                <text x="0" y="11" fontSize="10" fontWeight="700" fill="currentColor" className="text-cocoa-2">{STEP_LABEL[s.name]}</text>
                <rect x="0" y="15" width={w} height="13" rx="4" fill="#c45a2c" opacity={1 - i * 0.07} />
                <text x={w + 6} y="25.5" fontSize="10.5" fontWeight="800" fill="currentColor" className="text-cocoa tabular-nums">
                  {s.actors.toLocaleString("en-US")}{i ? `  · ${Math.round((s.actors / top) * 100)}%` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
        {side.map((s) => <Chip key={s.name}>{STEP_LABEL[s.name] ?? s.name}: {s.actors}</Chip>)}
      </div>
    </Card>
  );
}

function Economics({ e }: { e: Summary["economics"] }) {
  const rows: [string, number, number][] = [
    ["Pro page / month", e.plan.proContribution, e.pilot.proContribution],
    ["Business page / month", e.plan.businessContribution, e.pilot.businessContribution],
    ["Per checkout order", e.plan.orderContribution, e.pilot.orderContribution],
    ["Total contribution (M18 base)", e.plan.totalContribution, e.pilot.totalContribution],
    ["Monthly result (M18 base)", e.plan.monthlyResult, e.pilot.monthlyResult],
  ];
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-black tracking-tight text-cocoa">Unit economics</h2>
          <p className="text-sm text-cocoa-2">Study vs pilot</p>
        </div>
        <Chip tone={e.withinBreakEvenPath ? "mint" : "red"}><Icon name={e.withinBreakEvenPath ? "checkCircle" : "alert"} className="size-3.5" />{e.withinBreakEvenPath ? "On break-even path" : "Off break-even path"}</Chip>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-cocoa-2"><th className="py-1 font-bold">Contribution</th><th className="text-right font-bold">Study</th><th className="text-right font-bold">Pilot</th></tr></thead>
        <tbody>
          {rows.map(([l, a, b]) => (
            <tr key={l} className="border-t border-hairline">
              <td className="py-1.5 pr-2">{l}</td>
              <td className="text-right tabular-nums text-cocoa-2">{rwf(a)}</td>
              <td className={`text-right font-bold tabular-nums ${b < a ? "text-red-700" : "text-mint-ink"}`}>{rwf(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex items-center gap-1 text-[11px] font-semibold text-cocoa-2">
        Pilot inputs
        <InfoTip label="Pilot inputs">
          Feasibility §10 recomputed with pilot actuals: RWF {Math.round(e.pilot.inputs.costPerGenRwf)}/generation · AOV {rwf(Math.round(e.pilot.inputs.aovRwf))} · {e.pilot.inputs.uncoveredTriesPerOrder.toFixed(1)} uncovered try-ons/order · paid pages ×{e.scale}. Commission 6% and MoMo fee stay study assumptions.
        </InfoTip>
      </p>
    </Card>
  );
}

function ExperimentCard({ e, reload }: { e: Experiment; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const control = e.arms[0];
  const set = async (status: string) => {
    setBusy(true);
    try {
      await api(`/admin/pilot/experiments/${encodeURIComponent(e.key)}`, { method: "PATCH", json: { status } });
      setMsg(`Experiment ${status.toLowerCase()}.`);
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const maxRate = Math.max(0.01, ...e.arms.map((a) => (a.n ? a.metrics[e.primaryMetric] / a.n : 0)));
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold text-cocoa-2">{e.key}</p>
          <h3 className="font-extrabold leading-snug text-cocoa">{e.name}</h3>
        </div>
        <Chip tone={e.status === "RUNNING" ? "mint" : e.status === "DRAFT" ? "stone" : "gold"}>{e.status.toLowerCase()}</Chip>
      </div>
      <p className="line-clamp-2 text-xs text-cocoa-2">{e.description}</p>
      <p className="text-xs font-bold text-cocoa">Primary metric: {METRIC_LABEL[e.primaryMetric] ?? e.primaryMetric} · {e.exposed} exposed</p>
      <ul className="space-y-2.5">
        {e.arms.map((a, i) => {
          const rate = a.n ? a.metrics[e.primaryMetric] / a.n : 0;
          return (
            <li key={a.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-bold text-cocoa">{a.key}{i === 0 && <span className="font-semibold text-cocoa-2"> · control</span>} <span className="text-xs font-semibold text-cocoa-2">({a.weight}%)</span></span>
                <span className="shrink-0 tabular-nums text-cocoa"><b>{pct(rate)}</b> <span className="text-xs text-cocoa-2">n={a.n} · {a.generationsPerUser.toFixed(1)}/user</span></span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-paper-2" aria-hidden>
                <div className={`h-full rounded-full ${i === 0 ? "bg-cocoa-3" : "bg-gradient-to-r from-terra to-violet"}`} style={{ width: `${Math.max(2, (rate / maxRate) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {e.tests.map((t) => (
        <div key={t.arm} className={`rounded-2xl p-3 text-xs ${t.significant ? "bg-violet-50" : "bg-paper-2"}`}>
          <p className="font-bold text-cocoa">
            {t.arm} vs {control.key}: {t.diff >= 0 ? "+" : ""}{(t.diff * 100).toFixed(1)} pts
            {t.z !== null && <> · z = {t.z.toFixed(2)} · p = {t.p! < 0.001 ? "< 0.001" : t.p!.toFixed(3)}</>}
          </p>
          <p className="mt-0.5 text-cocoa-2">
            {t.z === null ? "Too little data" : t.significant ? "Significant (5%)" : "Not significant (5%)"}
            {t.ci && ` · 95% CI ${(t.ci[0] * 100).toFixed(1)} to ${(t.ci[1] * 100).toFixed(1)} pts`}
          </p>
        </div>
      ))}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {e.status !== "RUNNING" && <SButton variant="dark" disabled={busy} onClick={() => set("RUNNING")}>Start</SButton>}
        {e.status === "RUNNING" && <SButton variant="outline" disabled={busy} onClick={() => set("PAUSED")}>Pause</SButton>}
        {e.status !== "STOPPED" && e.status !== "DRAFT" && <SButton variant="ghost" disabled={busy} onClick={() => set("STOPPED")}>Stop</SButton>}
      </div>
      <Note ok={msg} />
    </Card>
  );
}

function Hypercare({ h, reload }: { h: Summary["hypercare"]; reload: () => Promise<void> }) {
  const [kind, setKind] = useState("P1");
  const [summary, setSummary] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const maxCost = Math.max(1, ...h.days.map((d) => d.costRwf));
  const totalCost = h.days.reduce((s, d) => s + d.costRwf, 0);
  const gens = h.days.reduce((s, d) => s + d.generations, 0);
  const withheld = h.days.reduce((s, d) => s + d.withheld, 0);
  return (
    <section aria-labelledby="hyper" className="space-y-3">
      <div>
        <h2 id="hyper" className="font-display text-xl font-black tracking-tight text-cocoa">Hypercare · last 14 days</h2>
        <p className="text-sm text-cocoa-2">Daily 9:00 triage · Kigali days</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="AI cost, 14 days" value={rwf(totalCost)} spark={h.days.map((d) => d.costRwf)} />
        <Kpi label="Generations" value={gens.toLocaleString("en-US")} spark={h.days.map((d) => d.generations)} tone="violet" />
        <Kpi label="Guard failure" value={gens ? pct(withheld / (gens + withheld)) : "—"} spark={h.days.map((d) => d.guardRate)} tone="gold" warn={gens > 0 && withheld / (gens + withheld) > 0.02} hint="Target ≤ 2%" />
        <Kpi label="Open incidents" value={h.incidents.filter((i) => !i.resolvedAt).length} warn={h.incidents.some((i) => !i.resolvedAt)} hint={`${h.incidents.length} logged in 14 days`} />
      </div>
      <Card className="overflow-x-auto">
        {/* Keyboard users can scroll the wide table (focusable region, WCAG 2.1.1). */}
        <div role="region" aria-label="Daily AI cost table" tabIndex={0} className="overflow-x-auto rounded-xl">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">Daily AI cost and guard failures</caption>
          <thead><tr className="text-left text-xs text-cocoa-2"><th className="py-1 font-bold">Day</th><th className="font-bold">AI cost</th><th className="text-right font-bold">Gens</th><th className="text-right font-bold">Withheld</th><th className="text-right font-bold">Guard</th><th className="text-right font-bold">Incidents</th></tr></thead>
          <tbody>
            {h.days.map((d) => (
              <tr key={d.day} className="border-t border-hairline">
                <td className="py-1.5 tabular-nums">{new Date(d.day + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</td>
                <td className="w-[38%] pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-2" aria-hidden><div className="h-full rounded-full bg-terra" style={{ width: `${(d.costRwf / maxCost) * 100}%` }} /></div>
                    <span className="w-20 text-right tabular-nums">{rwf(d.costRwf)}</span>
                  </div>
                </td>
                <td className="text-right tabular-nums">{d.generations}</td>
                <td className="text-right tabular-nums">{d.withheld}</td>
                <td className={`text-right tabular-nums ${d.guardRate > 0.02 ? "font-bold text-red-700" : ""}`}>{pct(d.guardRate)}{d.guardRate > 0.02 ? " ▲" : ""}</td>
                <td className="text-right tabular-nums">{d.incidents}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-extrabold text-cocoa">Incident log</h3>
        {h.incidents.length === 0 ? <p className="text-sm text-cocoa-2">No incidents in the last 14 days.</p> : (
          <ul className="space-y-2">
            {h.incidents.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start gap-2 text-sm">
                <Chip tone={i.kind === "PRIVACY" ? "red" : "gold"}>{i.kind}</Chip>
                <span className="min-w-0 flex-1 text-cocoa">{i.summary}</span>
                {i.resolvedAt ? <Chip tone="mint">resolved</Chip> : (
                  <SButton variant="outline" onClick={async () => { await api(`/admin/pilot/incidents/${i.id}/resolve`, { method: "POST" }); await reload(); }}>Resolve</SButton>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (ev) => {
            ev.preventDefault();
            try {
              await api("/admin/pilot/incidents", { method: "POST", json: { kind, summary } });
              setSummary("");
              setMsg("Incident logged.");
              await reload();
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        >
          <label className="sr-only" htmlFor="inc-kind">Incident type</label>
          <Select id="inc-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="sm:w-36">
            <option value="P1">P1</option>
            <option value="PRIVACY">Privacy</option>
            <option value="OTHER">Other</option>
          </Select>
          <label className="sr-only" htmlFor="inc-sum">What happened</label>
          <input id="inc-sum" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened, impact, mitigation" className="min-h-11 flex-1 rounded-2xl bg-white px-3 text-sm text-cocoa outline-none focus-visible:ring-2 focus-visible:ring-terra" />
          <SButton variant="dark" disabled={summary.trim().length < 4}>Log incident</SButton>
        </form>
        <Note ok={msg} />
      </Card>
    </section>
  );
}

interface CohortData {
  cohort: { name: string } | null;
  pages: { id: string; name: string; handle: string; status: string; memberType: string; member: boolean }[];
  shoppers: number;
  invites: { code: string; kind: string; uses: number; maxUses: number; note: string }[];
}

function CohortPanel() {
  const { data, reload } = useApi<CohortData>("/admin/pilot/cohort");
  const [kind, setKind] = useState<"SHOPPER" | "PAGE">("SHOPPER");
  const [codes, setCodes] = useState<string[]>([]);
  if (!data) return <ScreenSkeleton variant="list" />;
  if (!data.cohort) return <Empty title="No pilot cohort">Run the pilot migration to create the Kigali cohort.</Empty>;
  const members = data.pages.filter((p) => p.member).length;
  return (
    <section aria-labelledby="cohort" className="space-y-3">
      <div>
        <h2 id="cohort" className="font-display text-xl font-black tracking-tight text-cocoa">Cohort & invites</h2>
        <p className="text-sm text-cocoa-2">{data.cohort.name} · {members} member pages · {data.shoppers} shoppers</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="flex items-center gap-1 font-extrabold text-cocoa">Invite codes<InfoTip label="About invite codes">Shoppers redeem at <span className="font-mono">/join/&lt;code&gt;</span> or at sign-in. Member codes add the signer&apos;s own pages.</InfoTip></h3>
          
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="inv-kind">Invite for</label>
            <Select id="inv-kind" value={kind} onChange={(e) => setKind(e.target.value as "SHOPPER" | "PAGE")} className="w-40">
              <option value="SHOPPER">Shoppers</option>
              <option value="PAGE">Members</option>
            </Select>
            <SButton
              variant="dark"
              onClick={async () => {
                const r = await api<{ codes: string[] }>("/admin/pilot/invites", { method: "POST", json: { kind, count: 5, maxUses: kind === "SHOPPER" ? 25 : 1, note: "admin" } });
                setCodes(r.codes);
                await reload();
              }}
            >
              <Icon name="plus" className="size-4" /> 5 codes
            </SButton>
          </div>
          {codes.length > 0 && <p aria-label="New invite codes" className="rounded-2xl bg-emerald-50 p-3 font-mono text-sm text-mint-ink">{codes.join("  ")}</p>}
          <ul className="flex flex-wrap gap-2">
            {data.invites.map((i) => <li key={i.code}><Chip tone={i.uses >= i.maxUses ? "stone" : "sky"}><span className="font-mono">{i.code}</span> · {i.kind === "PAGE" ? "member" : "shopper"} · {i.uses}/{i.maxUses}</Chip></li>)}
          </ul>
        </Card>
        <div role="region" aria-label="Member pages in the pilot" tabIndex={0} className="max-h-[26rem] overflow-y-auto rounded-[var(--radius-md)]">
          <Group header={`Member pages · ${members} in`}>
            {data.pages.map((p) => (
              <GroupRow
                key={p.id}
                icon={p.memberType === "COOPERATIVE" ? "users" : p.memberType === "TAILOR" ? "scissors" : "store"}
                tone={p.member ? "mint" : "stone"}
                title={p.name}
                subtitle={`${p.memberType.toLowerCase()} · ${p.status.replace(/_/g, " ").toLowerCase()}`}
                accessory={
                  <Switch
                    checked={p.member}
                    ariaLabel={`${p.name} in the pilot`}
                    onChange={async (v) => {
                      await api("/admin/pilot/cohort/pages", { method: "POST", json: { pageId: p.id, member: v } });
                      await reload();
                    }}
                  />
                }
              />
            ))}
          </Group>
        </div>
      </div>
    </section>
  );
}
