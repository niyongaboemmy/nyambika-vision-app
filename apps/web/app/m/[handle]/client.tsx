"use client";

import { useDrag } from "@use-gesture/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { waLink, type MakerProduct, type MakerSpace } from "@/lib/maker";
import { useSession } from "@/lib/session";

/** 2D coverflow collection (Maker Space v1). Swipe to browse, tap to open. */
export function Collection({ maker }: { maker: MakerSpace }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState<MakerProduct | null>(null);
  const items = maker.products;
  const bind = useDrag(
    ({ last, movement: [mx], tap }) => {
      if (tap || !last) return;
      if (mx < -40) setI((x) => Math.min(items.length - 1, x + 1));
      if (mx > 40) setI((x) => Math.max(0, x - 1));
    },
    { axis: "x", filterTaps: true },
  );
  if (!items.length) return <p className="mt-8 px-5 text-center text-mut">No products yet.</p>;
  return (
    <section className="mt-6">
      <div {...bind()} className="relative h-[300px] touch-pan-y select-none [perspective:900px]" role="listbox" aria-label="Collection">
        {items.map((p, idx) => {
          const d = idx - i;
          if (Math.abs(d) > 2) return null;
          const img = p.variants[0]?.image;
          return (
            <button
              key={p.id}
              role="option"
              aria-selected={d === 0}
              aria-label={`${p.title}, ${rwf(p.priceRwf)}`}
              onClick={() => (d === 0 ? setOpen(p) : setI(idx))}
              className="glass absolute left-1/2 top-2 h-[270px] w-[180px] overflow-hidden rounded-3xl transition-all duration-300"
              style={{
                transform: `translateX(calc(-50% + ${d * 120}px)) rotateY(${d * -28}deg) scale(${1 - Math.abs(d) * 0.14})`,
                zIndex: 10 - Math.abs(d),
              }}
            >
              {/* Dim only the photo on side cards so labels keep WCAG AA contrast. */}
              {img && <img src={img} alt="" draggable={false} className="h-[200px] w-full object-cover" style={{ filter: `brightness(${1 - Math.abs(d) * 0.3})` }} />}
              <div className="p-2 text-left">
                <p className="truncate text-sm font-semibold">{p.title}</p>
                <p className="text-xs text-gold">{rwf(p.priceRwf)}</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-xs text-mut">
        {i + 1} / {items.length} · swipe to browse · tap to try on your twin
      </p>
      <ProductSheet maker={maker} product={open} onClose={() => setOpen(null)} />
    </section>
  );
}

function ProductSheet({ maker, product, onClose }: { maker: MakerSpace; product: MakerProduct | null; onClose: () => void }) {
  const router = useRouter();
  const [vi, setVi] = useState(0);
  if (!product) return null;
  const v = product.variants[Math.min(vi, product.variants.length - 1)];
  const tryOn = () => router.push(`/looks/try?variant=${v.id}`);
  return (
    <Sheet open onClose={onClose}>
      <div className="flex gap-4">
        {v.image && <img src={v.image} alt={product.title} className="h-40 w-32 rounded-2xl object-cover" />}
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-display text-xl font-black">{product.title}</h3>
          <p className="font-semibold text-gold">{rwf(product.priceRwf)}{product.madeToOrder ? " · made to measure" : ""}</p>
          {product.makers.length > 0 && <p className="text-sm text-mut">Made by {product.makers.join(", ")}, {maker.name}</p>}
          <p className="text-sm text-mut">{product.madeToOrder ? `Ready in ${product.leadTimeDays} days` : v.inStock ? "In stock" : "Out of stock"}</p>
          <div className="flex flex-wrap gap-2 pt-1" role="radiogroup" aria-label="Colour">
            {product.variants.map((x, j) => (
              <button key={x.id} role="radio" aria-checked={j === vi} aria-label={x.colourName} onClick={() => setVi(j)} className={`size-8 rounded-full border-2 ${j === vi ? "border-gold" : "border-white/30"}`} style={{ background: x.colourHex }} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={tryOn} disabled={product.readiness !== "READY"}>✨ Try on me</Button>
        <a
          className="glass inline-flex min-h-12 items-center justify-center rounded-2xl font-semibold"
          href={waLink(maker.whatsapp, `Muraho ${maker.name}! I'd like "${product.title}" (${v.colourName}). ${typeof window !== "undefined" ? window.location.origin : ""}/m/${maker.handle}`)}
          target="_blank"
          rel="noreferrer"
        >
          💬 Order on WhatsApp
        </a>
      </div>
      {product.readiness !== "READY" && <p className="mt-2 text-center text-xs text-mut">Try-on isn't available for this item yet.</p>}
      {product.studio.length > 0 && (
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
          {product.studio.filter(Boolean).map((src) => (
            <figure key={src} className="relative shrink-0">
              <img src={src!} alt={`${product.title} on an AI model`} className="h-40 w-24 rounded-xl object-cover" />
              <figcaption className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px]">AI model</figcaption>
            </figure>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function MakerActions({ maker }: { maker: MakerSpace }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [following, setFollowing] = useState(maker.following);
  async function follow() {
    if (!me) return router.push(`/signin?next=/m/${maker.handle}`);
    const r = await api<{ following: boolean }>(`/pages/${maker.id}/follow`, { method: "POST" });
    setFollowing(r.following);
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 mx-auto grid w-full max-w-[480px] grid-cols-2 gap-2 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pt-6 pb-[max(env(safe-area-inset-bottom),16px)]">
      <Button onClick={follow} variant={following ? "glass" : "primary"}>{following ? `✓ ${t("maker.following")}` : `+ ${t("maker.follow")}`}</Button>
      <a href={waLink(maker.whatsapp, `Muraho ${maker.name}!`)} target="_blank" rel="noreferrer" className="glass inline-flex min-h-12 items-center justify-center rounded-2xl font-semibold">💬 {t("maker.chat")}</a>
    </div>
  );
}
