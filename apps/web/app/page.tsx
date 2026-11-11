"use client";

import type { Intent } from "@nyambika/contracts";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RecordingTimer, TranscriptReview, VoiceConsentSheet, VoiceOrb, VoiceSettingsSheet } from "@/components/voice-muse";
import { Icon } from "@/components/studio";
import { Button, Chip, ErrorNote, Screen, Sheet, Spinner } from "@/components/ui";
import { api, ApiError, rwf } from "@/lib/api";
import { describeError } from "@/lib/api-errors";
import { museReply } from "@/lib/muse-reply";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { canRecord, loadPrefs, savePrefs, speak, SPEECH_LANG, stopSpeaking, useRecorder, type SttResult, type VoicePrefs } from "@/lib/voice";

// Below-the-fold / on-demand pieces load after first paint (perf budget, docs/design/ui-audit.md).
const MenuSheet = dynamic(() => import("@/components/menu").then((m) => m.MenuSheet), { ssr: false });
const TwinNudge = dynamic(() => import("@/components/twin-nudge").then((m) => m.TwinNudge), { ssr: false });
const WardrobeAmbient = dynamic(() => import("@/components/wardrobe-ambient").then((m) => m.WardrobeAmbient), { ssr: false });

type Phase = "idle" | "listening" | "transcribing" | "review" | "typing" | "thinking" | "understood" | "snapping";

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

const OCCASIONS = ["wedding", "office", "church", "party", "graduation", "casual", "traditional-ceremony"];

function dayLabel(iso: string | null) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The Muse (prototype v2 · 03/04): no feed, no search box. Voice, text or camera → intent → looks on you.
 * Voice GA (E22): hold-to-speak → server STT → editable transcript → intent → short spoken reply.
 * Fallbacks: browser Web Speech (no MediaRecorder / signed out) → typing. Keyboard: hold Space/Enter on the mic.
 */
