"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { ADMIN_TABS, adminTabHref } from "../tabs";
import { Card, Chip, Empty, Icon, Kpi, Note, ScreenSkeleton, SButton, Select } from "@/components/studio";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { InfoTip } from "@/components/kit";
import { MoreActions } from "@/components/ios";


interface RunRow {
  waveId: string;
  name: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  concurrency: number;
  createdAt: string;
}
interface Dash {
  wave: { id: string; name: string; createdAt: string; status: string };
  run: { status: string; total: number; done: number; failed: number; concurrency: number; maxRunning: number; running: number; queued: number; cancelled: number; cadenceDays: number[]; startedAt: string | null; finishedAt: string | null };
  funnel: { imported: number; reviewed: number; signedOff: number; live: number };
  status: Record<string, number>;
  defects: Record<string, number>;
  pagesWithDefects: number;
  failures: { handle: string; error: string | null }[];
  redirects: { total: number; active: number; hits: number; top: { from: string; to: string; hits: number; active: boolean }[] };
  outreach: { invites: number; reminders: number; byReminder: number[] };
  checklist: { key: string; label: string; done: boolean; auto: boolean; hint?: string }[];
}

const DEFECT_LABEL: Record<string, string> = { photos: "Photos", payments: "MoMo missing", catalogue: "No products", story: "Short story", other: "Other" };

