"use client";

import Link from "next/link";
import { useBack } from "@/lib/use-nav";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { recallFriendly } from "@/lib/api-errors";
import { Icon } from "@/components/icons";
import { useSheetDrag } from "@/lib/sheet-drag";

// The limit card only renders after a failed call, so it loads on demand (keeps core routes' first-load JS down).
const LimitState = dynamic(() => import("./limit-state").then((m) => m.LimitState), { ssr: false });

/* Shopper primitives (aurora). Exported names and props are stable (other screens import them); everything
 * styles itself with theme tokens so it reads right in both light and dark (docs/design/ui-audit.md). */

// Theme-aware primitives shared with the studio live in kit.tsx; re-exported here for convenience.
export { Fact, InfoTip, LearnMore, ShopperSkeleton, Skel, ThemeToggle, toast } from "@/components/kit";

/** Mobile-first frame: full-bleed on phones, a centred phone-width column on larger screens. */
export function Screen({ children, className = "", aurora = true }: { children: ReactNode; className?: string; aurora?: boolean }) {
  return (
    <div className={`relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden sm:shadow-e3 ${aurora ? "aurora" : "bg-ink"} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Consistent header: 40px round controls, centred title, safe-area aware.
 * `large` (iOS large title): the title is drawn big under the bar and collapses into the compact centred title,
 * on a material bar, once it scrolls under it.
 */
export function TopBar({ title, back, right, large = false }: { title?: ReactNode; back?: string | true; right?: ReactNode; large?: boolean }) {
  // Navigation pass: Back returns to the previous screen when it is ours (state kept), else `?next=`, else `back`
  // (or the route's parent) for deep links. The href stays for middle-click / no-JS.
  const goBack = useBack(typeof back === "string" ? back : undefined);
  const ctl = "hit glass press grid size-10 shrink-0 place-items-center rounded-full";
  const big = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(!large);
  useEffect(() => {
    const el = big.current;
    if (!large || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [large]);
  return (
    <>
      <div className={`z-20 flex min-h-14 items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),14px)] pb-2 ${large ? `sticky top-0 transition-[background-color,box-shadow] duration-200 ${collapsed ? "material hairline-b" : ""}` : "relative"}`}>
        {back ? (
          <BackLink href={typeof back === "string" ? back : "/"} onBack={goBack} className={ctl} />
        ) : (
          <Link href="/" className="flex items-center gap-2" aria-label="Nyambika home">
            <span className="orb size-7 rounded-full shadow-[0_0_18px_rgba(242,184,75,.5)]" />
            <span className="font-brand text-lg font-black tracking-tight">Nyambika</span>
          </Link>
        )}
        {title && (
          <div aria-hidden={large && !collapsed ? true : undefined} className={`min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-txt transition-opacity duration-200 ${collapsed ? "opacity-100" : "opacity-0"}`}>
            {title}
          </div>
        )}
        <div className="flex min-w-10 shrink-0 justify-end gap-2">{right}</div>
      </div>
      {large && title && (
        <h1 ref={big} className="px-4 pb-2 pt-1 font-display text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-txt">
          {title}
        </h1>
      )}
    </>
  );
}

/** A back control: plain link semantics (modifier clicks open the href), smart back on a normal click. */
export function BackLink({ href, onBack, className, label = "Back", children }: { href: string; onBack: () => void; className?: string; label?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      aria-label={label}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onBack();
      }}
    >
      {children ?? <Icon name="back" className="size-5" />}
    </a>
  );
}

// Button lives in button.tsx (no client code: pages can import it without the rest of this kit, JS budget pass).
export { Button } from "./button";

/** Toggle chip when it has an action; a plain (non-interactive) label chip otherwise — never a decorative button. */
export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  // iOS filter pill: filled, no outline; the selected one inverts (foreground fill) in both themes.
  const cls = `inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
    active ? "bg-fg text-surface" : "bg-fill text-txt"
  }`;
  if (!onClick) return <span className={cls}>{children}</span>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active !== undefined ? active : undefined} className={`hit press ${cls}`}>
      {children}
    </button>
  );
}

/** Inline busy indicator for actions (content loading uses skeletons instead). */
export function Spinner({ className = "" }: { className?: string }) {
  return <span role="presentation" className={`inline-block size-5 animate-spin rounded-full border-2 border-txt/25 border-t-txt ${className}`} />;
}

/**
 * iOS bottom sheet, portalled to <body> so ancestors with transforms/backdrop-filter can't trap or overlap it.
 * Anatomy: grabber · optional title row with close (sticky, drag handle) · scrollable body · safe-area padding.
 * Drag the handle down to dismiss; `detent="medium"` opens at about half height and expands on a drag up.
 * Escape closes, focus moves in and returns, the page behind doesn't scroll.
 */
export function Sheet({ open, onClose, children, title, detent = "large" }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; detent?: "medium" | "large" }) {
  const [mounted, setMounted] = useState(false);
  const { panel, expanded, handle } = useSheetDrag(onClose, detent);
  const titleId = useId();
  // Latest onClose without re-running the open/close effect on every parent render (callers pass inline arrows).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
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
  }, [open, panel]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
      <button aria-label="Close" tabIndex={-1} className="absolute inset-0 animate-fade bg-black/50" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={`relative w-full max-w-[480px] animate-rise overflow-y-auto overscroll-contain rounded-t-[28px] bg-[var(--sheet-bg)] px-5 pb-[max(env(safe-area-inset-bottom),20px)] text-txt shadow-e3 outline-none transition-[max-height] duration-300 ${expanded ? "max-h-[92dvh]" : "max-h-[56dvh]"}`}
      >
        <div {...handle} className="sticky top-0 z-10 -mx-5 mb-2 cursor-grab bg-[var(--sheet-bg)] px-5 pt-2 active:cursor-grabbing">
          <div aria-hidden className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-txt/25" />
          {title && (
            <div className="flex items-center justify-between gap-3 pb-2">
              <h2 id={titleId} className="min-w-0 truncate font-display text-[20px] font-bold tracking-[-0.01em]">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="hit glass press grid size-8 place-items-center rounded-full"><Icon name="x" className="size-4" /></button>
            </div>
          )}
        </div>
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

/**
 * Inline error. Expected limits (daily cap, kill switch, consent, rate limit, offline…) render as the calm
 * LimitState card instead; pass the caught error itself (or the friendly string from `api()`).
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  if (typeof error !== "string" || recallFriendly(error)?.expected) return <LimitState error={error} onRetry={onRetry} />;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl bg-red-500/15 px-3.5 py-2.5 text-left text-sm font-medium text-red-100">
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
      <p className="text-balance font-display text-lg font-black">{title}</p>
      {children && <div className="max-w-[30ch] text-pretty text-sm leading-relaxed text-mut">{children}</div>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
