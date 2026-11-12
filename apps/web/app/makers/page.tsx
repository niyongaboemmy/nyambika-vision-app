import type { Metadata } from "next";
import Link from "next/link";
import { serverApi } from "@/lib/server-api";
import { THEMES, TYPE_LABEL } from "@/lib/maker";
import { cookies } from "next/headers";
import { RegionPill } from "@/components/region";
import { TopBar } from "@/components/ui";

export const metadata: Metadata = { title: "Browse makers", description: "Rwandan tailors, sewing cooperatives and sellers on Nyambika." };

interface Card {
  id: string;
  handle: string;
  name: string;
  memberType: keyof typeof TYPE_LABEL;
  verified: boolean;
  sector: string;
  theme: string;
  rating: number;
  reviewCount: number;
  tagline: string;
  productCount: number;
  flag?: string;
  crossBorderListing?: boolean;
}

/** Secondary directory (CR-01) and SEO entry point (FR-DIR-10). */
export default async function Makers({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const { type, q } = await searchParams;
  // E41: region-aware ranking. The shopper's country and cross-border opt-in come from the region cookies.
  const jar = await cookies();
  const country = jar.get("nya_cc")?.value ?? "RW";
  const xb = jar.get("nya_xb")?.value === "1" ? "1" : "0";
  const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(q ? { q } : {}), country, xb }).toString();
  const pages = (await serverApi<Card[]>(`/region/directory?${qs}`, 30)) ?? [];
  const filters = [
    { label: "All", href: "/makers" },
    { label: "Tailors", href: "/makers?type=TAILOR" },
    { label: "Cooperatives", href: "/makers?type=COOPERATIVE" },
    { label: "Sellers", href: "/makers?type=SELLER" },
  ];
  return (
    <div className="aurora mx-auto min-h-dvh w-full max-w-[480px] pb-[max(env(safe-area-inset-bottom),40px)]">
      <TopBar large back="/" title="Browse makers" right={<RegionPill />} />
      <div className="px-4">
      <form className="mt-1" role="search"><input name="q" type="search" aria-label="Search makers" defaultValue={q} placeholder="Search makers" className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" /></form>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {filters.map((f) => (
          <Link key={f.href} href={f.href} aria-current={(type ?? "") === (f.href.split("=")[1] ?? "") ? "page" : undefined} className={`press inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${(type ?? "") === (f.href.split("=")[1] ?? "") ? "bg-fg text-surface" : "bg-fill"}`}>{f.label}</Link>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {pages.map((p) => (
          <Link key={p.id} href={`/m/${p.handle}`} className="glass flex items-center gap-3 overflow-hidden rounded-3xl p-3">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl font-display text-lg font-black" style={{ background: THEMES[p.theme] ?? THEMES.terra }}>
              {p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.name} {p.verified && <span className="text-mint">✓</span>} {p.crossBorderListing && <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-gold">Ships to you</span>}</p>
              <p className="text-xs text-mut">{[TYPE_LABEL[p.memberType], p.sector, p.rating > 0 ? `★ ${p.rating.toFixed(1)}` : null, `${p.productCount} ${p.productCount === 1 ? "item" : "items"}`].filter(Boolean).join(" · ")}</p>
              <p className="mt-0.5 truncate text-xs text-txt/70">{p.tagline}</p>
            </div>
          </Link>
        ))}
        {pages.length === 0 && <p className="text-center text-mut">No makers match.</p>}
      </div>
      </div>
    </div>
  );
}
