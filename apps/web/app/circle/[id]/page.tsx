"use client";

import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Bubble } from "@/components/circle-bits";
import { HoldToBuy } from "@/components/hold-to-buy";
import { Button, ErrorNote, Fact, Screen, Sheet, TopBar } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { timeLeft, type OwnerPoll, type Snapshot } from "@/lib/social";
import { useApi } from "@/lib/use-api";
import { useLive } from "@/lib/use-live";
import { Icon } from "@/components/icons";

/** Owner view of a circle poll: live votes and comments, share, take down, hold to buy the winner. */
export default function PollOwner() {
  const { id } = useParams<{ id: string }>();
  const { data: poll, error, setData } = useApi<OwnerPoll>(`/circle/polls/${id}`);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(false);

  const onSnap = useCallback(
    (s: Snapshot) => {
      setData((p) => {
        if (!p) return p;
        if (s.total > p.total) {
          setFlash(true);
          navigator.vibrate?.(10);
          setTimeout(() => setFlash(false), 900);
        }
        const options = p.options.map((o) => ({ ...o, ...s.options.find((x) => x.id === o.id) }));
        const top = [...options].sort((a, b) => b.votes - a.votes);
        const winner = s.total && top[0].votes > (top[1]?.votes ?? -1) ? top[0].lookId : null;
        return { ...p, state: s.state, total: s.total, comments: s.comments, options, winner };
      });
    },
    [setData],
  );
  const mode = useLive<Snapshot>(poll?.state === "OPEN" ? `/api/circle/polls/${id}/stream` : null, `/api/circle/polls/${id}`, onSnap, Boolean(poll));

  async function revoke() {
    setBusy(true);
    try {
      setData(await api<OwnerPoll>(`/circle/polls/${id}/revoke`, { method: "POST" }));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Screen><TopBar back="/circle" /><div className="p-5"><ErrorNote error={error} /></div></Screen>;
  if (!poll) {
    return (
      <Screen>
        <TopBar back="/circle" />
        <div className="space-y-4 p-5">
          <div className="skeleton mx-auto h-8 w-3/4 rounded-xl" />
          <div className="flex gap-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-64 flex-1 rounded-3xl" />)}</div>
        </div>
      </Screen>
    );
  }

  const open = poll.state === "OPEN";
  const winner = poll.options.find((o) => o.lookId === poll.winner);
  const lead = Math.max(...poll.options.map((o) => o.votes));
  const shareText = `${poll.question} Vote for my outfit: ${poll.shareUrl}`;

  return (
    <Screen className="pb-10">
      <TopBar
        back="/circle"
        right={open ? <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"><span className={`size-2 rounded-full ${mode === "live" ? "animate-pulse bg-mint" : "bg-gold"}`} />{mode === "live" ? "Live" : mode === "polling" ? "Refreshing" : "…"}</span> : null}
      />
      <header className="px-5 text-center">
        <h1 className="font-display text-[30px] font-black leading-tight">Ask your circle</h1>
        <p className="mt-1 text-[17px] text-txt/90">“{poll.question}”</p>
        <p className="mt-1 text-xs text-mut">{poll.total} vote{poll.total === 1 ? "" : "s"} · {open ? timeLeft(poll.expiresAt) : poll.state === "REVOKED" ? "taken down" : "closed"}</p>
      </header>

      <section className={`mt-5 grid gap-3 px-4 ${poll.options.length === 4 ? "grid-cols-4" : poll.options.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} aria-label="Results" aria-live="polite">
        {poll.options.map((o) => {
          const leading = poll.total > 0 && o.votes === lead;
          return (
            <div key={o.id} className="text-center">
              <div className={`relative aspect-[9/16] overflow-hidden rounded-[22px] border bg-white/[.06] transition duration-500 ${leading ? "border-gold/80 shadow-[0_0_30px_rgba(242,184,75,.3)]" : "border-white/15"} ${flash && leading ? "scale-[1.03]" : ""}`}>
                {o.image ? <img loading="lazy" decoding="async" src={o.image} alt={`${o.label} look`} className="h-full w-full object-cover" /> : <div className="skeleton h-full" />}
                {leading && <span role="img" aria-label="Leading" className="spring-pop absolute left-1/2 top-2 grid size-8 -translate-x-1/2 place-items-center rounded-full bg-black/55 text-gold backdrop-blur"><Icon name="crown" filled className="size-4" /></span>}
              </div>
              <p className="mt-2 truncate text-sm font-bold">{o.label}</p>
              <div className="mx-auto mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-gold to-terra transition-[width] duration-700 ease-out" style={{ width: `${o.pct}%` }} />
              </div>
              <p className="mt-1 font-display text-lg font-black tabular-nums">{o.pct}%</p>
            </div>
          );
        })}
      </section>

      {winner?.look && (
        <section className="mx-4 mt-5 animate-rise rounded-3xl border border-gold/40 bg-gradient-to-br from-gold/15 to-terra/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-gold">Your circle picked</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-display text-xl font-black">{winner.look.product.title}</p>
              <p className="truncate text-sm text-txt/80">{winner.look.variant.colourName} · {winner.look.maker.name} · {rwf(winner.look.product.priceRwf)}</p>
            </div>
            <HoldToBuy look={winner.look} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-mut"><Icon name="hand" className="size-3.5" /> Hold to buy · paid directly to the maker</p>
        </section>
      )}

      {poll.comments.length > 0 ? (
        <section className="mt-6 space-y-2.5 px-4" aria-label="Comments">
          {poll.comments.map((c) => <Bubble key={c.id} c={c} />)}
        </section>
      ) : (
        open && <p className="mt-8 px-8 text-center text-sm text-mut">No votes yet · share the link</p>
      )}

      {open ? (
        <div className="mt-8 space-y-2 px-4">
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center rounded-2xl bg-[#25D366] font-bold text-[#062b14]">Share on WhatsApp</a>
          <div className="flex gap-2">
            <Button variant="glass" className="flex-1" onClick={async () => { await navigator.clipboard?.writeText(poll.shareUrl).catch(() => {}); setCopied(true); }}>{copied ? "Copied ✓" : "Copy link"}</Button>
            <Button variant="glass" className="flex-1" onClick={() => setConfirm(true)}>Take down</Button>
          </div>
          <ul aria-label="How this poll is shared" className="flex flex-wrap justify-center gap-2 pt-1">
            <li><Fact icon="lock">Private link</Fact></li>
            <li><Fact icon="sparkle">AI label</Fact></li>
            <li><Fact icon="shield">Never shared with makers</Fact></li>
          </ul>
        </div>
      ) : (
        <p className="mt-8 px-6 text-center text-sm text-mut">The shared copies are deleted · only you see results</p>
      )}

      <Sheet open={confirm} onClose={() => setConfirm(false)}>
        <h2 className="font-display text-xl font-black">Take this poll down?</h2>
        <p className="mt-1 text-sm text-txt/80">Link off · previews deleted · you keep the results</p>
        <div className="mt-4 flex gap-2">
          <Button variant="glass" className="flex-1" onClick={() => setConfirm(false)}>Keep it</Button>
          <Button variant="danger" className="flex-1" disabled={busy} onClick={revoke}>Take down</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
