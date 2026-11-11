"use client";

import { REACTIONS, type PresenceMember } from "@nyambika/contracts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui";
import type { PresenceLayer } from "@/components/presence-layer";
import type { ShowroomEngine } from "@/components/vr-engine";
import { api } from "@/lib/api";
import { CLOSE_TEXT, PresenceClient, type PresenceEvent } from "@/lib/presence";
import { prefersReducedMotion } from "@/lib/xr";
import { Icon } from "@/components/icons";

type Phase = "idle" | "joining" | "in" | "closed";
const WHY = [
  { id: "harassment", label: "Harassment or following me" },
  { id: "inappropriate", label: "Inappropriate behaviour" },
  { id: "spam", label: "Spamming reactions" },
  { id: "impersonation", label: "Pretending to be the maker" },
  { id: "minor", label: "Seems to be under 18" },
  { id: "other", label: "Something else" },
] as const;

/**
 * R4 spike (flag `vr.multiuser_spike`): join the showroom as a shared room. Synthetic avatars with made-up
 * names, emoji reactions only (no voice, no chat), personal-space bubble, hide + report anyone, host mute /
 * remove / start runway. Renders nothing while the flag is off.
 */
export function SharedRoom({ engine, room, signedIn, signInHref, seated, show }: { engine: ShowroomEngine | null; room: string; signedIn: boolean; signInHref: string; seated: boolean; show?: { id: string; title: string; href: string } | null }) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [intro, setIntro] = useState(false);
  const [people, setPeople] = useState(false);
  const [adult, setAdult] = useState(false);
  const [you, setYou] = useState<PresenceMember | null>(null);
  const [members, setMembers] = useState<Map<string, PresenceMember>>(new Map());
  const [count, setCount] = useState(0);
  const [captions, setCaptions] = useState<{ id: number; text: string }[]>([]);
  const [cc, setCc] = useState(true);
  const [bubble, setBubble] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [reporting, setReporting] = useState<PresenceMember | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [runway, setRunway] = useState<{ by: string; show?: string } | null>(null);
  const client = useRef<PresenceClient | null>(null);
  const layer = useRef<PresenceLayer | null>(null);
  const nicks = useRef(new Map<string, string>());
  const capId = useRef(0);

  useEffect(() => {
    void api<Record<string, boolean>>("/flags")
      .then((f) => setEnabled(Boolean(f["vr.multiuser_spike"])))
      .catch(() => setEnabled(false));
  }, []);

  const caption = useCallback((text: string) => {
    const id = ++capId.current;
    setCaptions((c) => [...c.slice(-2), { id, text }]);
    setTimeout(() => setCaptions((c) => c.filter((x) => x.id !== id)), 6000);
  }, []);

  const onEvent = useCallback(
    (e: PresenceEvent) => {
      const L = layer.current;
      switch (e.kind) {
        case "welcome": {
          setYou(e.you);
          const m = new Map(e.roster.map((r) => [r.sid, r]));
          e.roster.forEach((r) => nicks.current.set(r.sid, r.nick));
          setMembers(m);
          setCount(m.size);
          e.roster.forEach((r) => L?.upsert(r));
          setPhase("in");
          caption(`You joined as ${e.you.nick}${e.you.seat === "spectator" ? " (watching: the room is at its avatar limit)" : ""}`);
          return;
        }
        case "join":
          nicks.current.set(e.m.sid, e.m.nick);
          setMembers((p) => new Map(p).set(e.m.sid, e.m));
          L?.upsert(e.m);
          caption(`${e.m.nick} joined`);
          return;
        case "leave":
          setMembers((p) => {
            const n = new Map(p);
            n.delete(e.sid);
            return n;
          });
          L?.remove(e.sid);
          return;
        case "poses":
          setCount(e.n);
          L?.poses(e.p);
          return;
        case "react":
          L?.react(e.sid, e.e);
          if (cc) caption(`${nicks.current.get(e.sid) ?? "Someone"} reacted ${e.e}`);
          return;
        case "mute":
          setMembers((p) => {
            const cur = p.get(e.sid);
            if (!cur) return p;
            const next = { ...cur, muted: e.muted };
            L?.upsert(next);
            return new Map(p).set(e.sid, next);
          });
          if (e.sid === client.current?.sid) setYou((y) => (y ? { ...y, muted: e.muted } : y));
          if (e.sid === client.current?.sid) caption(e.muted ? "The host paused your reactions" : "Your reactions are back on");
          return;
        case "runway":
          setRunway({ by: e.by, show: e.show });
          caption(`${e.by} started the runway`);
          navigator.vibrate?.([12, 40, 12]);
          return;
        case "reported":
          setNote("Thanks · a moderator will look · you can also hide them");
          return;
        case "error":
          setNote(e.msg);
          return;
        case "closed":
          setPhase("closed");
          setNote(CLOSE_TEXT[e.code] ?? (e.code === 1000 ? null : "The shared room disconnected. Join again in a moment."));
          for (const sid of nicks.current.keys()) L?.remove(sid);
          setMembers(new Map());
          setYou(null);
          return;
      }
    },
    [caption, cc],
  );
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(
    () => () => {
      client.current?.leave();
      layer.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    if (layer.current) layer.current.bubble = bubble;
  }, [bubble]);

  async function join() {
    if (!engine) return;
    setNote(null);
    setPhase("joining");
    try {
      if (!layer.current) {
        const { PresenceLayer } = await import("@/components/presence-layer");
        const font = getComputedStyle(document.body).getPropertyValue("--font-display").trim() || "system-ui, sans-serif";
        layer.current = new PresenceLayer(engine, { font, reducedMotion: prefersReducedMotion(), selfSid: () => client.current?.sid ?? null });
        if (process.env.NODE_ENV !== "production") (window as unknown as { __presence?: PresenceLayer }).__presence = layer.current; // crawl hook
      }
      client.current?.leave();
      client.current = new PresenceClient(room, () => engine.viewerPose(), (e) => onEventRef.current(e));
      await client.current.join(seated);
      setIntro(false);
    } catch (e) {
      setPhase("idle");
      setNote((e as Error).message);
    }
  }

  function leave() {
    client.current?.leave();
    client.current = null;
    for (const sid of nicks.current.keys()) layer.current?.remove(sid);
    setPhase("idle");
    setPeople(false);
    setMembers(new Map());
    setYou(null);
  }

  function react(e: string) {
    client.current?.send({ t: "r", e: e as (typeof REACTIONS)[number] });
    if (you) layer.current?.react(you.sid, e);
    navigator.vibrate?.(10);
  }

  function toggleHide(sid: string) {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      layer.current?.setHidden(sid, n.has(sid));
      return n;
    });
  }

  if (!enabled || !engine) return null;
  const host = you?.role === "host";
  const list = [...members.values()].sort((a, b) => (a.role === "host" ? -1 : 0) - (b.role === "host" ? -1 : 0) || a.nick.localeCompare(b.nick));

  return (
    <>
      {/* Entry / live count */}
      <div className="absolute right-3 top-[84px] z-20 flex flex-col items-end gap-2">
        {phase === "in" ? (
          <button onClick={() => setPeople(true)} className="glass flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold" aria-label={`${count} people in this shared room. Open the people list`}>
            <span className="size-2 rounded-full bg-mint shadow-[0_0_8px_#2dd4bf]" aria-hidden /> <Icon name="users" className="size-4" /> {count} here
          </button>
        ) : (
          <button onClick={() => setIntro(true)} disabled={phase === "joining"} className="glass flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold disabled:opacity-60">
            <Icon name="users" className="size-4" /> {phase === "joining" ? "Joining…" : "Shared room"} <span className="rounded-full bg-violet/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-txt/90">test</span>
          </button>
        )}
        {phase === "in" && you?.seat === "avatar" && (
          <div role="group" aria-label="Send a reaction" className="glass flex flex-col gap-1 rounded-full p-1">
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => react(e)} disabled={you.muted} aria-label={`React ${e}`} className="grid size-11 place-items-center rounded-full text-xl transition active:scale-75 disabled:opacity-40">
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Captions (FR-VR-07 style): joins, reactions, host actions */}
      {phase === "in" && cc && captions.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-[84px] z-20 max-w-[calc(100%-150px)] space-y-1" aria-live="polite">
          {captions.map((c) => (
            <p key={c.id} className="w-fit animate-rise rounded-2xl bg-black/65 px-3 py-1.5 text-xs font-semibold text-white">
              {c.text}
            </p>
          ))}
        </div>
      )}
      {runway && (
        <div className="absolute inset-x-3 top-[140px] z-20 mx-auto max-w-[420px] animate-rise" role="status">
          <div className="glass flex items-center gap-3 rounded-3xl p-3">
            <span className="text-2xl" aria-hidden>
              <Icon name="dress" className="size-6 text-gold" />
            </span>
            <p className="min-w-0 flex-1 text-sm font-bold">The runway is starting</p>
            {show && (
              <Link href={show.href} className="grad-cta rounded-2xl px-4 py-2 text-sm font-bold">
                Watch
              </Link>
            )}
            <button onClick={() => setRunway(null)} aria-label="Dismiss" className="grid size-9 place-items-center rounded-full bg-white/10">
              ✕
            </button>
          </div>
        </div>
      )}
      {note && phase !== "in" && !intro && (
        <p role="alert" className="absolute inset-x-3 top-[140px] z-20 mx-auto max-w-[420px] rounded-2xl bg-black/75 p-3 text-center text-sm">
          {note}{" "}
          <button className="ml-1 font-bold text-gold underline" onClick={() => setNote(null)}>
            OK
          </button>
        </p>
      )}

      {/* Intro + consent */}
      <Sheet open={intro} onClose={() => setIntro(false)}>
        <h2 className="font-display text-2xl font-black">Shared room</h2>
        <p className="mt-1 inline-block rounded-full bg-violet/25 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">Experimental test</p>
        <ul className="mt-3 space-y-2 text-sm text-txt/90">
          <li>Synthetic avatar, made-up name · nothing personal shown</li>
          <li>No voice, no chat · reactions only</li>
          <li>Personal-space bubble · hide or report anyone</li>
          <li>★ Hosted by the maker</li>
        </ul>
        {signedIn ? (
          <>
            <label className="mt-4 flex min-h-12 items-center gap-3 rounded-2xl bg-white/5 px-4 text-sm font-semibold">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="size-5 accent-[#e5395f]" />
              I&apos;m 18 or older
            </label>
            {note && <p className="mt-2 text-sm text-terra" role="alert">{note}</p>}
            <button onClick={() => void join()} disabled={!adult || phase === "joining"} className="grad-cta mt-4 min-h-12 w-full rounded-2xl font-bold disabled:opacity-50">
              {phase === "joining" ? "Joining…" : "Join the shared room"}
            </button>
          </>
        ) : (
          <Link href={signInHref} className="grad-cta mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl font-bold">
            Sign in to join
          </Link>
        )}
      </Sheet>

      {/* People, safety and host controls */}
      <Sheet open={people} onClose={() => (setPeople(false), setReporting(null))}>
        {reporting ? (
          <fieldset>
            <legend className="font-display text-xl font-black">Report {reporting.nick}</legend>
            <p className="mt-1 text-xs text-mut">Sent to moderators · anonymous</p>
            <div className="mt-3 grid gap-2">
              {WHY.map((w) => (
                <button
                  key={w.id}
                  onClick={() => {
                    client.current?.send({ t: "rep", sid: reporting.sid, why: w.id });
                    setReporting(null);
                  }}
                  className="min-h-12 rounded-2xl bg-white/8 px-4 text-left text-sm font-semibold ring-1 ring-inset ring-white/10"
                >
                  {w.label}
                </button>
              ))}
              <button onClick={() => setReporting(null)} className="min-h-11 text-sm text-mut underline">
                Cancel
              </button>
            </div>
          </fieldset>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 font-display text-xl font-black">In this room · {count}</h2>
              <button onClick={leave} className="min-h-10 rounded-full bg-white/10 px-4 text-sm font-bold">
                Leave
              </button>
            </div>
            {you && <p className="mt-1 text-xs text-mut">You are {you.nick}{you.seat === "spectator" ? " (watching)" : ""}.</p>}
            {note && <p className="mt-2 rounded-2xl bg-white/5 p-2 text-xs" role="status">{note}</p>}
            {host && show && (
              <button onClick={() => client.current?.send({ t: "h", a: "runway", show: show.id })} className="grad-cta mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-bold">
                <Icon name="play" className="mr-1 inline size-4 align-[-3px]" filled />Start the runway · {show.title}
              </button>
            )}
            <ul className="mt-3 max-h-[42dvh] space-y-2 overflow-y-auto" aria-label="People">
              {list.map((m) => {
                const self = m.sid === you?.sid;
                return (
                  <li key={m.sid} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/5 p-2">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-black text-ink" style={{ background: ["#e5395f", "#f0b429", "#2dd4bf", "#8b5cf6", "#38bdf8", "#f97316", "#a3e635", "#f472b6"][m.hue % 8] }} aria-hidden>
                      {m.nick[0]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {m.role === "host" && "★ "}
                        {m.nick}
                        {self && " (you)"}
                      </span>
                      <span className="block text-[11px] text-mut">
                        {m.role === "host" ? "Host" : m.seat === "spectator" ? "Watching" : "Guest"}
                        {m.muted && " · reactions paused"}
                        {hidden.has(m.sid) && " · hidden for you"}
                      </span>
                    </span>
                    {!self && (
                      <span className={`flex shrink-0 gap-1 ${host ? "w-full justify-end" : ""}`}>
                        {m.seat === "avatar" && you?.seat === "avatar" && (
                          <button
                            onClick={() => {
                              const n = layer.current?.near(m.sid);
                              if (n) engine.moveTo(n.x, n.z, n.yaw);
                              else setNote(`${m.nick} isn't close enough to see yet`);
                              setPeople(false);
                            }}
                            className="min-h-10 rounded-full bg-white/10 px-3 text-xs font-semibold"
                            aria-label={`Go near ${m.nick}`}
                          >
                            Go near
                          </button>
                        )}
                        <button onClick={() => toggleHide(m.sid)} className="min-h-10 rounded-full bg-white/10 px-3 text-xs font-semibold" aria-label={`${hidden.has(m.sid) ? "Show" : "Hide"} ${m.nick}`}>
                          {hidden.has(m.sid) ? "Show" : "Hide"}
                        </button>
                        <button onClick={() => setReporting(m)} className="min-h-10 rounded-full bg-white/10 px-3 text-xs font-semibold" aria-label={`Report ${m.nick}`}>
                          Report
                        </button>
                        {host && m.role !== "host" && (
                          <>
                            <button onClick={() => client.current?.send({ t: "h", a: m.muted ? "unmute" : "mute", sid: m.sid })} className="min-h-10 rounded-full bg-white/10 px-3 text-xs font-semibold" aria-label={`${m.muted ? "Unmute" : "Mute"} ${m.nick}`}>
                              {m.muted ? "Unmute" : "Mute"}
                            </button>
                            <button onClick={() => client.current?.send({ t: "h", a: "kick", sid: m.sid })} className="min-h-10 rounded-full bg-terra/25 px-3 text-xs font-bold text-white" aria-label={`Remove ${m.nick}`}>
                              Remove
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <fieldset className="mt-3 flex flex-wrap gap-2">
              <legend className="sr-only">Comfort</legend>
              <button aria-pressed={bubble} onClick={() => setBubble(!bubble)} className={`min-h-10 rounded-full px-3 text-xs font-bold ${bubble ? "bg-gold text-ink" : "bg-white/10"}`}>
                Personal space
              </button>
              <button aria-pressed={cc} onClick={() => setCc(!cc)} className={`min-h-10 rounded-full px-3 text-xs font-bold ${cc ? "bg-gold text-ink" : "bg-white/10"}`}>
                CC Captions
              </button>
            </fieldset>
            <p className="mt-3 text-[11px] text-mut">Experimental shared room · synthetic avatars · no voice or chat</p>
          </>
        )}
      </Sheet>
    </>
  );
}
