"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Pose } from "@/lib/twin3d";
import { hasWebGL2, loadModelViewer, prefersReducedMotion } from "@/lib/xr";
// The <model-viewer> JSX typing is declared once in components/xr-viewer.tsx (E27).

interface MV extends HTMLElement {
  cameraOrbit: string;
  getCameraOrbit(): { theta: number; phi: number; radius: number };
  play(o?: { repetitions?: number }): void;
  loaded?: boolean;
}

const ORBIT = "0deg 82deg 105%";

/**
 * 3D twin stage (E33/E34, FR-AVA-04, FR-FIT-01): the skinned avatar (optionally dressed) on <model-viewer>,
 * spinning on a lit studio disc, with Idle / Turn / Walk clips from the avatar skeleton. Without WebGL2 it shows
 * the server-side render (poster) instead, so low-end phones still see their twin.
 */
export function Twin3dViewer({
  src,
  poster,
  alt,
  pose,
  spin,
  label,
  busy,
  onLoaded,
}: {
  src: string;
  poster: string | null;
  alt: string;
  pose: Pose;
  spin: boolean;
  label: string;
  busy?: string | null;
  onLoaded?: () => void;
}) {
  const ref = useRef<MV | null>(null);
  const [ready, setReady] = useState(false);
  const [noGL, setNoGL] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    if (!hasWebGL2()) {
      setNoGL(true);
      return;
    }
    let live = true;
    loadModelViewer()
      .then(() => live && setReady(true))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLoad = () => {
      setLoaded(true);
      onLoaded?.();
    };
    const onError = () => setFailed(true);
    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
    };
  }, [ready, onLoaded]);

  // A new GLB (dressed / colour / size) keeps the camera where the shopper left it.
  useEffect(() => setLoaded(false), [src]);
  useEffect(() => {
    if (loaded && !reduced) ref.current?.play();
  }, [pose, loaded, reduced]);

  const turn = (deg: number) => {
    const el = ref.current;
    if (!el) return;
    const o = el.getCameraOrbit();
    el.cameraOrbit = `${(o.theta * 180) / Math.PI + deg}deg ${(o.phi * 180) / Math.PI}deg ${o.radius}m`;
  };

  const fallback = noGL || failed;
  // The still render has no load event; release any "dressing…" overlay as soon as it is shown.
  useEffect(() => {
    if (fallback) onLoaded?.();
  }, [src, fallback, onLoaded]);
  const autoRotate = spin && !reduced && pose !== "Turn";
  return (
    <div className="relative isolate h-[min(64dvh,580px)] w-full overflow-hidden rounded-[32px]" data-testid="twin3d-stage">
      {/* Studio: warm key light upper-left, cool rim right, floor glow. */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_45%_at_22%_18%,rgba(224,112,63,.28),transparent_70%),radial-gradient(55%_50%_at_88%_45%,rgba(139,92,246,.26),transparent_70%),linear-gradient(180deg,#120f19,#0a090e)]" />
      <div aria-hidden className="absolute inset-x-[14%] bottom-[9%] h-[12%]">
        <div className={`h-full w-full rounded-[50%] border-2 border-gold/70 shadow-[0_0_28px_rgba(242,184,75,.45),inset_0_0_24px_rgba(242,184,75,.25)] ${busy ? "animate-pulse" : ""}`} />
        <div className="absolute inset-[18%] rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,255,255,.12),transparent)]" />
      </div>
      {fallback ? (
        <figure className="absolute inset-0 grid place-items-center p-4">
          {poster ? <img src={poster} alt={alt} className="max-h-full max-w-full rounded-3xl object-contain" /> : <div className="skeleton h-3/4 w-1/2 rounded-[40px]" />}
          <figcaption className="absolute inset-x-4 bottom-3 text-center text-xs text-mut">
            {failed ? "3D could not start here. This is a still render of your twin." : "3D needs a newer browser on this phone. This is a still render of your twin."}
          </figcaption>
        </figure>
      ) : ready ? (
        <model-viewer
          ref={ref as never}
          src={src}
          poster={poster ?? undefined}
          alt={alt}
          camera-controls=""
          touch-action="pan-y"
          camera-orbit={ORBIT}
          min-camera-orbit="auto 40deg 70%"
          max-camera-orbit="auto 100deg 170%"
          camera-target="auto auto auto"
          interpolation-decay="140"
          auto-rotate={autoRotate ? "" : undefined}
          auto-rotate-delay="400"
          rotation-per-second="22deg"
          interaction-prompt="none"
          animation-name={pose}
          autoplay={!reduced}
          shadow-intensity="1"
          shadow-softness="0.9"
          exposure={1.08}
          environment-image="neutral"
          tone-mapping="neutral"
          loading="eager"
          tabIndex={0}
          style={{ width: "100%", height: "100%", background: "transparent", "--poster-color": "transparent", "--progress-bar-color": "transparent" } as CSSProperties}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center" role="status" aria-label="Loading 3D twin">
          {poster ? <img src={poster} alt="" className="max-h-[86%] animate-pulse object-contain opacity-80" /> : <div className="skeleton h-3/4 w-1/3 rounded-[40px]" />}
        </div>
      )}
      {busy && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center" role="status">
          <span className="glass rounded-full px-4 py-2 text-sm font-semibold">{busy}</span>
        </div>
      )}
      <span className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-xs font-semibold backdrop-blur">🧊 3D twin · 360°</span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/15 bg-black/55 px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur">✨ {label}</span>
      {!fallback && (
        <div className="absolute bottom-4 right-3 flex flex-col gap-2">
          <button aria-label="Turn left" onClick={() => turn(-45)} className="glass grid size-10 place-items-center rounded-full text-lg transition active:scale-90">⟲</button>
          <button aria-label="Turn right" onClick={() => turn(45)} className="glass grid size-10 place-items-center rounded-full text-lg transition active:scale-90">⟳</button>
        </div>
      )}
    </div>
  );
}
