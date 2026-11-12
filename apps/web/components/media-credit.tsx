"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Group } from "@/components/ios";
import { Sheet } from "@/components/ui";
import { api } from "@/lib/api";

export interface Credit {
  title: string;
  author: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string;
  shareAlike: boolean;
  changes: string[];
  illustration: boolean;
}

/** Credit in the CC "TASL" form (title, author, source, licence) plus what was changed, as an iOS grouped list. */
export function CreditBody({ c }: { c: Credit }) {
  const row = "flex min-h-11 flex-col justify-center gap-0.5 px-4 py-2.5";
  const label = "text-[13px] text-fg-muted";
  return (
    <Group>
      <li className={row}>
        <span className={label}>Source</span>
        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-[15px] font-medium text-fg underline underline-offset-2 [overflow-wrap:anywhere]">{c.title}</a>
        <span className="text-[13px] text-fg-muted">{c.author}</span>
      </li>
      <li className={row}>
        <span className={label}>Licence</span>
        <span className="text-[15px] text-fg">
          {c.licenceUrl ? <a href={c.licenceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{c.licence}</a> : c.licence}
          {c.shareAlike && <span className="text-fg-muted"> · share-alike</span>}
        </span>
      </li>
      {c.changes.length > 0 && (
        <li className={row}>
          <span className={label}>Modified</span>
          <span className="text-[15px] text-fg">{c.changes.join(" · ")}</span>
        </li>
      )}
    </Group>
  );
}

/**
 * Small ⓘ over a product image. Opens a sheet with the image credit (seeded open-licence photos, cut-outs,
 * recolours, illustrations). Place inside a `relative` wrapper. Images without a credit say who made them.
 */
export function MediaCreditButton({ src, className = "absolute bottom-1.5 right-1.5" }: { src: string | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false);
  const [credit, setCredit] = useState<Credit | null | undefined>(undefined);
  if (!src) return null;
  async function show() {
    setOpen(true);
    if (credit === undefined) setCredit((await api<{ credit: Credit | null }>(`/credits/media?src=${encodeURIComponent(src!)}`).catch(() => ({ credit: null }))).credit);
  }
  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="Image credit"
        className={`${className} grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur focus-visible:outline-2 focus-visible:outline-gold`}
      >
        <Icon name="info" className="size-4" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Image credit">
        {credit === undefined ? (
          <div className="h-24 animate-pulse rounded-[var(--radius-md)] bg-fill" />
        ) : credit ? (
          <div className="space-y-3">
            {credit.illustration && <p className="inline-block rounded-full bg-fill px-2.5 py-0.5 text-[13px] font-semibold text-fg">Illustration</p>}
            <CreditBody c={credit} />
          </div>
        ) : (
          <p className="text-[15px] text-fg-muted">Photo by the maker.</p>
        )}
        <Link href="/credits" className="mt-3 inline-flex min-h-11 items-center px-4 text-[15px] font-semibold text-accent">All image credits</Link>
      </Sheet>
    </>
  );
}
