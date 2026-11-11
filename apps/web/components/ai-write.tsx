"use client";

import { useState } from "react";
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
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-violet-50 p-2">
      <button type="button" onClick={run} disabled={busy} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Writing…" : "✨ Write it for me"}
      </button>
      <span className="text-xs text-violet-900">in</span>
      {(["rw", "en", "fr"] as Locale[]).map((l) => (
        <button key={l} type="button" aria-pressed={l === locale} onClick={() => setLocale(l)} className={`rounded-md px-2 py-1 text-xs font-semibold ${l === locale ? "bg-violet-200 text-violet-900" : "text-violet-700"}`}>
          {l.toUpperCase()}
        </button>
      ))}
      <span className="w-full text-[11px] text-violet-800">A draft from your details. Check it before saving.</span>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
