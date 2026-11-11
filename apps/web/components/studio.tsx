"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

/* Light, warm primitives for the member Page Manager and host admin (brief §4 "Tailor / member studio").
 * Exported names and props of Card, SButton, Field, Input, Textarea, Select, Badge, PageTabs, Empty and Note
 * are stable: other studio pages import them. New building blocks are added below them. */

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`st-card rounded-[22px] p-4 sm:p-5 ${className}`}>{children}</div>;
}

type SVariant = "primary" | "outline" | "danger" | "ghost" | "soft" | "dark";
const SBTN: Record<SVariant, string> = {
  primary: "st-cta text-white hover:brightness-110",
  dark: "bg-cocoa text-white hover:bg-black",
  outline: "border border-hairline bg-white text-cocoa hover:border-cocoa-3",
  soft: "bg-paper-2 text-cocoa hover:bg-paper-3",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-cocoa-2 hover:bg-paper-2 hover:text-cocoa",
};

export function SButton({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: SVariant }) {
  return (
    <button
      {...p}
      className={`st-press inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold disabled:pointer-events-none disabled:opacity-45 ${SBTN[variant]} ${className}`}
    />
  );
}

/** Same look as SButton for navigation (a real link, never a button nested in a link). */
export function SLink({ href, variant = "primary", className = "", children, ...p }: { href: string; variant?: SVariant; className?: string; children: ReactNode; target?: string; rel?: string; "aria-label"?: string }) {
  return (
    <Link href={href} {...p} className={`st-press inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold ${SBTN[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** Single control: a wrapping <label>. Groups of buttons/checkboxes: pass `group` for <fieldset>/<legend>. */
export function Field({ label, hint, children, group }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  if (group) {
    return (
      <fieldset className="space-y-2">
        <legend className="mb-2 text-[13px] font-bold text-cocoa">{label}</legend>
        {children}
        {hint && <span className="block text-xs leading-relaxed text-cocoa-2">{hint}</span>}
      </fieldset>
    );
  }
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-bold text-cocoa">{label}</span>
      {children}
      {hint && <span className="block text-xs leading-relaxed text-cocoa-2">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-2xl border border-hairline bg-white px-3.5 py-3 text-[15px] text-cocoa placeholder:text-cocoa-3 shadow-[inset_0_1px_2px_rgb(29_24_20/0.04)] outline-none transition focus:border-violet-ink focus:ring-4 focus:ring-violet-ink/15 disabled:bg-paper-2";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${inputCls} min-h-28 leading-relaxed ${p.className ?? ""}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...p}
    className={`${inputCls} appearance-none bg-[length:18px] bg-[right_12px_center] bg-no-repeat pr-10 ${p.className ?? ""}`}
    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235c524a' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, ...p.style }}
  />
);

type Tone = "mint" | "gold" | "sky" | "red" | "stone" | "violet";
const TONE: Record<Tone, string> = {
  mint: "bg-emerald-50 text-mint-ink ring-emerald-200",
  gold: "bg-amber-50 text-gold-ink ring-amber-200",
  sky: "bg-sky-50 text-sky-800 ring-sky-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  stone: "bg-paper-2 text-cocoa-2 ring-hairline",
  violet: "bg-violet-50 text-violet-ink ring-violet-200",
};
const DOT: Record<Tone, string> = { mint: "bg-emerald-500", gold: "bg-amber-500", sky: "bg-sky-500", red: "bg-red-500", stone: "bg-stone-400", violet: "bg-violet-500" };

const BADGE: Record<string, Tone> = {
  PUBLISHED: "mint",
  READY: "mint",
  PAID: "mint",
  COMPLETED: "mint",
  DELIVERED: "mint",
  LIVE: "mint",
  ACTIVE: "mint",
  DRAFT: "stone",
  NOT_ASSESSED: "stone",
  IMPORTED: "stone",
  ARCHIVED: "stone",
  ROLLED_BACK: "stone",
  RETIRED: "stone",
  PENDING_APPROVAL: "gold",
  PENDING_VERIFICATION: "gold",
  AWAITING_PAYMENT: "gold",
  NEEDS_BETTER_PHOTO: "gold",
  IN_REVIEW: "gold",
  NEW: "gold",
  OUT_OF_STOCK: "gold",
  PAUSED: "sky",
  ACCEPTED: "sky",
  IN_PREPARATION: "violet",
  READY_FOR_PICKUP: "sky",
  SHIPPED: "sky",
  SIGNED_OFF: "sky",
  RESOLVED: "sky",
  NOT_SUPPORTED: "red",
  SUSPENDED: "red",
  CANCELLED: "red",
  DECLINED: "red",
  DISPUTED: "red",
  CHANGES_REQUESTED: "red",
};

export const badgeTone = (value: string): Tone => BADGE[value] ?? "stone";

/** Status chip with a coloured dot. Text always carries the meaning (never colour alone). */
export function Badge({ value, label }: { value: string; label?: string }) {
  const tone = badgeTone(value);
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${TONE[tone]}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="truncate">{label ?? value.replace(/_/g, " ").toLowerCase()}</span>
    </span>
  );
}

/** Generic chip in a given tone (for counts, hints and AI labels). */
export function Chip({ tone = "stone", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${TONE[tone]} ${className}`}>{children}</span>;
}

export interface StudioNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Shown only in the sidebar / More sheet on phones (the dock keeps 4–5 slots). */
  secondary?: boolean;
}

