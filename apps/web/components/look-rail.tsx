"use client";

/*
 * Floating controls for the full-bleed Looks stream (iOS-style): dark "ultra-thin material" glass circles with
 * SF-like glyphs, press-scale + spring, a long-press label bubble, haptics. Shared by look-view, morph, XR and
 * video rails so every rail button looks and behaves the same.
 */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAT_BASE, MATERIAL, SPRING } from "@/components/look-material";
import { haptic } from "@/lib/native";

export { LooksSkeleton, MAT_BASE, MATERIAL, SPRING } from "@/components/look-material";

/** Coach mark, long-press bubble and heart burst (components/look-extras.tsx): a post-load chunk (JS budget pass 2). */
export const preloadLookExtras = () => import("@/components/look-extras");
const RailBubble = dynamic(() => preloadLookExtras().then((m) => m.RailBubble), { ssr: false });

export const reduced = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Run a Web Animation unless the shopper prefers reduced motion. */
export function animate(el: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  if (!el || reduced() || !("animate" in el)) return null;
  return el.animate(frames, opts);
}

/**
 * One rail button: 48 px glass circle (hit area ≥ 44 px), accessible name = `label` (or `ariaLabel`).
 * Glyph-only (iOS); a long-press shows the name (or `caption`, e.g. a progress percentage) in a bubble.
 */
export function RailButton({
  children,
  label,
  onClick,
  active,
  busy,
  progress = 0,
  ariaLabel,
  caption,
  activeClass = "bg-terra/85",
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  busy?: boolean;
  progress?: number;
  ariaLabel?: string;
  /** Visible caption when it differs from the name (e.g. a progress percentage). */
  caption?: string;
  activeClass?: string;
}) {
  const [bubble, setBubble] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(false), 1400);
    return () => clearTimeout(t);
  }, [bubble]);

  const down = () => {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setBubble(true);
      haptic("light");
    }, 450);
  };
  const up = () => { if (timer.current) clearTimeout(timer.current); };

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      title={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (longPressed.current) return void (longPressed.current = false);
        haptic("light");
        onClick();
      }}
      className="group relative flex select-none flex-col items-center gap-1 outline-none [-webkit-touch-callout:none]"
    >
      <span
        className={`relative grid size-11 place-items-center rounded-full text-white transition-[transform,background-color] duration-300 group-active:scale-[.86] group-focus-visible:outline group-focus-visible:outline-[2.5px] group-focus-visible:outline-offset-2 group-focus-visible:outline-gold ${MAT_BASE} ${active ? activeClass : "bg-black/35"}`}
        style={{ transitionTimingFunction: SPRING }}
      >
        {busy && (
          <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="24" cy="24" r="22.5" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="3" />
            <circle cx="24" cy="24" r="22.5" fill="none" stroke="#F2B84B" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(progress / 100) * 141} 141`} className="transition-[stroke-dasharray] duration-500" />
          </svg>
        )}
        <span aria-hidden className="grid place-items-center">{children}</span>
      </span>
      {bubble && <RailBubble text={caption ?? label} />}
    </button>
  );
}

/** Small round glass control (close / play / info) for overlays on the media. */
export function GlassControl({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={`hit grid size-10 place-items-center rounded-full text-white transition-transform active:scale-90 ${MATERIAL}`}>
      {children}
    </button>
  );
}
