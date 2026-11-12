"use client";

/*
 * Theme-aware building blocks shared by shopper and studio screens (UI/UX modernisation).
 * Everything here styles itself with semantic tokens (surface / fg / fg-muted / border / accent / focus),
 * so the same component reads right in shopper-dark, shopper-light, studio-light and studio-dark.
 * JS budget pass 2: the hook-free parts live in kit-static.tsx and the toasts in toast.tsx; both are re-exported here.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { haptic } from "@/lib/native";
import { useTheme, type ThemePref } from "@/lib/theme";

export { Fact, LearnMore, ShopperSkeleton, Skel } from "@/components/kit-static";
export { toast, Toaster } from "@/components/toast";

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
    <div role="group" aria-label="Theme" className={`inline-flex gap-1 rounded-2xl bg-fill p-1 ${className}`}>
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
            className={`hit press inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-[13px] font-bold ${on ? "bg-surface-2 text-fg shadow-e1" : "text-fg-muted hover:text-fg"}`}
          >
            <Icon name={o.icon} className="size-4" />
            {!compact && <span>{o.label}</span>}
          </button>
        );
      })}
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
        className="hit press grid size-7 place-items-center rounded-full text-fg-muted hover:text-fg"
      >
        <Icon name="info" className="size-[18px]" />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className="absolute left-1/2 top-full z-40 mt-1.5 w-64 max-w-[78vw] -translate-x-1/2 animate-pop rounded-2xl bg-surface-2 p-3 text-left text-[13px] font-medium leading-relaxed text-fg shadow-e3"
        >
          {children}
        </span>
      )}
    </span>
  );
}