/** One list drives the phone dock, the desktop sidebar and PageTabs. Add a studio section with one line here. */
export function studioNav(pageId: string, isCoop: boolean, member?: boolean, tailor?: boolean): StudioNavItem[] {
  const base = `/studio/${pageId}`;
  return [
    { href: base, label: "Home", icon: "home" },
    { href: `${base}/products`, label: member ? "My products" : "Products", icon: "hanger" },
    ...(member ? [] : [{ href: `${base}/orders`, label: "Orders", icon: "inbox" } as StudioNavItem]),
    ...(tailor && !member ? [{ href: `${base}/tailor`, label: "Custom orders", icon: "scissors" } as StudioNavItem] : []),
    ...(isCoop && !member ? [{ href: `${base}/makers`, label: "Makers", icon: "users" } as StudioNavItem] : []),
    ...(member ? [] : [{ href: `${base}/grow`, label: "Grow", icon: "trend" } as StudioNavItem]),
    ...(member && isCoop ? [{ href: `${base}/easy`, label: "Easy mode", icon: "sparkle" } as StudioNavItem] : []),
    ...(member ? [] : [{ href: `${base}/settings`, label: "Settings", icon: "settings", secondary: true } as StudioNavItem]),
  ];
}

export function isNavActive(path: string, href: string, pageId: string) {
  return path === href || (href !== `/studio/${pageId}` && path.startsWith(href));
}

