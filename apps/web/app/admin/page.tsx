"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Badge, Card, Chip, Empty, Icon, Kpi, Meter, Monogram, Note, ScreenSkeleton, SButton, Switch } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Overview {
  pages: Record<string, number>;
  products: number;
  shoppers: number;
  twins: number;
  orders: number;
  gmvDirectToMakersRwf: number;
  ai: { generationsToday: number; guardFailureRate: number; costTodayRwf: number; costPerGenerationRwf: number; generationsPerPaidOrder: number | null; costPerPaidOrderRwf: number | null };
  completedOrders: number;
  unreconciledPayments: number;
  openModeration: number;
}

const TABS = ["Overview", "Verify", "Moderation", "Migration", "Flags & models", "Outbox", "Audit", "Pilot", "Agents & partners"] as const;

/** Host admin console (FR-ADM). Host roles only. */
export default function Admin() {
  const { me, loading } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>(() => {
    const q = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return (TABS as readonly string[]).includes(q ?? "") && q !== "Pilot" && q !== "Agents & partners" ? (q as (typeof TABS)[number]) : "Overview";
  });
  useEffect(() => {
    if (!loading && !me?.isHost) router.replace("/signin?next=/admin");
  }, [loading, me, router]);
  const { data: counts } = useApi<Overview>(me?.isHost ? "/admin/overview" : null);
  if (!me?.isHost) return null;
  return (
    <AdminShell tabs={TABS} tab={tab} onTab={(t) => (t === "Pilot" ? router.push("/admin/pilot") : t === "Agents & partners" ? router.push("/admin/agents") : setTab(t))} counts={{ Verify: counts?.pages.PENDING_VERIFICATION ?? 0, Moderation: counts?.openModeration ?? 0 }}>
        {tab === "Overview" && <OverviewTab />}
        {tab === "Verify" && <VerifyTab />}
        {tab === "Moderation" && <ModerationTab />}
        {tab === "Migration" && <MigrationTab />}
        {tab === "Flags & models" && <FlagsTab />}
        {tab === "Outbox" && <OutboxTab />}
        {tab === "Audit" && <AuditTab />}
    </AdminShell>
  );
}

