"use client";

/*
 * Floating controls for the full-bleed Looks stream (iOS-style): dark "ultra-thin material" glass circles with
 * SF-like glyphs, press-scale + spring, a long-press label bubble, haptics. Shared by look-view, morph, XR and
 * video rails so every rail button looks and behaves the same.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/native";

/** iOS-like spring (≈ stiffness 260 / damping 20) as a CSS/WAAPI `linear()` easing. */
export const SPRING =
  "linear(0, 0.013 0.6%, 0.05 1.2%, 0.2 2.6%, 0.588 5.6%, 0.8 7.6%, 0.944 9.7%, 1.034 11.9%, 1.08 14.3%, 1.092 16.4%, 1.084 19.2%, 1.043 25.1%, 1.016 30.7%, 0.999 37.5%, 0.995 46.2%, 1.001 63.1%, 1)";

/** Dark material for chrome floating over photos (stays legible on any garment, both themes: media is dark). */
export const MAT_BASE = "border border-white/15 backdrop-blur-xl backdrop-saturate-150 shadow-[0_8px_24px_-12px_rgba(0,0,0,.6)]";
export const MATERIAL = `${MAT_BASE} bg-black/35`;

export const reduced = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Run a Web Animation unless the shopper prefers reduced motion. */
export function animate(el: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  if (!el || reduced() || !("animate" in el)) return null;
  return el.animate(frames, opts);
}

/**
 * One rail button: 48 px glass circle (hit area ≥ 44 px), accessible name = `label` (or `ariaLabel`).
 * The visible caption is tiny and only shown on tall phones; elsewhere a long-press shows it in a bubble.
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
        className={`relative grid size-12 place-items-center rounded-full text-white transition-[transform,background-color] duration-300 group-active:scale-[.86] group-focus-visible:outline group-focus-visible:outline-[2.5px] group-focus-visible:outline-offset-2 group-focus-visible:outline-gold ${MAT_BASE} ${active ? activeClass : "bg-black/35"}`}
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
      {/* Tiny caption on tall phones only (iOS rails stay glyph-first); the name is always on the button. */}
      <span aria-hidden className="hidden text-[10px] font-semibold leading-none text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,.7)] [@media(min-height:860px)]:block">
        {caption ?? label}
      </span>
      {bubble && (
        <span aria-hidden className={`pointer-events-none absolute right-[calc(100%+8px)] top-3 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-white ${MATERIAL}`}>
          {caption ?? label}
        </span>
      )}
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

/** Full-bleed loading state for the stream and try-on (same anatomy as the final screen). */
export function LooksSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="theme-media relative mx-auto h-dvh w-full max-w-[480px] overflow-hidden bg-black">
      <div data-skeleton aria-hidden className="skeleton absolute inset-0 rounded-none" />
      <div aria-hidden className="absolute inset-x-0 top-0 grid grid-cols-[44px_1fr_44px] items-center px-3 pt-[max(env(safe-area-inset-top),12px)]">
        <span className={`size-10 rounded-full ${MATERIAL}`} />
        <span className={`mx-auto h-7 w-24 rounded-full ${MATERIAL}`} />
      </div>
      <div aria-hidden className={`absolute inset-x-0 bottom-0 rounded-t-[28px] ${MAT_BASE} bg-black/55`} style={{ height: "max(13dvh, 128px)" }} />
    </div>
  );
}
