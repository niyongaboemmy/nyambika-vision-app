import type { PassportData } from "@nyambika/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HostVerify, PrintButton } from "@/components/passport-bits";
import { InfoTip } from "@/components/kit";
import { QrCode } from "@/components/qr";
import { serverApi } from "@/lib/server-api";

interface Passport {
  productId: string;
  version: number;
  latest: number;
  publishedAt: string;
  title: string;
  category: string;
  image: string | null;
  page: { name: string; handle: string; memberType: string; verified: boolean; district: string; sector: string };
  data: PassportData;
  claimsVerified: boolean;
  verifiedAt: string | null;
  url: string;
  versions: { version: number; note: string; changed: string[]; at: string }[];
  euDraftFields: Record<string, string>;
  jsonLd: object;
}

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> };

const COUNTRY: Record<string, string> = { RW: "Rwanda", KE: "Kenya", UG: "Uganda", TZ: "Tanzania" };
const date = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await serverApi<Passport>(`/passports/${id}`, 60);
  if (!p) return { title: "Passport not found" };
  return {
    title: `${p.title} · Product passport`,
    description: `Materials, origin, makers, care and repair for ${p.title} by ${p.page.name}.`,
    alternates: { canonical: `/p/${id}` },
  };
}

/** Public Digital Product Passport (FR-DPP-02/03/04): light and editorial, made to be printed and scanned. */
export default async function PassportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { v } = await searchParams;
  const p = await serverApi<Passport>(`/passports/${id}${v ? `?v=${encodeURIComponent(v)}` : ""}`, 30);
  if (!p) notFound();
  const d = p.data;
  const old = p.version !== p.latest;
  const makers = d.origin.makers.length ? d.origin.makers.join(", ") : p.page.name;

  return (
    <div className="theme-light min-h-dvh bg-paper text-cocoa print:bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(p.jsonLd) }} />
      <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-[max(env(safe-area-inset-top),20px)] sm:px-8 print:max-w-none print:px-0 print:pt-0">
        <header className="flex items-center justify-between gap-3 border-b border-cocoa/15 pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[.28em] text-terra-ink">Product passport</p>
            <p className="text-xs text-cocoa-2">Nyambika · version {p.version} · {date(p.publishedAt)}</p>
          </div>
          <Link href={`/m/${p.page.handle}`} className="inline-flex min-h-11 items-center text-sm font-bold text-cocoa underline decoration-cocoa/30 underline-offset-4 print:hidden">{p.page.name} →</Link>
        </header>

        {old && (
          <p role="status" className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-gold-ink">
            You are reading version {p.version}. <Link className="font-bold underline" href={`/p/${p.productId}`}>See the current version ({p.latest})</Link>
          </p>
        )}

        <section className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[220px_1fr]">
          {p.image && <img src={p.image} alt={p.title} className="aspect-[4/5] w-full max-w-[260px] rounded-[20px] object-cover shadow-[0_18px_40px_-24px_rgba(29,24,20,.6)] print:max-w-[160px] print:shadow-none" />}
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">{p.title}</h1>
            <p className="mt-3 text-lg leading-snug text-cocoa-2">
              {d.origin.handmade ? "Handmade" : "Made"} by <b className="text-cocoa">{makers}</b>
            </p>
            <p className="mt-0.5 text-sm text-cocoa-2">
              {[d.origin.cooperative && d.origin.cooperative !== makers ? d.origin.cooperative : null, d.origin.district, COUNTRY[d.origin.country] ?? d.origin.country].filter(Boolean).join(" · ")}
            </p>
            {d.claims.madeIn && (
              <p className="mt-4 inline-flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-cocoa px-3.5 py-1.5 text-sm font-bold text-white">{d.claims.madeIn}</span>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset ${p.claimsVerified ? "bg-emerald-50 text-mint-ink ring-transparent" : "bg-white text-cocoa-2 ring-transparent"}`}>
                  {p.claimsVerified ? `✓ Verified by Nyambika${p.verifiedAt ? ` · ${date(p.verifiedAt)}` : ""}` : "Declared by the maker"}
                </span>
              </p>
            )}
            {d.claims.impactStory && <blockquote className="mt-4 border-l-4 border-terra pl-4 text-[15px] italic leading-relaxed text-cocoa">“{d.claims.impactStory}”</blockquote>}
          </div>
        </section>

        <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
          <Block title="Materials">
            {d.materials.length ? (
              <ul className="space-y-2.5">
                {d.materials.map((m) => (
                  <li key={m.fibre}>
                    <div className="flex items-baseline justify-between gap-2 text-[15px]"><span className="font-bold">{m.fibre}{m.recycled ? " (recycled)" : ""}</span><span className="tabular-nums">{m.percent}%</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-paper-3" aria-hidden><div className="h-full rounded-full bg-terra-ink" style={{ width: `${m.percent}%` }} /></div>
                    {m.origin && <p className="mt-0.5 text-xs text-cocoa-2">Fibre from {m.origin}</p>}
                  </li>
                ))}
              </ul>
            ) : <Empty />}
            {(d.fabric.type || d.fabric.origin) && <p className="mt-3 text-sm text-cocoa-2">{d.fabric.type}{d.fabric.origin ? ` · woven/printed in ${d.fabric.origin}` : ""}</p>}
          </Block>

          <Block title="How it was made">
            {d.process.length ? (
              <ol className="relative space-y-3 border-l border-cocoa/20 pl-4">
                {d.process.map((s, i) => (
                  <li key={i} className="relative">
                    <span aria-hidden className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-cocoa" />
                    <p className="font-bold">{s.step}</p>
                    <p className="text-sm text-cocoa-2">{[s.by, s.place].filter(Boolean).join(" · ")}</p>
                  </li>
                ))}
              </ol>
            ) : <Empty />}
            {(d.production.date || d.production.batch) && <p className="mt-3 text-sm text-cocoa-2">{d.production.date && <>Made {d.production.date}</>}{d.production.batch && <> · batch {d.production.batch}</>}</p>}
          </Block>

          <Block title="Care">
            {d.care.length ? <ul className="list-disc space-y-1 pl-5 text-[15px]">{d.care.map((c) => <li key={c}>{c}</li>)}</ul> : <Empty />}
          </Block>

          <Block title="Repair & alterations">
            {d.repair.offered ? (
              <>
                <ul className="list-disc space-y-1 pl-5 text-[15px]">{d.repair.services.map((s) => <li key={s}>{s}</li>)}</ul>
                <p className="mt-2 text-sm text-cocoa-2">Offered by {p.page.name}{d.repair.contact ? ` · ${d.repair.contact}` : ""}</p>
              </>
            ) : <p className="text-[15px] text-cocoa-2">Not offered by the maker yet.</p>}
          </Block>

          <Block title="Certifications">
            {d.certifications.length ? (
              <ul className="space-y-2">{d.certifications.map((c) => <li key={c.name}><p className="font-bold">{c.name}</p><p className="text-sm text-cocoa-2">{[c.issuer, c.reference].filter(Boolean).join(" · ")}</p></li>)}</ul>
            ) : <Empty />}
          </Block>

          <Block title="Carbon footprint">
            <p className="text-[15px]">{d.carbon.kgCo2e != null ? `${d.carbon.kgCo2e} kg CO₂e` : "Not assessed yet"}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-cocoa-2">Method: {d.carbon.method}<InfoTip label="About the carbon method">Placeholder until a textile footprint method is adopted.</InfoTip></p>
          </Block>
        </div>

        {/* Hang-tag / label: cut along the dashed line */}
        <section aria-labelledby="tag-t" className="mt-12 break-inside-avoid">
          <h2 id="tag-t" className="text-[11px] font-bold uppercase tracking-[.28em] text-cocoa-2 print:hidden">Hang-tag</h2>
          <div className="mt-3 flex items-center gap-5 rounded-[22px] border-2 border-dashed border-cocoa/30 bg-white p-5">
            <QrCode value={p.url} label={`QR code for the passport of ${p.title}`} className="size-32 shrink-0 sm:size-36" />
            <div className="min-w-0">
              <p className="font-display text-xl font-black leading-tight">{p.title}</p>
              <p className="text-sm text-cocoa-2">{p.page.name}{d.claims.madeIn ? ` · ${d.claims.madeIn}` : ""}</p>
              {d.materials.length > 0 && <p className="mt-1 text-sm">{d.materials.map((m) => `${m.percent}% ${m.fibre}`).join(" · ")}</p>}
              <p className="mt-2 break-all font-mono text-[11px] text-cocoa-2">{p.url}</p>
              {d.gtin && <p className="font-mono text-[11px] text-cocoa-2">GTIN {d.gtin}</p>}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <PrintButton />
            <HostVerify productId={p.productId} verified={p.claimsVerified} />
          </div>
        </section>

        <section aria-labelledby="hist-t" className="mt-12 print:hidden">
          <h2 id="hist-t" className="text-[11px] font-bold uppercase tracking-[.28em] text-cocoa-2">Passport history</h2>
          <ol className="mt-3 divide-y divide-cocoa/10 rounded-[20px] bg-white">
            {p.versions.map((x) => (
              <li key={x.version}>
                <Link href={x.version === p.latest ? `/p/${p.productId}` : `/p/${p.productId}?v=${x.version}`} aria-current={x.version === p.version ? "page" : undefined} className={`flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-paper ${x.version === p.version ? "bg-paper" : ""}`}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-cocoa text-sm font-black text-white">v{x.version}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{x.note || "Update"}</span>
                    <span className="block truncate text-xs text-cocoa-2">{date(x.at)} · {x.changed.join(", ")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <details className="mt-8 rounded-[20px] bg-white p-4 text-sm print:hidden">
          <summary className="flex min-h-11 cursor-pointer items-center font-bold">EU passport alignment (draft)</summary>
          <p className="mt-2 text-cocoa-2">Field names follow the draft EU ESPR textile passport vocabulary. The delegated act is expected in 2027; this mapping is a draft alignment and may change. Machine-readable data is embedded as JSON-LD.</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
            {Object.entries(p.euDraftFields).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-cocoa-2">{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </details>
      </main>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-3 border-b border-cocoa/15 pb-1.5 text-[11px] font-bold uppercase tracking-[.28em] text-cocoa-2">{title}</h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-[15px] text-cocoa-2">Not provided.</p>;
}
