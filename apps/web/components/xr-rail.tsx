"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { XrStage } from "@/components/xr-viewer";
import { Button, Sheet } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Look } from "@/lib/looks";
import { useSession } from "@/lib/session";
import { load3d, prefersReducedMotion, type MotionClip, type MotionState, type Product3d } from "@/lib/xr";

/**
 * Right-rail actions on a look (E27/E28): "3D" when the product has an approved 3D model, and
 * "Move" (See it move) once the look is delivered. Owns its overlays so look-view stays lean.
 */
export function XrRail({ look }: { look: Look }) {
  const { t } = useSession();
  const [p3d, setP3d] = useState<Product3d | null>(null);
  const [stage, setStage] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void load3d(look.product.id).then((v) => live && setP3d(v));
    return () => {
      live = false;
    };
  }, [look.product.id]);
  const has3d = Boolean(p3d?.assets.length);
  return (
    <div ref={anchor} className="contents">
      {has3d && (
        <>
          <Rail label={t("xr.view3d")} onClick={() => setStage(true)}>
            <CubeIcon />
          </Rail>
          <XrStage
            open={stage}
            onClose={() => setStage(false)}
            title={look.product.title}
            subtitle={`${look.maker.name} · ${look.variant.colourName}`}
            assets={p3d!.assets}
            initialVariantId={look.variant.id}
          />
        </>
      )}
      {look.status === "DELIVERED" && <MotionRail look={look} anchor={anchor} />}
    </div>
  );
}

