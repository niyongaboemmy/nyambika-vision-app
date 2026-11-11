"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ErrorNote, Screen, TopBar } from "@/components/ui";
import { RestyleSheet } from "@/components/wardrobe-restyle";
import { rwf } from "@/lib/api";
import { nice, type OwnedItem } from "@/lib/social";
import { useApi } from "@/lib/use-api";

type Item = OwnedItem & { outfits: { id: string; eventId: string; event: string; image: string }[] };

/** One owned piece: details, where it came from, and the outfits the Muse built around it. */
export default function WardrobeItem() {
  const { id } = useParams<{ id: string }>();
  const { data: item, error } = useApi<Item>(`/wardrobe/items/${id}`);
  const [restyle, setRestyle] = useState(false);

  return (
    <Screen className="pb-28">
      <TopBar back="/wardrobe" />
      <ErrorNote error={error} />
      {!item ? (
        !error && <div className="mx-5 skeleton h-[52vh] rounded-[32px]" />
      ) : (
        <>
          <div className="relative mx-5 grid h-[46vh] place-items-center overflow-hidden rounded-[32px] border border-white/12" style={{ background: `radial-gradient(70% 60% at 50% 40%, ${item.colourHex}55, transparent 70%), rgba(255,255,255,.04)` }}>
            {item.image && <img src={item.image} alt={item.title} className="h-full w-full animate-rise object-contain p-6" />}
            <span className="absolute left-3 top-3 rounded-full bg-mint/90 px-2.5 py-1 text-xs font-bold text-ink">Owned</span>
          </div>
          <section className="px-5 pt-4">
            <h1 className="font-display text-[28px] font-black leading-tight">{item.title}</h1>
            <p className="text-txt/80">
              <span className="mr-1.5 inline-block size-3 rounded-full align-middle" style={{ background: item.colourHex }} />
              {item.colourName} · size {item.size} · {nice(item.category)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {item.occasions.map((o) => <span key={o} className="rounded-full bg-white/10 px-2.5 py-1">{nice(o)}</span>)}
            </div>
            <Link href={`/m/${item.maker.handle}`} className="glass mt-4 flex min-h-14 items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-bold">{item.maker.name}</span>
                <span className="block truncate text-xs text-mut">{rwf(item.priceRwf)} · {item.orderCode}</span>
              </span>
              <span aria-hidden>→</span>
            </Link>
          </section>
          <section className="px-5 pt-6">
            <h2 className="font-display text-lg font-black">Styled by the Muse</h2>
            {item.outfits.length ? (
              <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
                {item.outfits.map((o) => (
                  <Link key={o.id} href={`/wardrobe/events/${o.eventId}`} className="w-28 shrink-0">
                    <img src={o.image} alt={`Outfit for ${o.event}`} className="aspect-[3/4] w-full rounded-2xl bg-white/5 object-cover" />
                    <span className="mt-1 block truncate text-xs text-mut">{o.event}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-mut">No outfits yet</p>
            )}
          </section>
          <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-6 fade-bottom">
            <button onClick={() => setRestyle(true)} className="grad-cta min-h-14 w-full rounded-2xl font-display text-lg font-black">✨ Restyle for an event</button>
          </div>
          <RestyleSheet open={restyle} onClose={() => setRestyle(false)} />
        </>
      )}
    </Screen>
  );
}
