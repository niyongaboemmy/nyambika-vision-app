export interface Look {
  id: string;
  rank: number;
  saved: boolean;
  status: "PENDING" | "QUEUED" | "GENERATING" | "GUARDING" | "DELIVERED" | "WITHHELD" | "FAILED";
  image: string | null;
  onTwin: boolean;
  tier: string;
  c2pa: { signed: boolean; sha256: string; model: string } | null;
  guardPassed: boolean | null;
  latencyMs: number | null;
  intentSessionId: string;
  product: { id: string; title: string; priceRwf: number; madeToOrder: boolean; leadTimeDays: number; category: string; fabric: string };
  variant: { id: string; colourName: string; colourHex: string; sizes: string[]; inStock: boolean };
  variants: { id: string; colourName: string; colourHex: string }[];
  maker: { pageId: string; name: string; handle: string; memberType: string; verified: boolean; sector: string; whatsapp: string; madeBy: string[] };
}

export const isRendering = (s: Look["status"]) => s === "PENDING" || s === "QUEUED" || s === "GENERATING" || s === "GUARDING";

export const TYPE_ICON: Record<string, string> = { TAILOR: "✂️ Tailor", COOPERATIVE: "🧵 Cooperative", SELLER: "🛍️ Seller" };
