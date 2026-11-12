"use client";

/*
 * Looks stream extras that never paint on first load (JS budget pass 2): the one-time coach mark / swipe peek, the
 * long-press label bubble of the rail buttons and the double-tap heart burst. look-view and look-rail load this
 * chunk after the card is up (idle prefetch via `preloadLookExtras`), so the first gesture finds it ready.
 */
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { MATERIAL } from "@/components/look-material";
import { animate } from "@/components/look-rail";

/** Coach capsule: "Next · Maker Space" once (softly animated chevrons), and "Maker Space" as the drag peek. */
export function CoachHint({ next, pull, dragging }: { next: boolean; pull: number; dragging: boolean }) {
  const left = useRef<HTMLSpanElement>(null);
  const up = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (dragging) return;
    const a = animate(left.current, [{ transform: "translateX(3px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(3px)" }], { duration: 1300, iterations: Infinity, easing: "ease-in-out" });
    const b = animate(up.current, [{ transform: "translateY(2px)" }, { transform: "translateY(-3px)" }, { transform: "translateY(2px)" }], { duration: 1300, iterations: Infinity, easing: "ease-in-out" });
    return () => {
      a?.cancel();
      b?.cancel();
    };
  }, [dragging]);
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute left-4 z-10 inline-flex animate-fade items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white bottom-[calc(max(13dvh,128px)+max(env(safe-area-inset-bottom),14px)+4px)] ${MATERIAL}`}
      style={{ opacity: dragging ? 0.4 + pull * 0.6 : 1 }}
    >
      {next && !dragging && (
        <>
          <span ref={up} className="inline-flex"><Icon name="chevron" className="size-3.5 -rotate-90" /></span>
          Next
          <span className="text-white/50">·</span>
        </>
      )}
      <span ref={left} className="inline-flex"><Icon name="back" className="size-3.5" /></span>
      Maker Space
    </span>
  );
}

/** Long-press label bubble beside a rail button. */
export function RailBubble({ text }: { text: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute right-[calc(100%+8px)] top-2.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold text-white ${MATERIAL}`}>
      {text}
    </span>
  );
}

/** Double-tap heart: pops at (x, y) inside its stage, then floats up and fades. */
export function burstHeart(el: HTMLElement, x: number, y: number) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.opacity = "1";
  const a = animate(el, [
    { transform: "translate(-50%,-50%) scale(.3) rotate(-12deg)", opacity: 0 },
    { transform: "translate(-50%,-50%) scale(1.15) rotate(0deg)", opacity: 1, offset: 0.35 },
    { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.6 },
    { transform: "translate(-50%,-120%) scale(.9)", opacity: 0 },
  ], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" });
  if (a) a.onfinish = () => (el.style.opacity = "0");
  else setTimeout(() => (el.style.opacity = "0"), 600);
}
