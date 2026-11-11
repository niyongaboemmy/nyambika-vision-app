"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, InfoTip } from "@/components/ui";
import { anchorsFromAlpha, isLowEnd, LM, loadPoseTracker, smoothLandmarks, warpStrips, type Anchors, type Landmark, type PoseTracker, type Pt, type WardrobeItem } from "@/lib/twin3d";
import { prefersReducedMotion } from "@/lib/xr";

type Mode = "idle" | "starting" | "live" | "static" | "error";
const MIN_FPS = 10;

interface Garment {
  item: WardrobeItem;
  img: HTMLImageElement;
  anchors: Anchors;
}

async function loadGarment(item: WardrobeItem): Promise<Garment> {
  const img = new Image();
  img.decoding = "async";
  img.src = item.cutout!;
  await img.decode();
  const c = document.createElement("canvas");
  const scale = Math.min(1, 320 / Math.max(img.width, img.height));
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const a = anchorsFromAlpha(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, item.category);
  if (!a) throw new Error("This piece has no usable cut-out");
  const s = 1 / scale;
  return { item, img, anchors: { ...a, topRow: a.topRow * s, hipRow: a.hipRow * s, topWidth: a.topWidth * s, hipWidth: a.hipWidth * s, centreX: a.centreX * s } };
}

/**
 * AR mirror pilot (E34, FR-AR-03/06 pilot): the front camera with on-device MediaPipe pose tracking; the garment
 * cut-out is strip-warped to the tracked shoulders and hips every frame. Video never leaves the device (nothing is
 * uploaded, nothing is recorded). Reduced motion and low-end phones start on a static try-on instead.
 */
