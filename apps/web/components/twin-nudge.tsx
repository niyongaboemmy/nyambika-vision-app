"use client";

import { EXPERIMENTS } from "@nyambika/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useExperiment } from "@/lib/experiments";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";

/**
 * Pilot experiment "twin vs no-twin nudge" (plan §8.1).
 * - twin_first (control, also the default when the experiment is off): the strong pre-look prompt on the Muse.
 * - model_first: no pre-look prompt; AI-model looks first, then a soft prompt in the stream after the 3rd look.
 */
export function TwinNudge({ place, index = 0 }: { place: "home" | "stream"; index?: number }) {
  const { me, t } = useSession();
  const arm = useExperiment(EXPERIMENTS.twinNudge);
  const [closed, setClosed] = useState(false);
  const modelFirst = arm === "model_first";
  const show = Boolean(me && !me.hasTwin && arm !== undefined && !closed && (place === "home" ? !modelFirst : modelFirst && index >= 2));

  useEffect(() => {
    if (show) track("twin_nudge_shown", { place, arm: arm ?? "default" });
  }, [show, place, arm]);

  if (!show) return null;
  const click = () => track("twin_nudge_clicked", { place, arm: arm ?? "default" });

  if (place === "home") {
    return (
      <Link href="/mirror" onClick={click} className="glass mt-3 rounded-2xl px-4 py-2 text-sm">
        🪞 Create your private twin to see looks on <b>you</b> →
      </Link>
    );
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(max(env(safe-area-inset-top),12px)+120px)] z-30 flex justify-center px-4">
      <div className="glass pointer-events-auto flex max-w-[440px] animate-rise items-center gap-1 rounded-full py-1 pl-4 pr-1 text-sm shadow-[0_8px_30px_rgba(139,92,246,.35)]">
        <Link href="/mirror" onClick={click} className="flex min-h-10 items-center gap-2 font-semibold">
          <span aria-hidden>✨</span> {t("twin.nudgeSoft")} <span aria-hidden>→</span>
        </Link>
        <button type="button" aria-label="Hide" onClick={() => setClosed(true)} className="grid size-10 place-items-center rounded-full text-white/70 hover:text-white">✕</button>
      </div>
    </div>
  );
}
