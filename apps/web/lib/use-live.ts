"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live updates over Server-Sent Events (through the same-origin /api rewrite), falling back to
 * polling `pollUrl` every few seconds if the stream can't be opened or goes quiet (old proxies,
 * data savers, flaky mobile networks).
 */
export function useLive<T>(streamUrl: string | null, pollUrl: string | null, onData: (d: T) => void, enabled = true) {
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");
  const cb = useRef(onData);
  cb.current = onData;

  useEffect(() => {
    if (!enabled || !streamUrl) return;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let errors = 0;
    let cancelled = false;

    const startPolling = () => {
      if (poll || cancelled || !pollUrl) return;
      es?.close();
      setMode("polling");
      const tick = () =>
        fetch(pollUrl, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && !cancelled && cb.current(d as T))
          .catch(() => {});
      poll = setInterval(tick, 4000);
    };

    if (typeof EventSource === "undefined") startPolling();
    else {
      es = new EventSource(streamUrl, { withCredentials: true });
      const quiet = setTimeout(startPolling, 6000);
      es.addEventListener("snapshot", (e) => {
        clearTimeout(quiet);
        errors = 0;
        setMode("live");
        cb.current(JSON.parse((e as MessageEvent).data) as T);
      });
      es.onerror = () => {
        errors += 1;
        if (errors >= 3) startPolling();
      };
    }
    return () => {
      cancelled = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [streamUrl, pollUrl, enabled]);

  return mode;
}
