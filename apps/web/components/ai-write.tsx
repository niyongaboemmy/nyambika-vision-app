"use client";

import { isExpectedText, LimitState } from "@/components/limit-state";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { api } from "@/lib/api";

type Locale = "rw" | "en" | "fr";

/** "Write it for me" (FR-PAGE-07): drafts copy in the chosen language; the member edits before saving. */
export function AiWrite<T>({ pageId, kind, fields, onResult }: { pageId: string; kind: "product" | "story"; fields: () => Record<string, unknown>; onResult: (r: T) => void }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      onResult(await api<T>(`/pages/${pageId}/assist`, { method: "POST", json: { kind, locale, fields: fields() } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-gradient-to-br from-violet-50 to-orange-50 p-2.5">
      <button type="button" onClick={run} disabled={busy} title="A draft from your details. Check it before saving." className="inline-flex min-h-11 items-center rounded-xl bg-violet-ink px-3.5 text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(98,57,201,.8)] transition active:scale-[.97] disabled:opacity-50">
        <Icon name="sparkle" className="mr-1.5 size-4" />{busy ? "Writing…" : "Write it for me"}
      </button>
      <div role="group" aria-label="Draft language" className="flex items-center gap-0.5">
        {(["rw", "en", "fr"] as Locale[]).map((l) => (
          <button key={l} type="button" aria-pressed={l === locale} onClick={() => setLocale(l)} className={`min-h-11 min-w-11 rounded-lg px-2 text-xs font-bold transition ${l === locale ? "bg-white text-violet-ink shadow-sm" : "text-violet-ink/80 hover:bg-white/60"}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      {err && (isExpectedText(err) ? <LimitState error={err} tone="light" /> : <span className="text-xs text-red-700">{err}</span>)}
    </div>
  );
}
