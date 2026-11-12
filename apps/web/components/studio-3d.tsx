"use client";

import { useCallback, useEffect, useState } from "react";
import { InfoTip } from "@/components/kit";
import { Chip, Icon, Note, SButton, StudioSheet, Switch } from "@/components/studio";
import { GarmentViewer } from "@/components/xr-viewer";
import { api, rwf } from "@/lib/api";
import { fmtM, fmtMB, type Garment3d, type Studio3d, type Studio3dAsset } from "@/lib/xr";

const STATUS: Record<string, { tone: "mint" | "violet" | "gold" | "red" | "stone"; label: string }> = {
  READY: { tone: "mint", label: "Ready" },
  QUEUED: { tone: "violet", label: "Queued" },
  GENERATING: { tone: "violet", label: "Building" },
  FAILED: { tone: "red", label: "Failed" },
  NONE: { tone: "stone", label: "No 3D yet" },
};

/**
 * 3D readiness card on the studio product page (E27, FR-3D-01a/03/06/07): build AI 3D models from
 * each colour's try-on cut-out, watch progress, preview, and approve before shoppers see them.
 */
export function Garment3dCard({ productId, title, canManage }: { productId: string; title: string; canManage: boolean }) {
  const [s, setS] = useState<Studio3d | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const load = useCallback(async () => setS(await api<Studio3d>(`/xr/products/${productId}/3d`).catch((e: Error) => (setErr(e.message), null))), [productId]);
  useEffect(() => void load(), [load]);
  const building = s?.variants.some((v) => v.asset && (v.asset.status === "QUEUED" || v.asset.status === "GENERATING"));
  useEffect(() => {
    if (!building) return;
    const h = setTimeout(load, 1200);
    return () => clearTimeout(h);
  }, [s, building, load]);
  if (!s) return null;

  const withCutout = s.variants.filter((v) => v.hasCutout);
  const ready = s.variants.filter((v) => v.asset?.status === "READY");
  const approved = ready.length > 0 && ready.every((v) => v.asset!.approved);
  const missing = withCutout.filter((v) => v.asset?.status !== "READY" && !(v.asset && ["QUEUED", "GENERATING"].includes(v.asset.status)));
  const toBuild = missing.length ? missing : withCutout;
  const viewerAssets: Garment3d[] = ready.map((v) => ({
    variantId: v.variantId,
    colourName: v.colourName,
    colourHex: v.colourHex,
    glb: v.asset!.glb!,
    poster: v.asset!.poster,
    dimensions: v.asset!.dimensions ?? { width: 0, height: 0, depth: 0 },
    triangles: v.asset!.triangles ?? 0,
    size: v.asset!.size,
  }));

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      setS(await api<Studio3d>(`/xr/products/${productId}/3d`, { method: "POST", json: { variantIds: toBuild.map((v) => v.variantId) } }));
      navigator.vibrate?.(10);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve(on: boolean) {
    setErr(null);
    try {
      setS(await api<Studio3d>(`/xr/products/${productId}/3d/approve`, { method: "POST", json: { approved: on } }));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section aria-labelledby="xr3d-t" className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-sky-50 via-white to-violet-50 p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[conic-gradient(from_200deg,rgba(56,189,248,.25),rgba(139,92,246,.2),transparent_60%)] blur-2xl" />
      <div className="relative space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-cocoa text-white shadow-[0_8px_18px_-8px_rgba(29,24,20,.7)]">
            <Icon name="layers" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id="xr3d-t" className="font-display text-lg font-black tracking-tight text-cocoa">3D and AR view</h3>
              <Chip tone={approved ? "mint" : building ? "violet" : ready.length ? "gold" : "stone"}>
                {approved ? "Live for shoppers" : building ? "Building" : ready.length ? "Needs your review" : "Not set up"}
              </Chip>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1.5"><Chip>Spin</Chip><Chip>AR · true size</Chip><InfoTip label="About 3D and AR view">AI turns each colour&apos;s cut-out into a 3D model shoppers can spin and place in their room at true size.</InfoTip></p>
          </div>
        </div>

        {withCutout.length === 0 ? (
          <p className="flex items-center gap-2 rounded-2xl bg-white/80 p-3 text-sm font-semibold text-cocoa-2"><Icon name="camera" className="size-4 shrink-0" />Add a colour photo first</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {s.variants.map((v) => (
              <VariantTile key={v.variantId} name={v.colourName} hex={v.colourHex} hasCutout={v.hasCutout} asset={v.asset} />
            ))}
          </ul>
        )}

        <Note error={err} />
        <div className="flex flex-wrap gap-2">
          {withCutout.length > 0 && (
            <SButton onClick={generate} disabled={busy || Boolean(building)} className="flex-1 sm:flex-none">
              <Icon name="sparkle" className="size-4" />
              {building ? "Building 3D…" : missing.length ? `Make 3D for ${missing.length} colour${missing.length > 1 ? "s" : ""}` : "Rebuild 3D"}
            </SButton>
          )}
          {viewerAssets.length > 0 && (
            <SButton variant="outline" onClick={() => setPreview(true)} className="flex-1 sm:flex-none">
              <Icon name="eye" className="size-4" /> Preview in 3D
            </SButton>
          )}
        </div>
        {withCutout.length > 0 && (
          <p className="text-xs text-cocoa-2">
            {rwf(s.costRwf)} / colour
            {s.allowance.cap !== null ? ` · ${Math.max(0, s.allowance.cap - s.allowance.used)}/${s.allowance.cap} AI left` : ""}
          </p>
        )}

        {ready.length > 0 && canManage && (
          <div className="rounded-2xl bg-white p-3">
            <Switch
              checked={approved}
              onChange={approve}
              label="Show 3D to shoppers"
              description={`Labelled “${s.label}”`}
            />
            {!s.published && <p className="mt-2 text-xs font-semibold text-gold-ink">Visible once published</p>}
          </div>
        )}
        {ready.length > 0 && !canManage && <p className="text-xs font-semibold text-cocoa-2">Admin approves 3D</p>}
      </div>

      <StudioSheet open={preview} onClose={() => setPreview(false)} title={`${title} in 3D`}>
        <div className="-mx-1 rounded-[30px] bg-surface-3 p-2 text-fg">
          {preview && <GarmentViewer assets={viewerAssets} title={title} />}
        </div>
        <p className="mt-3 text-xs font-semibold text-cocoa-2">Shopper view · AR on supported phones</p>
      </StudioSheet>
    </section>
  );
}

function VariantTile({ name, hex, hasCutout, asset }: { name: string; hex: string; hasCutout: boolean; asset: Studio3dAsset | null }) {
  const st = STATUS[asset?.status ?? "NONE"];
  const busy = asset && (asset.status === "QUEUED" || asset.status === "GENERATING");
  return (
    <li className="overflow-hidden rounded-2xl bg-white">
      <div className="relative grid aspect-[4/5] place-items-center bg-[radial-gradient(70%_60%_at_50%_40%,#ede9fe,transparent_70%),linear-gradient(180deg,#f8fafc,#eef2f7)]">
        {asset?.status === "READY" && asset.poster ? (
          <img src={asset.poster} alt={`${name} 3D preview`} className="h-[88%] w-[88%] object-contain drop-shadow-[0_10px_14px_rgba(29,24,20,.18)]" />
        ) : busy ? (
          <div className="flex w-3/4 flex-col items-center gap-2" role="status" aria-label={`${name}: building 3D, ${asset!.progress}%`}>
            <div data-skeleton className="st-skel h-24 w-16 rounded-[18px]" />
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-3">
              <div className="h-full rounded-full bg-violet-ink transition-[width] duration-700" style={{ width: `${Math.max(8, asset!.progress)}%` }} />
            </div>
          </div>
        ) : (
          <Icon name={hasCutout ? "layers" : "camera"} className="size-8 text-cocoa-3" />
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-cocoa">
          <span className="size-2.5 rounded-full" style={{ background: hex }} /> {name}
        </span>
      </div>
      <div className="space-y-1 p-2.5">
        <Chip tone={st.tone}>{busy ? `${st.label} ${asset!.progress}%` : !hasCutout ? "Needs a photo" : st.label}</Chip>
        {asset?.status === "READY" && (
          <p className="text-[11px] leading-snug text-cocoa-2">
            {asset.dimensions ? `${fmtM(asset.dimensions.height)} tall · ` : ""}
            {(asset.triangles ?? 0).toLocaleString("en-US")} tris · {fmtMB(asset.bytes ?? 0)}
          </p>
        )}
        {asset?.status === "FAILED" && <p className="text-[11px] text-red-700">{asset.error ?? "Try again"}</p>}
      </div>
    </li>
  );
}
