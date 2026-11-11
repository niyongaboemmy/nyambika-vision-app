"use client";

import Link from "next/link";
import { EmptyState, Screen, Skel, TopBar } from "@/components/ui";
import { rwf } from "@/lib/api";
import { ORDER_LABEL, type OrderView } from "@/lib/orders";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

export default function Orders() {
  const { t } = useSession();
  const { data } = useApi<OrderView[]>("/orders/mine");
  return (
    <Screen>
      <TopBar back="/" title={t("orders.title")} />
      <main className="space-y-3 p-4">
        {data?.map((o) => (
          <Link key={o.id} href={`/orders/${o.id}`} className="glass press flex items-center gap-3 rounded-3xl p-3">
            {o.image ? <img src={o.image} alt="" width={56} height={64} loading="lazy" decoding="async" className="h-16 w-14 shrink-0 rounded-xl bg-white/5 object-cover" /> : <span className="h-16 w-14 shrink-0 rounded-xl bg-white/10" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{o.item.title}</p>
              <p className="truncate text-xs text-mut">{o.page.name} · {o.code}</p>
              <p className="tabular mt-0.5 text-sm font-bold">{rwf(o.totalRwf)}</p>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{ORDER_LABEL[o.status] ?? o.status}</span>
          </Link>
        ))}
        {!data && [0, 1, 2].map((i) => <Skel key={i} className="h-[88px] rounded-3xl" />)}
        {data?.length === 0 && <EmptyState icon="box" title="No orders yet">Hold a look to buy it.</EmptyState>}
      </main>
    </Screen>
  );
}
