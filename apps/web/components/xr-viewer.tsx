"use client";

import { useEffect, useRef, useState, type CSSProperties, type DetailedHTMLProps, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { TryIn3d } from "@/components/twin3d-card";
import { useSession } from "@/lib/session";
import { fmtM, hasWebGL2, loadModelViewer, prefersReducedMotion, type Garment3d } from "@/lib/xr";

type ModelViewerProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerProps;
    }
  }
}

interface ModelViewerEl extends HTMLElement {
  cameraOrbit: string;
  fieldOfView: string;
  canActivateAR?: boolean;
  getCameraOrbit(): { theta: number; phi: number; radius: number };
  activateAR(): Promise<void>;
}

const START_ORBIT = "25deg 78deg 115%";

/**
 * Interactive 3D garment (E27, FR-3D-04/05/08, FR-AR-01/04/05) on <model-viewer>, loaded on demand.
 * Orbit/pinch, keyboard (arrow keys on the focused stage, plus buttons), auto-rotate unless reduced
 * motion, colour switch across variants, AR "View in your space" (WebXR / Scene Viewer / Quick Look;
 * the button only appears where AR can start), poster fallback when WebGL2 is missing.
 */
export function GarmentViewer({ assets, title, initialVariantId, variantId, className = "", tall = false, onVariantChange }: { assets: Garment3d[]; title: string; initialVariantId?: string; /** Controlled colour (the host shows its own swatches). */ variantId?: string; className?: string; tall?: boolean; onVariantChange?: (variantId: string) => void }) {
  const { t } = useSession();
  const [vid, setVid] = useState(() => (assets.some((a) => a.variantId === initialVariantId) ? initialVariantId! : assets[0]?.variantId));
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [noGL, setNoGL] = useState(false);
  const [reduced, setReduced] = useState(false);
  const ref = useRef<ModelViewerEl | null>(null);
  const shown = variantId && assets.some((x) => x.variantId === variantId) ? variantId : vid;
  const a = assets.find((x) => x.variantId === shown) ?? assets[0];

  useEffect(() => {
    setReduced(prefersReducedMotion());
    if (!hasWebGL2()) {
      setNoGL(true);
      return;
    }
    let live = true;
    loadModelViewer()
      .then(() => live && setReady(true))
      .catch((e: Error) => live && setFailed(e.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onLoad = () => setLoaded(true);
    const onProgress = (e: Event) => setProgress((e as CustomEvent<{ totalProgress: number }>).detail.totalProgress);
    const onError = () => setFailed("The 3D model could not be shown.");
    el.addEventListener("load", onLoad);
    el.addEventListener("progress", onProgress);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("progress", onProgress);
      el.removeEventListener("error", onError);
    };
  }, [ready]);

  if (!a) return null;
  const alt = `3D model of ${title} in ${a.colourName}, about ${fmtM(a.dimensions.height)} long. ${t("xr.aiLabel")}.`;

  const turn = (deg: number) => {
    const el = ref.current;
    if (!el) return;
    const o = el.getCameraOrbit();
    el.cameraOrbit = `${(o.theta * 180) / Math.PI + deg}deg ${(o.phi * 180) / Math.PI}deg ${o.radius}m`;
  };
  const reset = () => {
    if (!ref.current) return;
    ref.current.cameraOrbit = START_ORBIT;
    ref.current.fieldOfView = "auto";
  };
  const pick = (id: string) => {
    if (id === vid) return;
    setLoaded(false);
    setProgress(0);
    setVid(id);
    onVariantChange?.(id);
    navigator.vibrate?.(8);
  };

  const fallback = noGL || failed;
  return (
    <div className={className}>
      <div
        className={`xr-stage relative isolate overflow-hidden rounded-[28px] border border-white/10 ${tall ? "h-[min(62dvh,560px)]" : "h-[340px]"}`}
        // Backdrop follows the theme (lit studio by day, night stage in dark mode); --backdrop-3d is a token.
        style={{ background: "radial-gradient(70% 55% at 50% 38%, rgba(139,92,246,.22), transparent 70%), radial-gradient(60% 45% at 50% 100%, rgba(224,112,63,.2), transparent 72%), var(--backdrop-3d)" }}
      >
        {/* Floor: soft spotlight disc under the garment for depth */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[12%] bottom-[7%] h-[16%] rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,255,255,.14),transparent)]" />
        {fallback ? (
          <figure className="absolute inset-0 grid place-items-center p-6">
            {a.poster && <img src={a.poster} alt={alt} className="max-h-full max-w-full object-contain" />}
            <figcaption className="absolute inset-x-4 bottom-4 text-center text-xs text-mut">{failed ?? "3D needs a newer browser on this device. Here is the preview image."}</figcaption>
          </figure>
        ) : ready ? (
          <model-viewer
            ref={ref as never}
            src={a.glb}
            poster={a.poster ?? undefined}
            alt={alt}
            camera-controls=""
            touch-action="pan-y"
            camera-orbit={START_ORBIT}
            min-camera-orbit="auto 35deg auto"
            max-camera-orbit="auto 105deg 180%"
            interpolation-decay="120"
            auto-rotate={reduced ? undefined : ""}
            auto-rotate-delay="2500"
            rotation-per-second="16deg"
            interaction-prompt={reduced ? "none" : "auto"}
            shadow-intensity="1.1"
            shadow-softness="0.85"
            exposure={1.05}
            environment-image="neutral"
            tone-mapping="neutral"
            /* React 19 assigns known properties on custom elements, so booleans must be real booleans. */
            ar={true}
            ar-modes="webxr scene-viewer quick-look"
            ar-scale="fixed"
            ar-placement="floor"
            xr-environment=""
            loading="eager"
            tabIndex={0}
            style={{ width: "100%", height: "100%", background: "transparent", "--poster-color": "transparent", "--progress-bar-color": "transparent" } as CSSProperties}
          >
            <div slot="progress-bar" aria-hidden className={`absolute inset-x-10 top-3 h-1 overflow-hidden rounded-full bg-white/10 transition-opacity ${loaded ? "opacity-0" : ""}`}>
              <div className="h-full rounded-full bg-gradient-to-r from-terra via-gold to-violet transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <button
              slot="ar-button"
              className="grad-cta absolute bottom-4 left-1/2 inline-flex min-h-12 -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-bold text-white shadow-[0_12px_32px_rgba(139,92,246,.45)] transition active:scale-[.97]"
            >
              <ArIcon /> {t("xr.ar")}
            </button>
          </model-viewer>
        ) : (
          <div className="absolute inset-0 grid place-items-center" role="status" aria-label="Loading 3D viewer">
            {a.poster ? <img src={a.poster} alt="" className="max-h-[85%] max-w-[80%] animate-pulse object-contain opacity-80" /> : <div className="skeleton h-3/4 w-1/2 rounded-[40px]" />}
          </div>
        )}

        <span className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">✨ {t("xr.aiLabel")}</span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[11px] font-semibold backdrop-blur" title="Real-world size used in AR">
          📏 {fmtM(a.dimensions.height)} · size {a.size}
        </span>

        {!fallback && (
          <div className="absolute bottom-[76px] right-3 flex flex-col gap-2">
            <StageButton label="Turn left" onClick={() => turn(-45)}>⟲</StageButton>
            <StageButton label="Turn right" onClick={() => turn(45)}>⟳</StageButton>
            <StageButton label="Reset view" onClick={reset}>⌖</StageButton>
          </div>
        )}
      </div>

      {assets.length > 1 && variantId === undefined && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5" role="radiogroup" aria-label="Colour">
          {assets.map((x) => (
            <button
              key={x.variantId}
              role="radio"
              aria-checked={x.variantId === a.variantId}
              aria-label={x.colourName}
              onClick={() => pick(x.variantId)}
              className={`size-10 rounded-full border-[3px] transition ${x.variantId === a.variantId ? "scale-110 border-gold shadow-[0_0_16px_rgba(242,184,75,.5)]" : "border-white/25"}`}
              style={{ background: x.colourHex }}
            />
          ))}
        </div>
      )}
      <p className="mt-2 text-center text-xs text-mut">
        {fallback ? "Preview image" : "Drag to turn · pinch to zoom · arrow keys when focused"} · AR shows true size where your phone supports it
      </p>
    </div>
  );
}

function StageButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="glass grid size-10 place-items-center rounded-full text-lg transition active:scale-90">
      {children}
    </button>
  );
}

function ArIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </svg>
  );
}

/** Full-screen immersive stage for the look rail (portalled above everything). */
export function XrStage({ open, onClose, title, subtitle, assets, initialVariantId }: { open: boolean; onClose: () => void; title: string; subtitle?: string; assets: Garment3d[]; initialVariantId?: string }) {
  const [mounted, setMounted] = useState(false);
  const [vid, setVid] = useState<string | undefined>(undefined);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink" role="dialog" aria-modal="true" aria-label={`${title} in 3D`}>
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(55%_40%_at_20%_10%,rgba(224,112,63,.22),transparent_70%),radial-gradient(50%_40%_at_90%_80%,rgba(56,189,248,.16),transparent_70%)]" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[480px] animate-rise flex-col px-4 pt-[max(env(safe-area-inset-top),14px)] pb-[max(env(safe-area-inset-bottom),18px)]">
        <div className="mb-3 flex items-center gap-3">
          <button ref={closeRef} onClick={onClose} aria-label="Close 3D view" className="glass grid size-10 shrink-0 place-items-center rounded-full">✕</button>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-black leading-tight">{title}</p>
            {subtitle && <p className="truncate text-xs text-mut">{subtitle}</p>}
          </div>
        </div>
        <GarmentViewer assets={assets} title={title} initialVariantId={initialVariantId} tall onVariantChange={setVid} />
        <TryIn3d variantId={vid ?? initialVariantId ?? assets[0]?.variantId} />
        <p className="mt-3 text-center text-[11px] text-mut">AI builds this 3D preview from the maker&apos;s photo. Shape and drape are approximate.</p>
      </div>
    </div>,
    document.body,
  );
}
