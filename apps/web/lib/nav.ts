"use client";

/*
 * "Come back where you were" for detours (twin, sign-in, consent…). A detour link carries `?next=<path>`;
 * the detour reads it and returns there when done. Only same-site paths are accepted, so a crafted link can't
 * bounce the shopper to another origin.
 *
 * Navigation & workflow pass: the pure parts of in-app history live here too (the trail of screens this tab
 * visited, a sensible parent for deep links, per-route keys), so they are unit-tested in lib/nav.test.ts. The
 * React side (back buttons, resume after sign-in, push/pop motion) is lib/use-nav.ts.
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

/** Path without query or hash. */
export const pathOf = (href: string) => href.split(/[?#]/)[0] || "/";

/** Max screens remembered per tab (enough for any detour chain). */
export const TRAIL_MAX = 30;

/**
 * The tab's trail after visiting `href`: going to the screen just behind us is a back step (pop), the same screen
 * with a new query replaces the top, anything else is a push. Lets a back button know whether the previous
 * history entry is ours (then `router.back()` keeps its state) or the shopper arrived by deep link.
 */
export function trailStep(trail: string[], href: string, popped = false): { trail: string[]; dir: "push" | "pop" | "replace" } {
  const top = trail[trail.length - 1];
  if (top === href) return { trail, dir: "replace" };
  // Browser back / swipe-back (popstate): drop the top; the entry behind it becomes `href` (its query may differ).
  if (popped) return { trail: trail.length >= 2 ? [...trail.slice(0, -2), href] : [href], dir: "pop" };
  if (trail.length >= 2 && trail[trail.length - 2] === href) return { trail: trail.slice(0, -1), dir: "pop" };
  if (top && pathOf(top) === pathOf(href)) return { trail: [...trail.slice(0, -1), href], dir: "replace" };
  return { trail: [...trail, href].slice(-TRAIL_MAX), dir: "push" };
}

/** The screen behind the current one in the trail, or null when the shopper arrived here directly. */
export function previousInTrail(trail: string[]): string | null {
  return trail.length >= 2 ? trail[trail.length - 2] : null;
}

/**
 * Where "Back" goes when there is no in-app history (deep link, new tab, reload after a restart): the nearest
 * sensible parent screen, never a dead end.
 */
export function parentOf(href: string): string {
  const p = pathOf(href).replace(/\/+$/, "") || "/";
  const seg = p.split("/").filter(Boolean);
  if (!seg.length) return "/";
  const [a, b, c, d] = seg;
  switch (a) {
    case "looks":
    case "signin":
    case "trust":
    case "bag":
    case "saved":
    case "makers":
    case "measurements":
    case "join":
    case "p":
      return "/";
    case "mirror":
      if (b === "ar") return "/mirror/3d";
      if (b === "mr") return "/mirror/ar";
      return b ? "/mirror" : "/";
    case "orders":
      return b ? "/orders" : "/";
    case "custom":
      return b ? "/custom" : "/";
    case "circle":
      return b ? "/circle" : "/wardrobe";
    case "wardrobe":
      return b ? "/wardrobe" : "/";
    case "m":
      return c ? `/m/${b}` : "/makers";
    case "studio":
      if (!b) return "/";
      if (c === "products" && d) return `/studio/${b}/products`;
      if (c === "tailor" && d) return `/studio/${b}/tailor`;
      if (c === "training") return `/studio/${b}/settings`;
      return c ? `/studio/${b}` : "/studio";
    case "admin":
      return b ? "/admin" : "/";
    default:
      return "/";
  }
}

/** sessionStorage key for state remembered on one route (look index, selected piece, open tab, scroll). */
export function routeKey(path: string, name: string): string {
  return `nv-route:${pathOf(path)}:${name}`;
}

/** The return button's words for a target ("Back to your looks"…); short, no emoji. */
export function returnLabel(to: string): string {
  const p = pathOf(to);
  if (p.startsWith("/looks")) return "Back to your looks";
  if (/^\/m\/[^/]+\/showroom/.test(p)) return "Back to the showroom";
  if (/^\/m\/[^/]+\/shows\//.test(p)) return "Back to the show";
  if (p.startsWith("/m/")) return "Back to the Maker Space";
  if (p.startsWith("/wardrobe")) return "Back to your wardrobe";
  if (p.startsWith("/circle")) return "Back to your circle";
  if (p === "/bag") return "Back to your bag";
  if (p.startsWith("/orders")) return "Back to your order";
  if (p === "/trust") return "Back to Trust centre";
  if (p === "/") return "Back to the Muse";
  return "Back to where you were";
}

/** Same look index on the Looks stream URL (`?i=3` is look 4), keeping every other query parameter. */
export function withLookIndex(href: string, index: number): string {
  const [path, query = ""] = href.split("?");
  const q = new URLSearchParams(query);
  if (index > 0) q.set("i", String(index));
  else q.delete("i");
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