export default function Muse() {
  const { me, loading, t, locale } = useSession();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [session, setSession] = useState<{ sessionId: string; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null); // string, or the caught error (expected limits render as LimitState)
  const [voiceOn, setVoiceOn] = useState(false);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<null | "occasion" | "budget">(null);
  const [touched, setTouched] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const heard = useRef("");
  const [stt, setStt] = useState<SttResult | null>(null);
  const [voiceConsent, setVoiceConsent] = useState<boolean | null>(null);
  const [askConsent, setAskConsent] = useState(false);
  const [prefs, setPrefsState] = useState<VoicePrefs>({ muted: false, voice: {} });
  const [voiceSheet, setVoiceSheet] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [reply, setReply] = useState("");
  const holding = useRef(false);

  useEffect(() => setPrefsState(loadPrefs()), []);
  const setPrefs = (p: VoicePrefs) => {
    setPrefsState(p);
    savePrefs(p);
    if (p.muted) {
      stopSpeaking();
      setSpeaking(false);
    }
  };

  useEffect(() => {
    // GA flag `muse.voice` (default on); the pilot experiment can still hold a user out.
    api<Record<string, boolean>>("/flags").then((f) => setVoiceOn(Boolean(f["muse.voice"] ?? f["muse.voice_beta"]))).catch(() => {});
  }, [me?.id]);

  useEffect(() => {
    if (!me || !voiceOn) return;
    api<{ consents: { purpose: string; granted: boolean }[] }>("/privacy")
      .then((p) => setVoiceConsent(p.consents.some((c) => c.purpose === "VOICE_PROCESSING" && c.granted)))
      .catch(() => setVoiceConsent(null));
  }, [me, voiceOn]);

  useEffect(() => () => void stopSpeaking(), []);

  const onRecordError = useCallbackRef((msg: string) => {
    holding.current = false;
    setError(msg);
    setPhase("idle");
  });
  const recorder = useRecorder((audio, durationMs) => void transcribe(audio, durationMs), onRecordError);

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
    setReply("");
    track("muse_ask", { source, locale });
    try {
      const parsed = await api<Intent>("/intent/parse", { method: "POST", json: { text: input, source, locale } });
      track("intent_parsed", { source, parser: parsed.parser, hasOccasion: Boolean(parsed.occasion) });
      setIntent(parsed);
      setPhase("understood");
      const answer = museReply(parsed, locale, Boolean(me));
      setReply(answer);
      // Spoken reply for voice turns; muted or no voice for this language → the caption carries it.
      if (source === "voice" && speak(answer, locale, prefs, () => setSpeaking(false))) {
        setSpeaking(true);
        setTouched(true); // let the reply finish before auto-continuing
        setTimeout(() => setTouched(false), Math.min(6000, 900 + answer.length * 55));
      }
      if (!me) return;
      setSession(await api("/intent", { method: "POST", json: { text: input, source, locale } }));
    } catch (e) {
      setError(e);
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
      setError(e);
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
      setError(e);
      setPhase("idle");
    }
  }

  async function transcribe(audio: Blob, durationMs: number) {
    setPhase("transcribing");
    setError(null);
    const fd = new FormData();
    fd.append("audio", audio, "muse.webm");
    fd.append("language", locale);
    fd.append("durationMs", String(Math.round(durationMs)));
    try {
      const r = await api<SttResult>("/voice/stt", { method: "POST", body: fd });
      if (r.no_speech || !r.text.trim()) {
        setError(t("voice.noSpeech"));
        setPhase("idle");
        return;
      }
      setStt(r);
      setTranscript(r.text);
      setText(r.text);
      setPhase("review");
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setVoiceConsent(false);
        setAskConsent(true);
        setPhase("idle");
        return;
      }
      setError(describeError(e, locale).expected ? e : `${(e as Error).message} ${t("voice.typeFallback")}`);
      setText("");
      setPhase("typing");
    }
  }

  /** Hold starts here (pointer or keyboard). */
  function beginHold() {
    if (holding.current) return;
    if (!voiceOn) return setPhase("typing");
    stopSpeaking();
    setSpeaking(false);
    setError(null);
    if (me && canRecord()) {
      if (voiceConsent === false) return setAskConsent(true);
      holding.current = true;
      setTranscript("");
      setStt(null);
      setPhase("listening");
      void recorder.start();
      return;
    }
    holding.current = true;
    startVoice();
  }

  function endHold() {
    if (!holding.current) return;
    holding.current = false;
    if (me && canRecord()) recorder.stop();
    else stopVoice();
  }

  async function allowVoice() {
    setAskConsent(false);
    try {
      await api("/privacy/consents", { method: "POST", json: { purpose: "VOICE_PROCESSING", granted: true } });
      setVoiceConsent(true);
      setError(null);
      setPhase("idle");
      setReply(t("voice.ready"));
    } catch (e) {
      setError(e);
    }
  }

  function startVoice() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (!Ctor) {
      holding.current = false;
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
      if (heard.current.trim()) {
        setStt(null);
        setText(heard.current);
        setPhase("review");
      } else setPhase("idle");
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
          <span className="flex items-center gap-2">
            {voiceOn && (
              <button
                onClick={() => setPrefs({ ...prefs, muted: !prefs.muted })}
                aria-pressed={!prefs.muted}
                aria-label={t("voice.speakReplies")}
                title={prefs.muted ? t("voice.unmute") : t("voice.mute")}
                className="hit glass press grid size-10 place-items-center rounded-full"
              >
                <Icon name={prefs.muted ? "mute" : "volume"} className="size-5" />
              </button>
            )}
            <button onClick={() => setMenu(true)} onPointerEnter={() => void import("@/components/menu")} aria-label="Menu" className="hit glass press grid size-10 place-items-center rounded-full"><Icon name="menu" className="size-5" /></button>
          </span>
        ) : (
          <Link href="/signin" className="hit glass rounded-full px-4 py-2 text-sm font-semibold">Sign in</Link>
        )}
      </header>

      <main className="flex flex-1 flex-col items-center px-5 text-center">
        <p className="mt-6 text-txt/80">{t("home.greeting")}{name ? ` ${name}` : ""} 👋</p>
        <h1 className="font-display text-[34px] font-black leading-tight text-grad">{t("muse.question")}</h1>

        <TwinNudge place="home" />
        {me && phase === "idle" && <WardrobeAmbient />}

        <div className="relative">
          <VoiceOrb phase={phase} levels={recorder.levels} speaking={speaking} />
          {(phase === "snapping" || phase === "transcribing") && <Spinner className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />}
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {phase === "listening" ? t("voice.listening") : phase === "transcribing" ? t("voice.transcribing") : phase === "review" ? t("voice.heard") : ""}
        </p>
        {phase === "listening" && (recorder.recording ? <RecordingTimer elapsed={recorder.elapsed} /> : !(me && canRecord()) && <Wave />)}
        {phase === "listening" && <p className="mt-1 text-sm font-semibold text-gold">{t("voice.listening")}</p>}
        {phase === "transcribing" && <p className="mt-1 text-sm text-mut">{t("voice.transcribing")}</p>}

        {phase === "review" ? (
          <TranscriptReview stt={stt} value={text} onChange={setText} onSend={() => void ask(text, "voice")} onRetry={() => { setPhase("idle"); setTranscript(""); }} />
        ) : (
          transcript && phase !== "transcribing" && <p className="mt-2 max-w-sm text-lg font-semibold leading-snug">“{transcript}”</p>
        )}

        {phase === "thinking" && <p className="mt-3 flex items-center gap-2 text-sm text-mut"><Spinner className="size-4" /> …</p>}

        {phase === "understood" && intent && (
          <div className="mt-4 w-full animate-rise">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-gold">{t("muse.understood")}</p>
            {reply && <p className="mx-auto mb-3 max-w-sm text-sm text-txt/90" aria-live="polite">{speaking ? "🔊 " : ""}{reply}</p>}
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
            <button type="button" onClick={() => setText(t("muse.example"))} className="hit mt-2 text-sm text-mut underline">e.g. “{t("muse.example")}”</button>
          </form>
        )}

        <div className="mt-3 w-full"><ErrorNote error={error} onRetry={transcript ? () => void ask(transcript, "text") : undefined} /></div>
      </main>

      <footer className="sticky bottom-0 z-20 px-6 pb-[max(env(safe-area-inset-bottom),18px)] pt-3">
        <div className="flex items-center justify-center gap-7">
          <label className="glass press grid size-16 cursor-pointer place-items-center rounded-full" aria-label={t("muse.snap")}>
            <Icon name="camera" className="size-7" />
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && snap(e.target.files[0])} />
          </label>
          <button
            aria-label={voiceOn ? t("voice.holdLabel") : t("muse.type")}
            aria-pressed={voiceOn ? phase === "listening" : undefined}
            onPointerDown={(e) => {
              if (!voiceOn) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              beginHold();
            }}
            onPointerUp={voiceOn ? endHold : undefined}
            onPointerCancel={voiceOn ? endHold : undefined}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && voiceOn) {
                e.preventDefault();
                if (!e.repeat) beginHold();
              }
            }}
            onKeyUp={(e) => {
              if ((e.key === " " || e.key === "Enter") && voiceOn) {
                e.preventDefault();
                endHold();
              }
            }}
            onClick={voiceOn ? undefined : () => setPhase("typing")}
            onContextMenu={(e) => e.preventDefault()}
            className={`grad-cta grid size-24 touch-none select-none place-items-center rounded-full text-4xl shadow-[0_0_40px_rgba(224,112,63,.45)] transition ${phase === "listening" ? "scale-110" : ""}`}
          >
            <Icon name="mic" className="size-10 text-[#fff]" />
          </button>
          <button aria-label={t("muse.type")} title={t("muse.type")} onClick={() => setPhase("typing")} className="glass press grid size-16 place-items-center rounded-full"><Icon name="keyboard" className="size-7" /></button>
        </div>
        <p className="mt-1 flex min-h-11 items-center justify-center gap-1 text-center text-xs text-mut">
          {voiceOn ? t("muse.hold") : t("muse.type")}
          {voiceOn && me && <> · <button type="button" onClick={() => setVoiceSheet(true)} className="inline-flex min-h-11 items-center underline underline-offset-2">{t("voice.options")}</button></>}
        </p>
      </footer>

      {menu && <MenuSheet open={menu} onClose={() => setMenu(false)} />}
      <VoiceConsentSheet open={askConsent} onClose={() => setAskConsent(false)} onAllow={() => void allowVoice()} onType={() => { setAskConsent(false); setPhase("typing"); }} />
      <VoiceSettingsSheet open={voiceSheet} onClose={() => setVoiceSheet(false)} prefs={prefs} setPrefs={setPrefs} />

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

/** Stable callback identity that always calls the latest closure. */
function useCallbackRef<A extends unknown[]>(fn: (...a: A) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current(...a), []);
}

function Wave() {
  return (
    <div className="flex h-6 items-end gap-1" aria-hidden>
      {Array.from({ length: 22 }).map((_, i) => (
        <span key={i} className="w-1.5 animate-pulse rounded-full bg-gradient-to-t from-violet to-gold" style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 7) * 0.1}s` }} />
      ))}
    </div>
  );
}
