"use client";

import { BackButton } from "@/components/back-link";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AiWrite } from "@/components/ai-write";
import { InfoTip } from "@/components/kit";
import { Badge, Card, Chip, Field, Icon, Input, Note, ScreenSkeleton, SButton, Skeleton, Steps, Textarea } from "@/components/studio";
import { MoreActions } from "@/components/ios";
import { EDITOR_STEPS, EditorSection, ProductPreview } from "@/components/studio-product";
import { MorphOptions } from "@/components/morph-options";
import { AttrSuggest } from "@/components/mlspike-suggest";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { StudioProduct, StudioVariant } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../../layout";
const PassportCard = dynamic(() => import("@/components/passport-editor").then((m) => m.PassportCard), { ssr: false, loading: () => <Skeleton className="h-48" /> });

// Lazy (below the fold / on demand): keeps this route's first-load JS small.
const Garment3dCard = dynamic(() => import("@/components/studio-3d").then((m) => m.Garment3dCard), { ssr: false, loading: () => <Skeleton className="h-64" /> });

function ProductDetail() {
  const { productId } = useParams<{ productId: string }>();
  const isNew = useSearchParams().get("new") === "1";
  const { page } = useManagedPage();
  const { me } = useSession();
  const { data: p, reload, error } = useApi<StudioProduct>(`/products/${productId}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Note error={error} />;
  if (!p) return <ScreenSkeleton variant="list" />;

  const canManage = me?.isHost || me?.roles.some((r) => r.page?.id === page.id && ["PAGE_OWNER", "PAGE_STAFF", "COOP_ADMIN"].includes(r.role));
  const photos = p.variants.filter((v) => v.image).length;
  const allPhotos = photos === p.variants.length && photos > 0;
  const step = p.status === "PUBLISHED" ? 4 : allPhotos ? 3 : 2;
  const cover = p.variants.find((v) => v.image)?.image;

  async function act(action: string) {
    setErr(null);
    setBusy(true);
    try {
      await api(`/products/${productId}/status`, { method: "POST", json: { action } });
      setMsg(action === "publish" && !canManage ? "Sent to your cooperative admin for approval." : `Done: ${action}.`);
      if (action === "publish") navigator.vibrate?.([10, 30, 10]);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <BackButton fallback={`/studio/${page.id}/products`} label="Back to products" className="st-press grid size-11 shrink-0 place-items-center rounded-full bg-white text-cocoa" />
        <div className="min-w-0 flex-1">
          <Steps steps={EDITOR_STEPS} current={step} label="Product steps" />
        </div>
      </div>
      {isNew && <Note ok="Saved. Now add a clear photo for each colour so shoppers can try it on." />}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {/* Status + publish */}
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-black leading-tight tracking-tight text-cocoa">{p.title}</h2>
                <p className="mt-0.5 text-sm text-cocoa-2">{rwf(p.priceRwf)} · {p.category}{p.madeToOrder ? ` · made to order (${p.leadTimeDays} days)` : ""}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge value={p.status} label={p.status === "PUBLISHED" ? "live" : undefined} />
                {canManage && p.status !== "ARCHIVED" && (
                  <MoreActions label="More product actions" title={p.title} actions={[{ label: "Archive", icon: "box", destructive: true, disabled: busy, onSelect: () => act("archive") }]} />
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge value={p.readiness} label={`try-on: ${p.readiness.replace(/_/g, " ").toLowerCase()}`} />
              {p.qualityScore !== null && <span className="text-xs font-semibold text-cocoa-2">photo quality {Math.round(p.qualityScore * 100)}%</span>}
            </div>
            {p.readinessNotes.length > 0 && (
              <ul className="space-y-1 rounded-2xl bg-amber-50 p-3 text-sm text-gold-ink">
                {p.readinessNotes.map((n) => <li key={n} className="flex gap-2"><Icon name="camera" className="mt-0.5 size-4 shrink-0" />{n}</li>)}
              </ul>
            )}
            {p.makers.length > 0 && <p className="text-sm text-cocoa">Made by {p.makers.map((m) => m.name).join(", ")} · pays {p.payoutTarget === "MAKER" ? "the maker" : "the cooperative"}</p>}
            <Note error={err} ok={msg} />
            <div className="flex flex-wrap gap-2 pt-1">
              {(p.status === "DRAFT" || p.status === "OUT_OF_STOCK") && (
                <SButton disabled={busy} onClick={() => act("publish")} className="min-h-12 flex-1 text-base sm:flex-none sm:px-6">
                  <Icon name="sparkle" className="size-4" /> {canManage ? "Publish" : "Submit for approval"}
                </SButton>
              )}
              {p.status === "PUBLISHED" && <SButton variant="outline" disabled={busy} onClick={() => act("unpublish")}>Unpublish</SButton>}
            </div>
            {(p.status === "DRAFT" || p.status === "OUT_OF_STOCK") && !allPhotos && (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-cocoa-2"><Icon name="camera" className="size-3.5" />Add a photo per colour first</p>
            )}
          </Card>

          {/* Step 3: photos */}
          <EditorSection n={3} id="photos" title="Colours and photos" hint="Lay the garment flat on a plain light background, fully in frame, in daylight.">
            {p.variants.map((v) => <VariantRow key={v.id} v={v} onChange={reload} />)}
          </EditorSection>

          <StudioCard p={p} onChange={reload} />
          <Garment3dCard productId={p.id} title={p.title} canManage={Boolean(canManage)} />
          <PassportCard productId={p.id} title={p.title} canManage={Boolean(canManage)} />
          {page.memberType === "TAILOR" && canManage && <MorphOptions productId={p.id} />}

          <AttrSuggest key={`${p.category}:${p.styles.join(",")}`} productId={p.id} canEdit onApplied={reload} />
          <DetailsEditor p={p} pageId={page.id} pageName={page.name} onSaved={reload} />
        </div>

        <aside className="space-y-3 lg:sticky lg:top-28" aria-label="Live preview">
          {[true, false].map((compact) => (
            <div key={String(compact)} className={compact ? "lg:hidden" : "hidden lg:block"}>
              <ProductPreview
                compact={compact}
                title={p.title}
                priceRwf={p.priceRwf}
                image={cover}
                colours={p.variants.map((v) => ({ name: v.colourName, hex: v.colourHex }))}
                madeToOrder={p.madeToOrder}
                leadTimeDays={p.leadTimeDays}
                pageName={page.name}
                theme={page.theme}
              />
            </div>
          ))}
          <Card className="space-y-2.5 p-4">
            <p className="text-sm font-extrabold text-cocoa">Ready to go live?</p>
            <Check ok={!!p.title && p.priceRwf > 0} label="Title and price" />
            <Check ok={allPhotos} label={`Photo for every colour (${photos}/${p.variants.length})`} />
            <Check ok={p.readiness === "READY"} label="Try-on check passed" />
            <Check ok={(p.description ?? "").trim().length >= 60} label="Full description" />
            <Check ok={p.status === "PUBLISHED"} label="Published" />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className={`grid size-5 shrink-0 place-items-center rounded-full ${ok ? "bg-mint-ink text-white" : "bg-paper-2 text-cocoa-3"}`}>
        {ok && <Icon name="check" className="size-3" />}
      </span>
      <span className={ok ? "font-semibold text-cocoa" : "text-cocoa-2"}>
        <span className="sr-only">{ok ? "Completed: " : "To do: "}</span>
        {label}
      </span>
    </p>
  );
}

/** Edit title, price and description after creation, with the AI writer (FR-PAGE-07). */
function DetailsEditor({ p, pageId, pageName, onSaved }: { p: StudioProduct; pageId: string; pageName: string; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ title: p.title, description: p.description ?? "", priceRwf: String(p.priceRwf) });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dirty = f.title !== p.title || f.description !== (p.description ?? "") || Number(f.priceRwf) !== p.priceRwf;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await api(`/products/${p.id}`, { method: "PATCH", json: { title: f.title, description: f.description, priceRwf: Number(f.priceRwf) } });
      setMsg("Details saved.");
      await onSaved();
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <form onSubmit={save}>
      <EditorSection n={1} id="details" title="Details" hint="Polish the words any time. AI drafts them from your details in RW, EN or FR.">
        <Field label="Product title"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Price in RWF"><Input required type="number" min={0} value={f.priceRwf} onChange={(e) => setF({ ...f, priceRwf: e.target.value })} /></Field>
        <Field label="Product description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <AiWrite<{ title: string; description: string }>
          pageId={pageId}
          kind="product"
          fields={() => ({ category: p.category, colours: p.variants.map((v) => v.colourName), occasions: p.occasions, styles: p.styles, fabric: p.fabric, madeToOrder: p.madeToOrder, leadTimeDays: p.leadTimeDays, makerName: pageName })}
          onResult={(r) => setF((x) => ({ ...x, description: r.description }))}
        />
        <Note error={err} ok={msg} />
        <SButton variant="dark" disabled={!dirty} className="w-full sm:w-auto">Save details</SButton>
      </EditorSection>
    </form>
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
    <section aria-labelledby="ai-studio-t" className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-violet-50 via-white to-orange-50 p-4 sm:p-5">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-ink text-white shadow-[0_8px_18px_-8px_rgba(98,57,201,.8)]"><Icon name="sparkle" className="size-5" /></span>
          <div>
            <h3 id="ai-studio-t" className="font-display text-lg font-black tracking-tight text-cocoa">AI product studio</h3>
            <p className="mt-1 flex flex-wrap gap-1.5"><Chip tone="violet">AI label · C2PA</Chip><Chip>Uses allowance</Chip><InfoTip label="About AI product studio">Show this piece on AI models with different skin tones. Photos are labelled as AI and use your page allowance.</InfoTip></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ready.map((v) => (
            <button key={v.id} type="button" aria-pressed={v.id === variantId} onClick={() => setVariantId(v.id)} className={`st-press inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset ${v.id === variantId ? "bg-cocoa text-white ring-cocoa" : "bg-white text-cocoa ring-transparent"}`}>
              <span className="size-3.5 rounded-full ring-1 ring-white/60" style={{ background: v.colourHex }} />
              {v.colourName}
            </button>
          ))}
        </div>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="mb-1.5 text-xs font-bold text-cocoa-2">Models</legend>
          {MODEL_TONES.map((tone, i) => {
            const n = i + 1;
            const on = models.includes(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                aria-label={`AI model ${n}`}
                onClick={() => setModels(on ? models.filter((x) => x !== n) : [...models, n])}
                className={`st-press relative size-11 rounded-full ring-offset-2 ${on ? "ring-[3px] ring-violet-ink" : "opacity-45"}`}
                style={{ background: tone }}
              >
                {on && <Icon name="check" className="absolute inset-0 m-auto size-4 text-white" />}
              </button>
            );
          })}
        </fieldset>
        <SButton onClick={generate} disabled={busy || !models.length || !variantId}>{busy ? "Creating photos…" : `Create ${models.length} photo(s)`}</SButton>
        <Note error={err} />
        {busy && (
          <div className="grid grid-cols-3 gap-2" aria-hidden>
            {models.map((m) => <div key={m} data-skeleton className="st-skel aspect-[9/16] rounded-2xl" />)}
          </div>
        )}
        {p.studio.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {p.studio.map((m) => (
              <figure key={m.id} className="relative animate-pop overflow-hidden rounded-2xl bg-cocoa">
                {m.image && <img src={m.image} alt="Product on an AI model" className="aspect-[9/16] w-full object-cover" />}
                <figcaption className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-bold text-white">AI model · C2PA</figcaption>
                <button
                  onClick={async () => {
                    await api(`/products/${p.id}/media/${m.id}`, { method: "DELETE" });
                    await onChange();
                  }}
                  className="hit st-press absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-white/90 text-cocoa"
                  aria-label="Remove photo"
                >
                  <Icon name="x" className="size-4" />
                </button>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
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
    <div className="space-y-3 rounded-[20px] bg-paper p-3">
      <div className="flex items-center gap-2">
        <span className="size-5 rounded-full ring-2 ring-white" style={{ background: v.colourHex }} />
        <span className="font-extrabold text-cocoa">{v.colourName}</span>
        <span className="truncate text-xs text-cocoa-2">· sizes {v.sizes.join(", ")} · stock {v.stock}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <figure className="overflow-hidden rounded-2xl bg-white">
          {busy ? (
            <div data-skeleton className="st-skel aspect-[4/5]" />
          ) : v.image ? (
            <img src={v.image} alt={`${v.colourName} photo`} className="aspect-[4/5] w-full object-cover" />
          ) : (
            <div className="grid aspect-[4/5] place-items-center text-cocoa-3"><Icon name="camera" className="size-8" /></div>
          )}
          <figcaption className="px-2.5 py-1.5 text-xs font-semibold text-cocoa-2">Your photo</figcaption>
        </figure>
        <figure className="st-checker overflow-hidden rounded-2xl">
          {v.cutout ? <img src={v.cutout} alt={`${v.colourName} cut-out`} className="aspect-[4/5] w-full object-contain" /> : <div className="grid aspect-[4/5] place-items-center text-sm text-cocoa-3">—</div>}
          <figcaption className="bg-white/85 px-2.5 py-1.5 text-xs font-semibold text-cocoa-2">Try-on cut-out (auto)</figcaption>
        </figure>
      </div>
      {result && (
        <div className="text-sm">
          <Badge value={result.readiness} />
          {result.notes.length > 0 && <ul className="mt-1 list-disc pl-5 text-gold-ink">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
      <Note error={err} />
      <label className={`st-press flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-paper-3 bg-white text-sm font-bold text-cocoa hover:border-cocoa-3 focus-within:outline focus-within:outline-[2.5px] focus-within:outline-violet-ink ${busy ? "opacity-50" : ""}`}>
        <Icon name={v.image ? "refresh" : "camera"} className="size-4" />
        {busy ? "Checking photo…" : v.image ? "Replace photo" : "Upload photo"}
        <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton variant="list" />}>
      <ProductDetail />
    </Suspense>
  );
}
