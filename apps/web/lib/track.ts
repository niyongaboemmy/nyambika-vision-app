"use client";

import type { AnalyticsEventName } from "@nyambika/contracts";

/**
 * Tiny pseudonymous product-analytics tracker (plan §8.1 "funnel analytics").
 * Batches events to POST /api/events. Never send names, phones, free text or images in props:
 * the server drops unknown keys and PII-looking values anyway. Signed-out devices use a random id.
 */
type Props = Record<string, string | number | boolean | null | undefined>;
interface Queued {
  name: AnalyticsEventName;
  props: Record<string, string | number | boolean>;
  at: string;
}

const queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let bound = false;

function anonId() {
  try {
    let v = localStorage.getItem("nya_anon");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("nya_anon", v);
    }
    return v;
  } catch {
    return "no-storage-device";
  }
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const events = queue.splice(0, 50);
    void fetch("/api/events", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonId: anonId(), events }),
    }).catch(() => {});
  }
}

export function track(name: AnalyticsEventName, props: Props = {}) {
  if (typeof window === "undefined") return;
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) if (v !== null && v !== undefined) clean[k] = v;
  queue.push({ name, props: clean, at: new Date().toISOString() });
  window.dispatchEvent(new CustomEvent("nya:track", { detail: { name } }));
  if (!bound) {
    bound = true;
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
    window.addEventListener("pagehide", flush);
  }
  if (queue.length >= 20) flush();
  else timer ??= setTimeout(flush, 1500);
}

/** Fire once per key per page load (e.g. a look scrolled into view twice counts once). */
const seen = new Set<string>();
export function trackOnce(key: string, name: AnalyticsEventName, props: Props = {}) {
  if (seen.has(key)) return;
  seen.add(key);
  track(name, props);
}
