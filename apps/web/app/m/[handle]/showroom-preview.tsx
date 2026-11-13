"use client";

import { roomLayout } from "@nyambika/contracts";
import { useEffect, useRef } from "react";
import type { ShowroomEngine } from "@/components/vr-engine";
import { rwf } from "@/lib/api";
import { lowEnd } from "@/lib/vr";
import type { HeroPiece } from "./hero";

/**
 * The Maker Space hero's live room: the same ShowroomEngine as /showroom in preview mode (no input, no XR, a slow
 * look-around). Renders only while on screen and the tab is visible; under reduced motion it holds still and stops
 * rendering once the pieces are in.
 */
export function ShowroomPreview({ name, banner, palette, pieces, visible, onReady }: { name: string; banner: string; palette: { primary: string; secondary: string; deep: string }; pieces: HeroPiece[]; visible: boolean; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    let engine: ShowroomEngine | null = null;
    let live = true;
    let onScreen = true;
    let settled = false;
    let stillTimer: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const sync = () => engine?.setPaused(!onScreen || document.hidden || (reduced && settled));
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    document.addEventListener("visibilitychange", sync);
    void import("@/components/vr-engine").then(({ ShowroomEngine }) => {
      if (!live || !canvas.current) return;
      const places = roomLayout(pieces.length);
      engine = new ShowroomEngine({
        canvas: canvas.current,
        pieces: pieces.map((p, i) => ({ id: p.id, title: p.title, price: rwf(p.priceRwf), glb: p.glb, poster: p.poster, heightM: p.heightM, place: places[i] })),
        palette,
        brand: name,
        banner,
        font: getComputedStyle(document.body).getPropertyValue("--font-display").trim() || "system-ui, sans-serif",
        reducedMotion: reduced,
        highContrast: false,
        lowEnd: lowEnd(),
        preview: true,
        onSelect: () => undefined,
        onHoldBuy: () => undefined,
        onProgress: ({ loaded, total }) => {
          if (loaded < total || !reduced) return;
          // Give poster textures a moment, then stop drawing a still scene.
          stillTimer = setTimeout(() => {
            settled = true;
            sync();
          }, 2500);
        },
        onXr: () => undefined,
        onReady: () => setTimeout(() => live && ready.current(), 250),
      });
      io.observe(canvas.current);
    }).catch(() => undefined);
    return () => {
      live = false;
      clearTimeout(stillTimer);
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine?.dispose();
    };
    // The room is built once per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvas} aria-hidden tabIndex={-1} className={`pointer-events-none absolute inset-0 size-full transition-opacity duration-700 ${visible ? "opacity-100" : "opacity-0"}`} />;
}
