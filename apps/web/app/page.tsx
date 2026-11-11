"use client";

import type { Intent } from "@nyambika/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MenuSheet } from "@/components/menu";
import { WardrobeAmbient } from "@/components/wardrobe-ambient";
import { Button, Chip, ErrorNote, Screen, Sheet, Spinner } from "@/components/ui";
import { api, rwf } from "@/lib/api";
import { useSession } from "@/lib/session";

type Phase = "idle" | "listening" | "typing" | "thinking" | "understood" | "snapping";

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SPEECH_LANG = { rw: "rw-RW", en: "en-US", fr: "fr-FR" } as const;
const OCCASIONS = ["wedding", "office", "church", "party", "graduation", "casual", "traditional-ceremony"];

function dayLabel(iso: string | null) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** The Muse (prototype v2 · 03/04): no feed, no search box. Voice, text or camera → intent → looks on you. */
export default function Muse() {
  const { me, loading, t, locale } = useSession();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [session, setSession] = useState<{ sessionId: string; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<null | "occasion" | "budget">(null);
  const [touched, setTouched] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const heard = useRef("");

  useEffect(() => {
    api<Record<string, boolean>>("/flags").then((f) => setVoiceOn(Boolean(f["muse.voice_beta"]))).catch(() => {});
  }, []);

  // Auto-continue to the looks unless the shopper is editing chips.
  useEffect(() => {
    if (phase !== "understood" || !session || touched) return;
    const id = setTimeout(() => router.push(`/looks/${session.sessionId}`), 2200);
    return () => clearTimeout(id);
  }, [phase, session, touched, router]);

  async function ask(input: string, source: "text" | "voice") {
    if (!input.trim()) return;
    setTranscript(input);
    setError(null);
    setPhase("thinking");
    setTouched(false);
    setSession(null);
    try {
      const parsed = await api<Intent>("/intent/parse", { method: "POST", json: { text: input, source, locale } });
      setIntent(parsed);
      setPhase("understood");
      if (!me) return;
      setSession(await api("/intent", { method: "POST", json: { text: input, source, locale } }));
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  }

  async function refine(next: Intent) {
    setIntent(next);
    setEdit(null);
    setSession(null);
    try {
      setSession(await api("/intent/refine", { method: "POST", json: { intent: next } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function snap(file: File) {
    if (!me) return router.push("/signin?next=/");
    setPhase("snapping");
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api<{ sessionId: string; makers: number }>("/intent/snap", { method: "POST", body: fd });
      router.push(`/looks/${r.sessionId}?snap=${r.makers}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  }

  function startVoice() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (!Ctor) {
      setError("Voice isn't available in this browser yet. Type what you need instead.");
      setPhase("typing");
      return;
    }
    const r = new Ctor();
    r.lang = SPEECH_LANG[locale];
    r.interimResults = true;
    r.continuous = true;
    heard.current = "";
    r.onresult = (e) => {
      heard.current = Array.from(e.results).map((x) => x[0].transcript).join(" ");
      setTranscript(heard.current);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(`Voice error: ${e.error}. You can type instead.`);
    };
    r.onend = () => {
      if (heard.current.trim()) void ask(heard.current, "voice");
      else setPhase("idle");
    };
    rec.current = r;
    setTranscript("");
    setPhase("listening");
    r.start();
  }

  const stopVoice = () => rec.current?.stop();

  const chips = intent ? buildChips(intent, me?.twinSize ?? null) : [];
  const name = me?.name ?? "";

  return (
    <Screen className="flex flex-col">
      <header className="relative z-20 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),14px)]">
        <span className="flex items-center gap-2">
          <span className="orb size-7 rounded-full shadow-[0_0_18px_rgba(242,184,75,.5)]" />
          <span className="font-display text-lg font-black">Nyambika</span>
        </span>
        {loading ? null : me ? (
          <button onClick={() => setMenu(true)} aria-label="Menu" className="glass grid size-10 place-items-center rounded-full text-lg">☰</button>
        ) : (
          <Link href="/signin" className="glass rounded-full px-4 py-2 text-sm font-semibold">Sign in</Link>
        )}
      </header>

      <main className="flex flex-1 flex-col items-center px-5 text-center">
        <p className="mt-6 text-txt/80">{t("home.greeting")}{name ? ` ${name}` : ""} 👋</p>
        <h1 className="font-display text-[34px] font-black leading-tight text-grad">{t("muse.question")}</h1>

        {me && !me.hasTwin && (
          <Link href="/mirror" className="glass mt-3 rounded-2xl px-4 py-2 text-sm">🪞 Create your private twin to see looks on <b>you</b> →</Link>
        )}
        {me && phase === "idle" && <WardrobeAmbient />}

        <div className="relative my-6 grid size-56 place-items-center">
          {phase === "listening" && (
            <>
              <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-gold/60" />
              <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-violet/60 [animation-delay:.6s]" />
            </>
          )}
          <span className={`orb absolute inset-4 rounded-full shadow-[0_0_80px_rgba(139,92,246,.5)] ${phase === "thinking" || phase === "listening" || phase === "snapping" ? "animate-orb" : "animate-[orb-spin_24s_linear_infinite]"}`} />
          <span className="absolute inset-[72px] rounded-full bg-[conic-gradient(from_90deg,#fff8,#8b5cf6aa,#38bdf8aa,#f2b84baa,#fff8)] blur-[2px]" />
          {phase === "snapping" && <Spinner className="relative" />}
        </div>

        {phase === "listening" && <Wave />}

        {transcript && <p className="mt-2 max-w-sm text-lg font-semibold leading-snug">“{transcript}”</p>}

        {phase === "thinking" && <p className="mt-3 flex items-center gap-2 text-sm text-mut"><Spinner className="size-4" /> …</p>}

        {phase === "understood" && intent && (
          <div className="mt-4 w-full animate-rise">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-gold">{t("muse.understood")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {chips.map((c) => (
                <Chip key={c.key} onClick={c.edit ? () => { setTouched(true); setEdit(c.edit!); } : undefined}>{c.label}</Chip>
              ))}
            </div>
            {me ? (
              <div className="mt-4">
                {session ? (
                  <Button className="w-full" onClick={() => router.push(`/looks/${session.sessionId}`)}>✨ {t("muse.showLooks")} ({session.total})</Button>
                ) : (
                  <p className="text-sm font-semibold text-gold">✨ {me.hasTwin ? t("muse.rendering") : t("muse.renderingModel")}</p>
                )}
              </div>
            ) : (
              <Link href="/signin?next=/" className="mt-4 block"><Button className="w-full">Sign in to see these looks on you</Button></Link>
            )}
          </div>
        )}

        {phase === "typing" && (
          <form
            className="mt-2 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text, "text");
            }}
          >
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("muse.type")}
              aria-label={t("muse.type")}
              className="glass h-14 w-full rounded-2xl px-4 text-base outline-none placeholder:text-white/40"
            />
            <button type="button" onClick={() => setText(t("muse.example"))} className="mt-2 text-sm text-mut underline">e.g. “{t("muse.example")}”</button>
          </form>
        )}

        <div className="mt-3 w-full"><ErrorNote error={error} /></div>
      </main>

      <footer className="sticky bottom-0 z-20 px-6 pb-[max(env(safe-area-inset-bottom),18px)] pt-3">
        <div className="flex items-center justify-center gap-7">
          <label className="glass grid size-16 cursor-pointer place-items-center rounded-full text-2xl" aria-label={t("muse.snap")}>
            📷
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && snap(e.target.files[0])} />
          </label>
          <button
            aria-label={voiceOn ? `${t("muse.hold")} (${t("muse.voiceBeta")})` : t("muse.type")}
            onPointerDown={(e) => {
              if (!voiceOn) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              startVoice();
            }}
            onPointerUp={voiceOn ? stopVoice : undefined}
            onClick={voiceOn ? undefined : () => setPhase("typing")}
            className={`grad-cta grid size-24 place-items-center rounded-full text-4xl shadow-[0_0_40px_rgba(224,112,63,.45)] transition ${phase === "listening" ? "scale-110" : ""}`}
          >
            🎙️
          </button>
          <button aria-label={t("muse.type")} title={t("muse.type")} onClick={() => setPhase("typing")} className="glass grid size-16 place-items-center rounded-full text-2xl"><span aria-hidden>⌨️</span></button>
        </div>
        <p className="mt-2 text-center text-xs text-mut">{voiceOn ? `${t("muse.hold")} · beta` : t("muse.type")}</p>
      </footer>

      <MenuSheet open={menu} onClose={() => setMenu(false)} />

      <Sheet open={edit !== null} onClose={() => setEdit(null)}>
        {edit === "occasion" && intent && (
          <div className="space-y-3">
            <p className="font-display text-lg font-black">Occasion</p>
            <div className="flex flex-wrap gap-2">
              {OCCASIONS.map((o) => <Chip key={o} active={intent.occasion === o} onClick={() => refine({ ...intent, occasion: o })}>{o.replace("-", " ")}</Chip>)}
            </div>
          </div>
        )}
        {edit === "budget" && intent && <BudgetEdit value={intent.budgetMax} onDone={(b) => refine({ ...intent, budgetMax: b })} />}
      </Sheet>
    </Screen>
  );
}

function BudgetEdit({ value, onDone }: { value: number | null; onDone: (b: number | null) => void }) {
  const [v, setV] = useState(String(value ?? ""));
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onDone(v ? Number(v) : null); }}>
      <p className="font-display text-lg font-black">Budget (RWF)</p>
      <input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} className="glass h-14 w-full rounded-2xl px-4 text-lg outline-none" />
      <div className="flex gap-2">{[20000, 50000, 80000].map((b) => <Chip key={b} onClick={() => onDone(b)}>≤ {rwf(b)}</Chip>)}</div>
      <Button className="w-full">Update</Button>
    </form>
  );
}

function buildChips(i: Intent, twinSize: string | null) {
  const chips: { key: string; label: string; edit?: "occasion" | "budget" }[] = [];
  chips.push({ key: "o", label: i.occasion ? `💍 ${cap(i.occasion.replace("-", " "))}${i.date ? ` · ${dayLabel(i.date)}` : ""}` : "💍 Any occasion", edit: "occasion" });
  chips.push({ key: "b", label: i.budgetMax ? `💰 Under ${rwf(i.budgetMax)}` : "💰 Any budget", edit: "budget" });
  const style = [...i.categories, ...i.colours, ...i.styles];
  if (style.length) chips.push({ key: "s", label: `🎨 ${style.map(cap).join(" · ")}` });
  const size = i.size ?? twinSize;
  chips.push({ key: "z", label: size ? `📏 Your twin · size ${size}` : "📏 Size from your twin" });
  chips.push({ key: "l", label: `📍 ${i.location ?? "Kigali"} makers` });
  return chips;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Wave() {
  return (
    <div className="flex h-6 items-end gap-1" aria-hidden>
      {Array.from({ length: 22 }).map((_, i) => (
        <span key={i} className="w-1.5 animate-pulse rounded-full bg-gradient-to-t from-violet to-gold" style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 7) * 0.1}s` }} />
      ))}
    </div>
  );
}
