/**
 * Daily limits reset at midnight in Kigali (Africa/Kigali, UTC+2, no daylight saving), not at the server's
 * local midnight: a container running in UTC would otherwise reset the look cap at 02:00 Kigali time.
 */
const KIGALI_OFFSET_MS = 2 * 3600_000;
const DAY_MS = 86400_000;

/** Start of the current Kigali calendar day, as a UTC instant. */
export function kigaliDayStart(now = new Date()): Date {
  const local = now.getTime() + KIGALI_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - KIGALI_OFFSET_MS);
}

/** Next Kigali midnight (when daily caps reset), as a UTC instant. */
export function nextKigaliMidnight(now = new Date()): Date {
  return new Date(kigaliDayStart(now).getTime() + DAY_MS);
}

/** Body of the 429 the shopper sees at the daily look cap (plan §4.4). The web maps `code` to a calm card. */
export function dailyCapBody(cap: number, used: number, now = new Date()) {
  const resetsAt = nextKigaliMidnight(now);
  return {
    message: `Daily look limit reached (${cap}). New looks unlock tomorrow; saved looks stay free to view.`,
    code: "DAILY_CAP" as const,
    cap,
    used,
    resetsAt: resetsAt.toISOString(),
    retryAfterSec: Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 1000)),
  };
}