/** SLO meter row: value against a target, with the target written out (not colour alone). */
function Slo({ label, value, display, target, targetLabel }: { label: string; value: number | null; display: string; target: number; targetLabel: string }) {
  const bad = value !== null && value > target;
  return (
    <div className={`st-card space-y-2 rounded-[22px] p-4 ${bad ? "!border-amber-300 !bg-amber-50" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-cocoa-2">{label}</p>
        <Chip tone={value === null ? "stone" : bad ? "gold" : "mint"}>{value === null ? "no data" : bad ? "over target" : "on target"}</Chip>
      </div>
      <p className="font-display text-2xl font-black tabular-nums text-cocoa">{display}</p>
      <Meter value={value ?? 0} max={target} label={`${label} against target`} />
      <p className="text-[11px] font-semibold text-cocoa-2">Target {targetLabel}</p>
    </div>
  );
}

function OverviewTab() {
  const { data: o, reload } = useApi<Overview>("/admin/overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!o) return <ScreenSkeleton />;
  const gpo = o.ai.generationsPerPaidOrder;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <section className="st-hero relative col-span-2 overflow-hidden rounded-[28px] p-5 lg:row-span-2 lg:p-6">
          <div aria-hidden className="orb absolute -right-12 -top-12 size-44 animate-orb rounded-full opacity-20 blur-2xl" />
          <p className="relative flex items-center gap-2 text-sm font-extrabold text-mint-ink"><Icon name="wallet" className="size-4" /> Paid directly to makers</p>
          <p className="relative mt-1 font-display text-4xl font-black tracking-tight tabular-nums text-cocoa lg:text-5xl">{rwf(o.gmvDirectToMakersRwf)}</p>
          <p className="relative mt-1 text-sm text-cocoa-2">{o.orders} orders · {o.completedOrders} completed. Nyambika never holds the money.</p>
          <div className="relative mt-5 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white/75 p-3">
              <p className="text-xs font-bold text-cocoa-2">Live pages</p>
              <p className="font-display text-2xl font-black tabular-nums text-cocoa">{o.pages.PUBLISHED ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-white/75 p-3">
              <p className="text-xs font-bold text-cocoa-2">Published products</p>
              <p className="font-display text-2xl font-black tabular-nums text-cocoa">{o.products}</p>
            </div>
          </div>
        </section>
        <Kpi label="Pending verification" value={o.pages.PENDING_VERIFICATION ?? 0} warn={(o.pages.PENDING_VERIFICATION ?? 0) > 0} />
        <Kpi label="Open moderation" value={o.openModeration} warn={o.openModeration > 0} />
        <Kpi label="Shoppers · twins" value={`${o.shoppers} · ${o.twins}`} tone="violet" />
        <Kpi label="Unreconciled payments" value={o.unreconciledPayments} warn={o.unreconciledPayments > 0} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SButton
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api("/payments/reconcile", { method: "POST" });
            await reload();
            setMsg("Reconciliation finished.");
            setBusy(false);
          }}
        >
          <Icon name="refresh" className="size-4" /> {busy ? "Reconciling…" : "Run payment reconciliation"}
        </SButton>
        <Note ok={msg} />
      </div>

      <section aria-labelledby="ai-econ" className="space-y-3">
        <div>
          <h2 id="ai-econ" className="font-display text-xl font-black tracking-tight text-cocoa">AI unit economics</h2>
          <p className="text-sm text-cocoa-2">{o.ai.generationsToday} generations today · {rwf(o.ai.costTodayRwf)} spent</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Slo label="Guard failure rate" value={o.ai.guardFailureRate} display={`${(o.ai.guardFailureRate * 100).toFixed(1)}%`} target={0.02} targetLabel="≤ 2%" />
          <Slo label="Cost / generation" value={o.ai.costPerGenerationRwf} display={rwf(o.ai.costPerGenerationRwf)} target={120} targetLabel="≤ RWF 120" />
          <Slo label="Generations / paid order" value={gpo} display={gpo === null ? "—" : String(gpo)} target={15} targetLabel="≤ 15" />
          <Slo label="AI cost / paid order" value={o.ai.costPerPaidOrderRwf} display={o.ai.costPerPaidOrderRwf !== null ? rwf(o.ai.costPerPaidOrderRwf) : "—"} target={1600} targetLabel="alert above RWF 1,600" />
        </div>
      </section>
    </>
  );
}

function VerifyTab() {
  const { data, reload } = useApi<{ id: string; name: string; handle: string; memberType: string; status: string; district: string; story: string; roles: { role: string; user: { phone: string; name: string | null } }[]; _count: { products: number } }[]>("/admin/verifications");
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: string) => {
    setBusy(id);
    try {
      await api(`/admin/pages/${id}/${action}`, { method: "POST", json: {} });
      await reload();
    } finally {
      setBusy(null);
    }
  };
  if (!data) return <ScreenSkeleton variant="list" />;
  if (data.length === 0) return <Empty icon="shield" title="All caught up">No pages waiting for verification.</Empty>;
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {data.map((p) => (
        <li key={p.id} className="st-card animate-rise space-y-3 rounded-[24px] p-4">
          <div className="flex items-start gap-3">
            <Monogram name={p.name} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-extrabold text-cocoa">{p.name} <span className="text-sm font-semibold text-cocoa-2">/{p.handle}</span></p>
              <p className="text-sm text-cocoa-2">{p.memberType.toLowerCase()} · {p.district || "—"} · {p._count.products} products</p>
              <p className="text-xs text-cocoa-2">Owner {p.roles[0]?.user.name ?? ""} {p.roles[0]?.user.phone}</p>
            </div>
            <Badge value={p.status} />
          </div>
          {p.story && <p className="rounded-2xl bg-paper p-3 text-sm italic leading-relaxed text-cocoa-2 ring-1 ring-inset ring-hairline">“{p.story}”</p>}
          <div className="flex gap-2">
            {p.status === "SUSPENDED" ? (
              <SButton disabled={busy === p.id} onClick={() => act(p.id, "reinstate")}>Reinstate</SButton>
            ) : (
              <>
                <SButton disabled={busy === p.id} className="flex-1" onClick={() => act(p.id, "verify")}>Verify &amp; publish</SButton>
                <SButton variant="outline" disabled={busy === p.id} onClick={() => act(p.id, "reject")}>Reject</SButton>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ModerationTab() {
  const { data, reload } = useApi<{ id: string; kind: string; refId: string; reason: string; createdAt: string }[]>("/admin/moderation");
  if (!data) return <ScreenSkeleton variant="list" />;
  if (data.length === 0) return <Empty icon="flag" title="Queue is clear">Moderation queue is clear.</Empty>;
  return (
    <ul className="space-y-2">
      {data.map((m) => (
        <li key={m.id} className="st-card flex items-center gap-3 rounded-[22px] p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-100 text-gold-ink"><Icon name="flag" className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold capitalize text-cocoa">{m.kind.replace(/_/g, " ").toLowerCase()}</p>
            <p className="truncate text-sm text-cocoa-2">{m.reason}</p>
            <p className="text-xs text-cocoa-3">{new Date(m.createdAt).toLocaleString()} · ref {m.refId.slice(-8)}</p>
          </div>
          <SButton variant="outline" onClick={async () => { await api(`/admin/moderation/${m.id}/resolve`, { method: "POST", json: { resolution: "Reviewed by host" } }); await reload(); }}>Resolve</SButton>
        </li>
      ))}
    </ul>
  );
}

function FlagsTab() {
  const { data: flags, reload, setData: setFlags } = useApi<{ key: string; enabled: boolean; rollout: number; description: string }[]>("/admin/flags");
  const { data: models, reload: reloadModels } = useApi<{ id: string; tier: string; status: string; costRwf: number; generations: number; guardFailureRate: number; avgLatencyMs: number }[]>("/admin/models");
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
      <section aria-labelledby="flags-t" className="space-y-2">
        <h2 id="flags-t" className="font-display text-xl font-black tracking-tight text-cocoa">Feature flags</h2>
        {!flags && <ScreenSkeleton variant="list" />}
        <ul className="st-card divide-y divide-hairline rounded-[24px] px-4">
          {flags?.map((f) => (
            <li key={f.key} className="py-3.5">
              <Switch
                checked={f.enabled}
                ariaLabel={f.key}
                label={<span className="font-mono text-[13px]">{f.key}</span>}
                description={f.description}
                onChange={async (enabled) => {
                  setFlags((all) => all?.map((x) => (x.key === f.key ? { ...x, enabled } : x)) ?? null);
                  await api(`/admin/flags/${f.key}`, { method: "PATCH", json: { enabled } }).catch(() => reload());
                }}
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="models-t" className="space-y-2">
        <h2 id="models-t" className="font-display text-xl font-black tracking-tight text-cocoa">Model registry</h2>
        {!models && <ScreenSkeleton variant="list" />}
        <ul className="space-y-2">
          {models?.map((m) => (
            <li key={m.id} className="st-card space-y-2 rounded-[22px] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-bold text-cocoa">{m.id}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge value={m.status} />
                    <Chip>{m.tier}</Chip>
                  </div>
                </div>
                <SButton variant="outline" className="min-h-10" onClick={async () => { await api(`/admin/models/${m.id}`, { method: "PATCH", json: { status: m.status === "ACTIVE" ? "RETIRED" : "ACTIVE" } }); await reloadModels(); }}>
                  {m.status === "ACTIVE" ? "Retire" : "Activate"}
                </SButton>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[["Cost / gen", `RWF ${m.costRwf}`], ["Generations", m.generations], ["Guard fail", `${(m.guardFailureRate * 100).toFixed(1)}%`], ["Avg latency", `${m.avgLatencyMs} ms`]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-paper px-2.5 py-1.5 ring-1 ring-inset ring-hairline">
                    <dt className="font-semibold text-cocoa-2">{k}</dt>
                    <dd className="font-bold tabular-nums text-cocoa">{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function OutboxTab() {
  const { data } = useApi<{ id: string; channel: string; to: string; template: string; body: string; createdAt: string }[]>("/admin/notifications");
  if (!data) return <ScreenSkeleton variant="list" />;
  if (data.length === 0) return <Empty icon="mail">No messages sent yet.</Empty>;
  return (
    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {data.map((n) => (
        <li key={n.id} className="st-card space-y-2 rounded-[22px] p-4">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Chip tone={n.channel === "WHATSAPP" ? "mint" : "sky"}>{n.channel.toLowerCase()}</Chip>
            <span className="font-semibold text-cocoa">{n.to}</span>
            <span className="text-cocoa-2">· {n.template}</span>
            <span className="ml-auto text-cocoa-2">{new Date(n.createdAt).toLocaleString()}</span>
          </div>
          <p className="rounded-2xl rounded-tl-md bg-paper p-3 text-sm leading-relaxed text-cocoa ring-1 ring-inset ring-hairline">{n.body.replace(/code: \d{6}/, "code: ••••••")}</p>
        </li>
      ))}
    </ul>
  );
}

function AuditTab() {
  const { data } = useApi<{ id: string; actorId: string | null; pageId: string | null; action: string; data: unknown; createdAt: string }[]>("/admin/audit");
  if (!data) return <ScreenSkeleton variant="list" />;
  return (
    <ol className="st-card divide-y divide-hairline overflow-hidden rounded-[24px]">
      {data.map((a) => (
        <li key={a.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[170px_220px_minmax(0,1fr)] sm:items-start sm:gap-4">
          <time className="text-xs font-semibold text-cocoa-2">{new Date(a.createdAt).toLocaleString()}</time>
          <span className="truncate font-mono text-xs font-bold text-cocoa">{a.action}</span>
          <code className="block truncate font-mono text-xs text-cocoa-2">{JSON.stringify(a.data)}</code>
        </li>
      ))}
    </ol>
  );
}

interface Wave {
  id: string;
  name: string;
  createdAt: string;
  items: {
    id: string;
    status: string;
    legacyUrl: string;
    checksum: string;
    defects: { severity: string; message: string }[];
    ownerNote: string;
    reviewUrl: string;
    page: { id: string; name: string; handle: string; status: string; products: number } | null;
    redirect: { from: string; active: boolean; hits: number } | null;
  }[];
}

const MIG_STEPS = ["IMPORTED", "IN_REVIEW", "SIGNED_OFF", "LIVE"];

/** Migration waves (plan §16): import → owner review → sign-off → go live, with rollback and 404 monitoring. */
function MigrationTab() {
  const { data: waves, reload } = useApi<Wave[]>("/admin/migration/waves");
  const { data: misses } = useApi<{ path: string; hits: number; lastSeen: string }[]>("/admin/migration/not-found");
  const [report, setReport] = useState<{ handle: string; ok: boolean; defects: unknown[]; error?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ report: typeof report }>("/admin/migration/waves", { method: "POST", body: await file.text(), headers: { "content-type": "application/json" } });
      setReport(r.report);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const act = async (id: string, action: string) => {
    setErr(null);
    try {
      await api(`/admin/migration/items/${id}/${action}`, { method: "POST" });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <Card className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-paper-2 text-cocoa"><Icon name="upload" className="size-5" /></span>
          <div>
            <p className="font-extrabold text-cocoa">Import a wave</p>
            <p className="text-sm text-cocoa-2">JSON bundle from the legacy export (format in docs/migration.md). Pages are imported hidden; photos go through the readiness pipeline.</p>
            <a href="/admin/network" className="mt-1 inline-block text-sm font-bold text-violet-ink underline">Whole network (waves, outreach, cut-over) →</a>
          </div>
        </div>
        <label className={`st-press flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-paper-3 bg-paper text-sm font-bold text-cocoa hover:border-cocoa-3 focus-within:outline focus-within:outline-[2.5px] focus-within:outline-violet-ink ${busy ? "opacity-50" : ""}`}>
          <Icon name="upload" className="size-4" />
          {busy ? "Importing…" : "Choose bundle (.json)"}
          <input type="file" accept="application/json,.json" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <Note error={err} />
        {report && (
          <ul className="space-y-1 text-sm">
            {report.map((r) => (
              <li key={r.handle} className={r.ok ? "text-mint-ink" : "text-red-800"}>{r.ok ? "✓" : "✕"} {r.handle} {r.ok ? `· ${r.defects.length} item(s) to check` : `· ${r.error}`}</li>
            ))}
          </ul>
        )}
      </Card>
      {waves?.length === 0 && <Empty icon="swap">No migration waves yet. Import a bundle to start.</Empty>}
      {waves?.map((w) => (
        <section key={w.id} className="space-y-2">
          <h3 className="font-display text-lg font-black text-cocoa">{w.name} <span className="text-sm font-semibold text-cocoa-2">· {new Date(w.createdAt).toLocaleString()}</span></h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {w.items.map((i) => {
              const at = i.status === "ROLLED_BACK" ? -1 : MIG_STEPS.indexOf(i.status === "CHANGES_REQUESTED" ? "IN_REVIEW" : i.status);
              return (
                <article key={i.id} aria-label={i.page?.name ?? "Migrated page"} className="st-card min-w-0 space-y-3 rounded-[24px] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-extrabold text-cocoa">{i.page?.name} <span className="text-sm font-semibold text-cocoa-2">· {i.page?.products} products</span></p>
                      <p className="truncate text-xs text-cocoa-2">{i.redirect?.from} → /m/{i.page?.handle} · redirect {i.redirect?.active ? `on (${i.redirect.hits} hits)` : "off"} · sha {i.checksum}</p>
                    </div>
                    <Badge value={i.status} label={i.status.replace(/_/g, " ").toLowerCase()} />
                  </div>
                  <ol aria-label="Migration progress" className="grid grid-cols-4 gap-1">
                    {["Imported", "Review", "Signed off", "Live"].map((s, k) => (
                      <li key={s} className="space-y-1">
                        <span className={`block h-1.5 rounded-full ${k <= at ? "bg-mint-ink" : "bg-paper-3"}`} />
                        <span className={`block text-[10px] font-bold ${k <= at ? "text-cocoa" : "text-cocoa-2"}`}>{s}</span>
                      </li>
                    ))}
                  </ol>
                  {i.defects.length > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-gold-ink ring-1 ring-inset ring-amber-200">{i.defects.length} item(s): {i.defects.map((d) => d.message).join(" · ").slice(0, 160)}</p>}
                  {i.ownerNote && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-inset ring-red-200">Owner: “{i.ownerNote}”</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {["IMPORTED", "CHANGES_REQUESTED", "IN_REVIEW"].includes(i.status) && <SButton variant="outline" className="min-h-10" onClick={() => act(i.id, "send-review")}>{i.status === "IMPORTED" ? "Send review link" : "Resend review link"}</SButton>}
                    {i.status === "SIGNED_OFF" && <SButton className="min-h-10" onClick={() => act(i.id, "go-live")}>Go live + redirect</SButton>}
                    {(i.status === "LIVE" || i.status === "SIGNED_OFF") && <SButton variant="outline" className="min-h-10" onClick={() => act(i.id, "rollback")}>Roll back</SButton>}
                    <a href={i.reviewUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs font-bold text-violet-ink underline">review link</a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {misses && misses.length > 0 && (
        <Card>
          <p className="mb-2 font-extrabold text-cocoa">Unmatched legacy URLs (404s)</p>
          <ul className="divide-y divide-hairline text-sm text-cocoa-2">
            {misses.map((m) => (
              <li key={m.path} className="flex justify-between gap-3 py-1.5"><span className="truncate font-mono text-xs">{m.path}</span><span className="font-bold tabular-nums">{m.hits}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

