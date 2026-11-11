/**
 * One place that turns API / network failures into words a shopper or maker can act on (error sweep).
 *
 * Expected limits (daily look cap, kill switch, consent, rate limits, closed pilot, NLB gate, offline) are product
 * rules, not errors: they render as calm cards (components/limit-state.tsx), never as raw server text in red.
 * Unexpected failures (5xx, validation) get a short human message; plain 4xx text written by the API for people
 * (e.g. "This item isn't available") is kept as is.
 */
import { LOCALES, translate, type Locale, type MessageKey } from "@nyambika/i18n";

export type ErrorKind =
  | "daily-cap" // DAILY_CAP (looks, or 3D twin builds with scope AVATAR_3D)
  | "resting" // KILL_SWITCH: AI spend paused
  | "consent" // VOICE_CONSENT, CONSENT_REQUIRED, CONSENT_WITHDRAWN, NO_CONSENT
  | "rate" // other 429s: circle votes, voice, presence joins, OTP, video/motion allowances
  | "pilot" // PILOT_ONLY
  | "gate" // NLB_GATE (studio/admin)
  | "payment" // payment declined / timed out
  | "offline" // fetch never reached the server
  | "auth" // 401 after the silent refresh
  | "server" // 5xx or a non-JSON gateway page
  | "validation" // 400 "Validation failed" with field issues
  | "error"; // any other 4xx: keep the API's human message

/** Kinds that are designed states (calm card, no red). */
export const EXPECTED_KINDS: ReadonlySet<ErrorKind> = new Set(["daily-cap", "resting", "consent", "rate", "pilot", "gate", "payment", "offline", "auth"]);

export interface ErrorLike {
  status?: number;
  message?: string;
  body?: unknown;
  retryAfterSec?: number | null;
  name?: string;
}

export interface Described {
  kind: ErrorKind;
  expected: boolean;
  status: number;
  code: string | null;
  title: string;
  body: string;
  /** ISO instant the limit lifts (DAILY_CAP: next Kigali midnight). */
  resetsAt: string | null;
  retryAfterSec: number | null;
  /** Consent purpose the inline "Turn on" action grants. */
  purpose: string | null;
  scope: string | null;
  /** The server's own words, for logs and tests (never shown for expected kinds). */
  raw: string;
}

const CONSENT_CODES = new Set(["VOICE_CONSENT", "CONSENT_REQUIRED", "CONSENT_WITHDRAWN", "NO_CONSENT"]);
const CONSENT_PURPOSE_BY_CODE: Record<string, string> = { VOICE_CONSENT: "VOICE_PROCESSING", CONSENT_WITHDRAWN: "TRYON_GENERATION" };
const CONSENT_COPY: Record<string, MessageKey> = {
  VOICE_PROCESSING: "err.consent.voice" as MessageKey,
  TRYON_GENERATION: "err.consent.tryon" as MessageKey,
  TWIN_PROCESSING: "err.consent.tryon" as MessageKey,
  AVATAR_3D: "err.consent.avatar" as MessageKey,
};

/** Locale for messages built outside React (the session provider mirrors it on <html lang>). */
export function currentLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const l = document.documentElement.lang as Locale;
  return LOCALES.includes(l) ? l : "en";
}

const tr = (locale: Locale, key: string) => translate(locale, key as MessageKey);

function field<T>(body: unknown, k: string): T | null {
  return body && typeof body === "object" && k in body ? ((body as Record<string, unknown>)[k] as T) : null;
}

function rawMessage(e: ErrorLike): string {
  const m = field<unknown>(e.body, "message") ?? e.message ?? "";
  return Array.isArray(m) ? m.join(", ") : String(m);
}

