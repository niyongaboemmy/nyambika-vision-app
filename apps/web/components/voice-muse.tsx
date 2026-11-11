"use client";

import type { Locale } from "@nyambika/i18n";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Chip, Sheet } from "@/components/ui";
import { useSession } from "@/lib/session";
import { canSpeak, defaultVoice, speak, useVoices, voiceLabel, type SttResult, type VoicePrefs } from "@/lib/voice";

/** Voice Muse GA (E22) pieces: living orb, consent, transcript review and spoken-reply settings. */

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * The orb. While listening, 28 radial bars follow the microphone level and the core swells with
 * the voice. Reduced motion: no spin or swell, a flat level meter carries the same information.
 */
export function VoiceOrb({ phase, levels, speaking }: { phase: string; levels: number[]; speaking: boolean }) {
  const reduced = useReducedMotion();
  const listening = phase === "listening";
  const busy = phase === "thinking" || phase === "transcribing" || phase === "snapping";
  const level = listening ? levels.slice(-4).reduce((a, b) => a + b, 0) / 4 : 0;
  return (
    <div className="relative my-6 grid size-56 place-items-center" aria-hidden>
      {listening && !reduced && (
        <svg viewBox="0 0 224 224" className="absolute inset-0 size-full">
          <defs>
            <linearGradient id="vbar" x1="0" x2="0" y1="1" y2="0">
              <stop offset="0" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#f2b84b" />
            </linearGradient>
          </defs>
          {levels.map((l, i) => {
            const a = (i / levels.length) * Math.PI * 2;
            const inner = 86;
            const len = 6 + l * 22;
            return (
              <line
                key={i}
                x1={112 + Math.sin(a) * inner}
                y1={112 - Math.cos(a) * inner}
                x2={112 + Math.sin(a) * (inner + len)}
                y2={112 - Math.cos(a) * (inner + len)}
                stroke="url(#vbar)"
                strokeWidth="4"
                strokeLinecap="round"
                opacity={0.45 + l * 0.55}
              />
            );
          })}
        </svg>
      )}
      {speaking && !reduced && <span className="absolute inset-3 animate-pulse-ring rounded-full border-2 border-mint/50" />}
      {/* Idle glow as a radial gradient (a box-shadow on an animated layer rasterises with square edges). */}
      <span className="absolute -inset-2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,.42),rgba(139,92,246,.12)_70%,transparent)]" />
      <span
        className="absolute inset-8 rounded-full"
        style={listening && !reduced ? { transform: `scale(${1 + level * 0.16})`, transition: "transform 90ms cubic-bezier(.2,.8,.2,1)", boxShadow: `0 0 ${60 + level * 90}px rgba(242,184,75,${0.35 + level * 0.4})` } : undefined}
      >
        <span className={`orb absolute inset-0 rounded-full ${reduced ? "" : busy || listening ? "animate-orb" : "animate-[orb-spin_24s_linear_infinite]"}`} />
      </span>
      <span className="absolute inset-[76px] rounded-full bg-[conic-gradient(from_90deg,#fff8,#8b5cf6aa,#38bdf8aa,#f2b84baa,#fff8)] blur-[2px]" />
      {listening && reduced && (
        <span className="absolute -bottom-2 left-1/2 flex h-3 w-40 -translate-x-1/2 overflow-hidden rounded-full bg-white/15">
          <span className="h-full bg-gradient-to-r from-violet to-gold" style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

export function RecordingTimer({ elapsed }: { elapsed: number }) {
  const s = Math.floor(elapsed / 1000);
  return (
    <p className="mt-1 font-mono text-xs text-mut" role="timer" aria-live="off">
      ● {s}s / 30s
    </p>
  );
}

export function VoiceConsentSheet({ open, onAllow, onType, onClose }: { open: boolean; onAllow: () => void; onType: () => void; onClose: () => void }) {
  const { t } = useSession();
  return (
    <Sheet open={open} onClose={onClose}>
      <p className="font-display text-xl font-black">🎙️ {t("voice.consentTitle")}</p>
      <p className="mt-2 text-sm text-txt/90">{t("voice.consentBody")}</p>
      <ul className="mt-3 space-y-1 text-sm text-mut">
        <li>• {t("voice.notStored")}</li>
        <li>• {t("voice.editFirst")}</li>
      </ul>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="glass" onClick={onType}>⌨️ {t("voice.typeInstead")}</Button>
        <Button onClick={onAllow}>{t("voice.allow")}</Button>
      </div>
      <Link href="/trust" className="mt-3 block text-center text-xs text-mut underline">{t("trust.title")}</Link>
    </Sheet>
  );
}

/** Editable transcript before it goes to the Muse (FR-AST-04: speak, then confirm). */
export function TranscriptReview({ stt, value, onChange, onSend, onRetry }: { stt: SttResult | null; value: string; onChange: (v: string) => void; onSend: () => void; onRetry: () => void }) {
  const { t } = useSession();
  const pct = stt ? Math.round(stt.confidence * 100) : null;
  return (
    <form className="mt-2 w-full animate-rise" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-[.2em] text-gold">{t("voice.heard")}</span>
        {pct !== null && <span className={`rounded-full px-2 py-0.5 font-semibold ${pct >= 75 ? "bg-mint/20 text-mint" : "bg-gold/20 text-gold"}`}>{pct}% {t("voice.sure")}</span>}
        {stt?.simulated && <span className="rounded-full bg-white/10 px-2 py-0.5 text-mut" title="Development speech adapter: words are scripted, not recognised">dev transcript</span>}
      </div>
      <label htmlFor="transcript" className="sr-only">{t("voice.editLabel")}</label>
      <textarea
        id="transcript"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={500}
        className="glass w-full resize-none rounded-2xl px-4 py-3 text-center text-lg font-semibold leading-snug outline-none"
      />
      <p className="mt-1 text-xs text-mut">{t("voice.editHint")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" variant="glass" onClick={onRetry}>🎙️ {t("voice.again")}</Button>
        <Button disabled={!value.trim()}>✨ {t("voice.send")}</Button>
      </div>
    </form>
  );
}

const LANG_NAME: Record<Locale, string> = { rw: "Kinyarwanda", en: "English", fr: "Français" };

export function VoiceSettingsSheet({ open, onClose, prefs, setPrefs }: { open: boolean; onClose: () => void; prefs: VoicePrefs; setPrefs: (p: VoicePrefs) => void }) {
  const { t, locale } = useSession();
  const voices = useVoices(locale);
  const current = prefs.voice[locale];
  return (
    <Sheet open={open} onClose={onClose}>
      <p className="font-display text-xl font-black">🔊 {t("voice.replies")}</p>
      <label className="mt-3 flex items-center gap-3">
        <span className="flex-1">
          <span className="block text-sm font-semibold">{t("voice.speakReplies")}</span>
          <span className="block text-xs text-mut">{t("voice.speakRepliesBody")}</span>
        </span>
        <input type="checkbox" role="switch" className="peer sr-only" checked={!prefs.muted} onChange={(e) => setPrefs({ ...prefs, muted: !e.target.checked })} />
        <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-gold ${!prefs.muted ? "bg-mint" : "bg-white/20"}`}>
          <span className={`absolute top-0.5 size-6 rounded-full bg-white transition-all ${!prefs.muted ? "left-[22px]" : "left-0.5"}`} />
        </span>
      </label>
      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-widest text-mut">{t("voice.voiceFor")} {LANG_NAME[locale]}</legend>
        {!canSpeak() || voices.length === 0 ? (
          <p className="text-sm text-mut">{t("voice.noVoice")}</p>
        ) : (
          <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
            {voices.map((v) => (
              <Chip key={v.voiceURI} active={(voices.find((x) => x.voiceURI === current) ?? defaultVoice(voices)) === v} onClick={() => setPrefs({ ...prefs, voice: { ...prefs.voice, [locale]: v.voiceURI } })}>
                {voiceLabel(v)}
              </Chip>
            ))}
          </div>
        )}
      </fieldset>
      <Button variant="glass" className="mt-4 w-full" disabled={prefs.muted || voices.length === 0} onClick={() => speak(t("voice.sample"), locale, prefs)}>▶ {t("voice.play")}</Button>
    </Sheet>
  );
}
