"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlassControl, MATERIAL, RailButton } from "@/components/look-rail";
import { Icon } from "@/components/icons";
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
          <RailButton label={t("xr.view3d")} onClick={() => setStage(true)}>
            <Icon name="cube" className="size-[22px]" />
          </RailButton>
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
      <RailButton label={t("xr.move")} caption={rendering ? `${pct}%` : undefined} onClick={open} active={playing} activeClass="bg-violet/80" busy={rendering} progress={pct} ariaLabel={rendering ? `Motion preview ${pct}% ready` : t("xr.seeItMove")}>
        <Icon name={playing ? "pause" : "play"} className="size-5" />
      </RailButton>

      <Sheet open={confirm} onClose={() => setConfirm(false)}>
        <div className="flex items-start gap-3">
          <span className="orb grid size-12 shrink-0 place-items-center rounded-2xl text-ink"><Icon name="play" className="size-5" /></span>
          <div>
            <h3 className="font-display text-xl font-black">{t("xr.seeItMove")}</h3>
            <p className="text-sm text-mut">4 s loop · see the fabric move</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/5 p-3">
          <span className="text-sm">Premium preview</span>
          <span className="text-right">
            <span className="block font-display font-black text-gold">{state?.quote.label ?? "3 credits"}</span>
            {state && state.quote.source !== "CREDITS" && <span className="block text-[11px] text-mut">usually {state.quote.credits} credits</span>}
          </span>
        </div>
        <ul className="mt-3 flex flex-wrap gap-1.5 text-xs text-txt/90">
          <li className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1"><Icon name="sparkle" className="size-3.5 text-gold" />AI motion preview · C2PA</li>
          <li className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1"><Icon name="shield" className="size-3.5 text-gold" />Face never changed</li>
          <li className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1"><Icon name="lock" className="size-3.5 text-gold" />Never shared with makers</li>
        </ul>
        {state && !state.eligible && <p className="mt-3 text-sm text-gold">{state.reason}</p>}
        {error && (isExpectedText(error) ? <LimitState error={error} /> : <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>)}
        <Button className="mt-4 w-full" onClick={start} disabled={busy || (state ? !state.eligible : false)}>
          {busy ? "Starting…" : <><Icon name="play" className="size-4" /> {t("xr.seeItMove")}</>}
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
    <div className={`${fixed ? "fixed" : "absolute"} inset-0 z-[5] animate-fade bg-black`}>
      <div className="relative size-full">
        {useImg ? (
          paused && clip.poster ? (
            <img src={clip.poster} alt={alt} className="size-full object-cover object-center" />
          ) : (
            <img src={clip.webp!} alt={alt} className="size-full object-cover object-center" />
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
            className="size-full object-cover object-center"
          />
        )}
        {/* Controls sit on the left, under the floating top chrome, clear of the right rail. */}
        <div className="absolute left-3 top-[calc(max(env(safe-area-inset-top),12px)+96px)] flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white ${MATERIAL}`}><Icon name="play" className="size-3" /> {t("xr.motionLabel")}</span>
          <GlassControl label={paused ? "Play motion preview" : "Pause motion preview"} onClick={() => setPaused((x) => !x)}>
            <Icon name={paused ? "play" : "pause"} className="size-4" />
          </GlassControl>
          <GlassControl label="Close motion preview" onClick={onClose}><Icon name="x" className="size-4" /></GlassControl>
        </div>
      </div>
    </div>,
    target,
  );
}
