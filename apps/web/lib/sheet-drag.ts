"use client";

import { useCallback, useRef, useState } from "react";
import { haptic } from "@/lib/native";

/**
 * iOS sheet gestures for the grabber/header of a bottom sheet (~0.6 KB, no library):
 *  - drag down: the sheet follows the finger (rubber-banded upwards); release past 96 px or a fast flick closes it,
 *    otherwise it springs back (CSS --spring);
 *  - detents: with `medium`, the sheet opens at the medium height and a drag up of 56 px snaps it to large.
 * Only the handle area listens, so content scrolls normally. Respects prefers-reduced-motion (no spring, instant).
 */
export function useSheetDrag(onClose: () => void, detent: "medium" | "large" = "large") {
  const panel = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(detent === "large");
  const close = useRef(onClose);
  close.current = onClose;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = panel.current;
      if (!el) return;
      const y0 = e.clientY;
      const t0 = performance.now();
      let dy = 0;
      el.style.transition = "none";
      el.style.animation = "none"; // the open animation's fill would otherwise override the inline transform
      const move = (ev: PointerEvent) => {
        dy = ev.clientY - y0;
        el.style.transform = `translateY(${dy > 0 ? dy : dy / 4}px)`;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.style.transition = reduced ? "none" : "transform var(--spring-dur) var(--spring)";
        const fast = dy / Math.max(1, performance.now() - t0) > 0.7;
        if (dy > 96 || (fast && dy > 24)) {
          haptic("light");
          el.style.transform = "translateY(100%)";
          setTimeout(() => close.current(), reduced ? 0 : 180);
          return;
        }
        if (dy < -56 && !expanded) {
          haptic("light");
          setExpanded(true);
        }
        el.style.transform = "";
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [expanded],
  );

  return { panel, expanded, handle: { onPointerDown, style: { touchAction: "none" as const } } };
}
