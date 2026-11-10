"use client";

import { Badge, Card, Empty, SButton } from "@/components/studio";
import { api, rwf } from "@/lib/api";
import { ORDER_LABEL, type OrderView } from "@/lib/orders";
import { useApi } from "@/lib/use-api";
import { useManagedPage } from "../layout";

const ACTION: Record<string, string> = {
  ACCEPTED: "Accept",
  DECLINED: "Decline",
  IN_PREPARATION: "Start making",
  READY: "Ready for pickup",
  SHIPPED: "Send out",
  DELIVERED: "Mark delivered",
  CANCELLED: "Cancel",
  RESOLVED: "Resolve",
};

/** Member order inbox (FR-ORD-04/06/11). */
export default function Orders() {
  const { page } = useManagedPage();
  const { data, reload } = useApi<OrderView[]>(`/pages/${page.id}/orders`);
  async function move(id: string, to: string) {
    await api(`/orders/${id}/transition`, { method: "POST", json: { to } });
    await reload();
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Orders</h2>
        <a href={`/api/pages/${page.id}/orders.csv`} className="text-sm font-semibold underline">Export CSV</a>
      </div>
      {data?.length === 0 && <Empty>Paid orders from hold-to-buy appear here, and on your WhatsApp.</Empty>}
      {data?.map((o) => (
        <Card key={o.id} className="space-y-2">
          <div className="flex items-start gap-3">
            {o.image && <img src={o.image} alt="" className="h-16 w-14 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{o.item.title} <span className="font-normal text-stone-500">· {o.item.colourName} · {o.item.size}</span></p>
              <p className="text-sm text-stone-600">{o.code} · {rwf(o.totalRwf)} · {o.deliveryMode === "DELIVERY" ? `deliver to ${o.address}` : "pickup"}</p>
              <p className="text-sm text-stone-600">Buyer: {o.buyer?.name ?? "—"} · {o.buyer?.phone}{o.item.makerName ? ` · maker ${o.item.makerName}` : ""}</p>
              <p className="text-xs text-stone-500">Paid to {o.payoutLabel} · {o.payment?.status.toLowerCase()}{o.payment?.reconciled ? " · reconciled" : ""}</p>
            </div>
            <Badge value={o.status} label={ORDER_LABEL[o.status]} />
          </div>
          {o.next.filter((n) => ACTION[n]).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {o.next.filter((n) => ACTION[n]).map((n) => (
                <SButton key={n} variant={n === "DECLINED" || n === "CANCELLED" ? "outline" : "primary"} onClick={() => move(o.id, n)}>{ACTION[n]}</SButton>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
