"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isExpectedText, LimitState } from "./limit-state";

/** Mobile-first frame: full-bleed on phones, a centred phone-width column on larger screens. */
export function Screen({ children, className = "", aurora = true }: { children: ReactNode; className?: string; aurora?: boolean }) {
  return (
    <div className={`relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden ${aurora ? "aurora" : "bg-ink"} ${className}`}>
      {children}
    </div>
  );
}

export function TopBar({ title, back, right }: { title?: ReactNode; back?: string | true; right?: ReactNode }) {
  const router = useRouter();
  return (
    <div className="relative z-20 flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),14px)] pb-2">
      {back ? (
        typeof back === "string" ? (
          <Link href={back} aria-label="Back" className="glass grid size-10 place-items-center rounded-full text-lg">←</Link>
        ) : (
          <button onClick={() => router.back()} aria-label="Back" className="glass grid size-10 place-items-center rounded-full text-lg">←</button>
        )
      ) : (
        <Link href="/" className="flex items-center gap-2" aria-label="Nyambika home">
          <span className="orb size-7 rounded-full shadow-[0_0_18px_rgba(242,184,75,.5)]" />
          <span className="font-display text-lg font-black tracking-tight">Nyambika</span>
        </Link>
      )}
      {title && <div className="flex-1 truncate text-center text-sm font-semibold text-txt/90">{title}</div>}
      <div className="flex min-w-10 justify-end gap-2">{right}</div>
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
    ghost: "text-txt/80 hover:text-white",
    danger: "bg-red-500/90 text-white",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold transition active:scale-[.98] disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-3.5 py-2 text-sm font-semibold transition ${
        active ? "border-gold/70 bg-gold/20 text-white" : "border-white/20 bg-white/10 text-white/90"
      }`}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block size-5 animate-spin rounded-full border-2 border-white/30 border-t-white ${className}`} />;
}

/** Bottom sheet, portalled to <body> so ancestors with transforms/backdrop-filter can't trap or overlap it. */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-[480px] animate-rise rounded-t-[28px] border border-white/15 bg-ink-2 p-5 pb-[max(env(safe-area-inset-bottom),20px)]">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/25" />
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
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-terra font-display font-black text-white ${ring ? "ring-2 ring-gold" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

/**
 * Inline error. Expected limits (daily cap, kill switch, consent, rate limit, offline…) render as the calm
 * LimitState card instead; pass the caught error itself (or the friendly string from `api()`).
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  if (typeof error !== "string" || isExpectedText(error)) return <LimitState error={error} onRetry={onRetry} />;
  return <p role="alert" className="rounded-xl border border-red-400/40 bg-red-500/15 px-3 py-2 text-sm text-red-100">{error}</p>;
}