/** Full-network migration dashboard (E21, FR-MIG-04/05). */
export default function NetworkMigration() {
  const router = useRouter();
  const { data: runs, reload: reloadRuns } = useApi<RunRow[]>("/admin/migration/network");
  const [waveId, setWaveId] = useState<string | null>(null);
  const [d, setD] = useState<Dash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState("4");

  useEffect(() => {
    if (!waveId && runs?.[0]) setWaveId(runs[0].waveId);
  }, [runs, waveId]);
  const load = useCallback(async () => {
    if (waveId) setD(await api<Dash>(`/admin/migration/network/${waveId}`));
  }, [waveId]);
  useEffect(() => {
    void load();
    const live = d?.run.status === "RUNNING" || d?.run.status === "QUEUED";
    const id = setInterval(load, live ? 1200 : 6000);
    return () => clearInterval(id);
  }, [load, d?.run.status]);

  async function upload(file: File) {
    setBusy("upload");
    setErr(null);
    try {
      const r = await api<{ waveId: string; total: number }>(`/admin/migration/network/waves?concurrency=${concurrency}`, { method: "POST", body: await file.text(), headers: { "content-type": "application/json" } });
      setOk(`Wave queued: ${r.total} pages, ${concurrency} at a time.`);
      setWaveId(r.waveId);
      await reloadRuns();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function act(path: string, label: string, body?: object, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(label);
    setErr(null);
    setOk(null);
    try {
      const r = await api<Record<string, number>>(`/admin/migration/network/${waveId}/${path}`, { method: "POST", json: body ?? {} });
      setOk(`${label}: ${Object.entries(r).map(([k, v]) => `${v} ${k}`).join(", ")}`);
      await load();
      await reloadRuns();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const pct = d ? Math.round(((d.run.done + d.run.failed) / Math.max(1, d.run.total)) * 100) : 0;
  const maxDefect = d ? Math.max(1, ...Object.values(d.defects)) : 1;
  const funnel = d ? [
    { k: "Imported", v: d.funnel.imported, c: "bg-stone-400" },
    { k: "Review sent", v: d.funnel.reviewed, c: "bg-amber-500" },
    { k: "Signed off", v: d.funnel.signedOff, c: "bg-sky-500" },
    { k: "Live", v: d.funnel.live, c: "bg-emerald-600" },
  ] : [];

  return (
    <AdminShell tabs={ADMIN_TABS} tab="Migration" onTab={(t) => router.push(adminTabHref(t))}>
      <div className="space-y-4">
        <div className="-mt-2 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-black tracking-tight text-cocoa">Whole network</h2>
          <a href="/admin?tab=Migration" className="st-press inline-flex min-h-11 items-center gap-1 rounded-2xl px-2 text-sm font-bold text-violet-ink hover:bg-paper-2">Per-page view <Icon name="chevron" className="size-4" /></a>
        </div>

        <Card className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-28 space-y-1.5">
              <span className="text-[13px] font-bold text-cocoa">At a time</span>
              <Select value={concurrency} onChange={(e) => setConcurrency(e.target.value)}>{[1, 2, 4, 6, 8, 12, 16].map((n) => <option key={n}>{n}</option>)}</Select>
            </label>
            <label className={`st-press flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-paper-3 bg-paper px-4 text-sm font-bold text-cocoa hover:border-cocoa-3 focus-within:outline focus-within:outline-[2.5px] focus-within:outline-violet-ink ${busy === "upload" ? "opacity-50" : ""}`}>
              <Icon name="upload" className="size-4" /> {busy === "upload" ? "Uploading…" : "Start wave (.json)"}
              <input type="file" accept="application/json,.json" className="sr-only" disabled={!!busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          </div>
          <p className="flex items-center gap-1 text-xs font-semibold text-cocoa-2">≤ 2,000 pages · old page stays until sign-off
          <InfoTip label="About network waves">Up to 2,000 pages per bundle. Pages import on the queue with this many in flight; owners keep their old page until they sign off. Synthetic network: <code className="rounded bg-paper-2 px-1">scripts/migration/make-network.py</code>.</InfoTip></p>
          {runs && runs.length > 0 && (
            <label className="block space-y-1.5">
              <span className="text-[13px] font-bold text-cocoa">Wave</span>
              <Select value={waveId ?? ""} onChange={(e) => setWaveId(e.target.value)}>
                {runs.map((r) => <option key={r.waveId} value={r.waveId}>{r.name} · {r.status.toLowerCase().replace("_", " ")}</option>)}
              </Select>
            </label>
          )}
          <Note error={err} ok={ok} />
        </Card>

        {runs?.length === 0 && <Empty icon="swap" title="No network waves yet">Upload a bundle.</Empty>}
        {waveId && !d && <ScreenSkeleton />}
        {d && (
          <>
            <section aria-labelledby="prog" className="st-hero rounded-[26px] p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 id="prog" className="font-display text-xl font-black text-cocoa">{d.wave.name}</h2>
                  <p className="text-sm text-cocoa-2">{d.run.status === "RUNNING" ? `Importing · ${d.run.running} in flight (max ${d.run.concurrency}) · ${d.run.queued} waiting` : d.run.status === "ROLLED_BACK" ? "Rolled back · legacy pages are live" : `Imported ${d.run.finishedAt ? new Date(d.run.finishedAt).toLocaleString() : ""}`} · peak {d.run.maxRunning} at once</p>
                </div>
                <Chip tone={d.run.status === "ROLLED_BACK" ? "red" : d.run.status === "RUNNING" ? "gold" : "mint"}>{d.run.status.replace("_", " ").toLowerCase()}</Chip>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-sm font-bold text-cocoa"><span>{d.run.done + d.run.failed} / {d.run.total} processed</span><span className="tabular-nums">{pct}%</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/70" role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={d.run.total} aria-valuenow={d.run.done + d.run.failed}>
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 transition-[width] duration-700" style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Imported" value={d.funnel.imported} hint={d.run.failed ? `${d.run.failed} failed` : "no failures"} warn={d.run.failed > 0} />
              <Kpi label="Review sent" value={d.funnel.reviewed} hint={`${d.outreach.reminders} reminders`} tone="gold" />
              <Kpi label="Signed off" value={d.funnel.signedOff} hint={`${Math.round((d.funnel.signedOff / Math.max(1, d.run.total)) * 100)}% · Gate 4 needs 95%`} tone="violet" />
              <Kpi label="Live" value={d.funnel.live} hint={`${d.redirects.hits} redirect hits`} tone="mint" />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card>
                <h3 className="font-extrabold text-cocoa">Funnel</h3>
                <ul className="mt-3 space-y-2.5">
                  {funnel.map((f) => (
                    <li key={f.k}>
                      <div className="flex justify-between text-sm"><span className="font-bold text-cocoa">{f.k}</span><span className="tabular-nums text-cocoa-2">{f.v}</span></div>
                      <span className="mt-1 block h-2.5 overflow-hidden rounded-full bg-paper-2"><span className={`block h-full rounded-full ${f.c}`} style={{ width: `${(f.v / Math.max(1, d.run.total)) * 100}%` }} /></span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <h3 className="font-extrabold text-cocoa">Defects by category</h3>
                <p className="text-xs text-cocoa-2">{d.pagesWithDefects} pages to fix</p>
                <ul className="mt-3 space-y-2.5">
                  {Object.entries(d.defects).map(([k, v]) => (
                    <li key={k}>
                      <div className="flex justify-between text-sm"><span className="font-bold text-cocoa">{DEFECT_LABEL[k] ?? k}</span><span className="tabular-nums text-cocoa-2">{v}</span></div>
                      <span className="mt-1 block h-2.5 overflow-hidden rounded-full bg-paper-2"><span className="block h-full rounded-full bg-gradient-to-r from-terra to-violet" style={{ width: `${(v / maxDefect) * 100}%` }} /></span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card className="space-y-3">
                <h3 className="flex items-center gap-1 font-extrabold text-cocoa">
                  Owner outreach
                  <InfoTip label="About outreach">WhatsApp review links, then reminders on days {d.run.cadenceDays.join(", ")} after the invite for pages not signed off.</InfoTip>
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Chip><Icon name="clock" className="size-3.5" /> days {d.run.cadenceDays.join(" · ")}</Chip>
                  <Chip tone="sky">{d.outreach.invites} invited</Chip>
                  {d.outreach.byReminder.map((n, i) => <Chip key={i} tone={n ? "gold" : "stone"}>reminder {i + 1}: {n}</Chip>)}
                </div>
                <div className="flex items-center gap-2">
                  <SButton className="flex-1" onClick={() => act("outreach", "Review links sent")} disabled={!!busy || d.run.status === "ROLLED_BACK"}><Icon name="mail" className="size-4" /> Send review links</SButton>
                  <MoreActions
                    label="More outreach actions"
                    title="Owner outreach"
                    actions={[
                      { label: "Chase unsigned now", icon: "bell", disabled: !!busy, onSelect: () => act("chase", "Reminders sent") },
                      { label: "Rehearse cadence (+3 days, dev)", icon: "clock", disabled: !!busy, onSelect: () => act("chase", "Rehearsal reminders", { asOf: new Date(Date.now() + 3 * 86400_000).toISOString() }) },
                    ]}
                  />
                </div>
              </Card>
              <Card className="space-y-3">
                <h3 className="font-extrabold text-cocoa">Redirects</h3>
                <p className="text-sm text-cocoa-2">{d.redirects.active} of {d.redirects.total} legacy URLs redirecting · {d.redirects.hits} hits</p>
                {d.redirects.top.length > 0 && (
                  <ul className="divide-y divide-hairline text-xs">
                    {d.redirects.top.map((r) => <li key={r.from} className="flex justify-between gap-2 py-1.5"><span className="truncate font-mono">{r.from}</span><span className="font-bold tabular-nums">{r.hits}</span></li>)}
                  </ul>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <a href={`/api/admin/migration/network/${d.wave.id}/redirects?format=csv`} onClick={() => setTimeout(load, 800)} className="st-press inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-hairline bg-white px-3 text-sm font-bold text-cocoa"><Icon name="download" className="size-4" /> CSV map</a>
                  <a href={`/api/admin/migration/network/${d.wave.id}/redirects?format=nginx`} onClick={() => setTimeout(load, 800)} className="st-press inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-hairline bg-white px-3 text-sm font-bold text-cocoa"><Icon name="download" className="size-4" /> nginx map</a>
                </div>
              </Card>
            </div>

            <Card>
              <h3 className="font-extrabold text-cocoa">Cut-over checklist</h3>
              <ul className="mt-3 space-y-2">
                {d.checklist.map((c) => (
                  <li key={c.key} className="flex items-center gap-3 rounded-2xl bg-paper p-3 ring-1 ring-inset ring-hairline">
                    <span className={`grid size-8 shrink-0 place-items-center rounded-full ${c.done ? "bg-emerald-600 text-white" : "bg-white text-cocoa-3 ring-1 ring-inset ring-hairline"}`}>{c.done ? <Icon name="check" className="size-4" /> : null}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-cocoa">{c.label}</span>
                      <span className="block truncate text-xs text-cocoa-2">{c.auto ? "Auto" : "Manual"}{c.hint ? ` · ${c.hint}` : ""}</span>
                    </span>
                    {!c.auto && (
                      <SButton variant={c.done ? "ghost" : "outline"} className="px-3 text-xs" onClick={() => act("checklist", c.done ? "Unticked" : "Ticked", { key: c.key, done: !c.done })}>{c.done ? "Undo" : "Tick"}</SButton>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            {d.failures.length > 0 && (
              <Card>
                <h3 className="font-extrabold text-cocoa">Failed imports ({d.run.failed})</h3>
                <ul className="mt-2 divide-y divide-hairline text-sm">
                  {d.failures.map((f) => <li key={f.handle} className="py-2"><span className="font-mono text-xs font-bold text-cocoa">{f.handle}</span><span className="block text-xs text-red-800">{f.error}</span></li>)}
                </ul>
              </Card>
            )}

            <Card className="space-y-3 !border-red-200">
              <h3 className="font-extrabold text-cocoa">Go live and rollback</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SButton onClick={() => act("go-live-signed", "Went live", undefined, `Publish every signed-off page in “${d.wave.name}” and switch on its redirects?`)} disabled={!!busy || !d.status.SIGNED_OFF}>Go live: all signed off ({d.status.SIGNED_OFF ?? 0})</SButton>
                <SButton variant="danger" onClick={() => act("rollback-all", "Rolled back", undefined, `Roll back the whole wave? Every page is hidden again, redirects switch off and the legacy pages stay live.`)} disabled={!!busy || d.run.status === "ROLLED_BACK"}>Roll back whole wave</SButton>
              </div>
            </Card>
          </>
        )}
      </div>
    </AdminShell>
  );
}
