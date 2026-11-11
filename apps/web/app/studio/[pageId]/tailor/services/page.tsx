"use client";

import { MEASUREMENT_FIELDS } from "@nyambika/contracts";
import { useState } from "react";
import { Card, Empty, Field, Icon, Input, Note, SButton, Textarea } from "@/components/studio";
import { DeskNav } from "@/components/tailor-studio";
import { api, rwf } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { MEASUREMENT_LABEL, type TailorServiceView } from "@/lib/tailor";
import { useManagedPage } from "../../layout";

const IDEAS = [
  { title: "Custom dress from your fabric", description: "Bring 3–4 m of kitenge. Cut and sewn to your measurements, one fitting included.", startingPriceRwf: 25000, leadTimeDays: 7 },
  { title: "Alterations and hemming", description: "Take in, let out, shorten. Same-week turnaround.", startingPriceRwf: 3000, leadTimeDays: 3 },
  { title: "Umushanana for your ceremony", description: "Hand-finished umushanana with sash for gusaba and weddings. Two fittings.", startingPriceRwf: 45000, leadTimeDays: 14 },
];

/** Tailor services on the Maker Space (FR-CAT-07). */
export default function Services() {
  const { page } = useManagedPage();
  const { data, reload } = useApi<TailorServiceView[]>(`/pages/${page.id}/services`);
  const [editing, setEditing] = useState<Partial<TailorServiceView> | null>(null);
  return (
    <div className="space-y-4">
      <DeskNav pageId={page.id} />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black">Services{data?.length ? <span className="ml-1.5 text-sm font-bold text-stone-500 tabular-nums">{data.length}</span> : null}</h2>
        <SButton onClick={() => setEditing({ requiredMeasurements: ["bustCm", "waistCm", "hipsCm"], leadTimeDays: 7, active: true })}><Icon name="plus" className="size-4" /> New service</SButton>
      </div>
      {editing && <ServiceForm pageId={page.id} initial={editing} onDone={async () => { setEditing(null); await reload(); }} onCancel={() => setEditing(null)} />}
      {data?.length === 0 && !editing && (
        <Empty icon="scissors" title="No services yet">
          <p className="mb-3">✨ Start from an idea</p>
          <div className="flex flex-wrap justify-center gap-2">
            {IDEAS.map((i) => <SButton key={i.title} variant="outline" onClick={() => setEditing({ ...i, requiredMeasurements: ["bustCm", "waistCm", "hipsCm"], active: true })}>{i.title}</SButton>)}
          </div>
        </Empty>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.map((s) => (
          <article key={s.id} className={`flex flex-col rounded-3xl bg-white p-4 ring-1 ring-stone-200 ${s.active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-black leading-tight">{s.title}</h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.active ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700"}`}>{s.active ? "on your page" : "hidden"}</span>
            </div>
            <p className="mt-1 text-sm text-stone-600">{s.description}</p>
            <p className="mt-2 text-sm"><b>from {rwf(s.startingPriceRwf)}</b> · {s.leadTimeDays} days</p>
            {s.requiredMeasurements.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-1">
                <Icon name="ruler" className="size-3.5 text-stone-500" />
                <span className="sr-only">Needs</span>
                {s.requiredMeasurements.map((m) => <span key={m} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-700">{MEASUREMENT_LABEL[m]?.label ?? m}</span>)}
              </p>
            )}
            <div className="mt-auto flex gap-2 pt-3">
              <SButton variant="outline" onClick={() => setEditing(s)}>Edit</SButton>
              <SButton variant="ghost" onClick={async () => { await api(`/pages/${page.id}/services/${s.id}`, { method: "PATCH", json: { active: !s.active } }); await reload(); }}>{s.active ? "Hide" : "Show"}</SButton>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ServiceForm({ pageId, initial, onDone, onCancel }: { pageId: string; initial: Partial<TailorServiceView>; onDone: () => void; onCancel: () => void }) {
  const [s, setS] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = { title: s.title, description: s.description ?? "", startingPriceRwf: Number(s.startingPriceRwf), leadTimeDays: Number(s.leadTimeDays), requiredMeasurements: s.requiredMeasurements ?? [], active: s.active ?? true };
      if (s.id) await api(`/pages/${pageId}/services/${s.id}`, { method: "PATCH", json: body });
      else await api(`/pages/${pageId}/services`, { method: "POST", json: body });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const req = s.requiredMeasurements ?? [];
  return (
    <Card className="space-y-3 ring-2 ring-stone-900">
      <Field label="Service name"><Input value={s.title ?? ""} onChange={(e) => setS({ ...s, title: e.target.value })} maxLength={80} placeholder="Custom dress from your fabric" /></Field>
      <Field label="What's included"><Textarea value={s.description ?? ""} onChange={(e) => setS({ ...s, description: e.target.value })} maxLength={600} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starting price (RWF)"><Input inputMode="numeric" value={s.startingPriceRwf ?? ""} onChange={(e) => setS({ ...s, startingPriceRwf: Number(e.target.value.replace(/\D/g, "")) })} /></Field>
        <Field label="Lead time (days)"><Input inputMode="numeric" value={s.leadTimeDays ?? ""} onChange={(e) => setS({ ...s, leadTimeDays: Number(e.target.value.replace(/\D/g, "")) })} /></Field>
      </div>
      <Field label="Measurements you need" group>
        <div className="flex flex-wrap gap-2">
          {MEASUREMENT_FIELDS.map((m) => {
            const on = req.includes(m);
            return (
              <label key={m} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-semibold ring-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${on ? "bg-stone-900 text-white ring-stone-900" : "bg-white ring-stone-300"}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => setS({ ...s, requiredMeasurements: on ? req.filter((x) => x !== m) : [...req, m] })} />
                {MEASUREMENT_LABEL[m].label}
              </label>
            );
          })}
        </div>
      </Field>
      <Note error={err} />
      <div className="flex gap-2">
        <SButton className="flex-1" disabled={busy || !s.title || !s.startingPriceRwf || !s.leadTimeDays} onClick={save}>{s.id ? "Save" : "Add to my page"}</SButton>
        <SButton variant="ghost" onClick={onCancel}>Cancel</SButton>
      </div>
    </Card>
  );
}
