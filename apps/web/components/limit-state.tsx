"use client";

/**
 * Designed limit / expected-error states (error sweep). One component for every place an API call can fail:
 * daily look cap → calm card with a live countdown to Kigali midnight; kill switch → "Looks are resting" + retry;
 * consent → inline "Turn on"; rate limits → countdown; offline → auto-retry when back online; closed pilot → join.
 * Unexpected errors keep the familiar red note. Tone: shopper side "dark" (aurora glass), studio "light".
 * Visually minimal on purpose (existing glass / grad-cta / studio tokens) so restyling stays a separate concern.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { api } from "@/lib/api";
import { describeError, formatCountdown, recallFriendly, type Described } from "@/lib/api-errors";
import { useSession } from "@/lib/session";

type Tone = "dark" | "light";

function isDescribed(x: unknown): x is Described {
  return Boolean(x && typeof x === "object" && "kind" in x && "expected" in x && "title" in x);
}

/** Accepts an ApiError / Error, an already-described error, or a message string from older call sites. */
export function toDescribed(error: unknown, locale?: Parameters<typeof describeError>[1]): Described | null {
  if (error == null || error === "" || error === false) return null;
  if (isDescribed(error)) return error;
  if (typeof error === "string") {
    return recallFriendly(error) ?? { kind: "error", expected: false, status: 0, code: null, title: error, body: "", resetsAt: null, retryAfterSec: null, purpose: null, scope: null, raw: error };
  }
  return describeError(error, locale);
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, until - now) : null;
}

const ICON: Partial<Record<Described["kind"], IconName>> = {
  "daily-cap": "sunrise",
  resting: "moon",
  consent: "lock",
  rate: "hourglass",
  pilot: "ticket",
  gate: "shield",
  payment: "phone",
  offline: "signal",
  auth: "user",
};

export function LimitState({
  error,
  tone = "dark",
  onRetry,
  onDismiss,
  className = "",
}: {
  error: unknown;
  tone?: Tone;
  /** Re-run what failed (after a countdown, consent, coming back online, kill switch lifted). */
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  const { t, locale } = useSession();
  const d = toDescribed(error, locale);
  const [granting, setGranting] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const until = !d
    ? null
    : d.resetsAt
      ? Date.parse(d.resetsAt)
      : d.kind === "rate" && d.retryAfterSec
        ? mountedAt + d.retryAfterSec * 1000
        : null;
  const left = useCountdown(d?.expected ? until : null);

  // Offline: retry by itself once the connection is back.
  useEffect(() => {
    if (d?.kind !== "offline" || !onRetry) return;
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [d?.kind, onRetry]);

  if (!d) return null;

  const dark = tone === "dark";
  if (!d.expected) {
    return (
      <div role="alert" className={`${dark ? "rounded-xl bg-red-500/15 text-red-100" : "rounded-2xl bg-red-50 text-red-800"} px-3 py-2 text-sm ${className}`}>
        <p>
          <span className="font-semibold">{d.title}</span>
          {d.body && <> {d.body}</>}
        </p>
        {(onRetry || onDismiss) && (
          <div className="mt-2 flex gap-3 text-sm font-semibold underline-offset-2">
            {onRetry && <button type="button" onClick={onRetry} className="underline">{t("err.retry")}</button>}
            {onDismiss && <button type="button" onClick={onDismiss} className="underline">{t("err.dismiss")}</button>}
          </div>
        )}
      </div>
    );
  }

  const card = dark ? "glass rounded-3xl text-white" : "rounded-[22px] bg-amber-50/80 text-cocoa";
  const sub = dark ? "text-mut" : "text-cocoa-2";
  const primary = dark ? "grad-cta text-white" : "bg-terra text-white";
  const secondary = dark ? "glass text-white" : "bg-white text-cocoa shadow-e1";
  const btn = "inline-flex min-h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition active:scale-[.98] disabled:opacity-50";

  async function grant() {
    if (!d?.purpose) return;
    setGranting(true);
    try {
      if (d.purpose === "AVATAR_3D") await api("/twin3d/consent", { method: "POST", json: { granted: true, locale } });
      else await api("/privacy/consents", { method: "POST", json: { purpose: d.purpose, granted: true } });
      onRetry?.();
    } catch {
      /* the card stays; the Trust centre link still works */
    } finally {
      setGranting(false);
    }
  }

  const next = typeof window === "undefined" ? "/" : window.location.pathname;
  const retryable = ["resting", "offline", "payment", "rate"].includes(d.kind) || (d.kind === "daily-cap" && left === 0);

  return (
    <section role="status" aria-live="polite" data-limit={d.kind} className={`${card} p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full ${dark ? "bg-white/10" : "bg-white"}`}><Icon name={ICON[d.kind] ?? "info"} className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-black leading-snug">{d.title}</h2>
          {d.body && <p className={`mt-1 text-sm leading-relaxed ${sub}`}>{d.body}</p>}
          {left != null && left > 0 && (
            <p className="mt-2 text-sm">
              {d.kind === "daily-cap" ? t("err.cap.resetsIn") : t("err.rate.in")}{" "}
              <time dateTime={new Date(until!).toISOString()} className="font-mono font-semibold tabular-nums">{formatCountdown(left)}</time>
            </p>
          )}
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label={t("err.dismiss")} className={`hit -m-1 grid size-8 shrink-0 place-items-center rounded-full ${sub}`}><Icon name="x" className="size-4" /></button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {d.kind === "daily-cap" && (
          <>
            <Link href="/saved" className={`${btn} ${primary}`}>{t("err.cap.saved")}</Link>
            <Link href="/wardrobe" className={`${btn} ${secondary}`}>{t("err.cap.wardrobe")}</Link>
            <Link href="/makers" className={`${btn} ${secondary}`}>{t("err.cap.makers")}</Link>
          </>
        )}
        {d.kind === "consent" && (
          <>
            {d.purpose && <button type="button" onClick={() => void grant()} disabled={granting} className={`${btn} ${primary}`}>{t("err.consent.enable")}</button>}
            <Link href="/trust" className={`${btn} ${secondary}`}>{t("err.consent.manage")}</Link>
          </>
        )}
        {d.kind === "pilot" && <Link href="/join" className={`${btn} ${primary}`}>{t("err.pilot.join")}</Link>}
        {d.kind === "auth" && <Link href={`/signin?next=${encodeURIComponent(next)}`} className={`${btn} ${primary}`}>{t("err.auth.signin")}</Link>}
        {retryable && (onRetry || d.kind === "resting") && (
          <button
            type="button"
            disabled={d.kind === "rate" && left != null && left > 0}
            onClick={() => (onRetry ? onRetry() : window.location.reload())}
            className={`${btn} ${d.kind === "daily-cap" ? primary : secondary}`}
          >
            {t("err.retry")}
          </button>
        )}
      </div>
    </section>
  );
}

/** For old string-based call sites: is this message a designed limit (render it calmly)? */
export function isExpectedText(text: string | null | undefined) {
  return Boolean(recallFriendly(text)?.expected);
}
