"use client";

import { validatePassport, type PassportData } from "@nyambika/contracts";
import { useCallback, useEffect, useState } from "react";
import { QrCode } from "@/components/qr";
import { InfoTip } from "@/components/kit";
import { Chip, Field, Icon, Input, Note, SButton, SLink, StudioSheet, Switch, Textarea } from "@/components/studio";
import { api } from "@/lib/api";

interface Draft {
  productId: string;
  version: number;
  data: PassportData;
  claimsVerified: boolean;
  url: string;
  versions: { version: number; note: string; changed: string[]; at: string }[];
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/**
 * Digital Product Passport card on the studio product page (FR-DPP-01..04): materials, origin and maker
 * attribution, process, care, repair, certifications, carbon placeholder and claims. Each publish is a version.
 */
export function PassportCard({ productId, title, canManage }: { productId: string; title: string; canManage: boolean }) {
  const [d, setD] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => setD(await api<Draft>(`/passports/${productId}/draft`).catch((e: Error) => (setErr(e.message), null))), [productId]);
  useEffect(() => void load(), [load]);
  if (!d) return err ? <Note error={err} /> : null;
  const m = d.data;
  const filled = [m.materials.length > 0, Boolean(m.origin.district || m.origin.cooperative), m.process.length > 0, m.care.length > 0, m.repair.offered, m.certifications.length > 0, Boolean(m.claims.madeIn)];
  const score = filled.filter(Boolean).length;

  return (
    <section aria-labelledby="dpp-t" className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cocoa text-white shadow-[0_8px_18px_-8px_rgba(29,24,20,.7)]"><Icon name="qr" className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 id="dpp-t" className="font-display text-lg font-black tracking-tight text-cocoa">Product passport</h3>
          <p className="mt-1 flex flex-wrap items-center gap-1.5"><Chip>Origin</Chip><Chip>Care</Chip><Chip>Repair</Chip><InfoTip label="About the product passport">Where it comes from, who made it, how to care for and repair it. Shoppers scan the QR on the hang-tag. Ready for export rules (EU DPP draft).</InfoTip></p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chip tone={d.version ? "mint" : "stone"}>{d.version ? `v${d.version} live` : "Not published"}</Chip>
        <Chip tone={score >= 5 ? "mint" : "gold"}>{score}/7 sections</Chip>
        {d.version > 0 && m.claims.madeIn && <Chip tone={d.claimsVerified ? "mint" : "violet"}>{d.claimsVerified ? "Claims verified" : "Claims awaiting host check"}</Chip>}
      </div>
      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-4">
        <div className={`rounded-2xl bg-white p-1.5 ${d.version ? "" : "opacity-40"}`}>
          <QrCode value={d.url} label={`QR code for the passport of ${title}`} className="size-24" />
        </div>
        <div className="flex flex-col gap-2">
          {canManage && <SButton onClick={() => setOpen(true)}><Icon name="sparkle" className="size-4" /> {d.version ? "Update passport" : "Create passport"}</SButton>}
          {d.version > 0 && <SLink href={`/p/${productId}`} variant="outline" target="_blank" rel="noreferrer">Open &amp; print hang-tag</SLink>}
        </div>
      </div>
      {d.versions.length > 0 && (
        <ol className="mt-4 space-y-1.5" aria-label="Passport versions">
          {d.versions.slice(0, 4).map((v) => (
            <li key={v.version} className="flex items-center gap-2 text-sm">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-xs font-black text-cocoa">v{v.version}</span>
              <span className="min-w-0 truncate text-cocoa"><b>{v.note || "Update"}</b> <span className="text-cocoa-2">· {new Date(v.at).toLocaleDateString("en-GB")} · {v.changed.join(", ")}</span></span>
            </li>
          ))}
        </ol>
      )}
      {open && <PassportSheet draft={d} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await load(); }} />}
    </section>
  );
}

