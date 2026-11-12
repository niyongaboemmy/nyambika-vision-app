"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { loadExtraIcons } from "@/components/icons-lazy";

/*
 * App-wide helpers that never paint on first load: the pilot survey (a sheet that appears later on
 * triggers) and the native-shell bridge (a no-op on the web). Loaded client-side after hydration so
 * they stay out of every route's critical JS (docs/design/ui-audit.md §Performance).
 * iOS pass: the non-core icon glyphs (components/icons-extra.ts) are prefetched once the page has loaded and the
 * main thread is idle, so screens that use them draw them immediately without costing first-load JS.
 */
const PilotSurvey = dynamic(() => import("@/components/pilot-survey").then((m) => m.PilotSurvey), { ssr: false });
const NativeBridge = dynamic(() => import("@/components/native-bridge").then((m) => m.NativeBridge), { ssr: false });

export function DeferredGlobals() {
  useEffect(() => {
    const idle = () => ("requestIdleCallback" in window ? window.requestIdleCallback(() => void loadExtraIcons(), { timeout: 3000 }) : setTimeout(() => void loadExtraIcons(), 1500));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  }, []);
  return (
    <>
      <PilotSurvey />
      <NativeBridge />
    </>
  );
}
