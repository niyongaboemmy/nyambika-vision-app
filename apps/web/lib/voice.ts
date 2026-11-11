"use client";

import type { Locale } from "@nyambika/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

/** Voice Muse GA (E22): hold-to-speak capture with a live input level, and spoken replies. */

export const MAX_RECORD_MS = 30_000;
export const SPEECH_LANG: Record<Locale, string> = { rw: "rw-RW", en: "en-US", fr: "fr-FR" };
const BARS = 28;

export interface SttResult {
  text: string;
  language: Locale;
  confidence: number;
  duration_s: number | null;
  no_speech: boolean;
  provider: string;
  simulated: boolean;
}

export const canRecord = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

/**
 * MediaRecorder + AnalyserNode. `levels` is a rolling window of input levels (0..1) for the waveform.
 * The recording only ever lives in memory: it is handed to `onDone` and then dropped.
 */
export function useRecorder(onDone: (audio: Blob, durationMs: number) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const peak = useRef(0);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const cleanup = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (limit.current) clearTimeout(limit.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close().catch(() => {});
    stream.current = null;
    ctx.current = null;
    rec.current = null;
    setRecording(false);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (rec.current) return;
    cancelled.current = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (cancelled.current) {
        s.getTracks().forEach((t) => t.stop());
        return onError("Hold the button while you speak.");
      }
      stream.current = s;
      const mime = pickMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const ms = performance.now() - started.current;
        const blob = new Blob(chunks, { type: r.mimeType || mime || "audio/webm" });
        chunks.length = 0;
        const heard = peak.current;
        cleanup();
        if (cancelled.current) return;
        if (ms < 400) return onError("Hold the button while you speak.");
        if (heard < 0.02) return onError("I couldn't hear anything. Check your microphone, or type instead.");
        doneRef.current(blob, Math.min(ms, MAX_RECORD_MS));
      };
      // Live level for the orb waveform.
      const ac = new AudioContext();
      ctx.current = ac;
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      ac.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      peak.current = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        peak.current = Math.max(peak.current, level);
        setLevels((prev) => [...prev.slice(1), level]);
        setElapsed(performance.now() - started.current);
        raf.current = requestAnimationFrame(tick);
      };
      started.current = performance.now();
      r.start(250);
      rec.current = r;
      setRecording(true);
      setElapsed(0);
      raf.current = requestAnimationFrame(tick);
      limit.current = setTimeout(() => r.state === "recording" && r.stop(), MAX_RECORD_MS);
      navigator.vibrate?.(12);
    } catch (e) {
      cleanup();
      const name = (e as Error).name;
      onError(name === "NotAllowedError" ? "Microphone is blocked. Allow it in your browser, or type instead." : "No microphone found. Type instead.");
    }
  }, [cleanup, onError]);

  const stop = useCallback(() => {
    if (!rec.current) {
      cancelled.current = true; // released before the mic opened
      return;
    }
    if (rec.current.state === "recording") rec.current.stop();
    navigator.vibrate?.(8);
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (rec.current?.state === "recording") rec.current.stop();
    else cleanup();
  }, [cleanup]);

  return { recording, levels, elapsed, start, stop, cancel };
}

// ── Spoken replies (speechSynthesis) ──────────────────────────────────────────────────────────────

export interface VoicePrefs {
  muted: boolean;
  voice: Partial<Record<Locale, string>>; // voiceURI per language
}

const PREFS_KEY = "nya_voice";

export function loadPrefs(): VoicePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (v && typeof v.muted === "boolean") return { muted: v.muted, voice: v.voice ?? {} };
  } catch {
    /* private mode */
  }
  return { muted: false, voice: {} };
}

export function savePrefs(p: VoicePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Voices whose language matches the locale (rw voices are rare; callers show text-only then). */
// macOS ships novelty/effect voices; they make a poor stylist.
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy|Grandma|Grandpa|Rocko|Shelley|Sandy|Flo|Reed|Eddy)\b/;
const MAX_VOICES = 8;

export function voicesFor(locale: Locale): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  const prefix = SPEECH_LANG[locale].slice(0, 2);
  const seen = new Set<string>();
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(prefix) && !NOVELTY.test(v.name))
    .filter((v) => {
      const k = voiceLabel(v);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_VOICES);
}

/** "Samantha · US", "Google français · FR" */
export function voiceLabel(v: SpeechSynthesisVoice) {
  const name = v.name.replace(/^(Microsoft) /, "").replace(/\s*\(.*\)\s*$/, "").replace(/ - .*$/, "");
  const region = v.lang.split(/[-_]/)[1]?.toUpperCase();
  return `${name}${region ? ` · ${region}` : ""}${v.localService ? "" : " ☁"}`;
}

/** Same default everywhere: the browser default for the language, else the first on-device voice. */
export function defaultVoice(voices: SpeechSynthesisVoice[]) {
  return voices.find((v) => v.default) ?? voices.find((v) => v.localService) ?? voices[0];
}

export function useVoices(locale: Locale) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!canSpeak()) return;
    const load = () => setVoices(voicesFor(locale));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, [locale]);
  return voices;
}

/** Speak the Muse's short answer. Returns false when there is no voice for this language. */
export function speak(text: string, locale: Locale, prefs: VoicePrefs, onEnd?: () => void): boolean {
  if (!canSpeak() || prefs.muted || !text) return false;
  const voices = voicesFor(locale);
  const chosen = voices.find((v) => v.voiceURI === prefs.voice[locale]) ?? defaultVoice(voices);
  if (!chosen) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = chosen;
  u.lang = chosen.lang;
  u.rate = 1.02;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
  return true;
}

export const stopSpeaking = () => canSpeak() && speechSynthesis.cancel();
