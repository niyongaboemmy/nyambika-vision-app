"use client";

import { useCallback, useRef } from "react";

/**
 * A ~0.5 KB stand-in for the slice of `@use-gesture/react`'s `useDrag` this app uses (horizontal swipes on the
 * Maker Space coverflow, the 3D shelf and the look card), so those routes skip the ~7 KB gz gesture library
 * (JS budget pass). Same call shape: `useDrag(handler, { axis: "x", filterTaps: true })`, then `{...bind()}`.
 *
 * Semantics kept from use-gesture: the axis locks on the first few pixels (a vertical start is left to the page
 * scroll and never reaches the handler); a press that moves less than 3 px is a tap (`tap: true`, reported on
 * release); `movement` is the offset from the press point; a `pointercancel` (the browser took over the touch for
 * scrolling) ends the gesture silently. Listeners sit on `window` while pressed, without pointer capture, so taps on
 * buttons inside the swipe area still click normally.
 */
export interface DragState {
  first: boolean;
  last: boolean;
  tap: boolean;
  movement: [number, number];
}

export interface DragOptions {
  axis?: "x" | "y";
  filterTaps?: boolean;
}

const TAP_PX = 3;
const AXIS_PX = 4;

export function useDrag(handler: (s: DragState) => void, opts: DragOptions = {}) {
  const ref = useRef({ handler, opts });
  ref.current = { handler, opts };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const id = e.pointerId;
    let axis: "x" | "y" | null = null;
    let first = true;
    const movement = (ev: PointerEvent): [number, number] => {
      const { axis: lock } = ref.current.opts;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      return lock === "x" ? [dx, 0] : lock === "y" ? [0, dy] : [dx, dy];
    };
    const decided = (ev: PointerEvent) => {
      const lock = ref.current.opts.axis;
      if (!lock || axis) return axis === lock || !lock;
      const dx = Math.abs(ev.clientX - x0);
      const dy = Math.abs(ev.clientY - y0);
      if (Math.max(dx, dy) < AXIS_PX) return false;
      axis = dx >= dy ? "x" : "y";
      return axis === lock;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id || !decided(ev)) return;
      ref.current.handler({ first, last: false, tap: false, movement: movement(ev) });
      first = false;
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      stop();
      if (ev.type === "pointercancel") return;
      const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      const tap = dist < TAP_PX;
      if (!tap && !decided(ev)) return; // vertical gesture on an x-locked area: the page scrolled
      if (tap && !ref.current.opts.filterTaps) return;
      ref.current.handler({ first, last: true, tap, movement: tap ? [0, 0] : movement(ev) });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }, []);

  return useCallback(() => ({ onPointerDown }), [onPointerDown]);
}
