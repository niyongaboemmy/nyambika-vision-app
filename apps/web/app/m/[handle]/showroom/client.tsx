"use client";

import { roomLayout } from "@nyambika/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoldToBuy } from "@/components/hold-to-buy";
import type { ShowroomEngine } from "@/components/vr-engine";
import { SharedRoom } from "@/components/vr-presence";
import { useFlag } from "@/lib/flags";
import { XrStage } from "@/components/xr-viewer";
import { api, rwf } from "@/lib/api";
import { useRegion, type Commerce } from "@/lib/region";
import { useSession } from "@/lib/session";
import type { FitView, Twin3dState } from "@/lib/twin3d";
import { fmtWhen, lookFor, lowEnd, xrSupported, type RoomItem, type Showroom } from "@/lib/vr";
import { fmtMB, hasWebGL2, load3d, prefersReducedMotion, type Garment3d } from "@/lib/xr";

type Mode = "loading" | "3d" | "flat";

export function ShowroomClient({ room, commerce }: { room: Showroom; commerce?: Commerce | null }) {
  return (
    <Suspense fallback={<div className="theme-media skeleton min-h-dvh" />}>
      <Room room={room} commerce={commerce ?? null} />
    </Suspense>
  );
}

function Room({ room, commerce }: { room: Showroom; commerce: Commerce | null }) {
  const { me, t } = useSession();
  const { show } = useRegion();
  /** E40/E41: page currency, plus "≈" in the shopper's display currency; RWF when the page has no regional price. */
  const price = useCallback(
    (i: { productId: string; priceRwf: number }) => {
      const minor = commerce?.prices[i.productId];
      if (!commerce || minor == null) return rwf(i.priceRwf);
      const d = show(minor, commerce.currency);
      return d.approx ? `${d.primary} ${d.approx}` : d.primary;
    },
    [commerce, show],
  );
  const router = useRouter();
  const q = useSearchParams();
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ShowroomEngine | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [progress, setProgress] = useState({ loaded: 0, total: room.items.length, bytes: 0 });
  const [firstView, setFirstView] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [xrOk, setXrOk] = useState(false);
  const [inXr, setInXr] = useState(false);
  const [xrError, setXrError] = useState<string | null>(null);
  const [seated, setSeated] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [sound, setSound] = useState(false);
  const [handoff, setHandoff] = useState(0);
  const [stage, setStage] = useState<{ item: RoomItem; assets: Garment3d[] } | null>(null);
  const [twin, setTwin] = useState<{ id: string; state: "working" | "on" | "none" | "error"; note?: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const mrMirror = useFlag("mr.mirror_spike"); // R4 spike entry
  const item = room.items.find((i) => i.productId === selected) ?? null;
  const pieces = useMemo(() => {
    const places = roomLayout(room.items.length);
    return room.items.map((i, n) => ({ id: i.productId, title: i.title, price: rwf(i.priceRwf), glb: i.glb, poster: i.poster, heightM: i.heightM, place: places[n] }));
  }, [room.items]);

  // Boot the engine (three.js is fetched here, not with the page).
  useEffect(() => {
    if (!room.items.length) return;
    if (!hasWebGL2()) return setMode("flat");
    let live = true;
    void xrSupported().then((ok) => live && setXrOk(ok));
    void import("@/components/vr-engine")
      .then(({ ShowroomEngine }) => {
        if (!live || !canvas.current) return;
        const font = getComputedStyle(document.body).getPropertyValue("--font-display").trim() || "system-ui, sans-serif";
        engine.current = new ShowroomEngine({
          canvas: canvas.current,
          pieces,
          palette: room.page.palette,
          brand: room.page.name,
          banner: room.banner,
          font,
          reducedMotion: prefersReducedMotion(),
          highContrast: false,
          lowEnd: lowEnd(),
          onSelect: (id) => setSelected(id),
          onHoldBuy: (id) => {
            setSelected(id);
            setHandoff((n) => n + 1);
          },
          onProgress: setProgress,
          onXr: setInXr,
          onReady: () => setFirstView(true),
        });
        setMode("3d");
        // Dev/test hook: the crawl drives the XR hold-to-buy hand-off without a headset.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __vrShowroom?: ShowroomEngine }).__vrShowroom = engine.current;
        const pre = q.get("item");
        if (pre && room.items.some((i) => i.productId === pre)) engine.current.select(pre);
      })
      .catch(() => live && setMode("flat"));
    return () => {
      live = false;
      engine.current?.dispose();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces]);

  useEffect(() => {
    if (item) setAnnounce(`${item.title}, ${price(item)} selected`);
  }, [item]);
  useEffect(() => engine.current?.setHighContrast(contrast), [contrast]);
  // Spatial labels follow the display currency (redrawn in place, no scene rebuild).
  useEffect(() => engine.current?.setPrices(Object.fromEntries(room.items.map((i) => [i.productId, price(i)]))), [price, room.items, mode]);
  useEffect(() => engine.current?.setSeated(seated), [seated]);
  useAmbient(sound);

  const pick = useCallback(
    (id: string | null) => {
      if (engine.current) engine.current.select(id);
      else setSelected(id);
    },
    [],
  );

  async function enterVr() {
    setXrError(null);
    try {
      await engine.current?.enterXR(seated);
    } catch (e) {
      setXrError((e as Error).message || "VR could not start on this device.");
    }
  }

  async function view3d(i: RoomItem) {
    const p = await load3d(i.productId);
    if (p?.assets.length) setStage({ item: i, assets: p.assets });
  }

  /** The shopper's own 3D twin wearing the piece: private signed link, only in this session (OP-3). */
  async function onMyTwin(i: RoomItem) {
    setTwin({ id: i.productId, state: "working" });
    try {
      const st = await api<Twin3dState>("/twin3d");
      if (!st.ready) return setTwin({ id: i.productId, state: "none" });
      let fit = await api<FitView>("/twin3d/fit", { method: "POST", json: { variantId: i.variantId } });
      for (let n = 0; n < 60 && fit.status === "QUEUED"; n++) {
        await new Promise((r) => setTimeout(r, 1000));
        fit = await api<FitView>(`/twin3d/fit/${fit.id}`);
      }
      if (fit.status !== "READY" || !fit.glb) throw new Error(fit.error ?? "The fit could not be made");
      const ok = await engine.current?.showTwin(i.productId, fit.glb);
      setTwin({ id: i.productId, state: ok ? "on" : "error", note: ok ? fit.disclaimer : "Could not show the 3D twin" });
    } catch (e) {
      setTwin({ id: i.productId, state: "error", note: (e as Error).message });
    }
  }

  function offTwin() {
    engine.current?.clearTwin();
    setTwin(null);
  }

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.code;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"].includes(k)) {
      e.preventDefault();
      engine.current?.key(k, e.type === "keydown");
    }
    if (e.type !== "keydown") return;
    if (e.key === "]" || e.key === "n") engine.current?.step(1);
    if (e.key === "[" || e.key === "p") engine.current?.step(-1);
    if (e.key === "Escape") pick(null);
    if (e.key === "h") engine.current?.home();
  };

  if (!room.items.length) {
    return (
      <main className="grid min-h-dvh place-items-center bg-ink p-6 text-center">
        <div>
          <p className="font-display text-2xl font-black">{room.page.name}&apos;s showroom is being set up</p>
          <p className="mt-2 text-mut">No 3D pieces yet. Visit the Maker Space in the meantime.</p>
          <Link href={`/m/${room.page.handle}`} className="glass mt-5 inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold">← Maker Space</Link>
        </div>
      </main>
    );
  }

  const look = item ? lookFor(room.page, item.product, { id: item.variantId, colourName: item.colourName, colourHex: item.colours[0]?.colourHex ?? "#888", sizes: item.variants.find((v) => v.id === item.variantId)?.sizes ?? [], inStock: item.variants.find((v) => v.id === item.variantId)?.inStock ?? true }, item.variants, item.photo) : null;
  const pct = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 100;

  return (
    <main className="theme-media relative h-dvh w-full overflow-hidden bg-ink text-txt" style={{ background: `radial-gradient(80% 60% at 50% 20%, ${room.page.palette.primary}33, transparent 70%), #0b0a0f` }}>
      <p className="sr-only" aria-live="polite">{announce}</p>
      {mode !== "flat" && (
        <canvas
          ref={canvas}
          tabIndex={0}
          onKeyDown={onKey}
          onKeyUp={onKey}
          aria-label={`${room.page.name} 3D showroom. Drag to look around, tap the floor to walk, tap a piece to select it. Keys: arrows or W A S D to walk and turn, Q and E to step sideways, N and P for the next or previous piece, H to return to the entrance, Escape to deselect.`}
          className="absolute inset-0 size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
        />
      )}
      {mode !== "flat" && !firstView && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-label="Opening the showroom">
          <div className="skeleton h-2/3 w-3/4 rounded-[40px] opacity-40" />
        </div>
      )}

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-8 pt-[max(env(safe-area-inset-top),12px)]">
        <Link href={`/m/${room.page.handle}`} aria-label={`Back to ${room.page.name}`} className="glass grid size-11 shrink-0 place-items-center rounded-full">←</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-black leading-tight">{room.page.name} {room.page.verified && <span className="text-mint" title="Verified member">✓</span>}</h1>
          <p className="truncate text-xs text-txt/75">3D showroom · {room.items.length} pieces</p>
        </div>
        <Toggle on={sound} set={setSound} label="Ambient sound" icon={sound ? "🔊" : "🔈"} />
        <Toggle on={contrast} set={setContrast} label="High-contrast labels" icon="◐" />
        <Toggle on={seated} set={setSeated} label="Seated mode" icon="🪑" />
      </header>

      {/* Streaming progress (FR-VR-08) */}
      {mode === "3d" && progress.loaded < progress.total && (
        <div className="absolute inset-x-6 top-[84px] z-10" role="status" aria-live="polite">
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-terra via-gold to-violet transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-center text-[11px] text-txt/75">Bringing in pieces {progress.loaded}/{progress.total} · {fmtMB(progress.bytes)} of ≤ {fmtMB(room.budget.limitBytes)}</p>
        </div>
      )}
      {sound && <p className="absolute inset-x-0 top-[104px] z-10 text-center text-xs text-txt/80" aria-live="polite">♪ Soft ambient music is playing</p>}

      {mode === "flat" && <FlatRoom room={room} onPick={(id) => setSelected(id)} price={price} />}

      {/* Bottom: controls, piece rail, selected card */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-10">
        {item && look ? (
          <section aria-label={`${item.title} details`} className="glass mx-auto max-w-[480px] animate-rise rounded-[26px] p-3">
            <div className="flex gap-3">
              {(item.photo ?? item.poster) && <img src={(item.photo ?? item.poster)!} alt={item.title} className="h-24 w-20 shrink-0 rounded-2xl object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h2 className="min-w-0 flex-1 font-display text-lg font-black leading-tight">{item.title}</h2>
                  <button onClick={() => (offTwin(), pick(null))} aria-label="Close piece details" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">✕</button>
                </div>
                <p className="font-semibold text-gold">{price(item)}{item.product.madeToOrder ? " · made to measure" : ""}</p>
                <p className="text-xs text-mut">{item.colours.map((c) => c.colourName).join(" · ")} · paid directly to {room.page.name}</p>
              </div>
              <div className="self-end">
                {me ? (
                  <HoldToBuy key={`buy-${item.productId}-${handoff}`} look={look} autoOpen={handoff > 0} />
                ) : (
                  <button onClick={() => router.push(`/signin?next=${encodeURIComponent(`/m/${room.page.handle}/showroom?item=${item.productId}`)}`)} className="grad-cta rounded-2xl px-4 py-2 text-sm font-bold">✋ Sign in to buy</button>
                )}
              </div>
            </div>
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
              <Pill onClick={() => void view3d(item)}>🧊 View in 3D</Pill>
              {me && mode === "3d" && (twin?.id === item.productId && twin.state === "on" ? <Pill onClick={offTwin}>↺ Back to mannequin</Pill> : <Pill onClick={() => void onMyTwin(item)} busy={twin?.id === item.productId && twin.state === "working"}>🪞 See it on my 3D twin</Pill>)}
              <Pill href={`/looks/try?variant=${item.variantId}`}>✨ Try on me</Pill>
              {me && mrMirror && <Pill href={`/mirror/mr?product=${item.productId}&variant=${item.variantId}`}>🥽 Mixed-reality mirror</Pill>}
              <Pill href={`/m/${room.page.handle}`}>🏠 Maker Space</Pill>
            </div>
            {twin?.id === item.productId && twin.state === "on" && <p className="mt-2 text-[11px] text-mut">🔒 Only you see your 3D twin here. {twin.note}</p>}
            {twin?.id === item.productId && twin.state === "none" && <p className="mt-2 text-xs text-mut"><Link className="text-gold underline" href="/mirror/3d">Make your 3D twin</Link> · 2 min</p>}
            {twin?.id === item.productId && twin.state === "error" && <p className="mt-2 text-xs text-terra">{twin.note}</p>}
          </section>
        ) : (
          <div className="mx-auto max-w-[480px]">
            <div className="mb-2 flex items-center justify-center gap-2">
              <Ctl label="Previous piece" onClick={() => engine.current?.step(-1)}>‹</Ctl>
              <Ctl label="Turn left" onClick={() => engine.current?.turn(Math.PI / 6)}>⟲</Ctl>
              <Ctl label="Back to the entrance" onClick={() => engine.current?.home()}>⌂</Ctl>
              <Ctl label="Turn right" onClick={() => engine.current?.turn(-Math.PI / 6)}>⟳</Ctl>
              <Ctl label="Next piece" onClick={() => engine.current?.step(1)}>›</Ctl>
            </div>
            {mode === "3d" && <p className="mb-2 text-center text-[11px] text-txt/75">Drag · tap floor to walk · tap a piece</p>}
            <nav aria-label="Pieces in this room" className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {room.items.map((i) => (
                <button key={i.productId} onClick={() => pick(i.productId)} className="glass flex shrink-0 items-center gap-2 rounded-2xl p-1.5 pr-3 text-left">
                  {i.poster ? <img src={i.poster} alt="" className="size-11 rounded-xl bg-black/30 object-contain" /> : <span className="size-11 rounded-xl bg-white/10" />}
                  <span className="max-w-[120px]">
                    <span className="block truncate text-xs font-bold">{i.title}</span>
                    <span className="block text-[11px] text-gold">{price(i)}</span>
                  </span>
                </button>
              ))}
            </nav>
            {room.shows[0] && (
              <Link href={`/m/${room.page.handle}/shows/${room.shows[0].id}`} className="mt-1 flex min-h-11 items-center justify-center gap-2 text-xs font-semibold text-gold">
                {room.shows[0].phase === "LIVE" ? `● ${t("vr.live")}: ${room.shows[0].title}` : `${t("vr.fashionShow")} · ${fmtWhen(room.shows[0].startsAt)}`} ›
              </Link>
            )}
          </div>
        )}
        {mode === "3d" && xrOk && !inXr && (
          <div className="mx-auto mt-2 max-w-[480px]">
            <button onClick={() => void enterVr()} className="grad-cta flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-bold shadow-[0_12px_32px_rgba(139,92,246,.4)]">
              🥽 {t("vr.enterVr")}{seated ? " · seated" : ""}
            </button>
            {xrError && <p className="mt-1 text-center text-xs text-terra" role="alert">{xrError}</p>}
          </div>
        )}
        <p className="mt-2 text-center text-[10px] text-txt/60">✨ {room.label} · approximate</p>
      </div>

      {/* R4 spike: shared presence (flag vr.multiuser_spike; renders nothing while off) */}
      {mode === "3d" && firstView && (
        <SharedRoom engine={engine.current} room={`showroom:${room.page.handle}`} signedIn={Boolean(me)} signInHref={`/signin?next=${encodeURIComponent(`/m/${room.page.handle}/showroom`)}`} seated={seated} show={room.shows[0] ? { id: room.shows[0].id, title: room.shows[0].title, href: `/m/${room.page.handle}/shows/${room.shows[0].id}` } : null} />
      )}
      {stage && <XrStage open onClose={() => setStage(null)} title={stage.item.title} subtitle={`${room.page.name} · ${price(stage.item)}`} assets={stage.assets} initialVariantId={stage.item.variantId} />}
    </main>
  );
}

/** No WebGL2: the same pieces as an image grid with the same actions (FR-3D-08 style fallback). */
function FlatRoom({ room, onPick, price }: { room: Showroom; onPick: (id: string) => void; price: (i: RoomItem) => string }) {
  return (
    <div className="absolute inset-0 overflow-y-auto px-4 pb-72 pt-24">
      <p className="mb-3 text-center text-sm text-mut">3D needs a newer browser on this device. Here are the pieces.</p>
      <ul className="grid grid-cols-2 gap-3">
        {room.items.map((i) => (
          <li key={i.productId}>
            <button onClick={() => onPick(i.productId)} className="glass w-full overflow-hidden rounded-3xl text-left">
              {(i.poster ?? i.photo) && <img src={(i.poster ?? i.photo)!} alt="" className="h-44 w-full object-contain p-2" />}
              <span className="block truncate px-3 text-sm font-bold">{i.title}</span>
              <span className="block px-3 pb-3 text-xs text-gold">{price(i)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Toggle({ on, set, label, icon }: { on: boolean; set: (v: boolean) => void; label: string; icon: string }) {
  return (
    <button aria-pressed={on} aria-label={label} title={label} onClick={() => set(!on)} className={`grid size-11 shrink-0 place-items-center rounded-full text-base transition ${on ? "bg-gold text-ink" : "glass"}`}>
      {icon}
    </button>
  );
}

function Ctl({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="glass grid size-11 place-items-center rounded-full text-lg transition active:scale-90">
      {children}
    </button>
  );
}

function Pill({ children, onClick, href, busy }: { children: React.ReactNode; onClick?: () => void; href?: string; busy?: boolean }) {
  const cls = "inline-flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-3.5 text-xs font-semibold ring-1 ring-inset ring-white/15 transition active:scale-95";
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return (
    <button onClick={onClick} disabled={busy} aria-busy={busy} className={`${cls} disabled:opacity-60`}>
      {busy ? "Dressing your twin…" : children}
    </button>
  );
}

/** Ambient pad (WebAudio, no asset download). Off by default; captioned while on (FR-VR-07). */
function useAmbient(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.5);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.connect(gain).connect(ctx.destination);
    const oscs = [196, 246.94, 293.66, 392].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "triangle" : "sine";
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 4;
      o.connect(filter);
      o.start();
      return o;
    });
    return () => {
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      setTimeout(() => {
        oscs.forEach((o) => o.stop());
        void ctx.close();
      }, 350);
    };
  }, [on]);
}
