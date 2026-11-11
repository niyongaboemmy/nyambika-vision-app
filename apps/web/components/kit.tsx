"use client";

/*
 * Theme-aware building blocks shared by shopper and studio screens (UI/UX modernisation).
 * Everything here styles itself with semantic tokens (surface / fg / fg-muted / border / accent / focus),
 * so the same component reads right in shopper-dark, shopper-light, studio-light and studio-dark.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/studio";
import { haptic } from "@/lib/native";
import { useTheme, type ThemePref } from "@/lib/theme";

/* ── theme toggle ─────────────────────────────────────────────────────────────────────────────────────────── */

const THEME_OPTS: { value: ThemePref; label: string; icon: IconName }[] = [
  { value: "system", label: "Auto", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

/** Three-way Auto / Light / Dark segmented control. `compact` shows icons only (names stay accessible). */
export function ThemeToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="group" aria-label="Theme" className={`inline-flex gap-1 rounded-2xl border border-border bg-surface-3/70 p-1 ${className}`}>
      {THEME_OPTS.map((o) => {
        const on = o.value === pref;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={compact ? `${o.label} theme` : undefined}
            title={`${o.label} theme`}
            onClick={() => {
              haptic("light");
              setPref(o.value);
            }}
            className={`press inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-bold ${on ? "bg-surface-2 text-fg shadow-e1" : "text-fg-muted hover:text-fg"}`}
          >
            <Icon name={o.icon} className="size-4" />
            {!compact && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── skeletons ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Shimmer block (theme-aware). Marked so crawls can wait for content. */
export function Skel({ className = "" }: { className?: string }) {
  return <div data-skeleton aria-hidden className={`skeleton rounded-2xl ${className}`} />;
}

/** Shopper screen skeleton: top bar + content shaped like the final layout. */
export function ShopperSkeleton({ variant = "list", title = true }: { variant?: "list" | "grid" | "hero" | "media" | "detail"; title?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className="relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden aurora">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top),14px)]">
        <Skel className="size-10 rounded-full" />
        {title && <Skel className="h-4 w-28 rounded-full" />}
        <Skel className="size-10 rounded-full" />
      </div>
      <div className="space-y-3 px-4 pt-3">
        {variant === "media" && <Skel className="h-[72dvh] w-full rounded-[28px]" />}
        {variant === "hero" && (
          <>
            <Skel className="mx-auto mt-6 h-8 w-3/4 rounded-full" />
            <Skel className="mx-auto mt-6 size-48 rounded-full" />
          </>
        )}
        {variant === "grid" && (
          <>
            <Skel className="h-8 w-2/3 rounded-full" />
            <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }, (_, i) => <Skel key={i} className="aspect-[3/4]" />)}</div>
          </>
        )}
        {variant === "list" && Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-20 rounded-3xl" />)}
        {variant === "detail" && (
          <>
            <Skel className="h-28 rounded-3xl" />
            <Skel className="h-40 rounded-3xl" />
            <Skel className="h-24 rounded-3xl" />
          </>
        )}
      </div>
    </div>
  );
}

/* ── ⓘ info popover ──────────────────────────────────────────────────────────────────────────────────────── */

/** Progressive disclosure for secondary explanations: an ⓘ button that toggles a small popover. */
export function InfoTip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="press grid size-7 place-items-center rounded-full text-fg-muted hover:text-fg"
      >
        <Icon name="info" className="size-[18px]" />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-1/2 top-full z-40 mt-1.5 w-64 max-w-[78vw] -translate-x-1/2 animate-pop rounded-2xl border border-border bg-surface-2 p-3 text-left text-[13px] font-medium leading-relaxed text-fg shadow-e3"
        >
          {children}
        </span>
      )}
    </span>
  );
}

/* ── "Learn more" disclosure ─────────────────────────────────────────────────────────────────────────────── */

/** Keeps legal/privacy detail one tap away. Native <details> → keyboard + screen-reader friendly by default. */
export function LearnMore({ summary = "Learn more", children, className = "" }: { summary?: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group rounded-2xl ${className}`}>
      <summary className="press inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl text-[13px] font-bold text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <Icon name="info" className="size-4" />
        {summary}
        <Icon name="chevron" className="size-3.5 transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-1.5 animate-fade text-[13px] leading-relaxed text-fg-muted">{children}</div>
    </details>
  );
}

/* ── icon + label chips ──────────────────────────────────────────────────────────────────────────────────── */

/** Compact fact: icon + short label (replaces a sentence). Purely presentational. */
export function Fact({ icon, children, className = "" }: { icon: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-3/60 px-2.5 py-1 text-xs font-semibold text-fg ${className}`}>
      <Icon name={icon} className="size-3.5 shrink-0 text-accent" />
      {children}
    </span>
  );
}

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
