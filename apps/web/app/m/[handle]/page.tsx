import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/server-api";
import { TYPE_LABEL, type MakerSpace } from "@/lib/maker";
import { AllPieces, MakerActions, ShowCard } from "./client";
import { ShowroomHero, type HeroPiece } from "./hero";
import { CollectionAlerts, TailorServices } from "@/components/maker-lazy";
import type { Showroom } from "@/lib/vr";
import { RegionPill } from "@/components/region";
import { Icon } from "@/components/icons";
import type { Commerce } from "@/lib/region";

type Props = { params: Promise<{ handle: string }> };

/** Calm accent per page theme (used when the showroom has no palette): a tint, never a pattern. */
const PALETTES: Record<string, { primary: string; secondary: string; deep: string }> = {
  terra: { primary: "#E0703F", secondary: "#F2B84B", deep: "#3a2140" },
  indigo: { primary: "#2B4EA2", secondary: "#38BDF8", deep: "#1b1838" },
  forest: { primary: "#1F7A4D", secondary: "#34D399", deep: "#14241f" },
  violet: { primary: "#6D28D9", secondary: "#C084FC", deep: "#22163a" },
};

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

/**
 * Maker Space (CR-07, FR-PAGE-04), showroom-first redesign (docs/design/ui-audit.md §9): the maker's 3D showroom
 * is the hero and the one guided path into 3D / VR; identity, the upcoming show and an image-first collection follow.
 * Server-rendered for SEO and link previews; the live 3D preview loads after the page, only when seen.
 */
export default async function MakerSpacePage({ params }: Props) {
  const { handle } = await params;
  const m = await serverApi<MakerSpace>(`/pages/by-handle/${handle}`, 10);
  if (!m) notFound();
  const [room, commerce] = await Promise.all([
    serverApi<Showroom>(`/vr/public/pages/${handle}/showroom`, 10),
    serverApi<Commerce>(`/region/pages/by-handle/${handle}/commerce`, 10), // E40/E41
  ]);
  const palette = room?.page.palette ?? PALETTES[m.theme] ?? PALETTES.terra;
  const initials = m.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const items = room?.items ?? [];
  const in3d = items.filter((i) => i.glb).map((i) => i.productId);
  // 3D pieces lead the composed poster; the preview needs only what the engine draws.
  const pieces: HeroPiece[] = [...items]
    .sort((a, b) => Number(Boolean(b.glb)) - Number(Boolean(a.glb)) || Number(b.featured) - Number(a.featured))
    .map((i) => ({ id: i.productId, title: i.title, priceRwf: i.priceRwf, glb: i.glb, poster: i.poster ?? i.photo, heightM: i.heightM }));
  const show = room?.shows.find((s) => s.phase === "LIVE") ?? room?.shows[0] ?? null;
  const about = m.story.length > m.tagline.length ? m.story : m.tagline;
  const region = commerce && commerce.region !== "RW" ? commerce.region : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ClothingStore",
    name: m.name,
    address: { "@type": "PostalAddress", addressLocality: m.sector, addressRegion: m.district, addressCountry: commerce?.region ?? "RW" },
    aggregateRating: m.reviewCount ? { "@type": "AggregateRating", ratingValue: m.rating, reviewCount: m.reviewCount } : undefined,
  };
  // The name always sits on one line: the type scales to the column width (container units), truncation is the safety net.
  const nameSize = `min(2.25rem, max(1.25rem, calc((100cqi - 2rem) / ${(Math.max(8, m.name.length) * 0.6).toFixed(2)})))`;

  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[480px] overflow-x-hidden bg-ink pb-[calc(env(safe-area-inset-bottom)+104px)] lg:max-w-[1120px] lg:px-8 lg:pt-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="lg:grid lg:grid-cols-12 lg:items-end lg:gap-10">
        <div className="relative lg:col-span-7">
          <ShowroomHero handle={m.handle} name={m.name} palette={palette} banner={room?.banner ?? m.name} pieces={pieces} showroom={items.length > 0} label={room?.label ?? null} chip={<AllPieces maker={m} commerce={commerce} in3d={in3d} />} />
          <a href="/" aria-label="Back to Muse" className="hit press glass absolute left-4 top-[max(env(safe-area-inset-top),14px)] z-20 grid size-10 place-items-center rounded-full !bg-black/40 text-[#fff]">
            <Icon name="back" className="size-5" />
          </a>
          <RegionPill className="absolute right-4 top-[max(env(safe-area-inset-top),14px)] z-20 !bg-black/40 text-[#fff]" />
        </div>

        {/* Identity: monogram, one-line name, compact facts, one line of story, actions. */}
        <section aria-label={`About ${m.name}`} className="@container relative px-4 pt-5 lg:col-span-5 lg:px-0 lg:pb-2 lg:pt-0">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-2xl font-display text-lg font-black text-white shadow-e2"
              style={{ background: `linear-gradient(140deg, ${palette.primary}, ${palette.deep})` }}
            >
              {initials}
            </span>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <Chip>{TYPE_LABEL[m.memberType]}</Chip>
              <Chip icon="pin">{region ? `${m.sector}, ${region}` : m.sector}</Chip>
              {m.reviewCount > 0 && (
                <Chip>
                  <Icon name="star" filled className="size-3.5 shrink-0 text-gold" />
                  <span className="tabular-nums">{m.rating.toFixed(1)}</span>
                  <span className="tabular-nums font-medium text-fg-muted">({m.reviewCount}<span className="sr-only"> reviews</span>)</span>
                </Chip>
              )}
              <Chip icon="shield" tone="trust">Managed by the maker</Chip>
            </div>
          </div>
          <h1 className="mt-3 flex min-w-0 items-center gap-1.5 font-display font-black leading-[1.1] tracking-[-0.01em]" style={{ fontSize: nameSize }}>
            <span className="min-w-0 truncate" title={m.name}>{m.name}</span>
            {m.verified && (
              <span title="Verified member" className="grid size-[0.8em] shrink-0 place-items-center rounded-full bg-sky text-white">
                <Icon name="check" className="size-[0.6em]" />
                <span className="sr-only">Verified member</span>
              </span>
            )}
          </h1>
          {/* One line of story; "more" opens the rest in place (native, no script). */}
          <details className="group mt-2">
            <summary className="hit flex min-h-11 cursor-pointer list-none items-start gap-2 text-[15px] leading-relaxed text-fg-muted [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 truncate group-open:whitespace-normal">{about}</span>
              <span className="shrink-0 font-semibold text-fg"><span className="group-open:hidden">more</span><span className="hidden group-open:inline">less</span></span>
            </summary>
          </details>
          <MakerActions maker={m} showroom={items.length > 0} />
        </section>
      </div>

      {show && <ShowCard show={show} handle={m.handle} />}

      <CollectionAlerts maker={m} />
      <TailorServices maker={m} />
    </div>
  );
}

function Chip({ children, icon, tone }: { children: React.ReactNode; icon?: "pin" | "shield"; tone?: "trust" }) {
  return (
    <span className={`inline-flex h-7 max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold ${tone === "trust" ? "bg-mint/12 text-mint" : "bg-fill text-fg"}`}>
      {icon && <Icon name={icon} className="size-3.5 shrink-0" />}
      {children}
    </span>
  );
}