/** True when the browser could not reach the API at all (DNS, offline, CORS, aborted connection). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (!(e instanceof Error)) return false;
  if ((e as ErrorLike).status === 0) return true;
  return e.name === "TypeError" && /fetch|network|load failed|connection/i.test(e.message);
}

/** Classify any thrown value. Pure: safe to unit-test without a DOM. */
export function describeError(e: unknown, locale: Locale = currentLocale()): Described {
  const err = (e && typeof e === "object" ? e : { message: String(e ?? "") }) as ErrorLike;
  const status = typeof err.status === "number" ? err.status : 0;
  const body = err.body;
  const code = field<string>(body, "code");
  const raw = rawMessage(err);
  const base = {
    status,
    code,
    raw,
    resetsAt: field<string>(body, "resetsAt"),
    retryAfterSec: field<number>(body, "retryAfterSec") ?? err.retryAfterSec ?? null,
    purpose: field<string>(body, "purpose"),
    scope: field<string>(body, "scope"),
  };
  const make = (kind: ErrorKind, title: string, text: string, extra: Partial<Described> = {}): Described => ({
    ...base,
    kind,
    expected: EXPECTED_KINDS.has(kind),
    title,
    body: text,
    ...extra,
  });

  if (status === 0 && isNetworkError(e)) return make("offline", tr(locale, "err.offline.title"), tr(locale, "err.offline.body"));

  if (code === "DAILY_CAP") {
    const is3d = base.scope === "AVATAR_3D" || /3D twin/i.test(raw);
    return make(
      "daily-cap",
      tr(locale, is3d ? "err.cap3d.title" : "err.cap.title"),
      tr(locale, is3d ? "err.cap3d.body" : "err.cap.body"),
      { resetsAt: base.resetsAt ?? nextKigaliMidnight().toISOString(), scope: is3d ? "AVATAR_3D" : "LOOKS" },
    );
  }
  if (code === "KILL_SWITCH") return make("resting", tr(locale, "err.resting.title"), tr(locale, "err.resting.body"));
  if (code && CONSENT_CODES.has(code)) {
    const purpose = base.purpose ?? CONSENT_PURPOSE_BY_CODE[code] ?? null;
    const copy = purpose ? CONSENT_COPY[purpose] : undefined;
    // Without a known purpose the API's sentence is the most specific guidance we have.
    return make("consent", tr(locale, "err.consent.title"), copy ? tr(locale, copy) : raw || tr(locale, "err.consent.generic"), { purpose });
  }
  if (code === "PILOT_ONLY") return make("pilot", tr(locale, "err.pilot.title"), tr(locale, "err.pilot.body"));
  if (code === "NLB_GATE") return make("gate", tr(locale, "err.gate.title"), raw || tr(locale, "err.gate.body"));
  if (code === "PAYMENT_FAILED" || code === "PAYMENT_TIMEOUT" || code === "PAYMENT_DECLINED")
    return make("payment", tr(locale, "err.payment.title"), tr(locale, "err.payment.body"));
  if (status === 429) {
    const otp = /code/i.test(raw) && /request/i.test(raw);
    // Allowance codes carry a specific, human reason (e.g. today's video allowance): keep it.
    const specific = code && ["VIDEO_NOT_ALLOWED", "MOTION_NOT_ALLOWED", "QUOTA_EXCEEDED", "SANDBOX_DAILY_CAP"].includes(code) && raw;
    return make("rate", tr(locale, "err.rate.title"), specific || tr(locale, otp ? "err.otp.body" : "err.rate.body"));
  }
  if (status === 401) return make("auth", tr(locale, "err.auth.title"), "");
  if (status === 503 || status === 502 || status === 504 || status >= 500 || (status >= 400 && typeof body === "string" && /<html|<!doctype/i.test(body)))
    return make("server", tr(locale, "err.server.title"), tr(locale, "err.server.body"));
  if (status === 400 && raw === "Validation failed") {
    const issues = field<{ path: string; message: string }[]>(body, "issues") ?? [];
    const fields = [...new Set(issues.map((i) => i.path.split(".").pop() || i.path).filter(Boolean))].join(", ");
    return make("validation", tr(locale, "err.check"), fields || raw);
  }
  // Non-API exceptions (JSON.parse, programming errors) must not leak stack-ish text to people.
  const programming = e instanceof Error && ["TypeError", "SyntaxError", "RangeError", "ReferenceError"].includes(e.name);
  if (!status && (!(e instanceof Error) || !raw || programming)) return make("server", tr(locale, "err.server.title"), tr(locale, "err.server.body"));
  return make("error", raw || tr(locale, "err.server.title"), "");
}

/** One line for inline notes and toasts: what most call sites used to get from `error.message`. */
export function errorText(e: unknown, locale: Locale = currentLocale()): string {
  const d = describeError(e, locale);
  if (d.kind === "error") return d.title;
  return d.body ? `${d.title} ${d.body}`.trim() : d.title;
}

// ── friendly-text registry ─────────────────────────────────────────────────────
// Older call sites keep `setError(e.message)` (a string). The API client registers the friendly text it puts on
// ApiError.message, so <ErrorNote> can recognise an expected limit from the string alone and render it calmly.
const registry = new Map<string, Described>();
export function rememberFriendly(text: string, d: Described) {
  if (registry.size > 50) registry.delete(registry.keys().next().value as string);
  registry.set(text, d);
}
export function recallFriendly(text: string | null | undefined): Described | null {
  return text ? (registry.get(text) ?? null) : null;
}

// ── time helpers (Kigali, UTC+2, no DST) ───────────────────────────────────────
export function nextKigaliMidnight(now = new Date()): Date {
  const off = 2 * 3600_000;
  const day = 86400_000;
  return new Date(Math.floor((now.getTime() + off) / day) * day - off + day);
}

/** "3:05:09" / "4:09" countdown, language-neutral digits. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
