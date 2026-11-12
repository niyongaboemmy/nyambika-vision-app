"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { Price } from "@/components/region";
import { useDrag } from "@/lib/drag";
import { api, rwf } from "@/lib/api";
import { waLink, type MakerProduct, type MakerSpace } from "@/lib/maker";
import type { Commerce } from "@/lib/region";
import { useSession } from "@/lib/session";
import { askSignIn } from "@/lib/auth-ask";
import { track, trackOnce } from "@/lib/track";
import { Icon } from "@/components/icons";

// The product sheet (try-on, WhatsApp, checkout, 3D) draws only after a tap, so it loads after hydration (JS budget pass).
const ProductSheet = dynamic(() => import("./product-sheet").then((m) => m.ProductSheet), { ssr: false });

/** 2D coverflow collection (Maker Space v1). Swipe to browse, tap to open. */
export function Collection({ maker, commerce }: { maker: MakerSpace; commerce?: Commerce | null }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState<MakerProduct | null>(null);
  const items = maker.products;
  // E30: share links carry ?src=… (WhatsApp status, QR card, broadcast…) → traffic sources in Insights.
  useEffect(() => trackOnce(`maker:${maker.id}`, "maker_space_viewed", { pageId: maker.id, source: new URLSearchParams(window.location.search).get("src")?.slice(0, 24) ?? undefined }), [maker.id]);
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
                <p className="text-xs text-gold">{commerce && commerce.prices[p.id] != null ? <Price minor={commerce.prices[p.id]!} currency={commerce.currency} approxClassName="block text-txt/70" /> : rwf(p.priceRwf)}</p>
              </div>
            </button>
          );
        })}
      </div>
      {/* Pager: buttons mirror the swipe; tapping the centre card opens it. */}
      <div className="mt-2 flex items-center justify-center gap-3 text-xs text-mut">
        <button type="button" aria-label="Previous in collection" disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))} className="hit press grid size-8 place-items-center rounded-full bg-white/5 text-base disabled:opacity-35">‹</button>
        <span className="min-w-12 text-center tabular-nums" aria-live="polite">{i + 1} / {items.length}</span>
        <button type="button" aria-label="Next in collection" disabled={i === items.length - 1} onClick={() => setI((x) => Math.min(items.length - 1, x + 1))} className="hit press grid size-8 place-items-center rounded-full bg-white/5 text-base disabled:opacity-35">›</button>
      </div>
      <ProductSheet maker={maker} product={open} commerce={commerce} onClose={() => setOpen(null)} />
    </section>
  );
}

export function MakerActions({ maker }: { maker: MakerSpace }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [following, setFollowing] = useState(maker.following);
  async function follow() {
    if (!me && !(await askSignIn("Sign in to follow"))) return;
    const r = await api<{ following: boolean }>(`/pages/${maker.id}/follow`, { method: "POST" });
    setFollowing(r.following);
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 mx-auto grid w-full max-w-[480px] grid-cols-2 gap-2 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pt-6 pb-[max(env(safe-area-inset-bottom),16px)]">
      <Button onClick={follow} variant={following ? "glass" : "primary"}>{following ? `✓ ${t("maker.following")}` : `+ ${t("maker.follow")}`}</Button>
      <a href={waLink(maker.whatsapp, `Muraho ${maker.name}!`)} target="_blank" rel="noreferrer" onClick={() => track("maker_contacted", { pageId: maker.id, channel: "whatsapp" })} className="glass inline-flex min-h-12 items-center justify-center rounded-2xl gap-2 font-semibold"><Icon name="chat" className="size-5" /> {t("maker.chat")}</a>
    </div>
  );
}
