"use client";

import Link from "next/link";
import { Screen, TopBar } from "@/components/ui";
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
          <Link key={o.id} href={`/orders/${o.id}`} className="glass flex items-center gap-3 rounded-3xl p-3">
            {o.image && <img src={o.image} alt="" className="h-16 w-14 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{o.item.title}</p>
              <p className="truncate text-xs text-mut">{o.page.name} · {rwf(o.totalRwf)} · {o.code}</p>
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">{ORDER_LABEL[o.status] ?? o.status}</span>
          </Link>
        ))}
        {data?.length === 0 && <p className="pt-10 text-center text-mut">No orders yet. Hold a look to buy it.</p>}
      </main>
    </Screen>
  );
}
