"use client";

import { useSyncExternalStore } from "react";

/** Draws a non-core glyph once icons-extra.ts has loaded (a same-size empty svg until then: no layout shift). */
let paths: Record<string, string> | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();

export function loadExtraIcons() {
  loading ??= import("./icons-extra").then((m) => {
    paths = m.EXTRA_PATHS as Record<string, string>;
    subs.forEach((f) => f());
  });
  return loading;
}

export function LazyIcon({ name, className, fill }: { name: string; className: string; fill: boolean }) {
  const d = useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!paths) void loadExtraIcons();
      return () => void subs.delete(f);
    },
    () => paths?.[name] ?? null,
    () => null,
  );
  return (
    <svg viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={name === "more" ? 3.4 : 1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {d && <path d={d} />}
    </svg>
  );
}
