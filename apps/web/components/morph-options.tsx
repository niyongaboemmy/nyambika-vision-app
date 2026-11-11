"use client";

import { MORPH_LENGTHS, MORPH_SLEEVES, morphPrice, type MorphTemplateInput } from "@nyambika/contracts/tailor-data";
import { useEffect, useState } from "react";
import { InfoTip } from "@/components/kit";
import { Card, Chip, Field, Icon, Input, Note, SButton, Select } from "@/components/studio";
import { api, rwf } from "@/lib/api";

const DEFAULTS: MorphTemplateInput = {
  enabled: true,
  colourEnabled: true,
  colourDeltaRwf: 3000,
  baseLength: "knee",
  baseSleeve: "short",
  lengths: { mini: 0, knee: 0, midi: 2000, maxi: 5000 },
  sleeves: { sleeveless: 0, short: 0, elbow: 1500, long: 3000 },
  leadTimeDays: 7,
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Product editor card (E23): make a product customizable in Live morph and price each option. */
export function MorphOptions({ productId }: { productId: string }) {
  const [base, setBase] = useState<{ basePriceRwf: number; category: string } | null>(null);
  const [o, setO] = useState<MorphTemplateInput | null>(null);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ basePriceRwf: number; category: string; options: MorphTemplateInput | null }>(`/products/${productId}/morph-template`).then((r) => {
      setBase(r);
      setO(r.options ?? null);
      setSaved(Boolean(r.options));
    }).catch(() => {});
  }, [productId]);
  if (!base) return null;
  const longCat = ["dress", "umushanana", "kitenge", "skirt", "bridal"].includes(base.category);

  async function save(next: MorphTemplateInput | null) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (next) await api(`/products/${productId}/morph-template`, { method: "PUT", json: next });
      else await api(`/products/${productId}/morph-template`, { method: "DELETE" });
      setO(next);
      setSaved(Boolean(next));
      setMsg(next ? "Saved. Shoppers see a Morph button on this piece." : "Live morph turned off for this piece.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!o) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-br from-amber-50 to-violet-50">
        <div>
          <h3 className="flex items-center gap-1.5 font-bold"><Icon name="palette" className="size-4 text-terra-ink" />Live morph</h3>
          <p className="mt-1 flex flex-wrap items-center gap-1.5"><Chip>Colour</Chip><Chip>Length</Chip><Chip>Sleeves</Chip><InfoTip label="About live morph">Let shoppers recolour this piece and change length or sleeves on their twin, then ask you to sew it.</InfoTip></p>
        </div>
        <SButton onClick={() => setO(DEFAULTS)}>Make customizable</SButton>
      </Card>
    );
  }

  const row = (kind: "lengths" | "sleeves", key: string) => {
    const table = o[kind] as Record<string, number | null | undefined>;
    const isBase = (kind === "lengths" ? o.baseLength : o.baseSleeve) === key;
    const on = isBase || (table[key] !== null && table[key] !== undefined);
    return (
      <div key={key} className={`flex items-center gap-2 rounded-2xl p-2 ring-1 ${on ? "bg-white ring-stone-300" : "bg-stone-50 ring-stone-200"}`}>
        <label className="flex min-h-11 flex-1 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-stone-900" checked={on} disabled={isBase} onChange={() => setO({ ...o, [kind]: { ...table, [key]: on ? null : 0 } })} />
          {cap(key)}{isBase ? " (as photographed)" : ""}
        </label>
        {on && !isBase && (
          <label className="flex items-center gap-1 text-sm">
            <span className="text-stone-500">+RWF</span>
            <input inputMode="numeric" aria-label={`${cap(key)} price change`} value={table[key] ?? 0} onChange={(e) => setO({ ...o, [kind]: { ...table, [key]: Number(e.target.value.replace(/[^\d-]/g, "")) || 0 } })} className="w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-right" />
          </label>
        )}
      </div>
    );
  };

  const max = (() => {
    try {
      const longest = [...MORPH_LENGTHS].reverse().find((k) => k === o.baseLength || (o.lengths[k] ?? null) !== null) ?? o.baseLength;
      const longSleeve = [...MORPH_SLEEVES].reverse().find((k) => k === o.baseSleeve || (o.sleeves[k] ?? null) !== null) ?? o.baseSleeve;
      return morphPrice(base.basePriceRwf, o, { hue: o.colourEnabled ? 0 : null, length: longCat ? longest : null, sleeve: longSleeve }).totalRwf;
    } catch {
      return base.basePriceRwf;
    }
  })();

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-bold"><Icon name="palette" className="size-4 text-terra-ink" />Live morph options</h3>
          <p className="text-sm text-stone-600">{rwf(base.basePriceRwf)} → up to {rwf(max)} · paid to you</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${saved ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{saved ? "live" : "not saved"}</span>
      </div>
      <div className="flex items-center gap-2 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
        <label className="flex min-h-11 flex-1 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" className="size-5 accent-stone-900" checked={o.colourEnabled} onChange={(e) => setO({ ...o, colourEnabled: e.target.checked })} />
          <span className="size-5 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" aria-hidden />
          Any colour (same print)
        </label>
        {o.colourEnabled && (
          <label className="flex items-center gap-1 text-sm">
            <span className="text-stone-500">+RWF</span>
            <input inputMode="numeric" aria-label="Custom colour price" value={o.colourDeltaRwf} onChange={(e) => setO({ ...o, colourDeltaRwf: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="w-20 rounded-lg border border-stone-300 px-2 py-1.5 text-right" />
          </label>
        )}
      </div>
      {longCat && (
        <fieldset className="space-y-2">
          <legend className="mb-1 flex w-full items-center justify-between text-sm font-bold">
            Lengths
            <Select aria-label="Length as photographed" value={o.baseLength} onChange={(e) => setO({ ...o, baseLength: e.target.value as MorphTemplateInput["baseLength"] })} className="!w-auto !py-1.5 text-sm">
              {MORPH_LENGTHS.map((k) => <option key={k} value={k}>Photo: {k}</option>)}
            </Select>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">{MORPH_LENGTHS.map((k) => row("lengths", k))}</div>
        </fieldset>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-1 flex w-full items-center justify-between text-sm font-bold">
          Sleeves
          <Select aria-label="Sleeves as photographed" value={o.baseSleeve} onChange={(e) => setO({ ...o, baseSleeve: e.target.value as MorphTemplateInput["baseSleeve"] })} className="!w-auto !py-1.5 text-sm">
            {MORPH_SLEEVES.map((k) => <option key={k} value={k}>Photo: {k}</option>)}
          </Select>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">{MORPH_SLEEVES.map((k) => row("sleeves", k))}</div>
      </fieldset>
      <Field label="Ready in (days) for custom pieces">
        <Input inputMode="numeric" value={o.leadTimeDays} onChange={(e) => setO({ ...o, leadTimeDays: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} className="max-w-28" />
      </Field>
      <Note error={err} ok={msg} />
      <div className="flex flex-wrap gap-2">
        <SButton className="flex-1" disabled={busy} onClick={() => save(o)}>Save morph options</SButton>
        {saved && <SButton variant="ghost" disabled={busy} onClick={() => save(null)}>Turn off</SButton>}
      </div>
    </Card>
  );
}