export function ArMirror({ items, initial }: { items: WardrobeItem[]; initial: string | null }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [why, setWhy] = useState<string | null>(null);
  const [status, setStatus] = useState("Step back so your shoulders and hips are in view");
  const [tracking, setTracking] = useState(false);
  const [sel, setSel] = useState<WardrobeItem | null>(() => items.find((i) => i.variantId === initial) ?? items[0] ?? null);
  const [fps, setFps] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef<PoseTracker | null>(null);
  const garment = useRef<Garment | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const smooth = useRef<Pt[] | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setWhy("Reduced motion is on, so we start with a still try-on.");
      setMode("static");
    } else if (isLowEnd()) {
      setWhy("This phone may struggle with live tracking, so we start with a still try-on.");
      setMode("static");
    }
  }, []);

  useEffect(() => {
    if (!sel?.cutout) return;
    let live = true;
    void loadGarment(sel)
      .then((g) => live && (garment.current = g))
      .catch(() => live && (garment.current = null));
    return () => {
      live = false;
    };
  }, [sel]);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    tracker.current?.close();
    tracker.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setMode("starting");
    setWhy(null);
    try {
      const [s, t] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 960 } }, audio: false }),
        loadPoseTracker(),
      ]);
      stream.current = s;
      tracker.current = t;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setMode("live");
    } catch (e) {
      stop();
      const name = (e as Error).name;
      setWhy(name === "NotAllowedError" ? "Camera permission was declined. Here is a still try-on instead." : "Live tracking couldn't start on this phone. Here is a still try-on instead.");
      setMode("static");
    }
  }, [stop]);

  // Render loop: mirrored video + pose → warped garment.
  useEffect(() => {
    if (mode !== "live") return;
    const v = video.current!;
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    let frames = 0;
    let since = performance.now();
    let slow = 0;
    let lastTs = -1;
    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      if (v.readyState < 2) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(W * dpr)) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Cover-fit and mirror the video.
      const s = Math.max(W / v.videoWidth, H / v.videoHeight);
      const vw = v.videoWidth * s;
      const vh = v.videoHeight * s;
      const ox = (W - vw) / 2;
      const oy = (H - vh) / 2;
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, ox, oy, vw, vh);
      ctx.restore();
      const ts = performance.now();
      let lms: Landmark[] | null = null;
      if (tracker.current && ts > lastTs) {
        lastTs = ts;
        try {
          lms = tracker.current.detect(v, ts);
        } catch {
          lms = null;
        }
      }
      const toPx = (l: Landmark): Pt => ({ x: W - (ox + l.x * vw), y: oy + l.y * vh });
      const ids = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip];
      const visible = lms && ids.every((i) => (lms![i]?.visibility ?? 0) > 0.5);
      if (lms && visible) {
        const pts = smoothLandmarks(smooth.current, ids.map((i) => toPx(lms![i])));
        smooth.current = pts;
        const g = garment.current;
        if (g) {
          const strips = warpStrips(g.anchors, g.img.height, [pts[1], pts[0]], [pts[3], pts[2]]);
          for (const st of strips) {
            ctx.save();
            ctx.translate(st.cx, st.cy);
            ctx.rotate(st.angle);
            ctx.scale(st.sx, 1);
            const dh = st.sh * st.syScale;
            ctx.drawImage(g.img, 0, st.sy, g.img.width, st.sh + 1, -g.anchors.centreX, -dh / 2, g.img.width, dh + st.syScale);
            ctx.restore();
          }
        }
        ctx.fillStyle = "#67e8f9";
        for (const p of pts) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        setTracking(true);
        setStatus("Tracking on this phone · nothing uploaded");
      } else {
        smooth.current = null;
        setTracking(false);
        setStatus("Step back so your shoulders and hips are in view");
      }
      frames++;
      const dt = ts - since;
      if (dt > 1000) {
        const f = (frames * 1000) / dt;
        setFps(Math.round(f));
        frames = 0;
        since = ts;
        slow = f < MIN_FPS ? slow + 1 : 0;
        if (slow >= 4) {
          stop();
          setWhy("Live tracking was too slow on this phone, so here is a still try-on.");
          setMode("static");
        }
      }
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [mode, stop]);

  return (
    <div className="relative">
      <div className="theme-media relative isolate h-[min(70dvh,620px)] overflow-hidden rounded-[32px] bg-black text-txt" data-testid="ar-stage">
        <video ref={video} playsInline muted className="hidden" />
        {mode === "live" || mode === "starting" ? (
          <canvas ref={canvas} className="h-full w-full" aria-label={`Live mirror with ${sel?.title ?? "the garment"} overlaid on your body`} role="img" />
        ) : (
          <StaticTryOn item={sel} />
        )}
        {mode === "starting" && (
          <div className="absolute inset-0 grid place-items-center bg-black/60" role="status">
            <span className="glass rounded-full px-4 py-2 text-sm font-semibold">Starting on-device tracking…</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start gap-2">
          <span className="rounded-full bg-[#c81e4a] px-3 py-1.5 text-xs font-black tracking-wide text-[#fff] shadow-lg">● {mode === "live" ? "LIVE AR MIRROR" : "AR MIRROR"} · PILOT</span>
          <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold backdrop-blur" role="status" aria-live="polite">
            {mode === "live" ? status : "Body tracking runs on-device · video never leaves your phone"}
          </span>
        </div>
        {mode === "live" && (
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2 py-1 text-[10px] tabular-nums text-mut">{fps} fps{tracking ? " · ✓" : ""}</span>
        )}
        {mode === "live" && (
          <button onClick={() => { stop(); setMode("static"); }} className="glass absolute bottom-4 right-3 min-h-11 rounded-full px-4 text-sm font-semibold">Stop camera</button>
        )}
      </div>

      {why && <p className="mt-3 rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-mut" role="status">{why}</p>}
      {mode !== "live" && mode !== "starting" && (
        <Button className="mt-3 w-full" onClick={start}>📷 {why ? "Try live mirror anyway" : "Start live mirror"}</Button>
      )}

      {items.length > 0 && (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Garment">
          {items.map((w) => (
            <button key={w.variantId} role="radio" aria-checked={sel?.variantId === w.variantId} aria-label={`${w.title} in ${w.colourName}`} onClick={() => setSel(w)} className={`glass h-24 w-[72px] shrink-0 overflow-hidden rounded-2xl p-1.5 transition active:scale-95 ${sel?.variantId === w.variantId ? "ring-2 ring-gold" : ""}`}>
              {w.cutout && <img src={w.cutout} alt="" className="h-full w-full object-contain" />}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 flex items-center justify-center gap-1 text-center text-xs text-mut">
        Pilot · visual guide only
        <InfoTip label="About AR accuracy">Overlay accuracy is still being validated. Visual guidance only. Actual fit may differ.</InfoTip>
      </p>
    </div>
  );
}

/** Static try-on fallback: the garment on a soft studio silhouette, with links to the photo twin and 3D twin. */
function StaticTryOn({ item }: { item: WardrobeItem | null }) {
  return (
    <figure className="absolute inset-0 grid place-items-center bg-[radial-gradient(60%_45%_at_50%_30%,rgba(139,92,246,.25),transparent_70%),linear-gradient(180deg,#1a1622,#0b0a0f)]">
      <svg viewBox="0 0 100 200" className="absolute h-[80%] text-white/10" aria-hidden>
        <circle cx="50" cy="22" r="15" fill="currentColor" />
        <path d="M28 44h44l8 70h-10l-4 82H54l-4-60-4 60H34l-4-82H20z" fill="currentColor" />
      </svg>
      {item?.cutout && <img src={item.cutout} alt={`${item.title} in ${item.colourName}`} className="relative mt-[12%] h-[52%] object-contain drop-shadow-[0_18px_30px_rgba(0,0,0,.5)]" />}
      <figcaption className="absolute inset-x-4 bottom-4 flex justify-center gap-2">
        {item && <Link href={`/looks/try?variant=${item.variantId}`} className="glass rounded-full px-4 py-2 text-sm font-semibold">See it on my twin</Link>}
        {item && <Link href={`/mirror/3d?variant=${item.variantId}`} className="glass rounded-full px-4 py-2 text-sm font-semibold">🧊 Try in 3D</Link>}
      </figcaption>
    </figure>
  );
}
