"use client";

import { useCallback, useEffect, useState } from "react";
import { THEME_COOKIE } from "@/lib/theme-script";

/**
 * Light/dark theme (docs/design/ui-audit.md §Tokens). The choice lives in the `nv-theme` cookie
 * ("system" | "light" | "dark"); the inline script in app/layout.tsx applies it to <html data-theme>
 * before first paint, so there is no flash and pages stay statically prerendered.
 */
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

/** Browser bar colours per resolved theme (shopper surface). */
const META = { dark: "#0B0A0F", light: "#FBF6F0" } as const;

function readPref(): ThemePref {
  if (typeof document === "undefined") return "system";
  const p = document.documentElement.dataset.themePref;
  return p === "light" || p === "dark" ? p : "system";
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function apply(pref: ThemePref) {
  const theme = pref === "system" ? systemTheme() : pref;
  const el = document.documentElement;
  const flip = () => {
    el.dataset.theme = theme;
    el.dataset.themePref = pref;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", META[theme]));
  };
  // Cross-fade the switch where View Transitions exist and motion is welcome.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(flip);
  else flip();
  window.dispatchEvent(new CustomEvent("nv-theme", { detail: theme }));
}

/** Theme preference + resolved theme, kept in sync with the OS while the preference is "system". */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setPrefState(readPref());
    setTheme(currentTheme());
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("nv-theme", onTheme);
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSystem = () => readPref() === "system" && apply("system");
    mq.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener("nv-theme", onTheme);
      mq.removeEventListener("change", onSystem);
    };
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    document.cookie = `${THEME_COOKIE}=${p}; path=/; max-age=31536000; SameSite=Lax`;
    setPrefState(p);
    apply(p);
  }, []);

  return { pref, theme, setPref };
}

/** The resolved theme only (for canvases, 3D backdrops and charts that paint colours themselves). */
export function useResolvedTheme(): Theme {
  return useTheme().theme;
}
