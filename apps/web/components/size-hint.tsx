"use client";

import { DetourLink } from "@/components/detour-link";
import { stashResume } from "@/lib/use-nav";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { api } from "@/lib/api";
import type { SizeRecommendation } from "@/lib/tailor";

/** Size recommendation for a product (E32, FR-SIZE-02): profile vs size chart, else the twin estimate. */
export function useSizeRecommendation(productId: string, variantId: string, enabled: boolean) {
  const [rec, setRec] = useState<SizeRecommendation | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void api<{ recommendation: SizeRecommendation | null }>(`/size/recommend?productId=${productId}&variantId=${variantId}`)
      .then((r) => live && setRec(r.recommendation))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [productId, variantId, enabled]);
  return rec;
}

const CONF: Record<string, string> = { high: "great fit", medium: "good fit", low: "estimate" };

export function SizeNotes({ rec, size, resumeKey }: { rec: SizeRecommendation | null; size: string; /** Reopen this buy sheet when the shopper comes back from measurements. */ resumeKey?: string }) {
  // No chart-based advice for this piece: still one tap to the measurements, and the buy sheet reopens on return.
  if (!rec)
    return resumeKey ? (
      <p className="mt-1.5 text-xs">
        <DetourLink href="/measurements" onBeforeGo={() => stashResume("buy", resumeKey)} className="inline-flex min-h-8 items-center gap-1 font-semibold text-gold underline-offset-2 hover:underline">
          <Icon name="ruler" className="size-3.5" /> My measurements
        </DetourLink>
      </p>
    ) : null;
  return (
    <div className="mt-1.5 text-xs text-txt/80" aria-live="polite">
      {rec.size === size ? (
        <p className="flex items-start gap-1.5">
          <Icon name="ruler" className="mt-px size-3.5 shrink-0 text-gold" />
          <span>
            {rec.basis === "PROFILE" ? `Your measurements · ${CONF[rec.confidence]}` : "Your twin's size"}
            {rec.notes.length > 0 && <> · {rec.notes.join(" · ")}</>}
          </span>
        </p>
      ) : (
        <p>We'd suggest {rec.size} ({rec.notes[0]?.toLowerCase() ?? CONF[rec.confidence]}).</p>
      )}
      {rec.basis === "TWIN" && (
        <DetourLink href="/measurements" onBeforeGo={() => resumeKey && stashResume("buy", resumeKey)} className="font-semibold text-gold underline-offset-2 hover:underline">Add measurements</DetourLink>
      )}
    </div>
  );
}
