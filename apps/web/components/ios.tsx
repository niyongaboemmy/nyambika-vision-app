"use client";

/*
 * iOS design language building blocks (copy & alignment pass → iOS). Own module, so only screens that use them pay
 * for them (kit.tsx is in the root layout). Theme-aware through the semantic tokens; works in shopper and studio.
 *   Group / GroupRow   inset grouped list with hairline separators, icon tile, value, chevron or accessory
 *   ActionSheet        iOS action sheet: actions + Cancel, portalled, Escape/scrim closes, focus in and back
 *   Stepper            − value + with press-scale, haptics, min/max, accessible spinbutton semantics
 *   useCollapsedTitle  true once a large title has scrolled under the bar (compact nav title)
 * Motion uses the CSS spring tokens in globals.css and is disabled under prefers-reduced-motion.
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { haptic } from "@/lib/native";

/* ── inset grouped list ─────────────────────────────────────────────────────────────────────────────────── */

/** Section of an inset grouped list. `header` is the small caps title above, `footer` one short line below. */
export function Group({ header, footer, children, className = "" }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={header ? id : undefined} className={className}>
      {header && (
        <h3 id={id} className="mb-1.5 px-4 text-[13px] font-semibold uppercase tracking-[0.04em] text-fg-muted">
          {header}
        </h3>
      )}
      <ul className="overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2 shadow-e1 [&>li+li]:hairline-t">{children}</ul>
      {footer && <p className="mt-1.5 px-4 text-[13px] leading-snug text-fg-muted">{footer}</p>}
    </section>
  );
}

const TILE: Record<string, string> = {
  terra: "bg-[#c0562b]",
  violet: "bg-[#7347e0]",
  mint: "bg-[#1f9d55]",
  sky: "bg-[#0a84ff]",
  gold: "bg-[#b7791f]",
  red: "bg-[#d70015]",
  stone: "bg-[#6e6a66]",
};

/**
 * One row: optional coloured icon tile, title (+ one-line subtitle), trailing value and accessory.
 * Interactive when it has `href` or `onClick` (whole row is the target, chevron shown). `accessory` (e.g. a Switch)
 * keeps the row non-interactive so the control owns the tap.
 */
