"use client";

import type { ReactNode } from "react";
import { InfoTip } from "@/components/kit";
import { Icon } from "@/components/studio";
import { rwf } from "@/lib/api";
import { THEMES } from "@/lib/maker";

/** Numbered section of the guided product editor. */
export function EditorSection({ n, title, hint, children, id }: { n: number; title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={`${id ?? n}-t`} className="st-card scroll-mt-28 rounded-[24px] p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-cocoa font-display text-sm font-black text-white">{n}</span>
        <h3 id={`${id ?? n}-t`} className="min-w-0 font-display text-lg font-black leading-tight tracking-tight text-cocoa">{title}</h3>
        {hint && <InfoTip label={`About ${title}`} className="-ml-2">{hint}</InfoTip>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/**
 * Live preview of a product card as shoppers see it in the (dark) Maker Space.
 * Decorative mirror of the form; images use empty alt so they never duplicate accessible names.
 */
export function ProductPreview({
  title,
  priceRwf,
  image,
  colours,
  madeToOrder,
  leadTimeDays,
  pageName,
  theme,
  compact,
}: {
  title: string;
  priceRwf: number;
  image?: string | null;
  colours: { name: string; hex: string }[];
  madeToOrder: boolean;
  leadTimeDays: number;
  pageName: string;
  theme: string;
  compact?: boolean;
}) {
  const hex = colours[0]?.hex ?? "#c8553d";
  return (
    <figure className={`theme-media overflow-hidden rounded-[26px] bg-ink text-txt shadow-[0_24px_50px_-28px_rgba(29,24,20,.8)] ${compact ? "flex items-stretch" : ""}`}>
      <div className={`relative ${compact ? "w-28 shrink-0" : "aspect-[4/5]"}`} style={{ background: THEMES[theme] ?? THEMES.terra }}>
        <div className="absolute inset-0 opacity-20 [background-image:repeating-linear-gradient(45deg,#fff_0_2px,transparent_2px_22px),repeating-linear-gradient(-45deg,#fff_0_2px,transparent_2px_22px)]" />
        <div className={`absolute ${compact ? "inset-2" : "inset-5"} grid place-items-center overflow-hidden rounded-[20px] bg-white/10 backdrop-blur-sm`}>
          {image ? (
            <img src={image} alt="" className="size-full object-cover" />
          ) : (
            <svg viewBox="0 0 100 120" aria-hidden className="h-4/5 drop-shadow-[0_10px_20px_rgba(0,0,0,.35)]">
              <path d="M38 8c4 5 20 5 24 0l14 8 8 22-12 5-3-10 6 79H25l6-79-3 10-12-5 8-22z" fill={hex} />
              <path d="M38 8c4 5 20 5 24 0" stroke="#fff" strokeOpacity=".5" strokeWidth="2" fill="none" />
            </svg>
          )}
        </div>
        {!compact && (
          <span className="glass absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold text-white">Try on me</span>
        )}
      </div>
      <figcaption className={`space-y-1.5 ${compact ? "min-w-0 flex-1 p-3" : "p-4"}`}>
        <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-gold">Live preview · Maker Space</p>
        <p className="truncate font-display text-lg font-black leading-tight">{title || "Your product title"}</p>
        <p className="text-sm font-bold">{priceRwf ? rwf(priceRwf) : "RWF —"}</p>
        <div className="flex items-center gap-2 text-xs text-mut">
          <span className="flex -space-x-1">
            {(colours.length ? colours : [{ name: "", hex }]).slice(0, 5).map((c, i) => (
              <span key={i} className="size-3.5 rounded-full ring-2 ring-ink" style={{ background: c.hex }} />
            ))}
          </span>
          <span className="truncate">{madeToOrder ? `Made to order · ${leadTimeDays} days` : "Ready to wear"}</span>
        </div>
        {!compact && (
          <p className="flex items-center gap-1.5 pt-1 text-xs text-mut">
            <Icon name="scissors" className="size-3.5" /> {pageName}
          </p>
        )}
      </figcaption>
    </figure>
  );
}

export const EDITOR_STEPS = ["Details", "Colours", "Photos", "Publish"];
