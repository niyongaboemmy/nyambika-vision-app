"use client";

import { useServerInsertedHTML } from "next/navigation";
import { useEffect, useRef } from "react";
import { THEME_SCRIPT } from "@/lib/theme-script";

/**
 * Injects the no-flash theme script into the initial HTML stream only (Next guide "preventing flash before
 * hydration" → Themes). Unlike a <script> in the layout JSX, it is never part of a client render, so React does
 * not warn about script tags. If the document shell is ever rebuilt on the client (error/not-found recovery),
 * the effect re-applies the same logic.
 */
export function ThemeScript() {
  const done = useRef(false);
  useServerInsertedHTML(() => {
    if (done.current) return null;
    done.current = true;
    return <script id="nv-theme" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
  });
  useEffect(() => {
    const el = document.documentElement;
    if (el.dataset.theme) return;
    const p = document.cookie.match(/(?:^|; )nv-theme=(light|dark|system)/)?.[1] ?? "system";
    el.dataset.themePref = p;
    el.dataset.theme = p === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : p;
  }, []);
  return null;
}
