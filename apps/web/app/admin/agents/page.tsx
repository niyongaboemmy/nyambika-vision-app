"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Badge, Card, Chip, Empty, Field, Icon, Input, Kpi, Meter, Monogram, Note, ScreenSkeleton, SButton, SectionTitle, Select, StudioSheet, Switch } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const TABS = ["Overview", "Verify", "Moderation", "Migration", "Flags & models", "Outbox", "Audit", "Pilot", "Agents & partners"] as const;
const SCOPES = ["catalogue:read", "checkout:write", "mcp:use", "tryon:write", "usage:read"] as const;
// Categorical series colours (validated: lightness band, chroma, CVD ΔE ≥ 17 on the light surface).
const SERIES = [
  { key: "agent", label: "Agents", color: "#6d4bd8" },
  { key: "partner", label: "Partners", color: "#c45a2c" },
  { key: "anonymous", label: "Anonymous", color: "#0e8f7e" },
] as const;

interface KeyRow { id: string; name: string; prefix: string; env: "LIVE" | "SANDBOX"; scopes: string[]; rateLimitPerMin: number; monthlyQuota: number | null; state: string; lastUsedAt: string | null; expiresAt: string | null; createdAt: string }
interface Contract { status: string; monthlyQuota: number; monthlyFeeRwf: number; overagePriceRwf: number; hardCap: boolean; sandboxDailyCap: number; endsAt: string | null; notes: string }
interface ClientRow { id: string; name: string; kind: "AGENT" | "PARTNER"; status: string; contactEmail: string; hasWebhookSecret: boolean; calls14d: number; keys: KeyRow[]; contract: Contract | null; usage: { live: number; billed: number; overage: number; overageRwf: number; sandbox: number } | null }
interface Job { id: string; status: string; environment: string; model_id: string; client_reference: string | null; clientName: string; image: string | null; billing: { band: string; price: { amount: number } }; guard: { passed: boolean } | null; error: string | null; created_at: string; result: { watermarked: boolean; c2pa: { signed: boolean; sha256: string | null } } | null }
interface Overview {
  killSwitch: Record<string, boolean>;
  totals: { clients: number; activeKeys: number; calls14d: number; errorRate14d: number };
  callsByDay: { day: string; agent: number; partner: number; anonymous: number; errors: number }[];
  tools: { tool: string; n: number }[];
  mandates: { created: number; confirmed: number; paid: number; expired: number; canceled: number; viaMcp: number; paidRwf: number; conversion: number };
  clients: ClientRow[];
  jobs: Job[];
  recentCalls: { id: string; client: string; method: string; route: string; tool: string | null; status: number; latencyMs: number; at: string }[];
  models: { id: string; label: string }[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

/** Host admin · Agents & partners (FR-AGT-08, E37): keys, quotas, usage, mandate conversions, contracts. */
export default function AgentsAdmin() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me?.isHost) router.replace("/signin?next=/admin/agents");
  }, [loading, me, router]);
  const { data, reload } = useApi<Overview>(me?.isHost ? "/admin/agents" : null);
  const [newClient, setNewClient] = useState(false);
  if (!me?.isHost) return null;
  return (
    <AdminShell tabs={TABS} tab="Agents & partners" onTab={(t) => (t === "Pilot" ? router.push("/admin/pilot") : t !== "Agents & partners" && router.push(`/admin?tab=${encodeURIComponent(t)}`))}>
      {!data ? (
        <ScreenSkeleton />
      ) : (
        <>
          <p className="-mt-2 max-w-2xl text-sm text-cocoa-2">AI shopping agents read the public catalogue and start checkouts that shoppers confirm in Nyambika; partners buy guarded try-ons on synthetic models. Keys are stored as hashes only.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={data.killSwitch["agents.kill_switch"] ? "red" : "mint"}>{data.killSwitch["agents.kill_switch"] ? "■ Agent channel paused" : "● Agent channel open"}</Chip>
            <Chip tone={data.killSwitch["partners.kill_switch"] ? "red" : "mint"}>{data.killSwitch["partners.kill_switch"] ? "■ Partner API paused" : "● Partner API open"}</Chip>
            <span className="text-xs font-semibold text-cocoa-2">Kill switches live in Flags & models.</span>
            <SButton className="ml-auto" onClick={() => setNewClient(true)}><Icon name="plus" className="size-4" /> New client</SButton>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Active keys" value={data.totals.activeKeys} hint={`${data.totals.clients} clients`} tone="violet" />
            <Kpi label="Calls · 14 days" value={data.totals.calls14d.toLocaleString()} spark={data.callsByDay.map((d) => d.agent + d.partner + d.anonymous)} />
            <Kpi label="Error rate · 14 days" value={pct(data.totals.errorRate14d)} hint="4xx/5xx, incl. rate limits" warn={data.totals.errorRate14d > 0.2} tone="gold" />
            <Kpi label="Mandate conversion" value={pct(data.mandates.conversion)} hint={`${data.mandates.paid} paid of ${data.mandates.created} · 30 days`} tone="mint" />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-5">
            <UsageChart days={data.callsByDay} />
            <Funnel m={data.mandates} tools={data.tools} />
          </div>

          <section aria-labelledby="clients" className="space-y-3">
            <SectionTitle id="clients" title="Clients & keys" eyebrow="Agents and partners" />
            {data.clients.length === 0 && <Empty title="No clients yet" icon="globe">Create an agent or partner to issue its first key.</Empty>}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
              {data.clients.map((c) => <ClientCard key={c.id} c={c} models={data.models} onChange={reload} />)}
            </div>
          </section>

          <section aria-labelledby="jobs" className="space-y-3">
            <SectionTitle id="jobs" title="Partner try-on jobs" eyebrow="Latest 8" />
            {data.jobs.length === 0 ? (
              <Empty title="No try-ons yet" icon="sparkle">Run a sandbox try-on from a partner card.</Empty>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {data.jobs.map((j) => (
                  <li key={j.id} className="st-card overflow-hidden rounded-[22px]">
                    <div className="relative aspect-[3/4] bg-paper-2">
                      {j.image ? <img src={j.image} alt={`Try-on result for ${j.client_reference ?? j.id} on ${j.model_id}`} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xs font-bold text-cocoa-2">{j.status}</div>}
                      {j.result?.watermarked && <span className="absolute left-2 top-2 rounded-full bg-cocoa/85 px-2 py-0.5 text-[11px] font-bold text-white">Sandbox</span>}
                    </div>
                    <div className="space-y-1.5 p-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge value={j.status.toUpperCase()} />
                        {j.result?.c2pa.signed && <Chip tone="violet">C2PA ✓</Chip>}
                      </div>
                      <p className="truncate text-xs font-bold text-cocoa">{j.clientName}</p>
                      <p className="truncate text-[11px] text-cocoa-2">{j.model_id} · {j.billing.band === "none" ? "not billed" : `${j.billing.band}${j.billing.price.amount ? ` · ${rwf(j.billing.price.amount)}` : ""}`}</p>
                      {j.error && <p className="line-clamp-2 text-[11px] text-red-800">{j.error}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="calls" className="space-y-3">
            <SectionTitle id="calls" title="Agent call log" eyebrow="Audit · latest 25" />
            <Card className="!p-2">
              <ul className="divide-y divide-hairline">
                {data.recentCalls.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5 text-sm">
                    <span className={`w-11 shrink-0 rounded-lg px-1.5 py-0.5 text-center text-xs font-black tabular-nums ${c.status >= 400 ? "bg-red-50 text-red-800" : "bg-emerald-50 text-mint-ink"}`}>{c.status}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-cocoa">{c.method} {c.route}{c.tool ? <span className="text-violet-ink"> · {c.tool}</span> : null}</span>
                    <span className="text-xs text-cocoa-2">{c.client} · {c.latencyMs} ms · {ago(c.at)}</span>
                  </li>
                ))}
                {data.recentCalls.length === 0 && <li className="p-3 text-sm text-cocoa-2">No calls yet.</li>}
              </ul>
            </Card>
          </section>
        </>
      )}
      <NewClientSheet open={newClient} onClose={() => setNewClient(false)} onDone={reload} />
    </AdminShell>
  );
}

/** 14-day calls, stacked by client kind. Hover/focus a day for exact numbers; the table is for screen readers. */
function UsageChart({ days }: { days: Overview["callsByDay"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.agent + d.partner + d.anonymous));
  const H = 140;
  const h = hover !== null ? days[hover] : null;
  return (
    <Card className="space-y-3 lg:col-span-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-black tracking-tight text-cocoa">Calls per day</h2>
        <ul className="flex flex-wrap gap-3 text-xs font-semibold text-cocoa-2" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</li>
          ))}
        </ul>
      </div>
      <div className="relative">
        <div className="flex h-[140px] items-end gap-[3px] border-b border-hairline" aria-hidden>
          {days.map((d, i) => {
            const total = d.agent + d.partner + d.anonymous;
            return (
              <div key={d.day} className="flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className={`flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] transition-opacity ${hover !== null && hover !== i ? "opacity-50" : ""}`} style={{ height: `${(total / max) * H}px`, minHeight: total ? 3 : 0 }}>
                  {SERIES.map((s) => (d[s.key] ? <div key={s.key} style={{ background: s.color, flexGrow: d[s.key] }} /> : null))}
                </div>
              </div>
            );
          })}
        </div>
        {h && (
          <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-xl bg-cocoa px-3 py-2 text-xs text-white shadow-lg">
            <p className="font-bold">{new Date(h.day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
            <p>{h.agent} agent · {h.partner} partner · {h.anonymous} anonymous · {h.errors} errors</p>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[11px] font-semibold text-cocoa-2">
          <span>{new Date(days[0].day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
          <span>max {max}/day</span>
          <span>today</span>
        </div>
      </div>
      <table className="sr-only">
        <caption>Calls per day by client kind</caption>
        <thead><tr><th>Day</th><th>Agents</th><th>Partners</th><th>Anonymous</th><th>Errors</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.agent}</td><td>{d.partner}</td><td>{d.anonymous}</td><td>{d.errors}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}

function Funnel({ m, tools }: { m: Overview["mandates"]; tools: Overview["tools"] }) {
  const steps = [
    { label: "Checkouts created by agents", n: m.created },
    { label: "Confirmed by the shopper", n: m.confirmed },
    { label: "Paid to the maker", n: m.paid },
  ];
  return (
    <Card className="space-y-3 lg:col-span-2">
      <h2 className="font-display text-lg font-black tracking-tight text-cocoa">Mandate conversions · 30 days</h2>
      <ol className="space-y-2.5">
        {steps.map((s) => (
          <li key={s.label} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-cocoa">{s.label}</span><span className="font-display font-black tabular-nums text-cocoa">{s.n}</span></div>
            <div className="h-2.5 overflow-hidden rounded-full bg-paper-2" role="meter" aria-label={s.label} aria-valuemin={0} aria-valuemax={Math.max(1, m.created)} aria-valuenow={s.n}><div className="h-full rounded-full bg-gradient-to-r from-terra to-violet" style={{ width: `${Math.max(2, (s.n / Math.max(1, m.created)) * 100)}%` }} /></div>
          </li>
        ))}
      </ol>
      <p className="text-xs font-semibold text-cocoa-2">{m.expired} expired · {m.canceled} cancelled · {m.viaMcp} via MCP · {rwf(m.paidRwf)} paid directly to makers</p>
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{tools.slice(0, 6).map((t) => <Chip key={t.tool} tone="violet">{t.tool} · {t.n}</Chip>)}</div>
      )}
    </Card>
  );
}

function ClientCard({ c, models, onChange }: { c: ClientRow; models: Overview["models"]; onChange: () => void }) {
  const [keySheet, setKeySheet] = useState(false);
  const [contractSheet, setContractSheet] = useState(false);
  const [sandboxSheet, setSandboxSheet] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = c.keys.filter((k) => k.state === "OK");
  return (
    <Card className="min-w-0 space-y-4">
      <div className="flex items-start gap-3">
        <Monogram name={c.name} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-lg font-black text-cocoa">{c.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip tone={c.kind === "AGENT" ? "violet" : "gold"}>{c.kind === "AGENT" ? "AI agent" : "Partner"}</Chip>
            <Badge value={c.status} />
            <Chip>{c.calls14d} calls · 14 d</Chip>
          </div>
        </div>
        <SButton variant="ghost" className="min-h-10" onClick={async () => { await api(`/admin/agents/clients/${c.id}/status`, { method: "POST", json: { status: c.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" } }); onChange(); }}>
          {c.status === "ACTIVE" ? "Suspend" : "Reactivate"}
        </SButton>
      </div>

      {c.kind === "PARTNER" && c.contract && c.usage && (
        <div className="space-y-2 rounded-2xl bg-paper p-3 ring-1 ring-inset ring-hairline">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-cocoa">Contract <Badge value={c.contract.status} /></p>
            <p className="text-xs font-semibold text-cocoa-2">{rwf(c.contract.monthlyFeeRwf)}/month · overage {rwf(c.contract.overagePriceRwf)}{c.contract.hardCap ? " · hard cap" : ""}</p>
          </div>
          <Meter value={c.usage.billed} max={c.contract.monthlyQuota} label="Looks used this month against quota" />
          <p className="text-xs text-cocoa-2"><b className="text-cocoa">{c.usage.billed}</b> of {c.contract.monthlyQuota} included looks this month · {c.usage.overage} overage ({rwf(c.usage.overageRwf)}) · {c.usage.sandbox} sandbox</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <SButton variant="outline" className="min-h-10" onClick={() => setContractSheet(true)}>Edit contract</SButton>
            <SButton variant="outline" className="min-h-10" onClick={() => setSandboxSheet(true)}><Icon name="sparkle" className="size-4" /> Sandbox try-on</SButton>
            <a className="st-press inline-flex min-h-10 items-center gap-1.5 rounded-2xl border border-hairline bg-white px-3.5 text-sm font-bold text-cocoa" href={`/api/admin/agents/clients/${c.id}/usage.csv`} download><Icon name="download" className="size-4" /> Usage CSV</a>
            <SButton variant="ghost" className="min-h-10" onClick={async () => setSecret((await api<{ secret: string }>(`/admin/agents/clients/${c.id}/webhook-secret`, { method: "POST" })).secret)}>
              {c.hasWebhookSecret ? "Rotate webhook secret" : "Create webhook secret"}
            </SButton>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-cocoa">Keys <span className="text-cocoa-2">· {live.length} active</span></p>
          <SButton variant="dark" className="min-h-10" onClick={() => setKeySheet(true)}><Icon name="plus" className="size-4" /> New key</SButton>
        </div>
        <ul className="space-y-2">
          {c.keys.map((k) => (
            <li key={k.id} className={`flex flex-wrap items-center gap-2 rounded-2xl bg-white p-2.5 ring-1 ring-inset ring-hairline ${k.state !== "OK" ? "opacity-60" : ""}`}>
              <code className="rounded-lg bg-paper-2 px-2 py-1 text-xs font-bold text-cocoa">{k.prefix}…</code>
              <Chip tone={k.env === "LIVE" ? "mint" : "sky"}>{k.env.toLowerCase()}</Chip>
              {k.state !== "OK" && <Badge value={k.state === "REVOKED" ? "CANCELLED" : "SUSPENDED"} label={k.state.toLowerCase()} />}
              <span className="order-last w-full text-xs leading-relaxed text-cocoa-2">{k.scopes.join(" · ")} · {k.rateLimitPerMin}/min{k.monthlyQuota ? ` · ${k.monthlyQuota.toLocaleString()}/month` : ""} · used {ago(k.lastUsedAt)}</span>
              {k.state === "OK" && (
                <SButton variant="ghost" className="ml-auto min-h-9 text-red-800" aria-label={`Revoke key ${k.prefix}`} onClick={async () => { await api(`/admin/agents/keys/${k.id}/revoke`, { method: "POST" }); onChange(); }}>Revoke</SButton>
              )}
            </li>
          ))}
          {c.keys.length === 0 && <li className="text-sm text-cocoa-2">No keys yet.</li>}
        </ul>
      </div>
      <Note error={err} />

      <KeySheet client={c} open={keySheet} onClose={() => setKeySheet(false)} onCreated={(s) => { setSecret(s); onChange(); }} onError={setErr} />
      {c.contract && <ContractSheet client={c} open={contractSheet} onClose={() => setContractSheet(false)} onDone={onChange} />}
      <SandboxSheet client={c} models={models} open={sandboxSheet} onClose={() => setSandboxSheet(false)} onDone={onChange} />
      <SecretSheet secret={secret} onClose={() => setSecret(null)} />
    </Card>
  );
}

function SecretSheet({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <StudioSheet open={Boolean(secret)} onClose={() => { setCopied(false); onClose(); }} title="Copy this secret now" footer={<SButton className="w-full" onClick={() => { setCopied(false); onClose(); }}>I saved it</SButton>}>
      <div className="space-y-3">
        <p className="text-sm text-cocoa-2">Nyambika stores only a hash. This is the only time it is shown.</p>
        <code data-testid="new-secret" className="block break-all rounded-2xl bg-cocoa p-4 font-mono text-sm font-bold text-white">{secret}</code>
        <SButton variant="outline" onClick={async () => { await navigator.clipboard?.writeText(secret ?? "").catch(() => undefined); setCopied(true); }}><Icon name="copy" className="size-4" /> {copied ? "Copied" : "Copy"}</SButton>
      </div>
    </StudioSheet>
  );
}

function KeySheet({ client, open, onClose, onCreated, onError }: { client: ClientRow; open: boolean; onClose: () => void; onCreated: (s: string) => void; onError: (e: string | null) => void }) {
  const defaults = client.kind === "AGENT" ? ["catalogue:read", "checkout:write", "mcp:use"] : ["tryon:write", "usage:read"];
  const [env, setEnv] = useState<"LIVE" | "SANDBOX">(client.kind === "PARTNER" ? "SANDBOX" : "LIVE");
  const [scopes, setScopes] = useState<string[]>(defaults);
  const [rate, setRate] = useState("120");
  const [quota, setQuota] = useState("");
  const [busy, setBusy] = useState(false);
  const allowed = SCOPES.filter((s) => (client.kind === "AGENT" ? !s.startsWith("tryon") && s !== "usage:read" : true));
  return (
    <StudioSheet
      open={open}
      onClose={onClose}
      title={`New key · ${client.name}`}
      footer={
        <SButton
          className="w-full"
          disabled={busy || !scopes.length}
          onClick={async () => {
            setBusy(true);
            onError(null);
            try {
              const r = await api<{ secret: string }>(`/admin/agents/clients/${client.id}/keys`, { method: "POST", json: { env, scopes, rateLimitPerMin: Number(rate) || 120, monthlyQuota: quota ? Number(quota) : null } });
              onClose();
              onCreated(r.secret);
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create key"}
        </SButton>
      }
    >
      <div className="space-y-4">
        <Field label="Environment" group>
          <div className="flex gap-2">
            {(["LIVE", "SANDBOX"] as const).map((e) => (
              <label key={e} className={`st-press flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-2xl text-sm font-bold ring-inset ${env === e ? "bg-cocoa text-white" : "bg-white text-cocoa ring-1 ring-hairline"}`}>
                <input type="radio" name="env" className="sr-only" checked={env === e} onChange={() => setEnv(e)} />
                {e === "LIVE" ? "Live" : "Sandbox (watermarked)"}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Scopes" group hint="A key can only call routes whose scope it holds.">
          <div className="space-y-1">
            {allowed.map((s) => (
              <Switch key={s} checked={scopes.includes(s)} onChange={(v) => setScopes(v ? [...scopes, s] : scopes.filter((x) => x !== s))} label={s} />
            ))}
          </div>
        </Field>
        <Field label="Rate limit (requests per minute)"><Input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Monthly quota (calls)" hint="Leave empty for no monthly cap."><Input inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 50000" /></Field>
      </div>
    </StudioSheet>
  );
}

function ContractSheet({ client, open, onClose, onDone }: { client: ClientRow; open: boolean; onClose: () => void; onDone: () => void }) {
  const c = client.contract!;
  const [f, setF] = useState({ status: c.status, monthlyQuota: String(c.monthlyQuota), monthlyFeeRwf: String(c.monthlyFeeRwf), overagePriceRwf: String(c.overagePriceRwf), hardCap: c.hardCap, sandboxDailyCap: String(c.sandboxDailyCap) });
  const [err, setErr] = useState<string | null>(null);
  const num = (v: string) => Number(v.replace(/\D/g, "")) || 0;
  return (
    <StudioSheet
      open={open}
      onClose={onClose}
      title="Try-on contract"
      footer={
        <SButton
          className="w-full"
          onClick={async () => {
            try {
              await api(`/admin/agents/clients/${client.id}/contract`, { method: "PUT", json: { status: f.status, monthlyQuota: num(f.monthlyQuota), monthlyFeeRwf: num(f.monthlyFeeRwf), overagePriceRwf: num(f.overagePriceRwf), hardCap: f.hardCap, sandboxDailyCap: Math.max(1, num(f.sandboxDailyCap)), notes: c.notes } });
              onClose();
              onDone();
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Save contract
        </SButton>
      }
    >
      <div className="space-y-4">
        <Field label="Status">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {["DRAFT", "ACTIVE", "SUSPENDED", "ENDED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Included looks / month"><Input inputMode="numeric" value={f.monthlyQuota} onChange={(e) => setF({ ...f, monthlyQuota: e.target.value })} /></Field>
          <Field label="Monthly fee (RWF)"><Input inputMode="numeric" value={f.monthlyFeeRwf} onChange={(e) => setF({ ...f, monthlyFeeRwf: e.target.value })} /></Field>
          <Field label="Overage price (RWF / look)"><Input inputMode="numeric" value={f.overagePriceRwf} onChange={(e) => setF({ ...f, overagePriceRwf: e.target.value })} /></Field>
          <Field label="Sandbox calls / day"><Input inputMode="numeric" value={f.sandboxDailyCap} onChange={(e) => setF({ ...f, sandboxDailyCap: e.target.value })} /></Field>
        </div>
        <Switch checked={f.hardCap} onChange={(v) => setF({ ...f, hardCap: v })} label="Hard cap" description="Refuse calls past the quota instead of billing overage." />
        <Note error={err} />
      </div>
    </StudioSheet>
  );
}

function SandboxSheet({ client, models, open, onClose, onDone }: { client: ClientRow; models: Overview["models"]; open: boolean; onClose: () => void; onDone: () => void }) {
  const { data: samples } = useApi<{ id: string; title: string; colourName: string; image: string | null }[]>(open ? "/admin/agents/samples" : null);
  const [model, setModel] = useState(models[1]?.id ?? models[0]?.id);
  const [variant, setVariant] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = variant ?? samples?.[0]?.id ?? null;
  useEffect(() => {
    if (!job || !["queued", "generating", "guarding"].includes(job.status)) return;
    const t = setTimeout(async () => {
      const o = await api<Overview>("/admin/agents");
      const j = o.jobs.find((x) => x.id === job.id);
      if (j) setJob(j);
      if (j && !["queued", "generating", "guarding"].includes(j.status)) onDone();
    }, 1200);
    return () => clearTimeout(t);
  }, [job, onDone]);
  return (
    <StudioSheet
      open={open}
      onClose={() => { setJob(null); onClose(); }}
      title="Sandbox try-on"
      footer={
        <SButton
          className="w-full"
          disabled={busy || !pick}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const j = await api<Job>(`/admin/agents/clients/${client.id}/sandbox-tryon`, { method: "POST", json: { modelId: model, variantId: pick } });
              setJob({ ...j, clientName: client.name, image: null });
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : "Run sandbox try-on"}
        </SButton>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-cocoa-2">Runs as {client.name} with its sandbox key: same guard and C2PA as live, watermarked, never billed.</p>
        <Field label="Synthetic model">
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.id})</option>)}
          </Select>
        </Field>
        <Field label="Sample garment" group>
          <div className="grid grid-cols-3 gap-2">
            {(samples ?? []).map((s) => (
              <label key={s.id} className={`st-press cursor-pointer overflow-hidden rounded-2xl bg-white ring-inset ${pick === s.id ? "ring-2 ring-cocoa" : "ring-1 ring-hairline"}`}>
                <input type="radio" name="garment" className="sr-only" checked={pick === s.id} onChange={() => setVariant(s.id)} />
                {s.image && <img src={s.image} alt="" className="aspect-square w-full object-cover" />}
                <span className="block truncate px-2 py-1 text-[11px] font-bold text-cocoa">{s.title} · {s.colourName}</span>
              </label>
            ))}
          </div>
        </Field>
        {job && (
          <div ref={(el) => { if (el && job.image) el.scrollIntoView({ block: "center", behavior: "auto" }); }} className="space-y-2 rounded-2xl bg-paper p-3 ring-1 ring-inset ring-hairline" role="status">
            <div className="flex items-center gap-2"><Badge value={job.status.toUpperCase()} /><span className="text-xs text-cocoa-2">{job.id}</span></div>
            {job.image ? <img src={job.image} alt="Sandbox try-on result (watermarked)" className="mx-auto max-h-80 rounded-2xl" /> : !job.error && <div data-skeleton className="st-skel mx-auto aspect-[3/4] w-48 rounded-2xl" />}
            {job.error && <p className="text-xs text-red-800">{job.error}</p>}
          </div>
        )}
        <Note error={err} />
      </div>
    </StudioSheet>
  );
}

function NewClientSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<"AGENT" | "PARTNER">("AGENT");
  const [err, setErr] = useState<string | null>(null);
  return (
    <StudioSheet
      open={open}
      onClose={onClose}
      title="New client"
      footer={
        <SButton
          className="w-full"
          disabled={name.trim().length < 2}
          onClick={async () => {
            try {
              await api("/admin/agents/clients", { method: "POST", json: { name, kind, contactEmail: email } });
              setName("");
              setEmail("");
              onClose();
              onDone();
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Create client
        </SButton>
      }
    >
      <div className="space-y-4">
        <Field label="Kind" group>
          <div className="flex gap-2">
            {(["AGENT", "PARTNER"] as const).map((k) => (
              <label key={k} className={`st-press flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-2xl text-sm font-bold ring-inset ${kind === k ? "bg-cocoa text-white" : "bg-white text-cocoa ring-1 ring-hairline"}`}>
                <input type="radio" name="kind" className="sr-only" checked={kind === k} onChange={() => setKind(k)} />
                {k === "AGENT" ? "AI shopping agent" : "Try-on partner"}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kigali Shopping Assistant" /></Field>
        <Field label="Contact email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@partner.example" /></Field>
        <Note error={err} />
      </div>
    </StudioSheet>
  );
}
