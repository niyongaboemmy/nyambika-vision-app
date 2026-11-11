import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/server-api";
import { THEMES, TYPE_LABEL, type MakerSpace } from "@/lib/maker";
import { MakerActions, Collection } from "./client";
import { TailorServices } from "@/components/tailor-services";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const m = await serverApi<MakerSpace>(`/pages/by-handle/${handle}`);
  if (!m) return { title: "Maker not found" };
  const image = m.products[0]?.variants[0]?.image ?? "/icon.png";
  return {
    title: `${m.name} · ${m.sector}`,
    description: m.story.slice(0, 160),
    openGraph: { title: `${m.name} on Nyambika`, description: m.story.slice(0, 160), images: [image], type: "profile" },
    alternates: { canonical: `/m/${m.handle}` },
  };
}

/** Maker Space v1 (CR-07, FR-PAGE-04): the member's own page, server-rendered for SEO and link previews. */
export default async function MakerSpacePage({ params }: Props) {
  const { handle } = await params;
  const m = await serverApi<MakerSpace>(`/pages/by-handle/${handle}`, 10);
  if (!m) notFound();
  const initials = m.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ClothingStore",
    name: m.name,
    address: { "@type": "PostalAddress", addressLocality: m.sector, addressRegion: m.district, addressCountry: "RW" },
    aggregateRating: m.reviewCount ? { "@type": "AggregateRating", ratingValue: m.rating, reviewCount: m.reviewCount } : undefined,
  };

  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[480px] overflow-hidden bg-ink pb-28">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="relative h-[300px]" style={{ background: THEMES[m.theme] ?? THEMES.terra }}>
        <div className="absolute inset-0 opacity-25 [background-image:repeating-linear-gradient(45deg,#fff_0_2px,transparent_2px_26px),repeating-linear-gradient(-45deg,#fff_0_2px,transparent_2px_26px)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink" />
        <a href="/" aria-label="Back to Muse" className="glass absolute left-4 top-[max(env(safe-area-inset-top),14px)] grid size-10 place-items-center rounded-full">←</a>
      </header>
      <section className="relative -mt-24 px-5">
        <div className="flex items-end gap-4">
          <span className="grid size-24 shrink-0 place-items-center rounded-full border-4 border-gold bg-ink font-display text-3xl font-black text-gold">{initials}</span>
          <div className="min-w-0 pb-1">
            <h1 className="font-display text-3xl font-black leading-tight">
              {m.name} {m.verified && <span className="text-mint" title="Verified member">✓</span>}
            </h1>
            <p className="text-sm text-txt/80">
              {TYPE_LABEL[m.memberType]} · {m.sector} · ★ {m.rating.toFixed(1)} · {m.reviewCount} reviews
            </p>
          </div>
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-txt/90">
          “{m.story}” <span className="font-semibold text-gold">Their page · managed by the maker</span>
        </p>
      </section>

      <Collection maker={m} />
      <TailorServices maker={m} />

      {m.reviews.length > 0 && (
        <section className="mt-6 space-y-2 px-5">
          <h2 className="text-xs font-semibold uppercase tracking-[.2em] text-gold">Reviews</h2>
          {m.reviews.map((r, i) => (
            <div key={i} className="glass rounded-2xl p-3 text-sm">
              <p className="text-gold">{"★".repeat(r.rating)}<span className="text-white/20">{"★".repeat(5 - r.rating)}</span></p>
              <p className="mt-1">{r.text}</p>
              <p className="mt-1 text-xs text-mut">{r.by}</p>
            </div>
          ))}
        </section>
      )}

      <MakerActions maker={m} />
    </div>
  );
}
