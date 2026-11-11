"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Card, Note, SButton } from "@/components/studio";
import { MorphOptions } from "@/components/morph-options";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { StudioProduct, StudioVariant } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../../layout";

function ProductDetail() {
  const { productId } = useParams<{ productId: string }>();
  const isNew = useSearchParams().get("new") === "1";
  const { page } = useManagedPage();
  const { me } = useSession();
  const { data: p, reload, error } = useApi<StudioProduct>(`/products/${productId}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Note error={error} />;
  if (!p) return <p className="text-stone-500">Loading…</p>;

  const canManage = me?.isHost || me?.roles.some((r) => r.page?.id === page.id && ["PAGE_OWNER", "PAGE_STAFF", "COOP_ADMIN"].includes(r.role));

  async function act(action: string) {
    setErr(null);
    try {
      await api(`/products/${productId}/status`, { method: "POST", json: { action } });
      setMsg(action === "publish" && !canManage ? "Sent to your cooperative admin for approval." : `Done: ${action}.`);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {isNew && <Note ok="Saved. Now add a clear photo for each colour so shoppers can try it on." />}
      <Card className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{p.title}</h2>
            <p className="text-sm text-stone-500">{rwf(p.priceRwf)} · {p.category}{p.madeToOrder ? ` · made to order (${p.leadTimeDays} days)` : ""}</p>
          </div>
          <Badge value={p.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={p.readiness} label={`try-on: ${p.readiness.replace(/_/g, " ").toLowerCase()}`} />
          {p.qualityScore !== null && <span className="text-xs text-stone-500">photo quality {Math.round(p.qualityScore * 100)}%</span>}
        </div>
        {p.readinessNotes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-800">{p.readinessNotes.map((n) => <li key={n}>{n}</li>)}</ul>
        )}
        {p.makers.length > 0 && <p className="text-sm">Made by {p.makers.map((m) => m.name).join(", ")} · pays {p.payoutTarget === "MAKER" ? "the maker" : "the cooperative"}</p>}
        <Note error={err} ok={msg} />
        <div className="flex flex-wrap gap-2 pt-1">
          {(p.status === "DRAFT" || p.status === "OUT_OF_STOCK") && <SButton onClick={() => act("publish")}>{canManage ? "Publish" : "Submit for approval"}</SButton>}
          {p.status === "PUBLISHED" && <SButton variant="outline" onClick={() => act("unpublish")}>Unpublish</SButton>}
          {canManage && p.status !== "ARCHIVED" && <SButton variant="ghost" onClick={() => act("archive")}>Archive</SButton>}
        </div>
      </Card>
      <StudioCard p={p} onChange={reload} />
      {page.memberType === "TAILOR" && canManage && <MorphOptions productId={p.id} />}
      <h3 className="font-bold">Colours and photos</h3>
      {p.variants.map((v) => <VariantRow key={v.id} v={v} onChange={reload} />)}
    </div>
  );
}

const MODEL_TONES = ["#8d5524", "#6b4423", "#5a3a22", "#4a2f1d", "#3b2417"];

/** AI product studio (FR-PHO): on-model photos on synthetic AI models, labelled and metered. */
function StudioCard({ p, onChange }: { p: StudioProduct; onChange: () => Promise<void> }) {
  const ready = p.variants.filter((v) => v.cutout);
  const [picked, setPicked] = useState("");
  // Colours gain cut-outs after upload, so derive the selection instead of freezing it at mount.
  const variantId = ready.some((v) => v.id === picked) ? picked : (ready[0]?.id ?? "");
  const setVariantId = setPicked;
  const [models, setModels] = useState<number[]>([1, 3, 5]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!ready.length) return null;
  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/variants/${variantId}/studio`, { method: "POST", json: { personas: models } });
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-3">
      <div>
        <h3 className="font-bold">✨ AI product studio</h3>
        <p className="text-sm text-stone-600">Show this piece on AI models with different skin tones. Photos are labelled as AI and use your page allowance.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ready.map((v) => (
          <button key={v.id} type="button" aria-pressed={v.id === variantId} onClick={() => setVariantId(v.id)} className={`rounded-full border px-3 py-1 text-sm ${v.id === variantId ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300"}`}>{v.colourName}</button>
        ))}
      </div>
      <fieldset className="flex items-center gap-2">
        <legend className="mb-1 text-xs font-semibold text-stone-600">Models</legend>
        {MODEL_TONES.map((tone, i) => {
          const n = i + 1;
          const on = models.includes(n);
          return (
            <button key={n} type="button" aria-pressed={on} aria-label={`AI model ${n}`} onClick={() => setModels(on ? models.filter((x) => x !== n) : [...models, n])} className={`size-9 rounded-full border-4 ${on ? "border-violet-500" : "border-transparent opacity-50"}`} style={{ background: tone }} />
          );
        })}
      </fieldset>
      <SButton onClick={generate} disabled={busy || !models.length || !variantId}>{busy ? "Creating photos…" : `Create ${models.length} photo(s)`}</SButton>
      <Note error={err} />
      {p.studio.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {p.studio.map((m) => (
            <figure key={m.id} className="relative overflow-hidden rounded-xl bg-stone-900">
              {m.image && <img src={m.image} alt="Product on an AI model" className="aspect-[9/16] w-full object-cover" />}
              <figcaption className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">AI model · C2PA</figcaption>
              <button onClick={async () => { await api(`/products/${p.id}/media/${m.id}`, { method: "DELETE" }); await onChange(); }} className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs" aria-label="Remove photo">✕</button>
            </figure>
          ))}
        </div>
      )}
    </Card>
  );
}

function VariantRow({ v, onChange }: { v: StudioVariant; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ readiness: string; notes: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setResult(await api(`/variants/${v.id}/image`, { method: "POST", body: fd }));
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="size-5 rounded-full border border-stone-300" style={{ background: v.colourHex }} />
        <span className="font-semibold">{v.colourName}</span>
        <span className="text-xs text-stone-500">· sizes {v.sizes.join(", ")} · stock {v.stock}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <figure className="overflow-hidden rounded-xl bg-stone-100">
          {v.image ? <img src={v.image} alt={`${v.colourName} photo`} className="aspect-[4/5] w-full object-cover" /> : <div className="grid aspect-[4/5] place-items-center text-sm text-stone-400">No photo</div>}
          <figcaption className="px-2 py-1 text-xs text-stone-500">Your photo</figcaption>
        </figure>
        <figure className="overflow-hidden rounded-xl bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
          {v.cutout ? <img src={v.cutout} alt={`${v.colourName} cut-out`} className="aspect-[4/5] w-full object-contain" /> : <div className="grid aspect-[4/5] place-items-center text-sm text-stone-400">—</div>}
          <figcaption className="bg-white/80 px-2 py-1 text-xs text-stone-500">Try-on cut-out (auto)</figcaption>
        </figure>
      </div>
      {result && (
        <div className="text-sm">
          <Badge value={result.readiness} />
          {result.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-amber-800">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
      <Note error={err} />
      <label className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed border-stone-400 text-sm font-semibold ${busy ? "opacity-50" : ""}`}>
        {busy ? "Checking photo…" : v.image ? "Replace photo" : "Upload photo"}
        <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      <p className="text-xs text-stone-500">Tip: lay the garment flat on a plain light background, fully in frame, in daylight.</p>
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ProductDetail />
    </Suspense>
  );
}