function MotionRail({ look, anchor }: { look: Look; anchor: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useSession();
  const [state, setState] = useState<MotionState | null>(null);
  const [clip, setClip] = useState<MotionClip | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset when the look changes (colour ring, next look in the stream).
  useEffect(() => {
    setClip(null);
    setState(null);
    setPlaying(false);
  }, [look.id, look.variant.id]);

  // Poll while the clip renders (progress ring on the button).
  useEffect(() => {
    if (!clip?.rendering) return;
    const h = setTimeout(async () => {
      const next = await api<MotionClip>(`/xr/motion/${clip.id}`).catch(() => null);
      if (!next) return;
      setClip(next);
      if (next.status === "DELIVERED") {
        setPlaying(true);
        navigator.vibrate?.([8, 40, 8]);
      }
    }, 900);
    return () => clearTimeout(h);
  }, [clip]);

  const open = useCallback(async () => {
    setError(null);
    if (clip?.status === "DELIVERED") return setPlaying((x) => !x);
    if (clip?.rendering) return;
    const s = await api<MotionState>(`/xr/looks/${look.id}/motion`).catch((e: Error) => {
      setError(e.message);
      return null;
    });
    if (!s) return setConfirm(true);
    setState(s);
    if (s.clip?.status === "DELIVERED") {
      setClip(s.clip);
      setPlaying(true);
    } else if (s.clip?.rendering) setClip(s.clip);
    else setConfirm(true);
  }, [clip, look.id]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setClip(await api<MotionClip>(`/xr/looks/${look.id}/motion`, { method: "POST" }));
      setConfirm(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the motion preview");
    } finally {
      setBusy(false);
    }
  }

  const rendering = Boolean(clip?.rendering);
  const pct = clip?.progress ?? 0;
  return (
    <>
      <Rail label={rendering ? `${pct}%` : t("xr.move")} onClick={open} active={playing} busy={rendering} progress={pct} ariaLabel={rendering ? `Motion preview ${pct}% ready` : t("xr.seeItMove")}>
        {playing ? "❚❚" : "▶"}
      </Rail>

      <Sheet open={confirm} onClose={() => setConfirm(false)}>
        <div className="flex items-start gap-3">
          <span className="orb grid size-12 shrink-0 place-items-center rounded-2xl text-xl text-ink">▶</span>
          <div>
            <h3 className="font-display text-xl font-black">{t("xr.seeItMove")}</h3>
            <p className="text-sm text-mut">A 4-second loop of this look on {look.onTwin ? "your twin" : "the AI model"}: a gentle sway so you can see how the fabric moves.</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3">
          <span className="text-sm">Premium preview</span>
          <span className="text-right">
            <span className="block font-display font-black text-gold">{state?.quote.label ?? "3 credits"}</span>
            {state && state.quote.source !== "CREDITS" && <span className="block text-[11px] text-mut">usually {state.quote.credits} credits</span>}
          </span>
        </div>
        <ul className="mt-3 space-y-1.5 text-xs text-mut">
          <li>✨ AI motion preview, labelled and signed with Content Credentials (C2PA).</li>
          <li>🛡️ Your face is never changed; every clip is checked before you see it.</li>
          <li>🔒 Private to you. Makers never receive it.</li>
        </ul>
        {state && !state.eligible && <p className="mt-3 text-sm text-gold">{state.reason}</p>}
        {error && (isExpectedText(error) ? <LimitState error={error} /> : <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>)}
        <Button className="mt-4 w-full" onClick={start} disabled={busy || (state ? !state.eligible : false)}>
          {busy ? "Starting…" : `▶ ${t("xr.seeItMove")}`}
        </Button>
      </Sheet>

      {playing && clip?.status === "DELIVERED" && <MotionLayer clip={clip} anchor={anchor} alt={`${look.product.title} in ${look.variant.colourName}, ${t("xr.motionLabel")}`} onClose={() => setPlaying(false)} />}
    </>
  );
}

/** Inline looping playback over the look image (portalled into the look's own frame). */
function MotionLayer({ clip, anchor, alt, onClose }: { clip: MotionClip; anchor: React.RefObject<HTMLDivElement | null>; alt: string; onClose: () => void }) {
  const { t } = useSession();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [useImg, setUseImg] = useState(!clip.mp4);
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    // The look frame is the nearest clipping ancestor of the rail.
    setTarget((anchor.current?.closest(".overflow-hidden") as HTMLElement | null) ?? document.body);
    // Reduced motion: show the first frame and let the shopper press play.
    if (prefersReducedMotion()) setPaused(true);
  }, [anchor]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => setPaused(true));
  }, [paused, target, useImg]);
  if (!target) return null;
  const fixed = target === document.body;
  return createPortal(
    <div className={`${fixed ? "fixed" : "absolute"} inset-x-0 top-[96px] bottom-[150px] z-[5] flex animate-rise items-center justify-center`}>
      <div className="relative h-full">
        {useImg ? (
          paused && clip.poster ? (
            <img src={clip.poster} alt={alt} className="h-full w-auto object-contain" />
          ) : (
            <img src={clip.webp!} alt={alt} className="h-full w-auto object-contain" />
          )
        ) : (
          <video
            ref={video}
            src={clip.mp4!}
            poster={clip.poster ?? undefined}
            loop
            muted
            playsInline
            autoPlay={!paused}
            aria-label={alt}
            onError={() => setUseImg(true)}
            className="h-full w-auto object-contain"
          />
        )}
        {/* Controls sit on the left so they never collide with the right rail. */}
        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          <span className="rounded-full border border-white/20 bg-black/60 px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur">▶ {t("xr.motionLabel")}</span>
          <button onClick={() => setPaused((x) => !x)} aria-label={paused ? "Play motion preview" : "Pause motion preview"} className="glass grid size-9 place-items-center rounded-full text-sm">
            {paused ? "▶" : "❚❚"}
          </button>
          <button onClick={onClose} aria-label="Close motion preview" className="glass grid size-9 place-items-center rounded-full text-sm">✕</button>
        </div>
      </div>
    </div>,
    target,
  );
}

function Rail({ children, label, onClick, active, busy, progress = 0, ariaLabel }: { children: ReactNode; label: string; onClick: () => void; active?: boolean; busy?: boolean; progress?: number; ariaLabel?: string }) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} className="hit flex flex-col items-center gap-1 text-xs font-semibold">
      <span className={`glass relative grid size-12 place-items-center rounded-full text-lg ${active ? "bg-violet/70 text-white" : ""}`}>
        {busy && (
          <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
            <circle cx="24" cy="24" r="22" fill="none" stroke="url(#xr-g)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(progress / 100) * 138} 138`} className="transition-[stroke-dasharray] duration-500" />
            <defs>
              <linearGradient id="xr-g" x1="0" x2="1">
                <stop offset="0" stopColor="#e0703f" />
                <stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
        )}
        <span aria-hidden>{children}</span>
      </span>
      {label}
    </button>
  );
}

function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 drop-shadow-[0_0_8px_rgba(56,189,248,.6)]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.8 4 7.3v9.4l8 4.5 8-4.5V7.3z" fill="rgba(56,189,248,.18)" />
      <path d="M4 7.3 12 12l8-4.7M12 12v9.2" />
    </svg>
  );
}
