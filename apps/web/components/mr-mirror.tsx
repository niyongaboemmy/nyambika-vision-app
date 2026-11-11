"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArMirror } from "@/components/ar-mirror";
import type { MirrorEngine, XrMode } from "@/components/mr-engine";
import { api } from "@/lib/api";
import type { FitView, GarmentInfo, Twin3dState, WardrobeItem } from "@/lib/twin3d";
import { hasWebGL2, load3d, prefersReducedMotion, type Garment3d } from "@/lib/xr";

export interface MirrorPiece {
  productId: string;
  title: string;
  category: string;
  assets: Garment3d[];
}
type Support = { ar: boolean; vr: boolean } | null;
type Body = "synthetic" | "twin";

/**
 * R4 spike (flag `mr.mirror_spike`): mixed-reality fitting mirror. Preview the stage inline, then place it in
 * the room (immersive-ar with passthrough) or a virtual fitting room (immersive-vr: Vision Pro, VR headsets).
 * Devices without WebXR get the existing E34 AR mirror inline (or the 3D twin when that pilot is off).
 */
export function MrMirror({ pieces, wardrobe, twin, arPilot, initial }: { pieces: MirrorPiece[]; wardrobe: WardrobeItem[]; twin: Twin3dState | null; arPilot: boolean; initial: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const engine = useRef<MirrorEngine | null>(null);
  const [support, setSupport] = useState<Support>(null);
  const [ready, setReady] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [piece, setPiece] = useState<MirrorPiece | null>(() => pieces.find((p) => p.productId === initial || p.assets.some((a) => a.variantId === initial)) ?? pieces[0] ?? null);
  const [colour, setColour] = useState<string | null>(() => piece?.assets.find((a) => a.variantId === initial)?.variantId ?? piece?.assets[0]?.variantId ?? null);
  const [info, setInfo] = useState<GarmentInfo | null>(null);
  const [size, setSize] = useState("M");
  const [body, setBody] = useState<Body>("synthetic");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [xr, setXr] = useState<XrMode | null>(null);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const twinReady = Boolean(twin?.ready);
  const asset = piece?.assets.find((a) => a.variantId === colour) ?? piece?.assets[0] ?? null;
  const sizes = info?.sizes.length ? info.sizes : [...new Set(piece?.assets.map((a) => a.size).filter(Boolean) ?? ["S", "M", "L"])];

  useEffect(() => {
    let live = true;
    if (!hasWebGL2()) {
      setWebgl(false);
      setSupport({ ar: false, vr: false });
      return;
    }
    void import("@/components/mr-engine").then(async ({ MirrorEngine }) => {
      const s = await MirrorEngine.support();
      if (!live) return;
      setSupport(s);
      if (!canvas.current) return;
      const font = getComputedStyle(document.body).getPropertyValue("--font-display").trim() || "system-ui, sans-serif";
      engine.current = new MirrorEngine({
        canvas: canvas.current,
        font,
        reducedMotion: prefersReducedMotion(),
        lowEnd: (navigator.hardwareConcurrency ?? 8) <= 4,
        onPick: (kind, value) => (kind === "colour" ? setColour(value) : setSize(value)),
        onXr: setXr,
        onPlaced: setPlaced,
      });
      if (process.env.NODE_ENV !== "production") (window as unknown as { __mrMirror?: MirrorEngine }).__mrMirror = engine.current;
      setReady(true);
    });
    return () => {
      live = false;
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);

  // Sizes + the recommended one (from the twin's measurements when there is a twin).
  useEffect(() => {
    if (!colour) return;
    let live = true;
    void api<GarmentInfo>(`/twin3d/garment/${colour}`)
      .then((g) => {
        if (!live) return;
        setInfo(g);
        if (g.recommended) setSize((s) => (g.sizes.includes(s) && s !== "M" ? s : g.recommended));
      })
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [colour]);

  // Dress the figure whenever the piece, colour, size or body changes.
  const dress = useCallback(async () => {
    const e = engine.current;
    if (!e || !asset || !piece) return;
    e.setChoice({ colours: piece.assets.map((a) => ({ id: a.variantId, name: a.colourName, hex: a.colourHex })), sizes, colour: asset.variantId, size });
    setNote(null);
    if (body === "twin") {
      setBusy("Dressing your 3D twin…");
      try {
        let fit = await api<FitView>("/twin3d/fit", { method: "POST", json: { variantId: asset.variantId, size } });
        for (let n = 0; n < 60 && fit.status === "QUEUED"; n++) {
          await new Promise((r) => setTimeout(r, 1000));
          fit = await api<FitView>(`/twin3d/fit/${fit.id}`);
        }
        if (fit.status !== "READY" || !fit.glb) throw new Error(fit.error ?? "The fit could not be made");
        await e.showTwin(fit.glb);
        setNote(`${fit.fit ? `${fit.fit.fit} fit in ${fit.size}. ` : ""}${fit.disclaimer}`);
      } catch (err) {
        setNote((err as Error).message);
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy("Bringing in the piece…");
    const ok = await e.showGarment(asset.glb, piece.category, size);
    setBusy(null);
    if (!ok) setNote("This piece's 3D model didn't load. Try another colour.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.variantId, piece?.productId, size, body, sizes.join(",")]);

  useEffect(() => {
    if (ready) void dress();
  }, [ready, dress]);

  async function enter(mode: XrMode) {
    setError(null);
    try {
      await engine.current?.enter(mode, overlay.current);
    } catch (e) {
      setError((e as Error).message || "Mixed reality could not start on this device.");
    }
  }

  const xrOk = support && (support.ar || support.vr);

  return (
    <div className="space-y-4">
      <section aria-label="Mirror preview" className="relative overflow-hidden rounded-[32px] border border-white/10" style={{ background: "radial-gradient(70% 55% at 50% 30%, #8b5cf633, transparent 70%), radial-gradient(60% 40% at 50% 100%, #f0b42922, transparent 70%), #0d0b13" }}>
        {webgl ? (
          <canvas ref={canvas} className="block h-[50dvh] max-h-[520px] w-full touch-none" aria-label={`Preview of the fitting mirror: ${piece?.title ?? "no piece"} on ${body === "twin" ? "your 3D twin" : "a synthetic body"}. Drag to turn.`} />
        ) : (
          <div className="grid h-[30dvh] place-items-center p-6 text-center text-sm text-mut">3D needs a newer browser on this device.</div>
        )}
        {!ready && webgl && <div className="skeleton absolute inset-6 rounded-[28px] opacity-40" aria-hidden />}
        <span className="absolute left-3 top-3 rounded-full bg-violet/35 px-3 py-1 text-[11px] font-bold uppercase tracking-wide backdrop-blur">Experimental</span>
        {busy && (
          <span className="absolute inset-x-0 bottom-14 mx-auto w-fit rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold" role="status">
            {busy}
          </span>
        )}
        <p className="absolute inset-x-3 bottom-3 mx-auto w-fit max-w-[calc(100%-24px)] rounded-full bg-black/60 px-3 py-1 text-center text-[11px] text-txt/90 backdrop-blur">{body === "twin" ? "🔒 Your 3D twin · only you see it" : "Synthetic body, not a real person · size and drape are approximate"}</p>
        {ready && (
          <div className="absolute right-3 top-3 flex gap-1.5">
            <button onClick={() => engine.current?.rotate(-0.5)} aria-label="Turn left" className="glass grid size-10 place-items-center rounded-full">⟲</button>
            <button onClick={() => engine.current?.rotate(0.5)} aria-label="Turn right" className="glass grid size-10 place-items-center rounded-full">⟳</button>
          </div>
        )}
      </section>

      {pieces.length > 0 && (
        <>
          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-mut">Who wears it</legend>
            <div className="glass flex rounded-full p-1">
              {(["synthetic", "twin"] as const).map((b) => (
                <button
                  key={b}
                  aria-pressed={body === b}
                  disabled={b === "twin" && !twinReady}
                  onClick={() => setBody(b)}
                  className={`min-h-11 flex-1 rounded-full text-sm font-bold transition disabled:opacity-45 ${body === b ? "bg-[#e5395f] text-white" : "text-white/80"}`}
                >
                  {b === "twin" ? "🧍 My 3D twin" : "🧩 Synthetic body"}
                </button>
              ))}
            </div>
            {!twinReady && (
              <p className="mt-1.5 text-xs text-mut">
                No 3D twin yet. <Link href="/mirror/3d" className="font-semibold text-gold underline">Make one</Link> to see the fit on your own shape.
              </p>
            )}
          </fieldset>

          <nav aria-label="Pieces with 3D" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {pieces.map((p) => (
              <button
                key={p.productId}
                aria-pressed={piece?.productId === p.productId}
                onClick={() => {
                  setPiece(p);
                  setColour(p.assets[0]?.variantId ?? null);
                }}
                className={`flex shrink-0 items-center gap-2 rounded-2xl p-1.5 pr-3 text-left ring-1 ring-inset transition active:scale-95 ${piece?.productId === p.productId ? "bg-white/15 ring-gold" : "glass ring-white/10"}`}
              >
                {p.assets[0]?.poster ? <img src={p.assets[0].poster} alt="" className="size-12 rounded-xl bg-black/30 object-contain" /> : <span className="size-12 rounded-xl bg-white/10" />}
                <span className="max-w-[130px] truncate text-xs font-bold">{p.title}</span>
              </button>
            ))}
          </nav>

          {piece && (
            <fieldset>
              <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-mut">Colour · {asset?.colourName}</legend>
              <div className="flex flex-wrap gap-2">
                {piece.assets.map((a) => (
                  <button key={a.variantId} onClick={() => setColour(a.variantId)} aria-pressed={colour === a.variantId} aria-label={a.colourName} title={a.colourName} className={`size-11 rounded-full ring-2 ring-offset-2 ring-offset-ink transition active:scale-90 ${colour === a.variantId ? "ring-gold" : "ring-white/20"}`} style={{ background: a.colourHex }} />
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-mut">Size{info?.recommended ? ` · ${info.recommended} suggested` : ""}</legend>
            <div className="flex flex-wrap gap-2">
              {sizes.map((s) => (
                <button key={s} onClick={() => setSize(s)} aria-pressed={size === s} className={`min-h-11 min-w-12 rounded-2xl px-3 text-sm font-bold transition active:scale-95 ${size === s ? "bg-gold text-ink" : "glass"}`}>
                  {s}
                </button>
              ))}
            </div>
          </fieldset>
          {note && <p className="text-xs text-mut" role="status">{note}</p>}
        </>
      )}

      {support === null ? (
        <div className="skeleton h-14 rounded-2xl" />
      ) : xrOk && pieces.length > 0 ? (
        <section className="space-y-2">
          {support.ar ? (
            <button onClick={() => void enter("ar")} className="grad-cta flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold shadow-[0_12px_32px_rgba(139,92,246,.4)]">
              🥽 Place the mirror in my room
            </button>
          ) : (
            <button onClick={() => void enter("vr")} className="grad-cta flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold">
              🥽 Open the virtual fitting room
            </button>
          )}
          {support.ar && support.vr && (
            <button onClick={() => void enter("vr")} className="glass min-h-12 w-full rounded-2xl text-sm font-semibold">
              Use a virtual room instead
            </button>
          )}
          {error && <p className="text-center text-xs text-terra" role="alert">{error}</p>}
          <p className="text-center text-[11px] text-mut">{support.ar ? "Point at the floor, then pinch, pull the trigger or tap to place it. Switch colour and size on the floating panel." : "Your headset shows the mirror in a virtual room (passthrough mixed reality isn't offered by this browser)."}</p>
        </section>
      ) : (
        <section aria-label="Inline mirror" className="space-y-3">
          <div className="glass rounded-3xl p-4 text-sm">
            <p className="font-bold">This device can&apos;t do mixed reality</p>
            <p className="mt-1 text-mut">{arPilot && wardrobe.length ? "Here's the live camera mirror instead. It runs on this phone only." : "Your 3D twin shows the same pieces in 3D."}</p>
          </div>
          {arPilot && wardrobe.length ? (
            <ArMirror items={wardrobe} initial={piece?.assets[0]?.variantId ?? null} />
          ) : (
            <Link href="/mirror/3d" className="grad-cta flex min-h-12 items-center justify-center rounded-2xl font-semibold text-white">
              🧊 Open my 3D twin
            </Link>
          )}
        </section>
      )}

      <p className="rounded-2xl bg-white/5 p-3 text-[11px] leading-relaxed text-mut">
        🔒 Passthrough is drawn by your headset or phone. This page never receives camera images, and nothing is recorded or uploaded. Your 3D twin loads through a private 5-minute link and only you see it. Works on Meta Quest and Android phones with ARCore (Chrome); Apple Vision Pro opens the virtual fitting room.
      </p>

      {/* DOM overlay for phone AR sessions (Chrome Android): status + exit over the camera view. */}
      <div ref={overlay} className={xr === "ar" ? "pointer-events-none fixed inset-0 z-50" : "hidden"}>
        <div className="pointer-events-auto absolute inset-x-0 top-[max(env(safe-area-inset-top),14px)] flex items-center justify-between px-4">
          <span className="rounded-full bg-black/65 px-3 py-1.5 text-xs font-bold">{placed ? "Tap the panel to switch colour or size" : "Point at the floor, then tap to place"}</span>
          <button onClick={() => engine.current?.exit()} className="rounded-full bg-black/65 px-4 py-2 text-sm font-bold">
            ✕ Exit
          </button>
        </div>
        <span className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-violet/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wide">Experimental</span>
      </div>
    </div>
  );
}
