export interface OrderView {
  id: string;
  code: string;
  status: string;
  totalRwf: number;
  deliveryMode: "PICKUP" | "DELIVERY";
  deliveryFeeRwf: number;
  address: string;
  wallet: string;
  payoutLabel: string;
  readyBy: string | null;
  createdAt: string;
  item: { title: string; colourName: string; size: string; unitPriceRwf: number; makerName: string };
  items?: { title: string; colourName: string; size: string; qty: number; unitPriceRwf: number; makerName: string }[];
  image: string | null;
  page: { id: string; name: string; handle: string; whatsapp: string };
  events: { status: string; note: string; at: string }[];
  payment: { status: string; provider: string; reconciled: boolean } | null;
  review: { rating: number; text: string } | null;
  next: string[];
  buyer?: { name: string | null; phone: string };
}

export const ORDER_LABEL: Record<string, string> = {
  NEW: "Held",
  AWAITING_PAYMENT: "Waiting for your PIN",
  PAID: "Paid",
  ACCEPTED: "Accepted by maker",
  DECLINED: "Declined",
  IN_PREPARATION: "Being made",
  READY: "Ready for pickup",
  SHIPPED: "On the way",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DISPUTED: "Issue raised",
  RESOLVED: "Resolved",
};
