"use client";

/*
 * Navigation & workflow pass (docs/design/flows.md): the React side of lib/nav.ts.
 * - A per-tab trail of screens (sessionStorage), kept by <NavTracker/> in the root layout, so a back button knows
 *   whether the previous history entry is ours: then `router.back()` (state, scroll and look index survive),
 *   otherwise `?next=`, otherwise a sensible parent (deep links never dead-end).
 * - `go()`: iOS-style push/pop motion between related screens with View Transitions (skipped under reduced
 *   motion or where unsupported; plain navigation then).
 * - Per-route memory (`remember` / `recall`) and one-shot "resume this action" stashes (`stashResume` /
 *   `takeResume`), e.g. reopen the buy sheet after a detour to measurements.
 */
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { hereNow, parentOf, pathOf, previousInTrail, returnTarget, routeKey, TRAIL_MAX, trailStep } from "./nav";

type Router = ReturnType<typeof useRouter>;
export type NavDir = "push" | "pop";

const TRAIL = "nv-trail";

function readTrail(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(TRAIL) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let trail: string[] | null = null;
const navListeners = new Set<() => void>();

function current(): string[] {
  if (trail == null) trail = typeof window === "undefined" ? [] : readTrail();
  return trail;
}

function save(next: string[]) {
  trail = next;
  try {
    sessionStorage.setItem(TRAIL, JSON.stringify(next));
  } catch {
    /* private mode: in-memory trail still works for this page's life */
  }
}

function notify() {
  // Fire after the new route has painted (Next commits the tree, then updates history).
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const f of [...navListeners]) f();
  }));
}

const hrefOf = (url: string | URL | null | undefined) => {
  if (url == null) return window.location.pathname + window.location.search;
  const u = new URL(String(url), window.location.href);
  return u.origin === window.location.origin ? u.pathname + u.search : null;
};

let installed = false;

/**
 * Keep the trail in step with the real history: pushState = push, replaceState = replace the top (guards and
 * `?i=` updates), popstate = back. Installed once by <NavTracker/>.
 */
export function installNavTrail() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const here = window.location.pathname + window.location.search;
  const t = current();
  // A reload keeps the trail (sessionStorage); a new tab or deep link starts a fresh one.
  if (t[t.length - 1] !== here) save(t.length && pathOf(t[t.length - 1]) === pathOf(here) ? [...t.slice(0, -1), here] : [here]);
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => {
    push(data, unused, url);
    const h = hrefOf(url);
    if (h && h !== current()[current().length - 1]) {
      save([...current(), h].slice(-TRAIL_MAX));
      notify();
    }
  };
  history.replaceState = (data, unused, url) => {
    replace(data, unused, url);
    const h = hrefOf(url);
    const c = current();
    if (h && h !== c[c.length - 1]) {
      const moved = pathOf(h) !== pathOf(c[c.length - 1] ?? "");
      save([...c.slice(0, -1), h]);
      if (moved) notify();
    }
  };
  window.addEventListener("popstate", () => {
    save(trailStep(current(), window.location.pathname + window.location.search, true).trail);
    notify();
  });
}

/** The previous in-app screen of this tab, or null (arrived by deep link). */
export function previousScreen(): string | null {
  return previousInTrail(current());
}

function reducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

type VTDoc = Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } };

/**
 * Navigate with a push (forward, slides in from the right) or pop (back) motion. `href` null = history back.
 * The transition waits for the new route to commit (NavTracker), at most 450 ms, so a slow route never freezes.
 */
export function go(router: Router, href: string | null, dir: NavDir = "push", opts: { replace?: boolean } = {}) {
  const nav = () => (href == null ? router.back() : opts.replace ? router.replace(href) : router.push(href));
  const doc = document as VTDoc;
  const samePath = href != null && pathOf(href) === window.location.pathname;
  if (!doc.startViewTransition || reducedMotion() || samePath) return nav();
  const root = document.documentElement;
  root.dataset.nav = dir;
  try {
    const t = doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            navListeners.delete(finish);
            resolve();
          };
          navListeners.add(finish);
          setTimeout(finish, 450);
          nav();
        }),
    );
    t.finished.finally(() => delete root.dataset.nav);
  } catch {
    delete root.dataset.nav;
    nav();
  }
}

/**
 * Back, the iOS way: the previous screen in history when it is ours (`router.back()` keeps its state), else the
 * `?next=` this screen was opened with, else `fallback` (or the route's parent). Never a dead end.
 */
export function useBack(fallback?: string) {
  const router = useRouter();
  return useCallback(() => {
    const next = returnTarget();
    const prev = previousScreen();
    if (prev && (!next || pathOf(prev) === pathOf(next))) return go(router, null, "pop");
    if (next) return go(router, next, "pop", { replace: true });
    go(router, fallback ?? parentOf(hereNow()), "pop", { replace: true });
  }, [router, fallback]);
}

/**
 * Leave a finished detour (twin made, measurements saved, signed in): back to where the shopper came from. Uses
 * history when the origin is the previous entry (state is kept), else replaces this screen with `to`.
 */
export function useReturn() {
  const router = useRouter();
  return useCallback(
    (to: string) => {
      const prev = previousScreen();
      if (prev && pathOf(prev) === pathOf(to)) return go(router, null, "pop");
      go(router, to, "pop", { replace: true });
    },
    [router],
  );
}

/* ── per-route memory ─────────────────────────────────────────────────────────────────────────────────── */

/** Remember a small value for this route (look index, selected piece, open tab, scroll) for the tab's life. */
export function remember(name: string, value: unknown, path: string = typeof window === "undefined" ? "/" : window.location.pathname) {
  try {
    sessionStorage.setItem(routeKey(path, name), JSON.stringify(value));
  } catch {
    /* storage off: nothing to restore later, the screen still works */
  }
}

export function recall<T>(name: string, path: string = typeof window === "undefined" ? "/" : window.location.pathname): T | null {
  try {
    const v = sessionStorage.getItem(routeKey(path, name));
    return v == null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}

/* ── resume an action after a detour ──────────────────────────────────────────────────────────────────── */

const RESUME_MS = 15 * 60_000;

/** Ask the screen we come back to to reopen something (e.g. kind "buy", key = variant id) once. */
export function stashResume(kind: string, key: string) {
  try {
    sessionStorage.setItem(`nv-resume:${kind}`, JSON.stringify({ key, at: Date.now() }));
  } catch {}
}

/** True once if a matching, fresh resume is waiting (and clears it). */
export function takeResume(kind: string, key: string): boolean {
  try {
    const raw = sessionStorage.getItem(`nv-resume:${kind}`);
    if (!raw) return false;
    const v = JSON.parse(raw) as { key: string; at: number };
    if (v.key !== key) return false;
    sessionStorage.removeItem(`nv-resume:${kind}`);
    return Date.now() - v.at < RESUME_MS;
  } catch {
    return false;
  }
}
