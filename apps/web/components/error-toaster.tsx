"use client";

/**
 * Safety net (error sweep): an API call in a click handler without its own catch used to end as an unhandled
 * promise rejection, so the tap silently did nothing. Any ApiError that escapes is shown here instead, through
 * the same LimitState mapping (daily cap, consent, rate limit, offline… calm; real errors red), and marked handled.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import dynamic from "next/dynamic";

// Rendered only after an escaped API error: the card (and its describeError mapping) loads on demand, keeping it
// out of every route's first-load JS (copy & iOS pass, JS budget).
const LimitState = dynamic(() => import("./limit-state").then((m) => m.LimitState), { ssr: false });

export function ErrorToaster() {
  const [error, setError] = useState<ApiError | null>(null);
  const path = usePathname();
  useEffect(() => {
    const on = (e: PromiseRejectionEvent) => {
      if (!(e.reason instanceof ApiError)) return;
      e.preventDefault();
      setError(e.reason);
    };
    window.addEventListener("unhandledrejection", on);
    return () => window.removeEventListener("unhandledrejection", on);
  }, []);
  useEffect(() => setError(null), [path]);
  useEffect(() => {
    if (!error || error.status === 0) return;
    const id = setTimeout(() => setError(null), 12000);
    return () => clearTimeout(id);
  }, [error]);
  if (!error) return null;
  const light = path.startsWith("/studio") || path.startsWith("/admin");
  return (
    <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-[60] mx-auto max-w-[448px]">
      <LimitState error={error} tone={light ? "light" : "dark"} onDismiss={() => setError(null)} className="shadow-lg" />
    </div>
  );
}