function PassportSheet({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState<PassportData>(draft.data);
  const [care, setCare] = useState(draft.data.care.join("\n"));
  const [services, setServices] = useState(draft.data.repair.services.join("\n"));
  const [makers, setMakers] = useState(draft.data.origin.makers.join(", "));
  const [carbon, setCarbon] = useState(draft.data.carbon.kgCo2e == null ? "" : String(draft.data.carbon.kgCo2e));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const data: PassportData = {
    ...f,
    care: lines(care),
    repair: { ...f.repair, services: lines(services) },
    origin: { ...f.origin, makers: makers.split(",").map((x) => x.trim()).filter(Boolean) },
    carbon: { kgCo2e: carbon.trim() ? Number(carbon) : null, method: carbon.trim() ? "maker estimate" : "not assessed" },
  };
  const issues = validatePassport(data);
  const total = f.materials.reduce((a, m) => a + (Number(m.percent) || 0), 0);
  const set = <K extends keyof PassportData>(k: K, v: PassportData[K]) => setF((x) => ({ ...x, [k]: v }));

  async function publish() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/passports/${draft.productId}`, { method: "POST", json: { data, note } });
      navigator.vibrate?.([10, 30, 10]);
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <StudioSheet
      open
      onClose={onClose}
      title={draft.version ? `Passport · new version ${draft.version + 1}` : "Create product passport"}
      footer={
        <div className="space-y-2">
          <Note error={err ?? (issues[0] ?? null)} />
          <SButton className="w-full text-base" disabled={busy || issues.length > 0} onClick={publish}>{busy ? "Publishing…" : `Publish version ${draft.version + 1}`}</SButton>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Fibre composition" hint={`Must add up to 100% (now ${total}%).`} group>
          {f.materials.map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_76px_auto] items-center gap-2">
              <Input aria-label={`Fibre ${i + 1}`} value={m.fibre} placeholder="Cotton" onChange={(e) => set("materials", f.materials.map((x, j) => (j === i ? { ...x, fibre: e.target.value } : x)))} />
              <Input aria-label={`Fibre ${i + 1} percent`} inputMode="numeric" value={String(m.percent)} onChange={(e) => set("materials", f.materials.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)))} />
              <button type="button" aria-label={`Remove fibre ${i + 1}`} onClick={() => set("materials", f.materials.filter((_, j) => j !== i))} className="st-press grid size-11 place-items-center rounded-full bg-paper-2 text-cocoa-2"><Icon name="x" className="size-4" /></button>
            </div>
          ))}
          <div className="h-2 overflow-hidden rounded-full bg-paper-3" aria-hidden><div className={`h-full rounded-full ${total === 100 ? "bg-mint-ink" : "bg-terra-ink"}`} style={{ width: `${Math.min(100, total)}%` }} /></div>
          <SButton variant="soft" type="button" onClick={() => set("materials", [...f.materials, { fibre: "", percent: Math.max(1, 100 - total), origin: "", recycled: false }])}><Icon name="plus" className="size-4" /> Add fibre</SButton>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Fabric"><Input value={f.fabric.type} onChange={(e) => set("fabric", { ...f.fabric, type: e.target.value })} placeholder="Wax-print kitenge" /></Field>
          <Field label="Fabric made in"><Input value={f.fabric.origin} onChange={(e) => set("fabric", { ...f.fabric, origin: e.target.value })} placeholder="Dar es Salaam, Tanzania" /></Field>
          <Field label="District"><Input value={f.origin.district} onChange={(e) => set("origin", { ...f.origin, district: e.target.value })} /></Field>
          <Field label="Cooperative (if any)"><Input value={f.origin.cooperative} onChange={(e) => set("origin", { ...f.origin, cooperative: e.target.value })} /></Field>
        </div>
        <Field label="Made by" hint="Names of the makers who agreed to be credited, separated by commas."><Input value={makers} onChange={(e) => setMakers(e.target.value)} /></Field>
        <Switch checked={f.origin.handmade} onChange={(v) => set("origin", { ...f.origin, handmade: v })} label="Handmade" description="Not mass-produced" />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Made in (month)"><Input value={f.production.date} placeholder="2026-10" onChange={(e) => set("production", { ...f.production, date: e.target.value })} /></Field>
          <Field label="Batch"><Input value={f.production.batch} onChange={(e) => set("production", { ...f.production, batch: e.target.value })} /></Field>
        </div>

        <Field label="How it was made" group>
          {f.process.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-white p-2">
              <div className="grid gap-2">
                <Input aria-label={`Step ${i + 1}`} value={s.step} onChange={(e) => set("process", f.process.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)))} />
                <Input aria-label={`Step ${i + 1} done by`} placeholder="Who" value={s.by} onChange={(e) => set("process", f.process.map((x, j) => (j === i ? { ...x, by: e.target.value } : x)))} />
              </div>
              <button type="button" aria-label={`Remove step ${i + 1}`} onClick={() => set("process", f.process.filter((_, j) => j !== i))} className="st-press grid size-11 place-items-center self-center rounded-full bg-paper-2 text-cocoa-2"><Icon name="x" className="size-4" /></button>
            </div>
          ))}
          <SButton variant="soft" type="button" onClick={() => set("process", [...f.process, { step: "", by: "", place: "" }])}><Icon name="plus" className="size-4" /> Add step</SButton>
        </Field>

        <Field label="Care" hint="One instruction per line."><Textarea value={care} onChange={(e) => setCare(e.target.value)} /></Field>
        <Switch checked={f.repair.offered} onChange={(v) => set("repair", { ...f.repair, offered: v })} label="I offer repairs and alterations" description="Shown on the passport" />
        {f.repair.offered && <Field label="Repair services" hint="One per line, e.g. hem and fit alterations."><Textarea value={services} onChange={(e) => setServices(e.target.value)} className="min-h-20" /></Field>}

        <Field label="Certifications" group>
          {f.certifications.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2">
              <Input aria-label={`Certification ${i + 1}`} value={c.name} onChange={(e) => set("certifications", f.certifications.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <button type="button" aria-label={`Remove certification ${i + 1}`} onClick={() => set("certifications", f.certifications.filter((_, j) => j !== i))} className="st-press grid size-11 place-items-center rounded-full bg-paper-2 text-cocoa-2"><Icon name="x" className="size-4" /></button>
            </div>
          ))}
          <SButton variant="soft" type="button" onClick={() => set("certifications", [...f.certifications, { name: "", issuer: "", reference: "" }])}><Icon name="plus" className="size-4" /> Add certification</SButton>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Carbon (kg CO₂e)" hint="Optional estimate. Leave empty if unknown."><Input inputMode="decimal" value={carbon} onChange={(e) => setCarbon(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
          <Field label="GTIN / barcode" hint="Optional. Enables GS1 Digital Link /01/…"><Input inputMode="numeric" value={f.gtin} onChange={(e) => set("gtin", e.target.value.replace(/\D/g, "").slice(0, 14))} /></Field>
        </div>

        <div className="rounded-2xl bg-white p-3">
          <p className="text-[13px] font-bold text-cocoa">Claims</p>
          <p className="text-xs text-cocoa-2">Host-verified</p>
          <div className="mt-2 space-y-3">
            <Field label="Made in label"><Input value={f.claims.madeIn} onChange={(e) => set("claims", { ...f.claims, madeIn: e.target.value })} placeholder="Made in Rwanda" /></Field>
            <Field label="Impact story"><Textarea value={f.claims.impactStory} onChange={(e) => set("claims", { ...f.claims, impactStory: e.target.value })} className="min-h-20" /></Field>
          </div>
        </div>
        <Field label="What changed?" hint="Shown in the passport history."><Input value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="Added care instructions" /></Field>
      </div>
    </StudioSheet>
  );
}
