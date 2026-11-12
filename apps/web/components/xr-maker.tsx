"use client";

import { useEffect, useState } from "react";
import { GarmentViewer } from "@/components/xr-viewer";
import { useSession } from "@/lib/session";
import { fmtM, load3d, type Product3d } from "@/lib/xr";
import { Icon } from "@/components/icons";

/**
 * Maker Space product sheet: 3D section (E27, FR-3D-04, FR-AR-01). Shows a poster card first; the
 * 3D viewer (and its script) loads only when the shopper taps it. Renders nothing without 3D.
 */
export function Garment3dSection({ productId, title, variantId }: { productId: string; title: string; variantId?: string }) {
  const { t } = useSession();
  const [p3d, setP3d] = useState<Product3d | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setOpen(false);
    void load3d(productId).then((v) => live && setP3d(v));
    return () => {
      live = false;
    };
  }, [productId]);
  if (!p3d?.assets.length) return null;
  const a = p3d.assets.find((x) => x.variantId === variantId) ?? p3d.assets[0];

  if (open) return <GarmentViewer className="mt-4" assets={p3d.assets} title={title} variantId={a.variantId} />;
  return (
    <button
      onClick={() => setOpen(true)}
      className="group relative mt-4 flex w-full items-center gap-4 overflow-hidden rounded-[24px] p-3 text-left transition active:scale-[.99]"
      style={{ background: "radial-gradient(80% 120% at 0% 50%, rgba(139,92,246,.28), transparent 60%), radial-gradient(60% 90% at 100% 100%, rgba(224,112,63,.22), transparent 70%), #15131b" }}
    >
      <span className="relative grid h-24 w-20 shrink-0 place-items-center [perspective:400px]">
        <span aria-hidden className="absolute bottom-1 h-3 w-14 rounded-[50%] bg-black/50 blur-[3px]" />
        {a.poster && <img src={a.poster} alt="" className="h-full w-full object-contain transition duration-500 group-hover:[transform:rotateY(18deg)]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-display text-lg font-black">
          <span className="rounded-md bg-sky/20 px-1.5 text-sm text-sky">3D</span> View in 3D
        </span>
        <span className="mt-0.5 block text-sm text-txt/80">Turn it around, switch colours{p3d.assets.length > 1 ? ` (${p3d.assets.length})` : ""}, place it in your room.</span>
        <span className="mt-1 block text-[11px] text-mut"><Icon name="sparkle" className="mr-1 inline size-3 align-[-2px]" />{t("xr.aiLabel")} · {fmtM(a.dimensions.height)}</span>
      </span>
      <span aria-hidden className="glass grid size-10 shrink-0 place-items-center rounded-full">›</span>
    </button>
  );
}
