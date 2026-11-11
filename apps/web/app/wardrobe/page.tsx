"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip, ErrorNote, Screen, Sheet, TopBar } from "@/components/ui";
import { RestyleSheet } from "@/components/wardrobe-restyle";
import { rwf } from "@/lib/api";
import type { Look } from "@/lib/looks";
import { COLOUR_SWATCH, nice, OCCASIONS, whenLabel, type Wardrobe } from "@/lib/social";
import { useApi } from "@/lib/use-api";
import { useSession } from "@/lib/session";
import { Icon } from "@/components/icons";

// Opened from a saved look's sheet only: keep checkout (and its zod-backed money helpers) out of the first load.
const HoldToBuy = dynamic(() => import("@/components/hold-to-buy").then((m) => m.HoldToBuy), { ssr: false });

type Tile =
  | { kind: "owned"; id: string; title: string; sub: string; image: string | null; colours: string[]; occasions: string[]; href: string }
  | { kind: "saved"; id: string; title: string; sub: string; image: string | null; colours: string[]; occasions: string[]; look: Look };

/** E26 · Digital wardrobe: owned pieces + saved looks, restyled by AI for upcoming events. */
export default function WardrobePage() {
  const { t } = useSession();
  const { data, error } = useApi<Wardrobe>("/wardrobe");
  const [show, setShow] = useState<"all" | "owned" | "saved">("all");
  const [occasion, setOccasion] = useState<string | null>(null);
  const [colour, setColour] = useState<string | null>(null);
  const [restyle, setRestyle] = useState(false);
  const [peek, setPeek] = useState<Look | null>(null);

  const tiles = useMemo<Tile[]>(() => {
    if (!data) return [];
    return [
      ...data.owned.map((o) => ({ kind: "owned" as const, id: o.id, title: o.title, sub: `${o.colourName} · size ${o.size}`, image: o.image, colours: o.colours, occasions: o.occasions, href: `/wardrobe/item/${o.id}` })),
      ...data.saved.map((l) => ({ kind: "saved" as const, id: l.id, title: l.product.title, sub: `${l.variant.colourName} · ${l.maker.name}`, image: l.image, colours: l.colours, occasions: [] as string[], look: l })),
    ];
  }, [data]);

  const colours = useMemo(() => [...new Set(tiles.flatMap((t) => t.colours))].filter((c) => COLOUR_SWATCH[c]), [tiles]);
  const occasions = useMemo(() => OCCASIONS.filter((o) => tiles.some((t) => t.occasions.includes(o))), [tiles]);
  const shown = tiles.filter((t) => (show === "all" || t.kind === show) && (!occasion || t.occasions.includes(occasion)) && (!colour || t.colours.includes(colour)));

  return (
    <Screen className="pb-28">
      <TopBar back="/" right={<Link href="/circle" className="hit glass flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold"><Icon name="users" className="size-4" /> Polls</Link>} />
      <header className="px-5">
        <h1 className="font-display text-[34px] font-black leading-tight text-grad">{t("wardrobe.title")}</h1>
      </header>

      {data?.events.length ? (
        <section className="no-scrollbar mt-4 flex snap-x gap-3 overflow-x-auto px-5" aria-label="Upcoming events">
          {data.events.map((e) => (
            <Link key={e.id} href={`/wardrobe/events/${e.id}`} className="glass w-[78%] shrink-0 snap-start rounded-3xl p-4">
              <p className="flex items-center gap-2 font-display text-lg font-black"><Icon name="calendar" className="size-5 shrink-0 text-gold" /><span className="min-w-0 truncate">{e.title} {whenLabel(e.daysUntil)}</span></p>
              <p className="text-sm text-txt/80">{e.rendering ? "The Muse is styling…" : `${e.ready} outfit${e.ready === 1 ? "" : "s"} ready`}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, i) => (e.thumbs[i] ? <img loading="lazy" decoding="async" key={i} src={e.thumbs[i]} alt="" className="aspect-[3/4] w-full rounded-xl bg-white/5 object-cover" /> : <div key={i} className="skeleton aspect-[3/4] rounded-xl" />))}
              </div>
            </Link>
          ))}
        </section>
      ) : null}

      <div className="mt-4 flex gap-2 px-5" role="group" aria-label="Show">
        {(["all", "owned", "saved"] as const).map((s) => <Chip key={s} active={show === s} onClick={() => setShow(s)}>{s === "all" ? "All" : s === "owned" ? `Owned${data ? ` · ${data.owned.length}` : ""}` : `Saved looks${data ? ` · ${data.saved.length}` : ""}`}</Chip>)}
      </div>
      {(occasions.length > 0 || colours.length > 0) && (
        <div className="no-scrollbar mt-2 flex items-center gap-2 overflow-x-auto px-5 pb-1" role="group" aria-label="Filter by occasion and colour">
          {occasions.map((o) => <Chip key={o} active={occasion === o} onClick={() => setOccasion(occasion === o ? null : o)}>{nice(o)}</Chip>)}
          {colours.map((c) => (
            <button key={c} type="button" aria-label={`Colour: ${c}`} aria-pressed={colour === c} onClick={() => setColour(colour === c ? null : c)} className={`hit size-9 shrink-0 rounded-full border-2 transition ${colour === c ? "scale-110 border-gold" : "border-white/25"}`} style={{ background: COLOUR_SWATCH[c] }} />
          ))}
        </div>
      )}

      <div className="px-5 pt-3"><ErrorNote error={error} /></div>

      <section className="grid grid-cols-2 gap-3 px-5 pt-1" aria-label="Wardrobe items">
        {!data && !error && Array.from({ length: 4 }).map((_, i) => <div key={i} className={`skeleton rounded-3xl ${i % 3 === 0 ? "row-span-2 h-80" : "h-[152px]"}`} />)}
        {shown.map((t, i) => {
          const inner = (
            <>
              {t.image ? <img loading="lazy" decoding="async" src={t.image} alt="" className={`w-full object-cover ${t.kind === "saved" ? "object-top" : "object-contain p-3"} ${i % 3 === 0 ? "h-72" : "h-40"}`} /> : <div className={`skeleton ${i % 3 === 0 ? "h-72" : "h-40"}`} />}
              <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${t.kind === "owned" ? "bg-mint/90 text-ink" : "bg-black/60"}`}>{t.kind === "owned" ? "Owned" : <span className="inline-flex items-center gap-1"><Icon name="heart" filled className="size-3" /> Saved · AI</span>}</span>
              <span className="block px-3 pb-3 pt-2 text-left">
                <span className="block truncate text-sm font-bold">{t.title}</span>
                <span className="block truncate text-xs text-mut">{t.sub}</span>
              </span>
            </>
          );
          const cls = `relative block overflow-hidden rounded-3xl border border-white/12 bg-white/[.06] animate-rise ${i % 3 === 0 ? "row-span-2" : ""}`;
          return t.kind === "owned" ? (
            <Link key={`o${t.id}`} href={t.href} className={cls} style={{ animationDelay: `${i * 40}ms` }}>{inner}</Link>
          ) : (
            <button key={`s${t.id}`} type="button" onClick={() => setPeek(t.look)} className={cls} style={{ animationDelay: `${i * 40}ms` }}>{inner}</button>
          );
        })}
      </section>

      {data && tiles.length === 0 && (
        <div className="glass mx-5 mt-2 rounded-3xl p-6 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/10 text-gold" aria-hidden><Icon name="hanger" className="size-7" /></span>
          <p className="mt-2 font-display text-lg font-black">Your wardrobe fills itself</p>
          <p className="mt-1 text-sm text-mut">Delivered pieces + saved looks</p>
        </div>
      )}
      {data && tiles.length > 0 && shown.length === 0 && <p className="px-5 pt-4 text-center text-sm text-mut">Nothing matches those filters.</p>}

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-6 fade-bottom">
        <button onClick={() => setRestyle(true)} className="grad-cta flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl font-display text-lg font-black shadow-[0_10px_30px_rgba(139,92,246,.35)] transition active:scale-[.98]"><Icon name="sparkle" className="size-5" /> {t("wardrobe.restyle")}</button>
      </div>

      <RestyleSheet open={restyle} onClose={() => setRestyle(false)} />

      <Sheet open={peek !== null} onClose={() => setPeek(null)}>
        {peek && (
          <div>
            <div className="relative mx-auto h-[46vh] overflow-hidden rounded-3xl bg-ink-3">
              {peek.image && <img loading="lazy" decoding="async" src={peek.image} alt={`${peek.product.title}, AI preview`} className="h-full w-full object-contain" />}
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold text-[#fff]"><Icon name="sparkle" className="size-3" /> AI preview</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-display text-xl font-black">{peek.product.title}</p>
                <p className="truncate text-sm text-mut">{peek.variant.colourName} · {peek.maker.name} · {rwf(peek.product.priceRwf)}</p>
              </div>
              <HoldToBuy look={peek} />
            </div>
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
