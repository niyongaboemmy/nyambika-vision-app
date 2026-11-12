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
import { InfoTip } from "./kit";
import { isExpectedText, LimitState } from "./limit-state";
import { Icon, type IconName } from "./icons";
import { haptic } from "@/lib/native";
import { useSheetDrag } from "@/lib/sheet-drag";

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
  outline: "bg-white text-cocoa shadow-e1 hover:bg-paper",
  soft: "bg-paper-2 text-cocoa hover:bg-paper-3",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-cocoa-2 hover:bg-paper-2 hover:text-cocoa",
};

export function SButton({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: SVariant }) {
  return (
    <button
      {...p}
      className={`st-press inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-4 text-sm font-bold disabled:pointer-events-none disabled:opacity-45 ${SBTN[variant]} ${className}`}
    />
  );
}

/** Same look as SButton for navigation (a real link, never a button nested in a link). */
export function SLink({ href, variant = "primary", className = "", children, ...p }: { href: string; variant?: SVariant; className?: string; children: ReactNode; target?: string; rel?: string; "aria-label"?: string }) {
  return (
    <Link href={href} {...p} className={`st-press inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl px-4 text-sm font-bold ${SBTN[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** Hints up to this length stay inline under the control; longer ones become an ⓘ popover next to the label. */
const SHORT_HINT = 28;

/** Single control: a wrapping <label>. Groups of buttons/checkboxes: pass `group` for <fieldset>/<legend>.
 *  Long hints render as an ⓘ InfoTip beside the label (outside the <label>, so it wraps only one control). */
export function Field({ label, hint, children, group }: { label: string; hint?: string; children: ReactNode; group?: boolean }) {
  const hintId = useId();
  const long = Boolean(hint && hint.length > SHORT_HINT);
  const inline = hint && !long ? <span className="block text-xs leading-relaxed text-cocoa-2">{hint}</span> : null;
  const tip = long ? <InfoTip label="More info">{hint}</InfoTip> : null;
  if (group) {
    return (
      <fieldset className="min-w-0 space-y-2" aria-describedby={long ? hintId : undefined}>
        <legend className="mb-2 flex items-center gap-1 text-[13px] font-bold text-cocoa">
          {label}
          {tip}
        </legend>
        {long && <span id={hintId} className="sr-only">{hint}</span>}
        {children}
        {inline}
      </fieldset>
    );
  }
  if (!long) {
    return (
      <label className="block space-y-1.5">
        <span className="text-[13px] font-bold text-cocoa">{label}</span>
        {children}
        {inline}
      </label>
    );
  }
  // Visible label text + ⓘ in one row; the <label> keeps the accessible name (sr-only copy) and wraps one control.
  return (
    <div className="space-y-1.5">
      <span className="-my-1 flex items-center gap-0.5 text-[13px] font-bold text-cocoa">
        <span aria-hidden>{label}</span>
        {tip}
      </span>
      <label className="block">
        <span className="sr-only">{label}</span>
        {children}
      </label>
    </div>
  );
}

// Filled field (iOS): a tinted fill gives the affordance, no outline; focus lifts it to the card surface with a ring.
const inputCls =
  "min-h-11 w-full rounded-2xl bg-fill px-3.5 py-3 text-[15px] text-cocoa placeholder:text-cocoa-3 outline-none transition focus:bg-white focus:ring-2 focus:ring-violet-ink/60 disabled:opacity-60";
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
  mint: "bg-emerald-50 text-mint-ink",
  gold: "bg-amber-50 text-gold-ink",
  sky: "bg-sky-50 text-sky-800",
  red: "bg-red-50 text-red-800",
  stone: "bg-paper-2 text-cocoa-2",
  violet: "bg-violet-50 text-violet-ink",
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
    <span className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${TONE[tone]}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="truncate">{label ?? value.replace(/_/g, " ").toLowerCase()}</span>
    </span>
  );
}

/** Generic chip in a given tone (for counts, hints and AI labels). */
export function Chip({ tone = "stone", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${TONE[tone]} ${className}`}>{children}</span>;
}

export interface StudioNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Shown only in the sidebar / More sheet on phones (the dock keeps 4–5 slots). */
  secondary?: boolean;
  /** One-line description under the label in the More sheet. */
  hint?: string;
  /** Dock label when the full one would not fit a fifth of a phone (the full label stays the accessible name). */
  short?: string;
}

