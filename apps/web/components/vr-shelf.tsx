"use client";

import { useDrag } from "@/lib/drag";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Price } from "@/components/region";
import { rwf } from "@/lib/api";
import { useRegion, type Commerce } from "@/lib/region";
import { useSession } from "@/lib/session";
import { countdown, fmtWhen, type Shelf, type ShelfItemView } from "@/lib/vr";
import { hasWebGL2, load3d, loadModelViewer, prefersReducedMotion, type Garment3d } from "@/lib/xr";
import { Icon } from "@/components/icons";

const XrStage = dynamic(() => import("@/components/xr-viewer").then((m) => m.XrStage), { ssr: false }); // full viewer on tap

/**
 * E35 Maker Space 3D shelf: a lit glass shelf of the page's approved 3D pieces. Poster-first; once the shelf is
 * on screen, only the focused piece loads its GLB (<model-viewer>, injected on demand). Swipe, arrow keys or
 * the side buttons move along the shelf; tapping / Enter opens the full 3D viewer (E27). Entry to the
 * showroom and the next fashion show sit underneath.
 */
export function Shelf3d({ shelf, brand, commerce }: { shelf: Shelf; brand: string; commerce?: Commerce | null }) {
  const { t } = useSession();
  const { show } = useRegion();
  // E40/E41: page currency + the shopper's display currency ("≈"); RWF for pages without regional prices.
  const priceText = (it: ShelfItemView) => {
    const minor = commerce?.prices[it.productId];
    if (!commerce || minor == null) return rwf(it.priceRwf);
    const d = show(minor, commerce.currency);
    return d.approx ? `${d.primary} (${d.approx})` : d.primary;
  };
  const items = shelf.items;
  const [i, setI] = useState(0);
  const [live, setLive] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [stage, setStage] = useState<{ item: ShelfItemView; assets: Garment3d[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const count = items.length;

  useEffect(() => setReduced(prefersReducedMotion()), []);
  // Load the 3D runtime only when the shelf is actually seen (customer JS budget), never on save-data.
  useEffect(() => {
    const el = ref.current;
    if (!el || !count) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData || !hasWebGL2()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer);
        if (e.isIntersecting) timer = setTimeout(() => void loadModelViewer().then(() => setLive(true)).catch(() => undefined), 500);
      },
      { threshold: 0.55 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [count]);

  const go = (d: number) => {
    setI((x) => Math.max(0, Math.min(count - 1, x + d)));
    navigator.vibrate?.(6);
  };
  const bind = useDrag(
    ({ last, movement: [mx], tap }) => {
      if (tap || !last) return;
      if (mx < -36) go(1);
      if (mx > 36) go(-1);
    },
    { axis: "x", filterTaps: true },
  );

  async function open(item: ShelfItemView) {
    const p = await load3d(item.productId);
    if (!p?.assets.length) return;
    setStage({ item, assets: p.assets });
  }

  if (!count) return null;
  const focus = items[i];
  return (
    <section className="mt-8" aria-labelledby="shelf3d-title">
      <div className="flex items-end justify-between px-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-gold">{t("vr.shelfEyebrow")}</p>
          <h2 id="shelf3d-title" className="font-display text-2xl font-black leading-tight">{t("vr.shelfTitle")}</h2>
        </div>
        <p className="pb-1 text-xs text-mut" aria-live="polite">{i + 1} / {count}</p>
      </div>

      {/* The shelf is a lit 3D stage (stays dark in both themes); its controls sit beside the listbox, not inside it. */}
      <div className="theme-media relative mx-3 mt-3 text-txt">
      <div
        ref={ref}
        {...bind()}
        role="listbox"
        tabIndex={0}
        aria-label={`${brand} pieces in 3D`}
        aria-activedescendant={`shelf-${focus.productId}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") (e.preventDefault(), go(1));
          if (e.key === "ArrowLeft") (e.preventDefault(), go(-1));
          if (e.key === "Home") setI(0);
          if (e.key === "End") setI(count - 1);
          if (e.key === "Enter" || e.key === " ") (e.preventDefault(), void open(focus));
        }}
        className="relative h-[330px] touch-pan-y select-none overflow-hidden rounded-[30px] border border-white/10 outline-none [perspective:1000px] focus-visible:ring-2 focus-visible:ring-gold"
        style={{ background: "radial-gradient(70% 60% at 50% 30%, rgba(139,92,246,.26), transparent 70%), radial-gradient(60% 40% at 50% 100%, rgba(224,112,63,.30), transparent 70%), linear-gradient(180deg,#15111f,#0a090e)" }}
      >
        {/* The glass shelf: a lit edge with a soft reflection under the pieces. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-4 bottom-[64px] h-[26px] rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,255,255,.16),transparent)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-6 bottom-[74px] h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent shadow-[0_0_18px_rgba(242,184,75,.6)]" />
        {items.map((it, idx) => {
          const d = idx - i;
          if (Math.abs(d) > 2) return null;
          const on = d === 0;
          const style: CSSProperties = {
            transform: `translateX(calc(-50% + ${d * 118}px)) translateZ(${on ? 0 : -140}px) rotateY(${d * -24}deg) scale(${on ? 1 : 0.78})`,
            zIndex: 10 - Math.abs(d),
            transition: reduced ? "none" : "transform .45s cubic-bezier(.2,.8,.2,1), opacity .3s",
            opacity: Math.abs(d) === 2 ? 0.45 : 1,
          };
          return (
            <div
              key={it.productId}
              id={`shelf-${it.productId}`}
              role="option"
              aria-selected={on}
              aria-label={`${it.title}, ${priceText(it)}${it.colours.length > 1 ? `, ${it.colours.length} colours` : ""}`}
              onClick={() => (on ? void open(it) : setI(idx))}
              className="absolute bottom-[76px] left-1/2 flex h-[220px] w-[150px] cursor-pointer items-end justify-center"
              style={style}
            >
              {on && live ? (
                <model-viewer
                  src={it.glb}
                  poster={it.poster ?? undefined}
                  alt={`3D model of ${it.title}`}
                  auto-rotate={reduced ? undefined : ""}
                  rotation-per-second="22deg"
                  interaction-prompt="none"
                  disable-zoom=""
                  camera-orbit="20deg 82deg 105%"
                  shadow-intensity="1"
                  environment-image="neutral"
                  tone-mapping="neutral"
                  loading="eager"
                  style={{ width: 190, height: 240, background: "transparent", pointerEvents: "none", "--poster-color": "transparent", "--progress-bar-color": "transparent" } as CSSProperties}
                />
              ) : it.poster ? (
                <img loading="lazy" decoding="async" src={it.poster} alt="" draggable={false} className="max-h-full max-w-full object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,.55)]" />
              ) : (
                <div className="skeleton h-full w-full rounded-[40px]" />
              )}
            </div>
          );
        })}
      </div>

        <div className="absolute inset-x-0 bottom-3 z-20 flex items-center justify-between gap-2 px-3">
          <ShelfButton label="Previous piece" disabled={i === 0} onClick={() => go(-1)}>‹</ShelfButton>
          <button onClick={() => void open(focus)} className="min-w-0 flex-1 rounded-2xl px-2 py-1 text-center">
            <span className="block truncate text-sm font-bold">{focus.title}</span>
            <span className="block text-xs text-gold">{commerce && commerce.prices[focus.productId] != null ? <Price minor={commerce.prices[focus.productId]!} currency={commerce.currency} approxClassName="text-txt/70" /> : rwf(focus.priceRwf)} · {t("vr.tapToTurn")}</span>
          </button>
          <ShelfButton label="Next piece" disabled={i === count - 1} onClick={() => go(1)}>›</ShelfButton>
        </div>
        <span className="pointer-events-none absolute left-3 top-3 z-20 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[11px] font-semibold backdrop-blur"><Icon name="sparkle" className="mr-1 inline size-3 align-[-2px]" />{t("xr.aiLabel")}</span>
      </div>

      <div className="mt-3 grid gap-2 px-4">
        {shelf.showroom && (
          <Link
            href={`/m/${shelf.handle}/showroom`}
           
            className="group relative flex min-h-16 items-center gap-3 overflow-hidden rounded-[22px] border border-white/10 px-4 py-3"
            style={{ background: "linear-gradient(110deg, rgba(224,112,63,.28), rgba(139,92,246,.28) 60%, rgba(56,189,248,.18))" }}
          >
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-black/35"><Icon name="headset" className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-black leading-tight">{t("vr.enterShowroom")}</span>
              <span className="block text-xs text-txt/80">{t("vr.showroomHint")}</span>
            </span>
            <span aria-hidden className="text-xl transition group-hover:translate-x-1">→</span>
          </Link>
        )}
        {shelf.shows.map((s) => (
          <Link key={s.id} href={`/m/${shelf.handle}/shows/${s.id}`} className="glass flex items-center gap-3 rounded-[22px] p-2.5 pr-4">
            {s.cover ? <img loading="lazy" decoding="async" src={s.cover} alt="" className="size-14 shrink-0 rounded-2xl object-cover" /> : <span className="size-14 shrink-0 rounded-2xl bg-white/10" />}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
                {s.phase === "LIVE" ? <span className="rounded-full bg-terra px-2 py-0.5 text-white">● {t("vr.live")}</span> : <span className="text-gold">{t("vr.fashionShow")}</span>}
              </span>
              <span className="block truncate font-bold">{s.title}</span>
              <span className="block text-xs text-mut" suppressHydrationWarning>{s.phase === "LIVE" ? t("vr.watchNow") : `${fmtWhen(s.startsAt)} · in ${countdown(new Date(s.startsAt).getTime() - Date.now())}`}</span>
            </span>
            <span aria-hidden>›</span>
          </Link>
        ))}
      </div>

      {stage && (
        <XrStage open onClose={() => setStage(null)} title={stage.item.title} subtitle={`${brand} · ${priceText(stage.item)}`} assets={stage.assets} initialVariantId={stage.item.variantId} />
      )}
    </section>
  );
}

function ShelfButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick} className="glass grid size-11 shrink-0 place-items-center rounded-full text-xl transition active:scale-90 disabled:opacity-30">
      {children}
    </button>
  );
}
