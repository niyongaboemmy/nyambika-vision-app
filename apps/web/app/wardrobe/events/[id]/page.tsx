"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorNote, Screen, TopBar } from "@/components/ui";
import { rwf } from "@/lib/api";
import { isRendering } from "@/lib/looks";
import { whenLabel, type WardrobeEventView } from "@/lib/social";
import { useApi } from "@/lib/use-api";

/** Three outfits for one event, rendered on the twin; swipe between them. */
export default function EventOutfits() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<WardrobeEventView>(`/wardrobe/events/${id}`);
  const [index, setIndex] = useState(0);
  const rail = useRef<HTMLDivElement>(null);

  // Refresh while outfits are still rendering.
  useEffect(() => {
    if (!data?.looks.some((l) => isRendering(l.status))) return;
    const t = setTimeout(() => void reload(), 1500);
    return () => clearTimeout(t);
  }, [data, reload]);

  useEffect(() => {
    const el = rail.current;
    if (!el || !data) return;
    const on = () => setIndex(Math.round(el.scrollLeft / (el.scrollWidth / data.looks.length)));
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [data]);

  if (error) return <Screen><TopBar back="/wardrobe" /><div className="p-5"><ErrorNote error={error} /></div></Screen>;
  const date = data ? new Date(data.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";

  return (
    <Screen className="pb-10">
      <TopBar back="/wardrobe" title={data ? `${data.title} · ${date}` : undefined} />
      <header className="px-5 text-center">
        {data ? (
          <>
            <h1 className="font-display text-[28px] font-black leading-tight">{data.title} {whenLabel(data.daysUntil)}</h1>
            <p className="text-sm text-txt/80">{data.rendering ? "The Muse is styling your wardrobe on your twin…" : `${data.ready} outfit${data.ready === 1 ? "" : "s"} ready · swipe to compare`}</p>
            {data.reminderSentAt ? (
              <p className="mt-2 inline-block rounded-full bg-[#25D366]/20 px-3 py-1 text-xs font-semibold text-[#7ff0a8]">📲 WhatsApp reminder sent</p>
            ) : data.daysUntil > 3 ? (
              <p className="mt-2 inline-block rounded-full bg-white/10 px-3 py-1 text-xs text-txt/80">📲 We&apos;ll remind you on WhatsApp 3 days before</p>
            ) : null}
          </>
        ) : (
          <div className="skeleton mx-auto h-8 w-2/3 rounded-xl" />
        )}
      </header>

      <div ref={rail} className="no-scrollbar mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-[8%]" aria-label="Outfits">
        {(data?.looks ?? [null, null, null]).map((o, i) => (
          <article key={o?.id ?? i} className={`w-[84vw] max-w-[400px] shrink-0 snap-center transition duration-300 ${i === index ? "" : "scale-[.95] opacity-70"}`} aria-label={`Outfit ${i + 1}`}>
            <div className="relative h-[min(54vh,500px)] overflow-hidden rounded-[32px] border border-white/15 bg-[#15131b]">
              {o?.image ? (
                <img src={o.image} alt={`Outfit ${i + 1}: ${o.pieces.map((p) => p.title).join(" with ")}, AI preview on your twin`} className="h-full w-full animate-rise object-contain" />
              ) : o && !isRendering(o.status) ? (
                <p className="grid h-full place-items-center px-8 text-center text-sm text-mut">This one didn&apos;t pass our quality check, so we won&apos;t show it.</p>
              ) : (
                <div className="skeleton relative h-full" role="status" aria-label="Rendering outfit">
                  <div className="absolute inset-x-0 h-1 animate-[scan_1.6s_ease-in-out_infinite] bg-sky shadow-[0_0_18px_#38bdf8]" />
                </div>
              )}
              {o && <span className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-bold">Look {i + 1} / {data!.looks.length}</span>}
              {o?.c2pa && <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold">🔏 C2PA</span>}
            </div>
            {o && (
              <div className="glass mt-3 rounded-3xl p-4">
                <ul className="space-y-2">
                  {o.pieces.map((p) => (
                    <li key={p.variantId} className="flex items-center gap-3">
                      <span className="size-10 shrink-0 overflow-hidden rounded-xl bg-white/10">{p.image && <img src={p.image} alt="" className="h-full w-full object-contain" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{p.title}</span>
                        <span className="block truncate text-xs text-mut">{p.colourName} · {p.owned ? "in your wardrobe" : `${rwf(p.priceRwf)} · ${p.maker?.name ?? ""}`}</span>
                      </span>
                      {p.owned ? (
                        <span className="rounded-full bg-mint/20 px-2 py-0.5 text-[10px] font-bold text-mint">Owned</span>
                      ) : p.maker ? (
                        <Link href={`/m/${p.maker.handle}`} className="rounded-full bg-gold/20 px-2.5 py-1 text-[11px] font-bold text-gold">New · view</Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-txt/80">✨ {o.reasons.join(" · ")}</p>
                {o.newCostRwf > 0 && <p className="mt-1 text-xs text-mut">New pieces: {rwf(o.newCostRwf)}, paid straight to the makers</p>}
              </div>
            )}
          </article>
        ))}
      </div>
      {data && (
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {data.looks.map((l, i) => <span key={l.id} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-gold" : "w-1.5 bg-white/30"}`} />)}
        </div>
      )}
    </Screen>
  );
}
