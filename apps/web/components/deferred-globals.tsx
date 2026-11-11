"use client";

import dynamic from "next/dynamic";

/*
 * App-wide helpers that never paint on first load: the pilot survey (a sheet that appears later on
 * triggers) and the native-shell bridge (a no-op on the web). Loaded client-side after hydration so
 * they stay out of every route's critical JS (docs/design/ui-audit.md §Performance).
 */
const PilotSurvey = dynamic(() => import("@/components/pilot-survey").then((m) => m.PilotSurvey), { ssr: false });
const NativeBridge = dynamic(() => import("@/components/native-bridge").then((m) => m.NativeBridge), { ssr: false });

export function DeferredGlobals() {
  return (
    <>
      <PilotSurvey />
      <NativeBridge />
    </>
  );
}
