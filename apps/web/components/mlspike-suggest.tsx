"use client";

import { useState } from "react";
import { Icon, Note } from "@/components/studio";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Suggestion {
  field: "category" | "pattern" | "colour";
  value: string;
  label: string;
  confidence: number;
  current: string | null;
  matches: boolean;
  apply: Record<string, unknown> | null;
}
type Suggest =
  | { enabled: false }
  | { enabled: true; model: { id: string; evalPassed?: boolean } | null; reason?: string; servedBy?: string; suggestions: Suggestion[] };

const FIELD: Record<Suggestion["field"], string> = { category: "Type", pattern: "Pattern family", colour: "Main colour" };

/**
 * R4 spike (flag ml.local_attr_spike): ✨ auto-fill suggestions from the photo, made by the self-hosted local
 * model. The maker always decides; nothing is changed until they tap "Use".
 */
export function AttrSuggest({ productId, canEdit, onApplied }: { productId: string; canEdit: boolean; onApplied: () => Promise<void> }) {
  const { data, reload } = useApi<Suggest>(`/products/${productId}/attr-suggest`);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  if (!data || !data.enabled) return null;
  if (!data.model || !data.suggestions.length) return null;

  async function use(s: Suggestion) {
    if (!s.apply) return;
    setBusy(s.field);
    setErr(null);
    try {
      await api(`/products/${productId}`, { method: "PATCH", json: s.apply });
      navigator.vibrate?.(8);
      setDone((d) => [...d, s.field]);
      await onApplied();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="attr-suggest-t" className="rounded-[24px] bg-gradient-to-br from-violet-50 via-white to-amber-50 p-4 ring-1 ring-inset ring-violet-200 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-ink text-white shadow-[0_8px_18px_-8px_rgba(98,57,201,.8)]"><Icon name="sparkle" className="size-5" /></span>
        <div className="min-w-0">
          <h3 id="attr-suggest-t" className="font-display text-lg font-black tracking-tight text-cocoa">✨ Suggested from your photo</h3>
          <p className="text-sm text-cocoa-2">Tap Use to fill it in. You can change it any time.</p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {data.suggestions.map((s) => {
          const ok = s.matches || done.includes(s.field);
          return (
            <li key={s.field} className="flex items-center gap-3 rounded-2xl bg-white/85 p-3 ring-1 ring-inset ring-hairline">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-black uppercase tracking-wider text-cocoa-2">{FIELD[s.field]}</span>
                <span className="block text-[15px] font-extrabold capitalize text-cocoa">{s.label}</span>
                <span className="block text-xs text-cocoa-2">{Math.round(s.confidence * 100)}% sure{s.current ? ` · now: ${s.current}` : ""}</span>
              </span>
              {ok ? (
                <span className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-emerald-50 px-3 text-sm font-bold text-mint-ink"><Icon name="check" className="size-4" /> {s.matches ? "Matches" : "Added"}</span>
              ) : s.apply && canEdit ? (
                <button type="button" disabled={busy !== null} onClick={() => use(s)} className="st-press inline-flex min-h-11 items-center rounded-xl bg-violet-ink px-4 text-sm font-bold text-white disabled:opacity-50">
                  {busy === s.field ? "Saving…" : s.field === "pattern" ? "Add tag" : "Use"}
                </button>
              ) : (
                <span className="text-xs font-semibold text-cocoa-2">Check your colour name</span>
              )}
            </li>
          );
        })}
      </ul>
      <Note error={err} />
      <p className="mt-2 text-[11px] leading-relaxed text-cocoa-2">
        Made by Nyambika&apos;s own small model, run in Rwanda ({data.servedBy === "pool" ? "self-hosted" : "simple colour rules"}). Trained on synthetic garments and photos makers chose to share. Experimental.
      </p>
    </section>
  );
}