export function GroupRow({
  icon,
  tone = "stone",
  title,
  subtitle,
  value,
  href,
  onClick,
  accessory,
  destructive,
}: {
  icon?: IconName;
  tone?: keyof typeof TILE;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  accessory?: ReactNode;
  destructive?: boolean;
}) {
  const body = (
    <>
      {icon && (
        <span aria-hidden className={`grid size-[30px] shrink-0 place-items-center rounded-[8px] text-[#fff] ${TILE[tone]}`}>
          <Icon name={icon} className="size-[18px]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] font-medium ${destructive ? "text-[#d70015] [[data-theme=dark]_&]:text-[#ff6961]" : "text-fg"}`}>{title}</span>
        {subtitle && <span className="block truncate text-[13px] text-fg-muted">{subtitle}</span>}
      </span>
      {value != null && <span className="max-w-[45%] shrink-0 truncate text-[15px] text-fg-muted">{value}</span>}
      {accessory}
      {(href || onClick) && !accessory && <Icon name="chevron" className="size-4 shrink-0 text-fg-muted/70" />}
    </>
  );
  const row = "flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left";
  if (href)
    return (
      <li>
        <Link href={href} className={`${row} press active:bg-surface-3`}>
          {body}
        </Link>
      </li>
    );
  if (onClick)
    return (
      <li>
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onClick();
          }}
          className={`${row} press active:bg-surface-3`}
        >
          {body}
        </button>
      </li>
    );
  return <li className={row}>{body}</li>;
}

/* ── action sheet ───────────────────────────────────────────────────────────────────────────────────────── */

export interface SheetAction {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** iOS action sheet. Use for secondary actions instead of rows of inline buttons. */
export function ActionSheet({ open, onClose, title, actions, cancelLabel = "Cancel" }: { open: boolean; onClose: () => void; title?: string; actions: SheetAction[]; cancelLabel?: string }) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);
  if (!open || !mounted) return null;
  const btn = "press flex min-h-14 w-full items-center justify-center gap-2 px-4 text-[17px]";
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "Actions"} className="fixed inset-0 z-[70] flex items-end justify-center px-2 pb-[max(env(safe-area-inset-bottom),8px)]">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 animate-fade bg-black/40" />
      <div ref={panel} className="relative w-full max-w-[460px] animate-rise space-y-2">
        <div className="material overflow-hidden rounded-[14px] border text-fg [&>*+*]:hairline-t">
          {title && (
            <p id={titleId} className="px-4 py-3 text-center text-[13px] font-semibold text-fg-muted">
              {title}
            </p>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={a.disabled}
              onClick={() => {
                haptic(a.destructive ? "medium" : "light");
                onClose();
                a.onSelect();
              }}
              className={`${btn} disabled:opacity-40 ${a.destructive ? "text-[#d70015] [[data-theme=dark]_&]:text-[#ff6961]" : "text-[color:var(--focus)]"}`}
            >
              {a.icon && <Icon name={a.icon} className="size-5" />}
              {a.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className={`${btn} material rounded-[14px] border font-semibold text-[color:var(--focus)]`}>
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** "More" ellipsis button that opens an ActionSheet: the standard way to tuck 2+ secondary actions away. */
export function MoreActions({ label = "More actions", title, actions, className = "" }: { label?: string; title?: string; actions: SheetAction[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => {
          haptic("light");
          setOpen(true);
        }}
        className={`hit press grid size-9 place-items-center rounded-full text-fg-muted hover:text-fg ${className}`}
      >
        <Icon name="more" className="size-5" />
      </button>
      <ActionSheet open={open} onClose={() => setOpen(false)} title={title} actions={actions} />
    </>
  );
}

/* ── stepper ────────────────────────────────────────────────────────────────────────────────────────────── */

/** iOS stepper: − value +. `label` names the value for screen readers (spinbutton semantics). */
export function Stepper({ label, value, onChange, min = 0, max = 99, step = 1, unit, className = "" }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; className?: string }) {
  const set = (v: number) => {
    const n = Math.min(max, Math.max(min, v));
    if (n !== value) {
      haptic("light");
      onChange(n);
    }
  };
  const btn = "hit press grid size-9 place-items-center rounded-full text-fg disabled:opacity-30";
  return (
    <div
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={unit ? `${value} ${unit}` : String(value)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") (e.preventDefault(), set(value + step));
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") (e.preventDefault(), set(value - step));
        if (e.key === "Home") (e.preventDefault(), set(min));
        if (e.key === "End") (e.preventDefault(), set(max));
      }}
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface-3/70 p-1 ${className}`}
    >
      <button type="button" tabIndex={-1} aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => set(value - step)} className={btn}>
        <Icon name="minus" className="size-4" />
      </button>
      <span key={value} className="spring-pop min-w-10 text-center text-[15px] font-semibold tabular-nums text-fg">
        {value}
        {unit && <span className="ml-0.5 text-[13px] font-medium text-fg-muted">{unit}</span>}
      </span>
      <button type="button" tabIndex={-1} aria-label={`More ${label}`} disabled={value >= max} onClick={() => set(value + step)} className={btn}>
        <Icon name="plus" className="size-4" />
      </button>
    </div>
  );
}

/* ── large title → compact bar ──────────────────────────────────────────────────────────────────────────── */

/** Watches a large-title element; returns true once it has scrolled under the top bar (show the compact title). */
export function useCollapsedTitle<T extends HTMLElement>(offset = 56) {
  const ref = useRef<T>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { rootMargin: `-${offset}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [offset]);
  return [ref, collapsed] as const;
}
