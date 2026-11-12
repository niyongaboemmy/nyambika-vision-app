"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
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

/** Credit line in the CC "TASL" form: title, author, source, licence, plus what was changed. */
export function CreditBody({ c }: { c: Credit }) {
  return (
    <dl className="space-y-2 text-[14px]">
      <div>
        <dt className="text-xs font-semibold uppercase tracking-[.14em] text-mut">Source</dt>
        <dd>
          <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">{c.title}</a>
          <span className="text-mut"> · {c.author}</span>
        </dd>
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-[.14em] text-mut">Licence</dt>
        <dd>
          {c.licenceUrl ? <a href={c.licenceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{c.licence}</a> : c.licence}
          {c.shareAlike && <span className="text-mut"> · share-alike</span>}
        </dd>
      </div>
      {c.changes.length > 0 && (
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[.14em] text-mut">Modified</dt>
          <dd className="text-mut">{c.changes.join(" · ")}</dd>
        </div>
      )}
    </dl>
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
          <div className="h-24 animate-pulse rounded-2xl bg-white/10" />
        ) : credit ? (
          <div className="space-y-3">
            {credit.illustration && <p className="inline-block rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold text-gold">Illustration</p>}
            <CreditBody c={credit} />
          </div>
        ) : (
          <p className="text-[14px] text-mut">Photo by the maker.</p>
        )}
        <Link href="/credits" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-gold underline underline-offset-2">All image credits</Link>
      </Sheet>
    </>
  );
}