/** Pill tab strip of the page sections (the shell uses the dock/sidebar; kept for pages that want inline tabs). */
export function PageTabs({ pageId, isCoop, member }: { pageId: string; isCoop: boolean; member?: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Page sections" className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4">
      {studioNav(pageId, isCoop, member).map((t) => {
        const active = isNavActive(path, t.href, pageId);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`st-press whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold ${active ? "bg-cocoa text-white" : "bg-white text-cocoa-2 ring-1 ring-hairline hover:text-cocoa"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Designed empty state. `children` stays the message (compatible); icon/title/action are optional. */
export function Empty({ children, icon = "sparkle", title, action }: { children: ReactNode; icon?: IconName; title?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[22px] border border-dashed border-paper-3 bg-white/70 px-6 py-10 text-center">
      <span className="st-hero grid size-14 place-items-center rounded-2xl text-terra-ink shadow-sm">
        <Icon name={icon} className="size-6" />
      </span>
      {title && <p className="font-display text-lg font-black text-cocoa">{title}</p>}
      <div className="max-w-sm text-sm leading-relaxed text-cocoa-2">{children}</div>
      {action}
    </div>
  );
}

export function Note({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error)
    return (
      <p role="alert" className="flex items-start gap-2 rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800 ring-1 ring-inset ring-red-200">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </p>
    );
  if (ok)
    return (
      <p role="status" className="flex animate-pop items-start gap-2 rounded-2xl bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-mint-ink ring-1 ring-inset ring-emerald-200">
        <Icon name="check" className="mt-0.5 size-4 shrink-0" />
        <span>{ok}</span>
      </p>
    );
  return null;
}

/* ───────────────────────── new building blocks ───────────────────────── */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div data-skeleton aria-hidden className={`st-skel rounded-2xl ${className}`} />;
}

/** Content-shaped loading state for a whole studio screen. */
export function ScreenSkeleton({ variant = "bento" }: { variant?: "bento" | "grid" | "list" }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-8 w-48" />
      {variant === "grid" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[4/5]" />)}
        </div>
      ) : variant === "list" ? (
        Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Skeleton className="col-span-2 h-40" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}
    </div>
  );
}

export function SectionTitle({ title, eyebrow, action, as: H = "h2", id }: { title: ReactNode; eyebrow?: string; action?: ReactNode; as?: "h1" | "h2" | "h3"; id?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-terra-ink">{eyebrow}</p>}
        <H id={id} className="truncate font-display text-xl font-black tracking-tight text-cocoa sm:text-2xl">{title}</H>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Segmented control (single choice). Buttons expose aria-pressed; the group has a label. */
export function Segmented<T extends string>({ label, options, value, onChange, className = "" }: { label: string; options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-paper-2 p-1 ring-1 ring-inset ring-hairline ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`st-press inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-bold ${on ? "bg-white text-cocoa shadow-sm" : "text-cocoa-2 hover:text-cocoa"}`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`rounded-full px-1.5 text-[11px] ${on ? "bg-cocoa text-white" : "bg-white/70 text-cocoa-2"}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Tiny inline-SVG sparkline (area + line + end dot). Decorative; the KPI text carries the value. */
export function Sparkline({ data, className = "", tone = "terra" }: { data: number[]; className?: string; tone?: "terra" | "violet" | "mint" | "gold" }) {
  const id = useId().replace(/:/g, "");
  const stroke = { terra: "#c45a2c", violet: "#6d4bd8", mint: "#159a66", gold: "#c48a10" }[tone];
  if (!data.length) return null;
  const w = 100;
  const h = 32;
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden className={`h-8 w-full overflow-visible ${className}`}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** KPI tile for bento grids. */
export function Kpi({ label, value, hint, spark, tone = "terra", warn, className = "" }: { label: string; value: ReactNode; hint?: ReactNode; spark?: number[]; tone?: "terra" | "violet" | "mint" | "gold"; warn?: boolean; className?: string }) {
  return (
    <div className={`st-card flex min-w-0 flex-col gap-1.5 rounded-[22px] p-4 ${warn ? "!border-amber-300 !bg-amber-50" : ""} ${className}`}>
      <p className="flex items-center gap-1.5 text-xs font-bold text-cocoa-2">
        {warn && <Icon name="alert" className="size-3.5 text-gold-ink" />}
        {label}
      </p>
      <p className="font-display text-2xl font-black tracking-tight text-cocoa tabular-nums">{value}</p>
      {spark && spark.length > 1 && <Sparkline data={spark} tone={tone} className="mt-auto" />}
      {hint && <p className="text-xs text-cocoa-2">{hint}</p>}
    </div>
  );
}

/** Usage meter with text label (allowance, makers seats, readiness). */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const r = Math.min(1, value / Math.max(1, max));
  const color = r >= 1 ? "bg-red-600" : r >= 0.8 ? "bg-amber-500" : "bg-gradient-to-r from-terra to-violet";
  return (
    <div>
      <div className="h-2.5 overflow-hidden rounded-full bg-paper-2" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className={`h-full rounded-full transition-[width] duration-700 ${color}`} style={{ width: `${Math.max(2, r * 100)}%` }} />
      </div>
    </div>
  );
}

/** iOS-style switch on top of a real checkbox (works with getByLabel/check and keyboard). */
export function Switch({ checked, onChange, label, description, ariaLabel, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; ariaLabel?: string; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-bold text-cocoa">{label}</span>}
          {description && <span className="mt-0.5 block text-xs leading-relaxed text-cocoa-2">{description}</span>}
        </span>
      )}
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          aria-label={ariaLabel}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
        />
        <span aria-hidden className="h-7 w-12 rounded-full bg-paper-3 transition peer-checked:bg-mint-ink peer-focus-visible:outline peer-focus-visible:outline-[2.5px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-ink" />
        <span aria-hidden className="absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

/** Progress steps for guided flows. */
export function Steps({ steps, current, label = "Progress" }: { steps: string[]; current: number; label?: string }) {
  return (
    <ol aria-label={label} className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <li key={s} aria-current={on ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={`h-1.5 rounded-full transition-colors duration-500 ${done ? "bg-cocoa" : on ? "bg-gradient-to-r from-terra to-violet" : "bg-paper-3"}`} />
            <span className={`truncate text-[11px] font-bold ${on ? "text-cocoa" : "text-cocoa-2"}`}>
              <span className="sr-only">{done ? "Completed: " : on ? "Current: " : ""}</span>
              {i + 1}. {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Light bottom sheet on phones, right-side drawer from 1024px. Portalled, Escape closes, focus moves in and back. */
export function StudioSheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("[data-autofocus],h2")?.focus(), 30);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="theme-light fixed inset-0 z-[60] flex items-end justify-center lg:items-stretch lg:justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button aria-label="Close" tabIndex={-1} className="absolute inset-0 animate-fade bg-cocoa/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className="relative flex max-h-[92dvh] w-full max-w-[560px] animate-rise flex-col rounded-t-[30px] bg-paper shadow-2xl lg:h-full lg:max-h-none lg:max-w-[460px] lg:animate-slide-in lg:rounded-none lg:rounded-l-[30px]"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-paper-3 lg:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 lg:pt-6">
          <h2 id={titleId} tabIndex={-1} className="font-display text-xl font-black tracking-tight text-cocoa outline-none">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="st-press grid size-10 place-items-center rounded-full bg-paper-2 text-cocoa-2 hover:text-cocoa">
            <Icon name="x" className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-hairline px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">{footer}</div>}
        {!footer && <div className="h-[env(safe-area-inset-bottom)]" />}
      </div>
    </div>,
    document.body,
  );
}

/** Toggle pills for multi-select groups (wrap in <Field group>). */
export function TogglePills({ all, on, toggle, labels }: { all: string[]; on: string[]; toggle: (v: string) => void; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {all.map((v) => {
        const sel = on.includes(v);
        return (
          <button
            key={v}
            type="button"
            aria-pressed={sel}
            onClick={() => toggle(v)}
            className={`st-press inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset ${sel ? "bg-cocoa text-white ring-cocoa" : "bg-white text-cocoa ring-hairline hover:ring-cocoa-3"}`}
          >
            {sel && <Icon name="check" className="size-3.5" />}
            {labels?.[v] ?? v.replace(/-/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

/** Initials avatar in brand colours (light theme). */
export function Monogram({ name, size = 40, className = "" }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const hues = ["from-terra to-gold", "from-violet to-sky", "from-terra-2 to-violet", "from-mint to-sky", "from-gold to-terra"];
  const h = hues[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % hues.length];
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br font-display font-black text-white shadow-sm ${h} ${className}`} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials || "•"}
    </span>
  );
}

/* ───────────────────────── icons ───────────────────────── */

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  hanger: "M12 7a2 2 0 1 1 2-2M12 7v1.5L3.6 15a1.5 1.5 0 0 0 .9 2.7h15a1.5 1.5 0 0 0 .9-2.7L12 8.5",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z",
  users: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15 4.15a3.5 3.5 0 0 1 0 6.7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1",
  plus: "M12 5v14M5 12h14",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0",
  camera: "M3 8a2 2 0 0 1 2-2h2l2-3h6l2 3h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10M9 12l2 2 4-4",
  wallet: "M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  store: "M4 9.5V20h16V9.5M3 4h18l-1.5 5.5a2.5 2.5 0 0 1-4.75.5 2.5 2.5 0 0 1-4.75 0 2.5 2.5 0 0 1-4.75-.5zM10 20v-5h4v5",
  palette: "M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-4 3.5h-1.5a1.5 1.5 0 0 0-1 2.6A1.7 1.7 0 0 1 12 21M7.5 11h.01M10.5 7h.01M15 7.5h.01",
  copy: "M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1zM16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
  download: "M12 3v12M7 10l5 5 5-5M4 21h16",
  flag: "M4 21V4M4 4h12l-2 4 2 4H4",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  scissors: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
  logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3",
  upload: "M12 21V9M7 14l5-5 5 5M4 3h16",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  layers: "M12 3 2 8l10 5 10-5zM2 13l10 5 10-5",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.4 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