/** One list drives the phone dock, the desktop sidebar and PageTabs. Add a studio section with one line here. */
export function studioNav(pageId: string, isCoop: boolean, member?: boolean, tailor?: boolean): StudioNavItem[] {
  const base = `/studio/${pageId}`;
  return [
    { href: base, label: "Home", icon: "home" },
    { href: `${base}/products`, label: member ? "My products" : "Products", short: "Products", icon: "hanger" },
    ...(member ? [] : [{ href: `${base}/orders`, label: "Orders", icon: "inbox" } as StudioNavItem]),
    ...(tailor && !member ? [{ href: `${base}/tailor`, label: "Custom orders", short: "Custom", icon: "scissors" } as StudioNavItem] : []),
    ...(isCoop && !member ? [{ href: `${base}/makers`, label: "Makers", icon: "users" } as StudioNavItem] : []),
    ...(member ? [] : [{ href: `${base}/grow`, label: "Grow", icon: "trend", secondary: true, hint: "Promo cards, offers, followers, insights" } as StudioNavItem]),
    ...(member ? [] : [{ href: `${base}/showroom`, label: "Showroom", icon: "layers", secondary: true, hint: "3D showroom, VR and virtual fashion shows" } as StudioNavItem]),
    ...(member && isCoop ? [{ href: `${base}/easy`, label: "Easy mode", icon: "sparkle" } as StudioNavItem] : []),
    ...(member ? [] : [{ href: `${base}/settings`, label: "Settings", icon: "settings", secondary: true, hint: "Profile, theme, payouts, plan, staff" } as StudioNavItem]),
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
            className={`st-press whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold ${active ? "bg-cocoa text-white" : "bg-white text-cocoa-2 hover:text-cocoa"}`}
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
    <div className="flex flex-col items-center gap-3 rounded-[22px] bg-white/60 px-6 py-10 text-center">
      <span className="st-hero grid size-14 place-items-center rounded-2xl text-terra-ink shadow-sm">
        <Icon name={icon} className="size-6" />
      </span>
      {title && <p className="text-balance font-display text-lg font-black text-cocoa">{title}</p>}
      <div className="max-w-sm text-pretty text-sm leading-relaxed text-cocoa-2">{children}</div>
      {action}
    </div>
  );
}

/** Expected limits (daily cap, consent, rate limit, NLB gate, offline…) render as the calm LimitState card. */
export function Note({ error, ok, onRetry }: { error?: unknown; ok?: string | null; onRetry?: () => void }) {
  if (error && (typeof error !== "string" || isExpectedText(error))) return <LimitState error={error} tone="light" onRetry={onRetry} />;
  if (typeof error === "string" && error)
    return (
      <p role="alert" className="flex items-start gap-2 rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </p>
    );
  if (ok)
    return (
      <p role="status" className="flex animate-pop items-start gap-2 rounded-2xl bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-mint-ink">
        <Icon name="check" className="mt-0.5 size-4 shrink-0" />
        <span>{ok}</span>
      </p>
    );
  return null;
}

/* ───────────────────────── new building blocks ───────────────────────── */

// Skeletons live in skeletons.tsx (no "use client": route loading.tsx files render them on the server with no
// client JS, JS budget pass); re-exported here so existing imports keep working.
export { Skeleton, ScreenSkeleton } from "./skeletons";

