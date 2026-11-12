/*
 * The presentational half of the kit (no hooks, no "use client"; JS budget pass 2): skeletons, the "Learn more"
 * disclosure and icon facts. Server components and `loading.tsx` render these with no client JS; kit.tsx re-exports
 * them so client imports keep working.
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

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

/* ── "Learn more" disclosure ─────────────────────────────────────────────────────────────────────────────── */

/** Keeps legal/privacy detail one tap away. Native <details> → keyboard + screen-reader friendly by default. */
export function LearnMore({ summary = "Learn more", children, className = "" }: { summary?: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group rounded-2xl ${className}`}>
      <summary className="hit press inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl text-[13px] font-bold text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
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
    <span className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full bg-fill px-2.5 py-1 text-xs font-semibold text-fg ${className}`}>
      <Icon name={icon} className="size-3.5 shrink-0 text-accent" />
      {children}
    </span>
  );
}
