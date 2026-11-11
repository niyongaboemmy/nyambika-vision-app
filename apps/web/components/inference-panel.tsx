"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Chip, Field, Icon, Input, Note, ScreenSkeleton, SButton, Segmented, StudioSheet, Switch } from "@/components/studio";
import { api, ApiError } from "@/lib/api";

type Route = "tryon" | "stt" | "llm" | "avatar" | "video" | "attr";
type Strategy = "cost" | "latency" | "pool-first" | "hosted-only" | "pool-only";
type ChaosMode = "healthy" | "slow" | "flaky" | "failing" | "down";
interface RoutePolicy {
  strategy: Strategy;
  latency_slo_ms: number;
  residency: "any" | "in-region";
  fallback: boolean;
  pool: { enabled: boolean; cost_rwf: number };
  hosted: { enabled: boolean; cost_rwf: number };
}
interface BackendView {
  configured: boolean;
  region: string;
  breaker: { state: "CLOSED" | "OPEN" | "HALF_OPEN"; consecutive_failures: number; retry_in_s: number | null };
  calls: number;
  ok: number;
  failures: number;
  served_as_fallback: number;
  cost_rwf: number;
  cost_per_call_rwf: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  last_error: string | null;
}
interface RouteView {
  route: Route;
  policy: RoutePolicy;
  health: { status: string; latency_ms?: number; error?: string | null };
  backends: Record<"pool" | "hosted", BackendView>;
  poolShare: number | null;
}
interface VideoModel {
  id: string;
  name: string;
  provider: string;
  status: string;
  configured: boolean;
  licence: string | null;
  canActivate: boolean;
  gateReason: string | null;
  lastEval: { passed: boolean; at: string; modelVersion: string; summary: { subgroups?: number; subgroups_passed?: number; failing_subgroups?: string[]; worst_identity_stability?: number; worst_garment_fidelity?: number; error?: string | null } } | null;
}
interface Overview {
  reachable: boolean;
  error: string | null;
  routingEnabled: boolean;
  pool: { configured: boolean; host: string | null; region: string } | null;
  hosted: { region: string } | null;
  policyVersion: number | null;
  breaker: { failure_threshold: number; cooldown_s: number } | null;
  fakePool: { mode: ChaosMode } | null;
  routes: RouteView[];
  videoModels: VideoModel[];
}

