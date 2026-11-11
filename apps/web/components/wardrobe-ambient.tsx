"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { whenLabel, type EventSummary } from "@/lib/social";

/** Ambient card on the Muse home (prototype v2 · 17): "Wedding in 3 days: your outfit is ready". */
export function WardrobeAmbient() {
  const [e, setE] = useState<EventSummary | null>(null);
  useEffect(() => {
    api<EventSummary | null>("/wardrobe/ambient").then(setE).catch(() => {});
  }, []);
  if (!e) return null;
  return (
    <Link href={`/wardrobe/events/${e.id}`} className="glass mt-4 block w-full max-w-sm animate-rise rounded-3xl p-4 text-left">
      <p className="font-display text-[17px] font-black">👗 {e.title} {whenLabel(e.daysUntil)}: your outfit is ready</p>
      <p className="text-sm text-txt/75">The Muse styled your wardrobe {e.ready} way{e.ready === 1 ? "" : "s"}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {e.thumbs.map((t) => <img loading="lazy" decoding="async" key={t} src={t} alt="" className="aspect-[3/4] w-full rounded-xl bg-white/5 object-cover" />)}
      </div>
    </Link>
  );
}
