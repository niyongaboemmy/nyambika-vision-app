"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/studio";
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

export function SizeNotes({ rec, size }: { rec: SizeRecommendation | null; size: string }) {
  if (!rec) return null;
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
        <Link href="/measurements" className="font-semibold text-gold underline-offset-2 hover:underline">Add measurements</Link>
      )}
    </div>
  );
}