const ROUTE_LABEL: Record<Route, string> = { tryon: "Photo try-on", stt: "Speech to text", llm: "LLM phrasing", avatar: "3D avatar", video: "Video try-on", attr: "Garment attributes · spike" };
const STRATEGY: { value: Strategy; label: string }[] = [
  { value: "cost", label: "Cheapest in SLO" },
  { value: "latency", label: "Fastest" },
  { value: "pool-first", label: "Pool first" },
  { value: "hosted-only", label: "Hosted only" },
  { value: "pool-only", label: "Pool only" },
];
const BREAKER_TONE = { CLOSED: "mint", HALF_OPEN: "gold", OPEN: "red" } as const;
const HEALTH_TONE: Record<string, "mint" | "red" | "stone" | "gold"> = { UP: "mint", DOWN: "red", UNCONFIGURED: "stone", UNKNOWN: "gold" };
const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/** E42 "Inference" panel in Flags & models: pool status, routing policy editor, cost/latency per provider, last eval (E39). */
export function InferencePanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [edit, setEdit] = useState<RouteView | null>(null);
  const [probeRoute, setProbeRoute] = useState<"tryon" | "stt" | "llm" | "avatar">("tryon");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok?: string; error?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>("/admin/inference"));
    } catch (e) {
      setNote({ error: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  /** Runs an action; the outcome goes to the panel note, or back to the caller when `local` (shown on the card). */
  async function run(key: string, fn: () => Promise<string | void>, local = false): Promise<{ ok?: string; error?: string }> {
    setBusy(key);
    if (!local) setNote(null);
    let out: { ok?: string; error?: string } = {};
    try {
      const ok = await fn();
      if (ok) out = { ok };
      await load();
    } catch (e) {
      // NLB gate refusals: the card already says "Activation refused", so show the gate's own reason.
      out = { error: e instanceof ApiError ? (e.code === "NLB_GATE" ? e.raw : e.message) : (e as Error).message };
    } finally {
      setBusy(null);
    }
    if (!local && (out.ok || out.error)) setNote(out);
    return out;
  }

  if (!data) return <ScreenSkeleton variant="list" />;
  return (
    <section aria-labelledby="inference-t" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="inference-t" className="font-display text-xl font-black tracking-tight text-cocoa">Inference</h2>
          <p className="text-sm text-cocoa-2">Self-hosted GPU pool or hosted providers, chosen per call by policy. Live every 3 s.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={data.routingEnabled ? "mint" : "stone"}>{data.routingEnabled ? "Routing on" : "Routing off"}</Chip>
          {data.policyVersion !== null && <Chip tone="violet">Policy v{data.policyVersion}</Chip>}
          {data.pool?.configured ? <Chip tone="sky">Pool {data.pool.host} · {data.pool.region}</Chip> : <Chip>No pool configured</Chip>}
          {data.hosted && <Chip>Hosted · {data.hosted.region}</Chip>}
        </div>
      </div>
      {!data.reachable && <Note error={`AI gateway unreachable: ${data.error ?? ""}`} />}
      {note && <Note ok={note.ok ?? null} error={note.error ?? null} />}

      {/* Controls: synthetic traffic + dev chaos */}
      <div className="st-card grid grid-cols-1 gap-4 rounded-[24px] p-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-2">
          <p className="text-[13px] font-bold text-cocoa">Test traffic (synthetic personas only)</p>
          <Segmented label="Route for test traffic" value={probeRoute} onChange={setProbeRoute} options={(["tryon", "llm", "stt", "avatar"] as const).map((r) => ({ value: r, label: ROUTE_LABEL[r] }))} />
          <SButton
            className="min-h-11"
            disabled={busy !== null}
            onClick={() =>
              run("probe", async () => {
                const r = await api<{ served: Record<string, number>; fallbacks: number; failed: number }>("/admin/inference/probe", { method: "POST", json: { route: probeRoute, n: 10 } });
                return `10 calls: pool ${r.served.pool ?? 0}, hosted ${r.served.hosted ?? 0}, fallbacks ${r.fallbacks}, failed ${r.failed}`;
              })
            }
          >
            <Icon name="refresh" className="size-4" /> {busy === "probe" ? "Sending…" : "Send 10 calls"}
          </SButton>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-[13px] font-bold text-cocoa">
            Pool {data.fakePool ? <Chip tone="gold" className="ml-1">dev fake pool · {data.fakePool.mode}</Chip> : null}
          </p>
          {data.fakePool ? (
            <div role="group" aria-label="Fake pool failure mode" className="flex flex-wrap gap-1.5">
              {(["healthy", "slow", "flaky", "failing", "down"] as const).map((m) => (
                <SButton key={m} variant={data.fakePool?.mode === m ? "dark" : "outline"} aria-pressed={data.fakePool?.mode === m} className="min-h-10" disabled={busy !== null} onClick={() => run(`chaos-${m}`, async () => {
                  await api("/admin/inference/chaos", { method: "POST", json: { mode: m } });
                  return `Fake pool set to ${m}`;
                })}>
                  {m === "healthy" ? "Healthy" : m === "slow" ? "Slow" : m === "flaky" ? "Flaky" : m === "failing" ? "Fail" : "Down"}
                </SButton>
              ))}
            </div>
          ) : (
            <p className="text-sm text-cocoa-2">Chaos controls appear only for the local fake pool.</p>
          )}
          <SButton variant="soft" className="min-h-10" disabled={busy !== null} onClick={() => run("health", async () => { await api("/admin/inference/health", { method: "POST" }); return "Health checked"; })}>
            <Icon name="shield" className="size-4" /> Check health now
          </SButton>
        </div>
      </div>

      {/* Route cards */}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {data.routes.map((r) => (
          <li key={r.route} className="st-card space-y-3 rounded-[24px] p-4" data-route={r.route}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-display text-lg font-black tracking-tight text-cocoa">{ROUTE_LABEL[r.route]}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Chip tone={HEALTH_TONE[r.health.status] ?? "stone"}>Pool health {r.health.status.toLowerCase()}</Chip>
                  <Chip tone="violet">{STRATEGY.find((s) => s.value === r.policy.strategy)?.label}</Chip>
                  {r.policy.residency === "in-region" && <Chip tone="sky">In-country only</Chip>}
                  {!r.policy.fallback && <Chip>No fallback</Chip>}
                </div>
              </div>
              <SButton variant="outline" className="min-h-10 shrink-0" onClick={() => setEdit(r)} aria-label={`Edit ${ROUTE_LABEL[r.route]} policy`}>
                Edit
              </SButton>
            </div>
            {r.poolShare !== null && (
              <div>
                <div className="flex justify-between text-xs font-semibold text-cocoa-2">
                  <span>Served by pool</span>
                  <span className="tabular-nums">{Math.round(r.poolShare * 100)}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-2 ring-1 ring-inset ring-hairline" role="img" aria-label={`${Math.round(r.poolShare * 100)}% of calls served by the pool`}>
                  <div className="h-full rounded-full bg-violet-ink transition-[width] duration-500" style={{ width: `${r.poolShare * 100}%` }} />
                </div>
              </div>
            )}
            {(["pool", "hosted"] as const).map((b) => {
              const s = r.backends[b];
              return (
                <div key={b} className="rounded-2xl bg-paper px-3 py-2.5 ring-1 ring-inset ring-hairline" data-backend={b}>
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <p className="text-sm font-bold text-cocoa">
                      {b === "pool" ? "Self-hosted pool" : "Hosted"} <span className="font-semibold text-cocoa-2">· {s.region}</span>
                    </p>
                    {s.configured ? (
                      <Chip tone={BREAKER_TONE[s.breaker.state]}>
                        {s.breaker.state === "HALF_OPEN" ? "half-open" : s.breaker.state.toLowerCase()}
                        {s.breaker.retry_in_s !== null ? ` · retry ${Math.ceil(s.breaker.retry_in_s)} s` : ""}
                      </Chip>
                    ) : (
                      <Chip>not configured</Chip>
                    )}
                  </div>
                  {s.configured && (
                    <dl className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
                      {[
                        ["Calls", `${s.ok}/${s.calls}`],
                        ["p50 · p95", `${ms(s.p50_ms)} · ${ms(s.p95_ms)}`],
                        ["Cost", `RWF ${Math.round(s.cost_rwf)}`],
                        ["Fallback", s.served_as_fallback],
                      ].map(([k, v]) => (
                        <div key={k as string} className="min-w-0">
                          <dt className="font-semibold text-cocoa-2">{k}</dt>
                          <dd className="truncate font-bold tabular-nums text-cocoa">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {s.last_error && s.failures > 0 && <p className="mt-1 truncate text-[11px] text-red-800">Last error: {s.last_error}</p>}
                </div>
              );
            })}
          </li>
        ))}
      </ul>

      <VideoModels models={data.videoModels} busy={busy} run={run} />
      {edit && <PolicyEditor view={edit} breaker={data.breaker} onClose={() => setEdit(null)} onSaved={async (v) => { setEdit(null); setNote({ ok: `Policy v${v} saved and pushed to the gateway` }); await load(); }} />}
    </section>
  );
}

function VideoModels({ models, busy, run }: { models: VideoModel[]; busy: string | null; run: (key: string, fn: () => Promise<string | void>, local?: boolean) => Promise<{ ok?: string; error?: string }> }) {
  const [msg, setMsg] = useState<Record<string, { ok?: string; error?: string }>>({});
  const act = async (id: string, key: string, fn: () => Promise<string | void>) => {
    setMsg((m) => ({ ...m, [id]: {} }));
    const out = await run(key, fn, true);
    setMsg((m) => ({ ...m, [id]: out }));
  };
  return (
    <div className="space-y-2" aria-labelledby="video-models-t">
      <h3 id="video-models-t" className="font-display text-lg font-black tracking-tight text-cocoa">Video try-on providers · NLB gate</h3>
      <p className="text-sm text-cocoa-2">A provider reaches shoppers only after its NLB video eval passes on every skin tone × body size subgroup (identity stable across frames, garment faithful).</p>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {models.map((m) => {
          const s = m.lastEval?.summary;
          return (
            <li key={m.id} className="st-card space-y-2.5 rounded-[22px] p-4" data-model={m.id}>
              <div className="min-w-0">
                <p className="font-bold text-cocoa">{m.name}</p>
                <p className="truncate font-mono text-xs text-cocoa-2">{m.id}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge value={m.status} />
                  <Chip tone={m.configured ? "mint" : "stone"}>{m.configured ? "configured" : "not configured"}</Chip>
                </div>
              </div>
              {m.licence && <p className="text-xs text-cocoa-2">Licence: {m.licence}</p>}
              <div className="rounded-2xl bg-paper px-3 py-2 text-xs ring-1 ring-inset ring-hairline">
                {m.lastEval ? (
                  <>
                    <p className="font-bold text-cocoa">
                      Last eval: <span className={m.lastEval.passed ? "text-mint-ink" : "text-red-800"}>{m.lastEval.passed ? "passed" : "failed"}</span> · {new Date(m.lastEval.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    <p className="mt-0.5 text-cocoa-2">
                      {s?.subgroups_passed ?? 0}/{s?.subgroups ?? 0} subgroups
                      {s?.worst_identity_stability !== undefined ? ` · stability ≥ ${s.worst_identity_stability}` : ""}
                      {s?.worst_garment_fidelity !== undefined ? ` · fidelity ≥ ${s.worst_garment_fidelity}` : ""}
                    </p>
                    {s?.error && <p className="mt-0.5 text-red-800">{s.error}</p>}
                    {!!s?.failing_subgroups?.length && <p className="mt-0.5 text-red-800">Failing: {s.failing_subgroups.slice(0, 6).join(", ")}</p>}
                  </>
                ) : (
                  <p className="font-semibold text-cocoa-2">No NLB eval yet</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <SButton variant="soft" className="min-h-10" disabled={busy !== null} onClick={() => act(m.id, `eval-${m.id}`, async () => {
                  const r = await api<{ passed: boolean }>(`/admin/video/models/${encodeURIComponent(m.id)}/eval`, { method: "POST" });
                  return r.passed ? `NLB video eval passed for ${m.id}` : `NLB video eval did not pass for ${m.id}`;
                })}>
                  <Icon name="shield" className="size-4" /> {busy === `eval-${m.id}` ? "Evaluating 15 subgroups…" : "Run NLB eval"}
                </SButton>
                <SButton variant={m.status === "ACTIVE" ? "outline" : "primary"} className="min-h-10" disabled={busy !== null} onClick={() => act(m.id, `status-${m.id}`, async () => {
                  const next = m.status === "ACTIVE" ? "RETIRED" : "ACTIVE";
                  await api(`/admin/models/${encodeURIComponent(m.id)}`, { method: "PATCH", json: { status: next } });
                  return next === "ACTIVE" ? `${m.id} activated for shoppers` : `${m.id} retired`;
                })}>
                  {m.status === "ACTIVE" ? "Retire" : "Activate"}
                </SButton>
              </div>
              {(msg[m.id]?.ok || msg[m.id]?.error) && <Note ok={msg[m.id]?.ok ?? null} error={msg[m.id]?.error ? `Activation refused: ${msg[m.id]?.error}` : null} />}
              {!msg[m.id]?.error && m.status !== "ACTIVE" && !m.canActivate && m.gateReason && m.lastEval && <p className="text-xs text-cocoa-2">Gate: {m.gateReason}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PolicyEditor({ view, breaker, onClose, onSaved }: { view: RouteView; breaker: Overview["breaker"]; onClose: () => void; onSaved: (version: number) => void }) {
  const [p, setP] = useState<RoutePolicy>(view.policy);
  const [b, setB] = useState(breaker ?? { failure_threshold: 3, cooldown_s: 15 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const video = view.route === "video";
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ version: number }>(`/admin/inference/policy/${view.route}`, { method: "PUT", json: { policy: p, breaker: b } });
      onSaved(r.version);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <StudioSheet open onClose={onClose} title={`${ROUTE_LABEL[view.route]} routing`} footer={<SButton className="min-h-12 w-full" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save and push"}</SButton>}>
      <div className="space-y-5">
        <Field label="Strategy" group>
          <Segmented label="Strategy" value={p.strategy} onChange={(strategy) => setP({ ...p, strategy })} options={STRATEGY} />
        </Field>
        <Field label="Latency SLO (ms, p95)" hint="Cheapest-in-SLO skips a backend whose observed p95 is above this.">
          <Input type="number" inputMode="numeric" min={50} max={600000} value={p.latency_slo_ms} onChange={(e) => setP({ ...p, latency_slo_ms: Number(e.target.value) })} />
        </Field>
        <Switch checked={p.residency === "in-region"} onChange={(v) => setP({ ...p, residency: v ? "in-region" : "any" })} label="Keep data in the shopper's country" description="Only backends in the request's region are used. If none is healthy the call fails rather than leaving the country." />
        <Switch checked={video ? false : p.fallback} disabled={video} onChange={(v) => setP({ ...p, fallback: v })} label="Fall back to the next backend on failure" description={video ? "Always off for video: every backend serving shoppers needs its own NLB pass." : "A failure trips the circuit breaker and the call is retried on the other backend."} />
        {(["pool", "hosted"] as const).map((k) => (
          <fieldset key={k} className="space-y-2 rounded-2xl bg-paper-2 p-3 ring-1 ring-inset ring-hairline">
            <legend className="sr-only">{k === "pool" ? "Self-hosted pool" : "Hosted provider"}</legend>
            <Switch checked={p[k].enabled} onChange={(v) => setP({ ...p, [k]: { ...p[k], enabled: v } })} label={k === "pool" ? "Self-hosted pool" : "Hosted provider"} />
            <Field label="Cost per call (RWF)">
              <Input type="number" inputMode="decimal" min={0} step="0.5" value={p[k].cost_rwf} onChange={(e) => setP({ ...p, [k]: { ...p[k], cost_rwf: Number(e.target.value) } })} />
            </Field>
          </fieldset>
        ))}
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-2 text-[13px] font-bold text-cocoa">Circuit breaker (all routes)</legend>
          <Field label="Failures to open">
            <Input type="number" min={1} max={50} value={b.failure_threshold} onChange={(e) => setB({ ...b, failure_threshold: Number(e.target.value) })} />
          </Field>
          <Field label="Cool-down (s)">
            <Input type="number" min={1} max={3600} value={b.cooldown_s} onChange={(e) => setB({ ...b, cooldown_s: Number(e.target.value) })} />
          </Field>
        </fieldset>
        <Note error={error} />
      </div>
    </StudioSheet>
  );
}
