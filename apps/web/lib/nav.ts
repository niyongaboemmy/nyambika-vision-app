"use client";

/*
 * "Come back where you were" for detours (twin, sign-in, consent…). A detour link carries `?next=<path>`;
 * the detour reads it and returns there when done. Only same-site paths are accepted, so a crafted link can't
 * bounce the shopper to another origin.
 */

/** A safe in-app path, or null (rejects absolute URLs, protocol-relative `//host` and backslash tricks). */
export function safeReturn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  return raw;
}

/** The current page as a return target (path + query), read at click time so it is always up to date. */
export function hereNow(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

/** `href` with `?next=` pointing back at `back` (defaults to the current page). */
export function withReturn(href: string, back: string = hereNow()): string {
  const target = safeReturn(back);
  if (!target || target === href) return href;
  return `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(target)}`;
}

/** The `next` this page was opened with (client only), or null. */
export function returnTarget(): string | null {
  if (typeof window === "undefined") return null;
  return safeReturn(new URLSearchParams(window.location.search).get("next"));
}
