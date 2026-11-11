"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge, Empty, Icon, ScreenSkeleton, SButton, SectionTitle, Segmented } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import type { StudioProduct } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

type Filter = "all" | "live" | "draft" | "photo" | "improve";
const RETAKE = ["NEEDS_BETTER_PHOTO", "NOT_SUPPORTED"];
const needsPhoto = (p: StudioProduct) => RETAKE.includes(p.readiness) || !p.variants.some((v) => v.image);
const thin = (p: StudioProduct) => (p.description ?? "").trim().length < 60;

const MATCH: Record<Filter, (p: StudioProduct) => boolean> = {
  all: () => true,
  live: (p) => p.status === "PUBLISHED",
  draft: (p) => p.status === "DRAFT" || p.status === "OUT_OF_STOCK",
  photo: needsPhoto,
  improve: thin,
};

const EMPTY: Record<Filter, string> = {
  all: "No products yet. Add your first one with a clear photo on a plain background.",
  live: "Nothing is live yet. Publish a product so shoppers can try it on.",
  draft: "No drafts. Everything you added is live or waiting.",
  photo: "Every photo passed the try-on check. Nice work.",
  improve: "Every listing has a full description. ✨",
};

const readinessLabel = (r: string) => `try-on: ${r.replace(/_/g, " ").toLowerCase()}`;

function Products() {
  const { page } = useManagedPage();
  const router = useRouter();
  const params = useSearchParams();
  const initial = (params.get("filter") as Filter) || "all";
  const [filter, setFilter] = useState<Filter>(MATCH[initial] ? initial : "all");
  const { data, loading, reload } = useApi<StudioProduct[]>(`/pages/${page.id}/products`);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = data?.filter((p) => p.status === "PENDING_APPROVAL") ?? [];
  const rest = useMemo(() => data?.filter((p) => p.status !== "PENDING_APPROVAL" && p.status !== "ARCHIVED") ?? [], [data]);
  const shown = rest.filter(MATCH[filter]);
  const member = page.myAccess === "MEMBER";

  async function act(id: string, action: string) {
    setBusy(id + action);
    try {
      await api(`/products/${id}/status`, { method: "POST", json: { action } });
      navigator.vibrate?.(10);
      await reload();
    } finally {
      setBusy(null);
    }
  }

  const setF = (f: Filter) => {
    setFilter(f);
    router.replace(f === "all" ? `/studio/${page.id}/products` : `/studio/${page.id}/products?filter=${f}`, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        title={member ? "My products" : "Products"}
        eyebrow={data ? `${rest.length} pieces` : undefined}
        action={
          <SButton onClick={() => router.push(`/studio/${page.id}/products/new`)}>
            <Icon name="plus" className="size-4" /> Add product
          </SButton>
        }
      />

      {pending.length > 0 && (
        <section aria-labelledby="pending-title" className="rounded-[26px] bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
          <h3 id="pending-title" className="flex items-center gap-2 text-sm font-extrabold text-gold-ink">
            <Icon name="clock" className="size-4" /> Waiting for approval ({pending.length})
          </h3>
          <ul className="st-snap no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
            {pending.map((p) => (
              <li key={p.id} className="st-card flex w-[280px] shrink-0 gap-3 rounded-[22px] p-3">
                <Thumb p={p} className="size-20" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link href={`/studio/${page.id}/products/${p.id}`} className="truncate font-bold text-cocoa hover:underline">{p.title}</Link>
                  <p className="truncate text-xs text-cocoa-2">By {p.makers.map((m) => m.name).join(", ") || "member"} · {rwf(p.priceRwf)}</p>
                  {!member && (
                    <div className="mt-auto flex gap-1.5 pt-2">
                      <SButton variant="outline" className="min-h-10 flex-1 px-2" disabled={!!busy} onClick={() => act(p.id, "reject")}>Reject</SButton>
                      <SButton variant="dark" className="min-h-10 flex-1 px-2" disabled={!!busy} onClick={() => act(p.id, "approve")}>Approve</SButton>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && rest.length > 0 && (
        <Segmented
          label="Filter products"
          value={filter}
          onChange={setF}
          options={[
            { value: "all", label: "All", count: rest.length },
            { value: "live", label: "Live", count: rest.filter(MATCH.live).length },
            { value: "draft", label: "Drafts", count: rest.filter(MATCH.draft).length },
            { value: "photo", label: "Needs photo", count: rest.filter(MATCH.photo).length },
            { value: "improve", label: "✨ Improve", count: rest.filter(MATCH.improve).length },
          ]}
        />
      )}
      {filter === "improve" && shown.length > 0 && (
        <p className="flex items-start gap-2 rounded-2xl bg-violet-50 p-3 text-sm text-violet-ink ring-1 ring-inset ring-violet-200">
          <Icon name="sparkle" className="mt-0.5 size-4 shrink-0" />
          These listings have a short description. Open one and tap “✨ Write it for me” for a draft in Kinyarwanda, English or French.
        </p>
      )}

      {loading && !data && <ScreenSkeleton variant="grid" />}
      {data && shown.length === 0 && (
        <Empty
          icon={filter === "photo" ? "camera" : "hanger"}
          title={filter === "all" ? "Your rail is empty" : undefined}
          action={filter === "all" ? <SButton onClick={() => router.push(`/studio/${page.id}/products/new`)}>Add your first piece</SButton> : undefined}
        >
          {EMPTY[filter]}
        </Empty>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {shown.map((p, i) => (
          <li key={p.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
            <Link href={`/studio/${page.id}/products/${p.id}`} className="st-card st-press st-lift group block overflow-hidden rounded-[24px]">
              <div className="relative">
                <Thumb p={p} className="aspect-[4/5] w-full rounded-none" />
                <div className="absolute left-2 top-2"><Badge value={p.status} label={p.status === "PUBLISHED" ? "live" : undefined} /></div>
                {needsPhoto(p) && (
                  <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-amber-400 text-cocoa shadow" title="Photo needs a retake">
                    <Icon name="camera" className="size-4" />
                    <span className="sr-only">Photo needs a retake</span>
                  </span>
                )}
              </div>
              <div className="space-y-1.5 p-3">
                <p className="truncate text-sm font-extrabold text-cocoa">{p.title}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold tabular-nums text-cocoa">{rwf(p.priceRwf)}</span>
                  <span className="flex -space-x-1" aria-label={`${p.variants.length} colour(s)`}>
                    {p.variants.slice(0, 4).map((v) => <span key={v.id} className="size-4 rounded-full ring-2 ring-white" style={{ background: v.colourHex }} />)}
                  </span>
                </div>
                <p className={`truncate text-[11px] font-bold ${p.readiness === "READY" ? "text-mint-ink" : RETAKE.includes(p.readiness) ? "text-gold-ink" : "text-cocoa-2"}`}>
                  {readinessLabel(p.readiness)}
                  {p.makers.length ? <span className="font-semibold text-cocoa-2"> · by {p.makers.map((m) => m.name).join(", ")}</span> : null}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thumb({ p, className = "" }: { p: StudioProduct; className?: string }) {
  const img = p.variants.find((v) => v.image)?.image;
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-paper-2 ${className}`}>
      {img ? <img src={img} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <Icon name="camera" className="size-7 text-cocoa-3" />}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton variant="grid" />}>
      <Products />
    </Suspense>
  );
}
