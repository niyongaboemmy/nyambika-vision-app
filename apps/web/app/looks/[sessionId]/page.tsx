"use client";

import type { Intent } from "@nyambika/contracts";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { LookView } from "@/components/look-view";
import { ErrorNote, Screen, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { isRendering, type Look } from "@/lib/looks";

interface SessionData {
  id: string;
  source: string;
  intent: Intent | Record<string, never>;
  looks: Look[];
}

function intentLabel(s: SessionData, snapMakers: string | null) {
  if (s.source === "snap") return snapMakers ? `Snapped · ${snapMakers} makers` : "Snapped fabric";
  const i = s.intent as Intent;
  if (!i?.occasion) return null;
  const day = i.date ? new Date(i.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" }) : null;
  return `For: ${i.occasion.charAt(0).toUpperCase()}${i.occasion.slice(1).replace("-", " ")}${day ? ` · ${day}` : ""}`;
}

/** Looks stream (prototype v2 · 06/07): full-screen vertical feed, progressive generation. */
function Stream() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const snap = useSearchParams().get("snap");
  const [data, setData] = useState<SessionData | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const advanced = useRef(new Set<number>());
  const container = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => setData(await api<SessionData>(`/intent/${sessionId}`)), [sessionId]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  // Poll while any visible-soon look is still rendering.
  useEffect(() => {
    if (!data) return;
    const pending = data.looks.slice(0, index + 3).some((l) => isRendering(l.status) && l.status !== "PENDING");
    if (!pending) return;
    const id = setTimeout(() => void load(), 1000);
    return () => clearTimeout(id);
  }, [data, index, load]);

  // Progressive generation: when the shopper reaches look n−1, render the next two.
  useEffect(() => {
    if (!data || advanced.current.has(index)) return;
    advanced.current.add(index);
    api<{ queued: number }>(`/intent/${sessionId}/advance`, { method: "POST", json: { index } })
      .then((r) => { if (r.queued) void load(); })
      .catch((e) => setError(e.message));
  }, [index, data, sessionId, load]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(el.scrollTop / el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [data]);

  const replace = (l: Look) => setData((d) => (d ? { ...d, looks: d.looks.map((x) => (x.id === l.id ? l : x)) } : d));

  if (error && !data) return <Screen><div className="p-6 pt-20"><ErrorNote error={error} /></div></Screen>;
  if (!data) return <Screen><div className="grid min-h-dvh place-items-center"><Spinner /></div></Screen>;
  if (!data.looks.length) return <Screen><p className="p-6 pt-24 text-center text-mut">No matching looks yet. Try asking differently.</p></Screen>;

  const label = intentLabel(data, snap);
  return (
    <div ref={container} className="no-scrollbar mx-auto h-dvh w-full max-w-[480px] snap-y snap-mandatory overflow-y-scroll" aria-label="Looks stream">
      {data.looks.map((look, i) => (
        <section key={look.id} className="relative h-dvh snap-start snap-always" aria-label={`Look ${i + 1} of ${data.looks.length}`}>
          <LookView
            look={look}
            index={i}
            total={data.looks.length}
            intentLabel={label}
            onSave={async () => replace(await api<Look>(`/looks/${look.id}/save`, { method: "POST" }))}
            onVariant={async (variantId) => {
              replace(await api<Look>(`/looks/${look.id}/variant`, { method: "POST", json: { variantId } }));
              setTimeout(() => void load(), 900);
            }}
          />
          {i === 0 && index === 0 && data.looks.length > 1 && (
            <p className="pointer-events-none absolute inset-x-0 bottom-[178px] z-10 text-center text-sm text-txt/80">↑ swipe up · next look</p>
          )}
        </section>
      ))}
      {error && <div className="fixed inset-x-4 top-20 z-40"><ErrorNote error={error} /></div>}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Stream />
    </Suspense>
  );
}
