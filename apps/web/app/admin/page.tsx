"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Card, Empty, SButton } from "@/components/studio";
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

const TABS = ["Overview", "Verify", "Moderation", "Flags & models", "Outbox", "Audit"] as const;

/** Host admin console (FR-ADM). Host roles only. */
export default function Admin() {
  const { me, loading } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  useEffect(() => {
    if (!loading && !me?.isHost) router.replace("/signin?next=/admin");
  }, [loading, me, router]);
  if (!me?.isHost) return null;
  return (
    <div className="theme-light min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-[#faf7f3]/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 pt-3">
          <p className="font-display text-lg font-black">🛠️ Nyambika host admin</p>
          <nav className="no-scrollbar -mx-4 mt-2 flex gap-1 overflow-x-auto px-4">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === t ? "border-stone-900" : "border-transparent text-stone-500"}`}>{t}</button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        {tab === "Overview" && <OverviewTab />}
        {tab === "Verify" && <VerifyTab />}
        {tab === "Moderation" && <ModerationTab />}
        {tab === "Flags & models" && <FlagsTab />}
        {tab === "Outbox" && <OutboxTab />}
        {tab === "Audit" && <AuditTab />}
      </main>
    </div>
  );
}

function OverviewTab() {
  const { data: o, reload } = useApi<Overview>("/admin/overview");
  if (!o) return <p className="text-stone-500">Loading…</p>;
  const gpo = o.ai.generationsPerPaidOrder;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Live pages" value={o.pages.PUBLISHED ?? 0} />
        <Stat label="Pending verification" value={o.pages.PENDING_VERIFICATION ?? 0} />
        <Stat label="Published products" value={o.products} />
        <Stat label="Shoppers · twins" value={`${o.shoppers} · ${o.twins}`} />
        <Stat label="Orders (completed)" value={`${o.orders} (${o.completedOrders})`} />
        <Stat label="Paid directly to makers" value={rwf(o.gmvDirectToMakersRwf)} />
        <Stat label="Unreconciled payments" value={o.unreconciledPayments} warn={o.unreconciledPayments > 0} />
        <Stat label="Open moderation" value={o.openModeration} warn={o.openModeration > 0} />
      </div>
      <h2 className="pt-2 font-bold">AI unit economics</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Generations today" value={o.ai.generationsToday} />
        <Stat label="Guard failure rate (≤ 2%)" value={`${(o.ai.guardFailureRate * 100).toFixed(1)}%`} warn={o.ai.guardFailureRate > 0.02} />
        <Stat label="AI cost today" value={rwf(o.ai.costTodayRwf)} />
        <Stat label="Cost / generation (≤ RWF 120)" value={rwf(o.ai.costPerGenerationRwf)} warn={o.ai.costPerGenerationRwf > 120} />
        <Stat label="Generations / paid order (≤ 15)" value={gpo ?? "—"} warn={gpo !== null && gpo > 15} />
        <Stat label="AI cost / paid order (alert > RWF 1,600)" value={o.ai.costPerPaidOrderRwf !== null ? rwf(o.ai.costPerPaidOrderRwf) : "—"} warn={(o.ai.costPerPaidOrderRwf ?? 0) > 1600} />
      </div>
      <SButton variant="outline" onClick={async () => { await api("/payments/reconcile", { method: "POST" }); await reload(); }}>Run payment reconciliation</SButton>
    </>
  );
}

function VerifyTab() {
  const { data, reload } = useApi<{ id: string; name: string; handle: string; memberType: string; status: string; district: string; story: string; roles: { role: string; user: { phone: string; name: string | null } }[]; _count: { products: number } }[]>("/admin/verifications");
  const act = async (id: string, action: string) => {
    await api(`/admin/pages/${id}/${action}`, { method: "POST", json: {} });
    await reload();
  };
  if (data?.length === 0) return <Empty>No pages waiting for verification.</Empty>;
  return (
    <div className="space-y-3">
      {data?.map((p) => (
        <Card key={p.id} className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{p.name} <span className="text-sm font-normal text-stone-500">/{p.handle}</span></p>
              <p className="text-sm text-stone-600">{p.memberType.toLowerCase()} · {p.district || "—"} · {p._count.products} products · owner {p.roles[0]?.user.name ?? ""} {p.roles[0]?.user.phone}</p>
              {p.story && <p className="mt-1 text-sm text-stone-500">“{p.story}”</p>}
            </div>
            <Badge value={p.status} />
          </div>
          <div className="flex gap-2">
            {p.status === "SUSPENDED" ? (
              <SButton onClick={() => act(p.id, "reinstate")}>Reinstate</SButton>
            ) : (
              <>
                <SButton onClick={() => act(p.id, "verify")}>Verify &amp; publish</SButton>
                <SButton variant="outline" onClick={() => act(p.id, "reject")}>Reject</SButton>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ModerationTab() {
  const { data, reload } = useApi<{ id: string; kind: string; refId: string; reason: string; createdAt: string }[]>("/admin/moderation");
  if (data?.length === 0) return <Empty>Moderation queue is clear.</Empty>;
  return (
    <div className="space-y-2">
      {data?.map((m) => (
        <Card key={m.id} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{m.kind.replace(/_/g, " ").toLowerCase()}</p>
            <p className="truncate text-sm text-stone-600">{m.reason}</p>
            <p className="text-xs text-stone-400">{new Date(m.createdAt).toLocaleString()} · ref {m.refId.slice(-8)}</p>
          </div>
          <SButton variant="outline" onClick={async () => { await api(`/admin/moderation/${m.id}/resolve`, { method: "POST", json: { resolution: "Reviewed by host" } }); await reload(); }}>Resolve</SButton>
        </Card>
      ))}
    </div>
  );
}

function FlagsTab() {
  const { data: flags, reload, setData: setFlags } = useApi<{ key: string; enabled: boolean; rollout: number; description: string }[]>("/admin/flags");
  const { data: models, reload: reloadModels } = useApi<{ id: string; tier: string; status: string; costRwf: number; generations: number; guardFailureRate: number; avgLatencyMs: number }[]>("/admin/models");
  return (
    <>
      <h2 className="font-bold">Feature flags</h2>
      {flags?.map((f) => (
        <Card key={f.key} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold">{f.key}</p>
            <p className="text-xs text-stone-500">{f.description}</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setFlags((all) => all?.map((x) => (x.key === f.key ? { ...x, enabled } : x)) ?? null);
                await api(`/admin/flags/${f.key}`, { method: "PATCH", json: { enabled } }).catch(() => reload());
              }}
              className="size-5"
              aria-label={f.key}
            />
            {f.enabled ? "on" : "off"}
          </label>
        </Card>
      ))}
      <h2 className="pt-2 font-bold">Model registry</h2>
      {models?.map((m) => (
        <Card key={m.id} className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-sm font-semibold">{m.id}</p>
            <p className="text-xs text-stone-500">{m.tier} · RWF {m.costRwf}/gen · {m.generations} gens · guard fail {(m.guardFailureRate * 100).toFixed(1)}% · {m.avgLatencyMs} ms avg</p>
          </div>
          <SButton variant="outline" onClick={async () => { await api(`/admin/models/${m.id}`, { method: "PATCH", json: { status: m.status === "ACTIVE" ? "RETIRED" : "ACTIVE" } }); await reloadModels(); }}>
            {m.status === "ACTIVE" ? "Retire" : "Activate"}
          </SButton>
        </Card>
      ))}
    </>
  );
}

function OutboxTab() {
  const { data } = useApi<{ id: string; channel: string; to: string; template: string; body: string; createdAt: string }[]>("/admin/notifications");
  return (
    <div className="space-y-2">
      {data?.map((n) => (
        <Card key={n.id}>
          <p className="text-xs text-stone-500">{n.channel} → {n.to} · {n.template} · {new Date(n.createdAt).toLocaleString()}</p>
          <p className="mt-1 text-sm">{n.body.replace(/code: \d{6}/, "code: ••••••")}</p>
        </Card>
      ))}
    </div>
  );
}

function AuditTab() {
  const { data } = useApi<{ id: string; actorId: string | null; pageId: string | null; action: string; data: unknown; createdAt: string }[]>("/admin/audit");
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 text-xs text-stone-500"><tr><th className="p-2">When</th><th className="p-2">Action</th><th className="p-2">Details</th></tr></thead>
        <tbody>
          {data?.map((a) => (
            <tr key={a.id} className="border-b border-stone-100 align-top">
              <td className="whitespace-nowrap p-2 text-xs text-stone-500">{new Date(a.createdAt).toLocaleString()}</td>
              <td className="p-2 font-mono text-xs">{a.action}</td>
              <td className="max-w-[420px] truncate p-2 font-mono text-xs text-stone-600">{JSON.stringify(a.data)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <Card className={warn ? "border-amber-400 bg-amber-50" : ""}>
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </Card>
  );
}
