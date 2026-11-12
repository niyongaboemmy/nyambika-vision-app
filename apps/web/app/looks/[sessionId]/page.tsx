"use client";

import type { Intent } from "@nyambika/contracts";
import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/components/toast";
import { withLookIndex } from "@/lib/nav";
import { haptic } from "@/lib/native";
import { useSession } from "@/lib/session";
import { LooksSkeleton } from "@/components/look-material";
const LimitState = dynamic(() => import("@/components/limit-state").then((m) => m.LimitState), { ssr: false }); // error-only
import { Screen } from "@/components/ui";
import { api } from "@/lib/api";
import { isRendering, type Look } from "@/lib/looks";
import { track, trackOnce } from "@/lib/track";

// JS budget pass: the look card (gestures, rails, sheets, region pricing) and hold-to-buy are only drawn once the
// session data is in, so their code loads in parallel with that fetch instead of on the critical path.
const loadLookView = () => import("@/components/look-view");
const loadHoldToBuy = () => import("@/components/hold-to-buy");
const LookView = dynamic(() => loadLookView().then((m) => m.LookView), { ssr: false, loading: () => <LooksSkeleton /> });
const HoldToBuy = dynamic(() => loadHoldToBuy().then((m) => m.HoldToBuy), { ssr: false });
const TwinNudge = dynamic(() => import("@/components/twin-nudge").then((m) => m.TwinNudge), { ssr: false });

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
  const search = useSearchParams();
  const snap = search.get("snap");
  const { me } = useSession();
  const [data, setData] = useState<SessionData | null>(null);
  // Navigation pass: the look on screen lives in `?i=` (look 4 of 9 is ?i=3), so every detour that carries
  // `next` (twin, sign in, measurements…) and the history entry itself come back to the same look.
  const [index, setIndex] = useState(() => Math.max(0, Number(search.get("i")) || 0));
  const [error, setError] = useState<unknown>(null);
  const advanced = useRef(new Set<number>());
  const container = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const load = useCallback(async () => setData(await api<SessionData>(`/intent/${sessionId}`)), [sessionId]);
  useEffect(() => {
    void loadLookView();
    void loadHoldToBuy();
    load().catch(setError);
  }, [load]);

  // Back on the stream: jump (no animation) to the remembered look before the first paint of the feed.
  useLayoutEffect(() => {
    const el = container.current;
    if (!data || !el || restored.current) return;
    restored.current = true;
    const i = Math.min(index, data.looks.length - 1);
    if (i > 0) el.scrollTop = i * el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Keep ?i= in step with the look on screen (replace, not push: paging is not a history step).
  useEffect(() => {
    if (!restored.current) return;
    const want = withLookIndex(window.location.pathname + window.location.search, index);
    if (want !== window.location.pathname + window.location.search) window.history.replaceState(null, "", want);
  }, [index]);

  // Twin follow-through: back from making a twin, the looks around the one on screen re-render on it (visible
  // first, then neighbours; GenerationService caches by twin key). The old render stays under a sheen meanwhile.
  const retwinAt = useRef(new Set<number>());
  const stale = useRef(new Map<string, string>());
  const [retwin, setRetwin] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!data || error || !me?.hasTwin || retwinAt.current.has(index)) return;
    const near = data.looks.slice(Math.max(0, index - 1), index + 3).filter((l) => l.status === "DELIVERED" && l.image && !l.onTwin);
    if (!near.length) return;
    retwinAt.current.add(index);
    for (const l of near) stale.current.set(l.id, l.image!);
    api<{ queued: number; lookIds: string[] }>(`/intent/${sessionId}/retwin`, { method: "POST", json: { index } })
      .then((r) => {
        if (!r.queued) return;
        setRetwin((s) => new Set([...s, ...r.lookIds]));
        void load();
      })
      .catch(setError); // daily cap / consent / budget: the calm limit card; the model renders stay
  }, [data, index, me?.hasTwin, error, sessionId, load]);
  useEffect(() => {
    if (!data || !retwin.size) return;
    const done = data.looks.filter((l) => retwin.has(l.id) && !isRendering(l.status));
    if (!done.length) return;
    const onYou = done.some((l) => l.onTwin && l.status === "DELIVERED" && data.looks[index]?.id === l.id);
    setRetwin((s) => new Set([...s].filter((id) => !done.some((l) => l.id === id))));
    for (const l of done) stale.current.delete(l.id);
    if (onYou) {
      haptic("success");
      toast("On you now");
    }
  }, [data, retwin, index]);

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
    retwinAt.current.clear();
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
            staleImage={retwin.has(look.id) && isRendering(look.status) ? stale.current.get(look.id) : undefined}
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