export function SectionTitle({ title, eyebrow, action, as: H = "h2", id }: { title: ReactNode; eyebrow?: string; action?: ReactNode; as?: "h1" | "h2" | "h3"; id?: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-terra-ink">{eyebrow}</p>}
        {/* h1 = iOS large title (34/28 pt bold, tight tracking); collapses into the shell header on scroll. */}
        <H id={id} className={`truncate font-display font-bold text-cocoa ${H === "h1" ? "text-[28px] leading-[1.15] tracking-[-0.02em] sm:text-[34px]" : "text-[20px] tracking-[-0.01em] sm:text-[22px]"}`}>{title}</H>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Segmented control (single choice). Buttons expose aria-pressed; the group has a label. */
export function Segmented<T extends string>({ label, options, value, onChange, className = "" }: { label: string; options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  // iOS segmented control: one thumb that slides (spring) to the selected segment; measured from the DOM.
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const place = () => {
      const b = root.querySelector<HTMLElement>('button[aria-pressed="true"]');
      if (b) setThumb({ x: b.offsetLeft, w: b.offsetWidth });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(root);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div ref={box} role="group" aria-label={label} className={`no-scrollbar relative flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-paper-2 p-1 ${className}`}>
      {thumb && <span aria-hidden className="spring pointer-events-none absolute bottom-1 top-1 left-0 rounded-xl bg-white shadow-[0_3px_8px_rgba(0,0,0,.12),0_1px_1px_rgba(0,0,0,.04)]" style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }} />}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (!on) haptic("light");
              onChange(o.value);
            }}
            className={`hit st-press relative inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition-colors ${on ? `text-cocoa ${thumb ? "" : "bg-white shadow-sm"}` : "text-cocoa-2 hover:text-cocoa"}`}
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
    <div className={`st-card flex min-w-0 flex-col gap-1.5 rounded-[22px] p-4 ${warn ? "!bg-amber-50" : ""} ${className}`}>
      <p className="flex items-center gap-1.5 text-xs font-bold text-cocoa-2">
        {warn && <Icon name="alert" className="size-3.5 text-gold-ink" />}
        {label}
      </p>
      <p className="break-words font-display text-[clamp(1.25rem,5.5vw,1.5rem)] font-black leading-tight tracking-tight text-cocoa tabular-nums">{value}</p>
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
    // iOS geometry: 51×31 track, 27 px knob on a spring, row at least 44 px tall; haptic tick on change.
    <label className={`flex min-h-11 cursor-pointer items-center justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-[15px] font-semibold text-cocoa">{label}</span>}
          {description && <span className="mt-0.5 block text-xs leading-snug text-cocoa-2">{description}</span>}
        </span>
      )}
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          aria-label={ariaLabel}
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            haptic("light");
            onChange(e.target.checked);
          }}
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
        />
        <span aria-hidden className="h-[31px] w-[51px] rounded-full bg-paper-3 transition-colors duration-200 peer-checked:bg-[var(--ios-green)] peer-focus-visible:outline peer-focus-visible:outline-[2.5px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-violet-ink" />
        <span aria-hidden className="spring absolute left-0.5 top-0.5 size-[27px] rounded-full bg-[#fff] shadow-[0_3px_8px_rgba(0,0,0,.15),0_1px_1px_rgba(0,0,0,.16)] peer-checked:translate-x-5 peer-active:scale-x-110" />
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
  const { panel, handle } = useSheetDrag(onClose);
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
  }, [open, onClose, panel]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="theme-light fixed inset-0 z-[60] flex items-end justify-center lg:items-stretch lg:justify-end" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button aria-label="Close" tabIndex={-1} className="absolute inset-0 animate-fade bg-cocoa/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className="relative flex max-h-[92dvh] w-full max-w-[560px] animate-rise flex-col rounded-t-[30px] bg-paper shadow-2xl lg:h-full lg:max-h-none lg:max-w-[460px] lg:animate-slide-in lg:rounded-none lg:rounded-l-[30px]"
      >
        {/* Grabber + title row are the drag handle (drag down to dismiss on phones). */}
        <div {...handle} className="shrink-0 cursor-grab active:cursor-grabbing lg:cursor-auto">
          <div aria-hidden className="mx-auto mt-2 h-[5px] w-9 rounded-full bg-paper-3 lg:hidden" />
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 lg:pt-6">
            <h2 id={titleId} tabIndex={-1} className="font-display text-[20px] font-bold tracking-[-0.01em] text-cocoa outline-none">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="hit st-press grid size-8 place-items-center rounded-full bg-paper-2 text-cocoa-2 hover:text-cocoa">
              <Icon name="x" className="size-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && <div className="hairline-t px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">{footer}</div>}
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
            className={`st-press inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold ${sel ? "bg-cocoa text-white" : "bg-fill text-cocoa hover:bg-fill-2"}`}
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

/* ───────────────────────── icons ─────────────────────────
 * The icon set lives in icons.tsx (JS budget pass) so shopper routes that only need <Icon> do not ship the studio
 * kit; re-exported here so existing `@/components/studio` imports keep working. */
export { Icon, type IconName } from "./icons";
