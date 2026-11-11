"use client";

import Link from "next/link";
import { Screen, TopBar } from "@/components/ui";
import { rwf } from "@/lib/api";
import type { Look } from "@/lib/looks";
import { useApi } from "@/lib/use-api";

/** Saved looks (R1 precursor of the digital wardrobe, CR-09). */
export default function Saved() {
  const { data } = useApi<Look[]>("/looks/saved");
  return (
    <Screen>
      <TopBar back="/" title="Saved looks" />
      <main className="grid grid-cols-2 gap-3 p-4">
        {data?.map((l) => (
          <Link key={l.id} href={`/looks/${l.intentSessionId}`} className="glass overflow-hidden rounded-3xl">
            {l.image ? <img loading="lazy" decoding="async" src={l.image} alt={l.product.title} className="aspect-[9/16] w-full object-cover" /> : <div className="skeleton aspect-[9/16]" />}
            <div className="p-2">
              <p className="truncate text-sm font-semibold">{l.product.title}</p>
              <p className="truncate text-xs text-mut">{l.maker.name}</p>
              <p className="tabular text-xs font-bold">{rwf(l.product.priceRwf)}</p>
            </div>
          </Link>
        ))}
        {data?.length === 0 && <p className="col-span-2 pt-10 text-center text-mut">Double-tap a look to save it here.</p>}
      </main>
    </Screen>
  );
}
