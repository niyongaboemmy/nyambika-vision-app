"use client";

import type { Intent } from "@nyambika/contracts";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { HoldToBuy } from "@/components/hold-to-buy";
import { LooksSkeleton } from "@/components/look-rail";
import { LookView } from "@/components/look-view";
import { TwinNudge } from "@/components/twin-nudge";
import { LimitState } from "@/components/limit-state";
import { Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { isRendering, type Look } from "@/lib/looks";
import { track, trackOnce } from "@/lib/track";

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
  const [error, setError] = useState<unknown>(null);
  const advanced = useRef(new Set<number>());
  const container = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => setData(await api<SessionData>(`/intent/${sessionId}`)), [sessionId]);
  useEffect(() => {
    load().catch(setError);
  }, [load]);

  // Poll while any visible-soon look is still rendering.
  useEffect(() => {
    if (!data || error) return; // a limit stops the poll; the card offers retry
    const pending = data.looks.slice(0, index + 3).some((l) => isRendering(l.status) && l.status !== "PENDING");
    if (!pending) return;
    const id = setTimeout(() => void load(), 1000);
    return () => clearTimeout(id);
  }, [data, index, load, error]);

  // Progressive generation: when the shopper reaches look n−1, render the next two.
  useEffect(() => {
    if (!data || advanced.current.has(index)) return;
    advanced.current.add(index);
    api<{ queued: number }>(`/intent/${sessionId}/advance`, { method: "POST", json: { index } })
      .then((r) => { if (r.queued) void load(); })
      .catch((e) => {
        advanced.current.delete(index); // allow a retry (countdown over, consent on, back online)
        setError(e);
      });
  }, [index, data, sessionId, load]);

  // Current look + parallax: each section gets --p (its offset in screens, -1…1) for the media layer.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const paint = () => {
      frame = 0;
      setIndex(Math.round(el.scrollTop / el.clientHeight));
      if (still) return;
      for (const sec of el.children) {
        if (!(sec instanceof HTMLElement) || sec.tagName !== "SECTION") continue;
        const p = (sec.offsetTop - el.scrollTop) / el.clientHeight;
        if (Math.abs(p) <= 1.05) sec.style.setProperty("--p", p.toFixed(3));
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };
    paint();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [data]);

  // Keyboard paging: ↓/PageDown/j next look, ↑/PageUp/k previous (not while typing or in a sheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = container.current;
      const tgt = e.target as HTMLElement | null;
      if (!el || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (tgt?.closest("input,textarea,select,[contenteditable],[role=dialog]") || document.querySelector("[role=dialog]")) return;
      const dir = ["ArrowDown", "PageDown", "j"].includes(e.key) ? 1 : ["ArrowUp", "PageUp", "k"].includes(e.key) ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ top: (Math.round(el.scrollTop / el.clientHeight) + dir) * el.clientHeight, behavior: still ? "auto" : "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pilot funnel: a look counts as viewed once it is on screen and rendered.
  const current = data?.looks[index];
  useEffect(() => {
    if (current && !isRendering(current.status)) trackOnce(`look:${current.id}`, "look_viewed", { lookId: current.id, sessionId, index, onTwin: current.onTwin });
  }, [current, sessionId, index]);

  const replace = (l: Look) => setData((d) => (d ? { ...d, looks: d.looks.map((x) => (x.id === l.id ? l : x)) } : d));

  const retry = () => {
    setError(null);
    void load().catch(setError);
  };
  if (error && !data) return <Screen><div className="p-6 pt-20"><LimitState error={error} onRetry={retry} /></div></Screen>;
  if (!data) return <LooksSkeleton />;
  if (!data.looks.length) return <Screen><p className="p-6 pt-24 text-center text-mut">No matching looks yet. Try asking differently.</p></Screen>;

  const label = intentLabel(data, snap);
  return (
    <div ref={container} className="theme-media no-scrollbar mx-auto h-dvh w-full max-w-[480px] snap-y snap-mandatory overflow-y-scroll overscroll-contain bg-black" aria-label="Looks stream">
      {data.looks.map((look, i) => (
        <section key={look.id} className="relative h-dvh snap-start snap-always" aria-label={`Look ${i + 1} of ${data.looks.length}`}>
          <LookView
            paused={error != null}
            active={i === index}
            look={look}
            index={i}
            total={data.looks.length}
            intentLabel={label}
            onSave={async () => {
              const saved = await api<Look>(`/looks/${look.id}/save`, { method: "POST" });
              if (saved.saved) track("look_saved", { lookId: look.id, index: i });
              replace(saved);
            }}
            onVariant={async (variantId) => {
              replace(await api<Look>(`/looks/${look.id}/variant`, { method: "POST", json: { variantId } }));
              setTimeout(() => void load(), 900);
            }}
          >
            <HoldToBuy look={look} />
          </LookView>
        </section>
      ))}
      <TwinNudge place="stream" index={index} />
      {/* Daily cap, kill switch, consent…: a calm card over the feed (centred while the current look can't render). */}
      {error != null && (
        <div className={`fixed left-4 right-20 z-40 mx-auto max-w-[448px] sm:inset-x-4 ${current && !current.image ? "top-1/3" : "top-20"}`}>
          <LimitState error={error} onRetry={retry} onDismiss={() => setError(null)} />
        </div>
      )}
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
