"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorNote, Sheet } from "@/components/ui";
import { api } from "@/lib/api";
import { REACTIONS, timeLeft, type PollMeta, type PublicPoll, type Snapshot } from "@/lib/social";
import { useLive } from "@/lib/use-live";
import { useSession } from "@/lib/session";
import { Bubble } from "@/components/circle-bits";

/** Public poll page opened from WhatsApp: big swipeable looks, tap to vote, live results. No account. */
export function PollClient({ token, meta }: { token: string; meta: PollMeta }) {
  const { t } = useSession();
  const [poll, setPoll] = useState<PublicPoll | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const [note, setNote] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const state = poll?.state ?? meta.state;

  useEffect(() => {
    api<PublicPoll>(`/c/${token}`).then(setPoll).catch((e) => setError(e.message));
  }, [token]);

  const onSnap = useCallback((s: Snapshot) => {
    setPoll((p) => (p ? { ...p, state: s.state, total: s.total, comments: s.comments, options: p.options.map((o) => ({ ...o, ...s.options.find((x) => x.id === o.id) })) } : p));
  }, []);
  useLive<Snapshot>(state === "OPEN" ? `/api/c/${token}/stream` : null, `/api/c/${token}`, onSnap, Boolean(poll));

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const on = () => setIndex(Math.round(el.scrollLeft / (el.scrollWidth / meta.options.length)));
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [meta.options.length]);

  async function vote(optionId: string, extra: { name?: string; comment?: string; emoji?: string } = {}) {
    if (busy || state !== "OPEN") return;
    setBusy(true);
    setError(null);
    if (!extra.comment && !extra.name) {
      setBurst(optionId);
      navigator.vibrate?.(15);
      setTimeout(() => setBurst(null), 800);
    }
    try {
      setPoll(await api<PublicPoll>(`/c/${token}/vote`, { method: "POST", json: { optionId, ...extra } }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const scrollTo = (i: number) => rail.current?.scrollTo({ left: (rail.current.scrollWidth / meta.options.length) * i, behavior: "smooth" });

  if (state !== "OPEN") {
    return (
      <main className="aurora mx-auto grid min-h-dvh w-full max-w-[480px] place-items-center px-6 text-center">
        <div>
          <span className="orb mx-auto mb-5 block size-16 rounded-full opacity-80" />
          <h1 className="font-display text-3xl font-black">{state === "REVOKED" ? "Taken down" : "This poll has closed"}</h1>
          <p className="mt-2 text-txt/80">“{poll?.question ?? meta.question}”</p>
          <p className="mt-2 text-sm text-mut">{state === "REVOKED" ? "The owner removed these previews." : "Polls close by themselves"}</p>
          <Link href="/" className="grad-cta mt-6 inline-flex min-h-12 items-center rounded-2xl px-6 font-semibold">See looks on you · Nyambika</Link>
        </div>
      </main>
    );
  }

  const options = meta.options.map((o) => ({ ...o, ...(poll?.options.find((x) => x.id === o.id) ?? { votes: 0, pct: 0 }) }));
  const mine = poll?.myVote?.optionId ?? null;
  const current = options[index] ?? options[0];

  return (
    <main className="aurora relative mx-auto min-h-dvh w-full max-w-[480px] overflow-x-hidden pb-28">
      <header className="px-5 pt-[max(env(safe-area-inset-top),18px)] text-center">
        <h1 className="font-display text-[28px] font-black leading-tight">{t("circle.title")} 👥</h1>
        <p className="mt-1 text-[17px] text-txt/90">“{meta.question}”</p>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs text-txt/80">
          <span className="size-2 animate-pulse rounded-full bg-mint" aria-hidden /> Live · {poll ? `${poll.total} vote${poll.total === 1 ? "" : "s"}` : "…"} · {timeLeft(poll?.expiresAt ?? meta.expiresAt)}
        </p>
      </header>

      <div ref={rail} className="no-scrollbar mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-[12%]" aria-label="Looks to vote on">
        {options.map((o, i) => {
          const chosen = mine === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => (i === index ? vote(o.id) : scrollTo(i))}
              aria-label={`${chosen ? "Your vote: " : "Vote for "}${o.label}`}
              aria-pressed={chosen}
              className={`relative shrink-0 snap-center overflow-hidden rounded-[32px] border bg-[#15131b] text-left transition duration-300 ${chosen ? "border-gold shadow-[0_0_40px_rgba(242,184,75,.35)]" : "border-white/15"} ${i === index ? "" : "scale-[.94] opacity-70"}`}
            >
              {/* Exact look ratio, so the AI-preview stamp at the bottom is never cropped or covered. */}
              <span className="relative block aspect-[9/16] h-[min(50vh,470px)] max-w-[72vw]">
                <img src={o.image} alt={`${o.label} look, AI preview`} className="h-full w-full object-cover" loading={i < 2 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} decoding="async" />
                {burst === o.id && <span className="pointer-events-none absolute inset-0 grid place-items-center text-8xl animate-rise drop-shadow-[0_0_30px_rgba(242,184,75,.9)]" aria-hidden>💛</span>}
                {chosen && <span className="absolute right-3 top-3 rounded-full bg-gold px-3 py-1 text-xs font-black text-ink">{t("circle.yourVote")} ✓</span>}
              </span>
              <span className="block px-4 pb-3.5 pt-2.5">
                <span className="flex items-end justify-between gap-2">
                  <span className="truncate font-display text-lg font-black">{o.label}</span>
                  {mine && <span className="font-display text-xl font-black tabular-nums">{o.pct}%</span>}
                </span>
                <span className="mt-2 block h-2 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full rounded-full bg-gradient-to-r from-gold to-terra transition-[width] duration-700 ease-out" style={{ width: mine ? `${Math.max(o.pct, 3)}%` : "0%" }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
        {options.map((o, i) => <span key={o.id} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-gold" : "w-1.5 bg-white/30"}`} />)}
      </div>

      <div className="mt-4 px-5">
        <ErrorNote error={error} />
        {!poll ? (
          <div className="skeleton h-12 rounded-2xl" />
        ) : !mine ? (
          <>
            <Button className="w-full" disabled={busy} onClick={() => vote(current.id)}>{t("circle.voteFor")} {current.label}</Button>
            <p className="mt-2 text-center text-xs text-mut">{t("circle.hint")}</p>
          </>
        ) : (
          <div className="flex gap-2">
            <Button className="flex-1" variant="glass" onClick={() => setNote(true)}>💬 {poll.myVote?.comment ? "Edit your comment" : t("circle.addComment")}</Button>
            {current.id !== mine && <Button variant="glass" disabled={busy} onClick={() => vote(current.id)}>Switch to {current.label}</Button>}
          </div>
        )}
      </div>

      {poll && poll.comments.length > 0 && (
        <section className="mt-6 space-y-2.5 px-5" aria-label="Comments" aria-live="polite">
          {poll.comments.map((c) => <Bubble key={c.id} c={c} />)}
        </section>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-[480px] px-4 pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="glass flex items-center justify-between gap-2 rounded-full px-4 py-2.5 text-xs text-txt/85">
          <span>🔗 Private live poll · AI-preview watermark</span>
          <Link href="/" className="shrink-0 font-semibold text-gold">Nyambika →</Link>
        </div>
      </footer>

      <CommentSheet
        open={note}
        onClose={() => setNote(false)}
        initial={poll?.myVote ?? null}
        onSend={async (x) => {
          if (mine && (await vote(mine, x))) setNote(false);
        }}
        busy={busy}
      />
    </main>
  );
}

function CommentSheet({ open, onClose, initial, onSend, busy }: { open: boolean; onClose: () => void; initial: PublicPoll["myVote"]; onSend: (x: { name?: string; comment?: string; emoji?: string }) => void; busy: boolean }) {
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [emoji, setEmoji] = useState<string | undefined>();
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setComment(initial?.comment ?? "");
    setEmoji(initial?.emoji ?? undefined);
  }, [open, initial]);
  return (
    <Sheet open={open} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSend({ name: name.trim() || undefined, comment: comment.trim() || undefined, emoji });
        }}
      >
        <h2 className="font-display text-xl font-black">Say something nice</h2>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-mut">Reaction</legend>
          <div className="flex flex-wrap gap-2">
            {REACTIONS.map((r) => (
              <button key={r} type="button" aria-pressed={emoji === r} aria-label={`React ${r}`} onClick={() => setEmoji(emoji === r ? undefined : r)} className={`grid size-11 place-items-center rounded-full text-xl transition ${emoji === r ? "scale-110 bg-gold/30 ring-2 ring-gold" : "bg-white/10"}`}>{r}</button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-mut">Your name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Grace" className="glass mt-1.5 h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widest text-mut">Comment (optional)</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={140} placeholder="Indigo! So elegant" className="glass mt-1.5 h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" />
        </label>
        <Button className="w-full" disabled={busy || (!comment.trim() && !name.trim() && !emoji)}>Send</Button>
      </form>
    </Sheet>
  );
}
