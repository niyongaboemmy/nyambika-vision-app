"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/studio";

/* Shopper primitives (aurora). Exported names and props are stable (other screens import them); everything
 * styles itself with theme tokens so it reads right in both light and dark (docs/design/ui-audit.md). */

// Theme-aware primitives shared with the studio live in kit.tsx; re-exported here for convenience.
export { Fact, InfoTip, LearnMore, ShopperSkeleton, Skel, ThemeToggle, toast } from "@/components/kit";

/** Mobile-first frame: full-bleed on phones, a centred phone-width column on larger screens. */
export function Screen({ children, className = "", aurora = true }: { children: ReactNode; className?: string; aurora?: boolean }) {
  return (
    <div className={`relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden sm:border-x sm:border-line sm:shadow-e3 ${aurora ? "aurora" : "bg-ink"} ${className}`}>
      {children}
    </div>
  );
}

/** Consistent header: 40px round controls, centred title, safe-area aware. */
export function TopBar({ title, back, right }: { title?: ReactNode; back?: string | true; right?: ReactNode }) {
  const router = useRouter();
  const ctl = "glass press grid size-10 shrink-0 place-items-center rounded-full";
  return (
    <div className="relative z-20 flex min-h-14 items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),14px)] pb-2">
      {back ? (
        typeof back === "string" ? (
          <Link href={back} aria-label="Back" className={ctl}><Icon name="back" className="size-5" /></Link>
        ) : (
          <button onClick={() => router.back()} aria-label="Back" className={ctl}><Icon name="back" className="size-5" /></button>
        )
      ) : (
        <Link href="/" className="flex items-center gap-2" aria-label="Nyambika home">
          <span className="orb size-7 rounded-full shadow-[0_0_18px_rgba(242,184,75,.5)]" />
          <span className="font-display text-lg font-black tracking-tight">Nyambika</span>
        </Link>
      )}
      {title && <div className="min-w-0 flex-1 truncate text-center text-[15px] font-bold text-txt">{title}</div>}
      <div className="flex min-w-10 shrink-0 justify-end gap-2">{right}</div>
    </div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "glass" | "ghost" | "danger" }) {
  const styles = {
    primary: "grad-cta text-white shadow-[0_10px_30px_rgba(139,92,246,.35)]",
    glass: "glass text-white",
    ghost: "text-txt/80 hover:text-txt",
    danger: "bg-red-600 text-white",
  }[variant];
  return (
    <button
      {...props}
      className={`press inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={onClick && active !== undefined ? active : undefined}
      className={`press inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-2xl border px-3.5 text-sm font-semibold ${
        active ? "border-gold/70 bg-gold/20 text-txt" : "border-white/20 bg-white/10 text-txt/90"
      }`}
    >
      {children}
    </button>
  );
}

/** Inline busy indicator for actions (content loading uses skeletons instead). */
export function Spinner({ className = "" }: { className?: string }) {
  return <span role="presentation" className={`inline-block size-5 animate-spin rounded-full border-2 border-txt/25 border-t-txt ${className}`} />;
}

/**
 * Bottom sheet, portalled to <body> so ancestors with transforms/backdrop-filter can't trap or overlap it.
 * Anatomy: grabber · optional title row with close · scrollable body · safe-area padding. Escape closes,
 * focus moves in and returns, the page behind doesn't scroll.
 */
export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => panel.current?.focus({ preventScroll: true }), 20);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      clearTimeout(t);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
      <button aria-label="Close" tabIndex={-1} className="absolute inset-0 animate-fade bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full max-w-[480px] animate-rise overflow-y-auto overscroll-contain rounded-t-[28px] border border-line bg-ink-2 px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-3 text-txt shadow-e3 outline-none"
      >
        <div aria-hidden className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-txt/20" />
        {title && (
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id={titleId} className="font-display text-xl font-black tracking-tight">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="glass press grid size-9 place-items-center rounded-full"><Icon name="x" className="size-4" /></button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Avatar({ name, size = 44, ring = false }: { name: string; size?: number; ring?: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    // Fixed brand terracotta (#b4532a) so white initials meet AA in both themes.
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-[#b4532a] font-display font-black text-[#fff] ${ring ? "ring-2 ring-gold" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-400/40 bg-red-500/15 px-3.5 py-2.5 text-left text-sm font-medium text-red-100">
      <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
      <span>{error}</span>
    </p>
  );
}

/** Designed empty state for shopper screens: icon tile, short title, one line, one action. */
export function EmptyState({ icon, title, children, action }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-2.5 rounded-[28px] px-6 py-9 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-gold/15 text-gold"><Icon name={icon} className="size-6" /></span>
      <p className="font-display text-lg font-black">{title}</p>
      {children && <div className="max-w-[30ch] text-sm leading-relaxed text-mut">{children}</div>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
