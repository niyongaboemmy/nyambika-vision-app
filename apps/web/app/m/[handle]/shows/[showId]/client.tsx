"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { REACTIONS, runwayCursor, showPhase, type RunwayCursor, type ShowPhase } from "@nyambika/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HoldToBuy } from "@/components/hold-to-buy";
import type { RunwayEngine } from "@/components/vr-engine";
import { api, rwf } from "@/lib/api";
import { Price } from "@/components/region";
import type { Commerce } from "@/lib/region";
import { useSession } from "@/lib/session";
import { useLive } from "@/lib/use-live";
import { countdown, fmtWhen, lookFor, lowEnd, type ShowSnapshot, type ShowView } from "@/lib/vr";
import { hasWebGL2, prefersReducedMotion } from "@/lib/xr";

interface Floater {
  key: string;
  emoji: string;
  x: number;
}

export function ShowClient({ initial }: { initial: ShowView }) {
  const { me, t } = useSession();
  const router = useRouter();
  const [show, setShow] = useState(initial);
  const [offset, setOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [snap, setSnap] = useState<ShowSnapshot | null>(null);
  const [replay, setReplay] = useState<{ startedAt: number; pausedAt: number | null; track: { emoji: string; offsetMs: number }[] } | null>(null);
  const [cursor, setCursor] = useState<RunwayCursor | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);
  const [gl, setGl] = useState(true);
  const seen = useRef(new Set<string>());
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<RunwayEngine | null>(null);
  const replayIdx = useRef(0);
  const mine = useRef(new Map<string, number>());
  const runwayRef = useRef(initial.runwayStatus);
  const [commerce, setCommerce] = useState<Commerce | null>(null);
  // E40/E41: the page's currency (and "≈" display currency) like the Maker Space; RWF when no regional price.
  const money = (p: { id: string; priceRwf: number }) =>
    commerce && commerce.prices[p.id] != null ? <Price minor={commerce.prices[p.id]!} currency={commerce.currency} approxClassName="text-txt/70" /> : rwf(p.priceRwf);
  useEffect(() => {
    void api<Commerce>(`/region/pages/by-handle/${initial.maker.handle}/commerce`).then(setCommerce).catch(() => undefined);
  }, [initial.maker.handle]);

  const serverNow = now + offset;
  const phase: ShowPhase = showPhase({ status: show.phase === "CANCELLED" ? "CANCELLED" : "SCHEDULED", startsAt: show.startsAt, items: show.items.length, walkSec: show.walkSec }, new Date(serverNow));
  const liveish = phase === "LIVE" || phase === "DOORS_OPEN";
  const watching = liveish || Boolean(replay);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    setGl(hasWebGL2());
    // Signed-in viewers: re-read to learn whether they already RSVP'd (the SSR copy has no cookies).
    void api<ShowView>(`/vr/public/shows/${initial.id}`).then((s) => {
      setShow(s);
      setOffset(new Date(s.serverNow).getTime() - Date.now());
    }).catch(() => undefined);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [initial.id]);

  const spawn = (emoji: string, key: string) => {
    if (reduced) return;
    setFloaters((f) => [...f.slice(-24), { key, emoji, x: 8 + Math.random() * 30 }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.key !== key)), 2600);
  };

  const mode = useLive<ShowSnapshot>(
    liveish ? `/api/vr/public/shows/${show.id}/stream` : null,
    liveish ? `/api/vr/public/shows/${show.id}/live` : null,
    (s) => {
      setSnap(s);
      if (s.runwayStatus !== runwayRef.current) {
        runwayRef.current = s.runwayStatus;
        void api<ShowView>(`/vr/public/shows/${s.id}`).then(setShow).catch(() => undefined);
      }
      setOffset(new Date(s.serverNow).getTime() - Date.now());
      const fresh = s.recent.filter((r) => !seen.current.has(r.id));
      for (const r of fresh) seen.current.add(r.id);
      if (seen.current.size > fresh.length)
        fresh.slice(-6).forEach((r) => {
          const n = mine.current.get(r.emoji) ?? 0;
          if (n > 0) return void mine.current.set(r.emoji, n - 1); // already shown when I tapped it
          spawn(r.emoji, r.id);
        });
    },
    liveish,
  );

  // Runway engine: three.js is fetched only when the runway is on screen.
  useEffect(() => {
    if (!watching || !gl) return;
    // Rebuild when the runway models finish building (garment stand → dressed avatar).
    engine.current?.dispose();
    engine.current = null;
    let live = true;
    void import("@/components/vr-engine").then(({ RunwayEngine }) => {
      if (!live || !canvas.current) return;
      const font = getComputedStyle(document.body).getPropertyValue("--font-display").trim() || "system-ui, sans-serif";
      engine.current = new RunwayEngine({
        canvas: canvas.current,
        palette: show.maker.palette,
        brand: show.maker.name,
        title: show.title,
        font,
        looks: show.items.map((i) => (i.runway ? { glb: i.runway.glb, kind: "avatar" as const, poster: i.runway.poster } : i.garment ? { glb: i.garment.glb, kind: "garment" as const, poster: i.garment.poster } : { glb: null, kind: "poster" as const, poster: i.photo })),
        reducedMotion: prefersReducedMotion(),
        lowEnd: lowEnd(),
        onReady: () => undefined,
      });
    }).catch(() => live && setGl(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, gl, show.id, show.runwayStatus]);
  useEffect(() => () => engine.current?.dispose(), []);
  useEffect(() => {
    if (!watching && engine.current) {
      engine.current.dispose();
      engine.current = null;
    }
  }, [watching]);

  // Show clock → runway cursor each frame (server-synced live; local for replay).
  useEffect(() => {
    if (!watching) return;
    let raf = 0;
    let last = "";
    const start = new Date(show.startsAt).getTime();
    const frame = () => {
      const elapsed = replay ? ((replay.pausedAt ?? performance.now()) - replay.startedAt) / 1000 : (Date.now() + offset - start) / 1000;
      const c = runwayCursor(elapsed, show.items.length, show.walkSec);
      engine.current?.setCursor(c);
      const k = `${c.stage}:${c.index}`;
      if (k !== last) {
        last = k;
        setCursor(c);
      }
      if (replay && !replay.pausedAt) {
        const ms = elapsed * 1000;
        while (replayIdx.current < replay.track.length && replay.track[replayIdx.current].offsetMs <= ms) {
          const r = replay.track[replayIdx.current++];
          spawn(r.emoji, `rp-${replayIdx.current}`);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, replay, offset, show.startsAt, show.items.length, show.walkSec]);

  async function rsvp(going: boolean) {
    if (!me) return router.push(`/signin?next=${encodeURIComponent(location.pathname)}`);
    setRsvpBusy(true);
    setErr(null);
    try {
      const r = await api<{ going: boolean; rsvps: number }>(`/vr/shows/${show.id}/rsvp`, { method: "POST", json: { going } });
      setShow((s) => ({ ...s, going: r.going, rsvps: r.rsvps }));
      navigator.vibrate?.(12);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRsvpBusy(false);
    }
  }

  async function react(emoji: string) {
    spawn(emoji, `me-${Date.now()}`);
    mine.current.set(emoji, (mine.current.get(emoji) ?? 0) + 1);
    navigator.vibrate?.(6);
    try {
      await api(`/vr/public/shows/${show.id}/react`, { method: "POST", json: { emoji } });
    } catch (e) {
      setErr((e as Error).message);
      setTimeout(() => setErr(null), 2500);
    }
  }

  async function startReplay() {
    const r = await api<{ reactions: { emoji: string; offsetMs: number }[] }>(`/vr/public/shows/${show.id}/reactions`).catch(() => ({ reactions: [] }));
    replayIdx.current = 0;
    setReplay({ startedAt: performance.now(), pausedAt: null, track: r.reactions });
  }

  const togglePause = () =>
    setReplay((r) => {
      if (!r) return r;
      if (r.pausedAt) return { ...r, startedAt: r.startedAt + (performance.now() - r.pausedAt), pausedAt: null };
      return { ...r, pausedAt: performance.now() };
    });

  const item = cursor && (cursor.stage === "walk" || cursor.stage === "outro") ? show.items[cursor.index] : null;
  const look = item ? lookFor(show.maker, item.product, item.variant, item.variants, item.photo) : null;
  const toStart = new Date(show.startsAt).getTime() - serverNow;

  if (phase === "CANCELLED") {
    return (
      <main className="grid min-h-dvh place-items-center bg-ink p-6 text-center">
        <div>
          <p className="font-display text-2xl font-black">This show was cancelled</p>
          <Link href={`/m/${show.maker.handle}`} className="glass mt-5 inline-flex min-h-12 items-center rounded-2xl px-5 font-semibold">← {show.maker.name}</Link>
        </div>
      </main>
    );
  }

  if (!watching) {
    return (
      <main className="theme-media relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden bg-ink pb-10 text-txt">
        <header className="relative h-[58dvh] min-h-[360px]">
          {show.cover && <img loading="lazy" decoding="async" src={show.cover} alt="" className="absolute inset-0 size-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-ink" />
          <Link href={`/m/${show.maker.handle}`} aria-label={`Back to ${show.maker.name}`} className="glass absolute left-4 top-[max(env(safe-area-inset-top),14px)] grid size-11 place-items-center rounded-full">←</Link>
          <div className="absolute inset-x-5 bottom-4">
            <p className="text-[11px] font-bold uppercase tracking-[.22em] text-gold">{t("vr.fashionShow")} · {show.maker.name}</p>
            <h1 className="mt-1 font-display text-4xl font-black leading-[1.05]">{show.title}</h1>
            <p className="mt-2 text-sm text-txt/85">{fmtWhen(show.startsAt)} · {show.items.length} looks · {Math.ceil(show.durationSec / 60)} min</p>
          </div>
        </header>
        <section className="space-y-4 px-5">
          {phase === "UPCOMING" ? (
            <div className="glass flex items-center justify-between rounded-3xl p-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-mut">Starts in</p>
                <p className="font-display text-3xl font-black tabular-nums" aria-live="off">{countdown(toStart)}</p>
              </div>
              <p className="text-right text-xs text-mut">{show.rsvps} going</p>
            </div>
          ) : (
            <div className="glass rounded-3xl p-4">
              <p className="font-display text-2xl font-black">That&apos;s a wrap</p>
              <p className="text-sm text-mut">The show has ended. Replay it with the audience&apos;s reactions.</p>
              <button onClick={() => void startReplay()} className="grad-cta mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl font-bold">▶ {t("vr.replay")}</button>
            </div>
          )}
          {phase === "UPCOMING" && (
            <div>
              {show.going ? (
                <button onClick={() => void rsvp(false)} disabled={rsvpBusy} aria-pressed className="glass flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl font-bold">
                  ✓ {t("vr.rsvpDone")} <span className="text-xs font-normal text-mut">· tap to cancel</span>
                </button>
              ) : (
                <button onClick={() => void rsvp(true)} disabled={rsvpBusy} className="grad-cta flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-lg font-black shadow-[0_14px_36px_rgba(224,112,63,.4)]">
                  🔔 {me ? t("vr.rsvp") : `Sign in · ${t("vr.rsvp")}`}
                </button>
              )}
              <p className="mt-1.5 text-center text-xs text-mut">One WhatsApp message about an hour before. Your number is never shown to the maker.</p>
            </div>
          )}
          {err && (isExpectedText(err) ? <LimitState error={err} /> : <p role="alert" className="text-sm text-terra">{err}</p>)}
          {show.description && <p className="text-[15px] leading-relaxed text-txt/90">{show.description}</p>}
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-gold">On the runway</h2>
            <ul tabIndex={0} aria-label="Looks in this show" className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5">
              {show.items.map((i) => (
                <li key={i.position} className="w-32 shrink-0">
                  <div className="glass overflow-hidden rounded-3xl">{(i.runway?.poster ?? i.photo) && <img loading="lazy" decoding="async" src={(i.runway?.poster ?? i.photo)!} alt="" className="h-40 w-full object-cover" />}</div>
                  <p className="mt-1 truncate text-sm font-semibold">{i.product.title}</p>
                  <p className="text-xs text-gold">{money(i.product)}</p>
                </li>
              ))}
            </ul>
          </div>
          <Link href={`/m/${show.maker.handle}/showroom`} className="glass flex min-h-12 items-center justify-center rounded-2xl text-sm font-semibold">🥽 {t("vr.enterShowroom")}</Link>
          <p className="text-center text-[11px] text-mut">{show.model.label}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="theme-media relative h-dvh w-full overflow-hidden bg-ink text-txt" onKeyDown={(e) => {
      if (e.key === "ArrowLeft") engine.current?.look(0.12);
      if (e.key === "ArrowRight") engine.current?.look(-0.12);
    }}>
      {gl ? (
        <canvas ref={canvas} tabIndex={0} aria-label={`${show.title} runway. Drag or use the arrow keys to change your seat angle.`} className="absolute inset-0 size-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold" />
      ) : (
        <div className="absolute inset-0 grid place-items-center">{item?.runway?.poster || item?.photo ? <img loading="lazy" decoding="async" src={(item.runway?.poster ?? item.photo)!} alt={item.product.title} className="max-h-[70dvh] object-contain" /> : null}</div>
      )}

      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/75 to-transparent px-3 pb-10 pt-[max(env(safe-area-inset-top),12px)]">
        <button onClick={() => (replay ? setReplay(null) : router.push(`/m/${show.maker.handle}`))} aria-label={replay ? "Close the replay" : `Back to ${show.maker.name}`} className="glass grid size-11 shrink-0 place-items-center rounded-full">←</button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-black leading-tight">{show.title}</p>
          <p className="truncate text-xs text-txt/75">{show.maker.name}</p>
        </div>
        {replay ? (
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold">REPLAY</span>
        ) : phase === "LIVE" ? (
          <span className="rounded-full bg-terra px-2.5 py-1 text-xs font-black text-white">● {t("vr.live")}</span>
        ) : (
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold">Doors open</span>
        )}
        {!replay && (
          <span className="glass rounded-full px-2.5 py-1 text-xs font-bold tabular-nums" aria-live="polite" aria-label={`${snap?.viewers ?? 0} ${t("vr.watching")}`}>
            👁 {snap?.viewers ?? "…"} <span className="sr-only">{t("vr.watching")}</span>
          </span>
        )}
      </header>

      {/* Floating reactions (off with reduced motion: counts only) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {floaters.map((f) => (
          <span key={f.key} className="vr-float absolute bottom-40 text-3xl" style={{ right: `${f.x}%` }}>{f.emoji}</span>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-12">
        <div className="mx-auto max-w-[480px]">
          {/* Caption of what is on the runway (FR-VR-07 captions) */}
          <p className="mb-2 text-center text-sm" aria-live="polite">
            {phase === "DOORS_OPEN" && !replay
              ? `Starting in ${countdown(toStart)} · find a seat`
              : cursor?.stage === "intro"
                ? `Welcome to ${show.title}`
                : item
                  ? <><span className="text-mut">Look {cursor!.index + 1} of {show.items.length} · </span><b>{item.product.title}</b> <span className="text-gold">{money(item.product)}</span>{cursor?.stage === "outro" ? " · finale" : ""}</>
                  : cursor?.stage === "after" ? "Thank you for watching" : " "}
          </p>
          <div className="flex items-center gap-2">
            {!replay ? (
              <div role="group" aria-label="Send a reaction" className="glass flex flex-1 justify-between rounded-full px-1.5 py-1">
                {REACTIONS.map((e) => (
                  <button key={e} onClick={() => void react(e)} aria-label={`React ${e}${snap ? `, ${snap.reactions[e] ?? 0} so far` : ""}`} className="grid size-11 place-items-center rounded-full text-2xl transition active:scale-125">
                    <span aria-hidden>{e}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 gap-2">
                <button onClick={togglePause} className="glass min-h-12 flex-1 rounded-2xl font-bold">{replay.pausedAt ? "▶ Play" : "❚❚ Pause"}</button>
                <button onClick={() => void startReplay()} className="glass min-h-12 rounded-2xl px-4 font-bold" aria-label="Restart the replay">↺</button>
              </div>
            )}
            {look && (me ? <HoldToBuy key={look.variant.id} look={look} /> : <Link href={`/signin?next=${encodeURIComponent(`/m/${show.maker.handle}/shows/${show.id}`)}`} className="grad-cta shrink-0 rounded-2xl px-4 py-2 text-sm font-bold">✋ Buy</Link>)}
          </div>
          {snap && !replay && (
            <p className="mt-2 text-center text-[11px] text-txt/70">
              {REACTIONS.map((e) => `${e} ${snap.reactions[e] ?? 0}`).join("  ·  ")}{mode === "polling" ? " · refreshing every few seconds" : ""}
            </p>
          )}
          {err && (isExpectedText(err) ? <LimitState error={err} /> : <p role="alert" className="mt-1 text-center text-xs text-terra">{err}</p>)}
          <p className="mt-2 text-center text-[10px] text-txt/60">{show.model.label} · 3D generated by AI · drag to change your seat</p>
        </div>
      </div>
    </main>
  );
}
