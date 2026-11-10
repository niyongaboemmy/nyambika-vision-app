import type { Metadata } from "next";
import Link from "next/link";
import { serverApi } from "@/lib/server-api";
import { THEMES, TYPE_LABEL } from "@/lib/maker";

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
}

/** Secondary directory (CR-01) and SEO entry point (FR-DIR-10). */
export default async function Makers({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const { type, q } = await searchParams;
  const qs = new URLSearchParams({ ...(type ? { type } : {}), ...(q ? { q } : {}) }).toString();
  const pages = (await serverApi<Card[]>(`/pages${qs ? `?${qs}` : ""}`, 30)) ?? [];
  const filters = [
    { label: "All", href: "/makers" },
    { label: "Tailors", href: "/makers?type=TAILOR" },
    { label: "Cooperatives", href: "/makers?type=COOPERATIVE" },
    { label: "Sellers", href: "/makers?type=SELLER" },
  ];
  return (
    <div className="aurora mx-auto min-h-dvh w-full max-w-[480px] px-4 pb-10">
      <div className="flex items-center justify-between pt-[max(env(safe-area-inset-top),14px)] pb-2">
        <Link href="/" className="glass grid size-10 place-items-center rounded-full" aria-label="Back">←</Link>
        <h1 className="font-display text-xl font-black">Browse makers</h1>
        <span className="size-10" />
      </div>
      <form className="mt-2"><input name="q" defaultValue={q} placeholder="Search makers" className="glass h-12 w-full rounded-2xl px-4 outline-none placeholder:text-white/40" /></form>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
        {filters.map((f) => (
          <Link key={f.href} href={f.href} className={`whitespace-nowrap rounded-2xl border px-3.5 py-2 text-sm font-semibold ${(type ?? "") === (f.href.split("=")[1] ?? "") ? "border-gold/70 bg-gold/20" : "border-white/20 bg-white/10"}`}>{f.label}</Link>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {pages.map((p) => (
          <Link key={p.id} href={`/m/${p.handle}`} className="glass flex items-center gap-3 overflow-hidden rounded-3xl p-3">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl font-display text-lg font-black" style={{ background: THEMES[p.theme] ?? THEMES.terra }}>
              {p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.name} {p.verified && <span className="text-mint">✓</span>}</p>
              <p className="text-xs text-mut">{TYPE_LABEL[p.memberType]} · {p.sector} · ★ {p.rating.toFixed(1)} · {p.productCount} items</p>
              <p className="mt-0.5 truncate text-xs text-txt/70">{p.tagline}</p>
            </div>
          </Link>
        ))}
        {pages.length === 0 && <p className="text-center text-mut">No makers match.</p>}
      </div>
    </div>
  );
}
