"use client";

import Link from "next/link";
import { Badge, Card, Empty, SButton } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import type { StudioProduct } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

export default function Products() {
  const { page } = useManagedPage();
  const { data, loading, reload } = useApi<StudioProduct[]>(`/pages/${page.id}/products`);
  const pending = data?.filter((p) => p.status === "PENDING_APPROVAL") ?? [];
  const rest = data?.filter((p) => p.status !== "PENDING_APPROVAL") ?? [];

  async function act(id: string, action: string) {
    await api(`/products/${id}/status`, { method: "POST", json: { action } });
    await reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Products</h2>
        <Link href={`/studio/${page.id}/products/new`}><SButton>Add product</SButton></Link>
      </div>
      {loading && <p className="text-stone-500">Loading…</p>}
      {pending.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-700">Waiting for approval ({pending.length})</h3>
          {pending.map((p) => (
            <Card key={p.id} className="flex items-center gap-3">
              <Thumb p={p} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.title}</p>
                <p className="text-xs text-stone-500">By {p.makers.map((m) => m.name).join(", ") || "member"} · {rwf(p.priceRwf)}</p>
              </div>
              <SButton variant="outline" onClick={() => act(p.id, "reject")}>Reject</SButton>
              <SButton onClick={() => act(p.id, "approve")}>Approve</SButton>
            </Card>
          ))}
        </section>
      )}
      {data && data.length === 0 && <Empty>No products yet. Add your first one with a clear photo on a plain background.</Empty>}
      <div className="space-y-2">
        {rest.map((p) => (
          <Link key={p.id} href={`/studio/${page.id}/products/${p.id}`} className="block">
            <Card className="flex items-center gap-3 hover:border-stone-400">
              <Thumb p={p} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.title}</p>
                <p className="text-xs text-stone-500">{rwf(p.priceRwf)} · {p.variants.length} colour(s){p.makers.length ? ` · by ${p.makers.map((m) => m.name).join(", ")}` : ""}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge value={p.status} />
                  <Badge value={p.readiness} label={`try-on: ${p.readiness.replace(/_/g, " ").toLowerCase()}`} />
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Thumb({ p }: { p: StudioProduct }) {
  const img = p.variants.find((v) => v.image)?.image;
  return (
    <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-stone-100">
      {img ? <img src={img} alt="" className="size-full object-cover" /> : <span className="text-2xl">👗</span>}
    </div>
  );
}
