"use client";

/*
 * Toasts (`toast()` + the root `<Toaster/>`), on their own so the root layout's shared chunk carries only this and
 * not the whole kit (JS budget pass 2). kit.tsx and ui.tsx re-export both.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";
import { haptic } from "@/lib/native";

/* ── toasts ──────────────────────────────────────────────────────────────────────────────────────────────── */

type ToastItem = { id: number; text: string; tone: "ok" | "error" | "info" };
let toasts: ToastItem[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Fire-and-forget confirmation. `toast("Saved")`, `toast("Couldn't save", "error")`. */
export function toast(text: string, tone: ToastItem["tone"] = "ok") {
  const id = Date.now() + Math.random();
  toasts = [...toasts.slice(-2), { id, text, tone }];
  emit();
  haptic(tone === "error" ? "error" : "success");
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 2800);
}

/** Mounted once in the root layout. Polite live region; toasts sit above docks and safe areas. */
export function Toaster() {
  const list = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => toasts,
    () => toasts,
  );
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),12px)+84px)] z-[80] flex flex-col items-center gap-2 px-4 lg:bottom-8">
      {list.map((t) => (
        <div
          key={t.id}
          className={`animate-pop flex max-w-sm items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold shadow-e3 ${t.tone === "error" ? "bg-red-700 text-[#fff]" : "bg-[#1c1714] text-[#fff] [[data-theme=dark]_&]:bg-[#f5efe8] [[data-theme=dark]_&]:text-[#1c1714]"}`}
        >
          <Icon name={t.tone === "error" ? "alert" : t.tone === "info" ? "info" : "check"} className="size-4 shrink-0" />
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
