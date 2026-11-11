/**
 * Optional checkout (E29): a bag across makers is split into one order + one Mobile Money request
 * per payout account. Money never pools at Nyambika (OP-3, CON-08): each maker is paid directly.
 */
export const DELIVERY_FEE_RWF = 2000;
export const MAX_QTY = 5;

export type DeliveryMode = "DELIVERY" | "PICKUP";

export interface BagLine {
  id: string;
  productId: string;
  variantId: string;
  size: string;
  qty: number;
  lookId: string | null;
  title: string;
  colourName: string;
  unitPriceRwf: number;
  madeToOrder: boolean;
  stock: number;
  sizes: string[];
  available: boolean; // product + page published
  pageId: string;
  pageName: string;
  sector: string;
  leadTimeDays: number;
  /** Payout account resolved per product (FR-COOP-05): the coop maker's own, else the page's. */
  payoutMsisdn: string | null;
  payoutLabel: string;
  makerName: string;
}

export interface MakerGroup {
  key: string;
  pageId: string;
  pageName: string;
  sector: string;
  payoutMsisdn: string | null;
  payoutLabel: string;
  lines: BagLine[];
  subtotalRwf: number;
  deliveryFeeRwf: number;
  totalRwf: number;
  leadTimeDays: number;
  payable: boolean;
  problems: string[];
}

export function lineProblem(l: BagLine): string | null {
  if (!l.available) return `${l.title} isn't available any more`;
  if (!l.sizes.includes(l.size)) return `${l.title}: size ${l.size} isn't offered`;
  if (!l.madeToOrder && l.stock < l.qty) return l.stock < 1 ? `${l.title} (${l.colourName}) sold out` : `Only ${l.stock} × ${l.title} left`;
  return null;
}

export const groupKey = (l: Pick<BagLine, "pageId" | "payoutMsisdn">) => `${l.pageId}:${l.payoutMsisdn ?? "none"}`;

/** Group lines per maker payout account; fees and totals per group (each maker delivers separately). */
export function splitBag(lines: BagLine[], delivery: Record<string, DeliveryMode> = {}): MakerGroup[] {
  const groups = new Map<string, MakerGroup>();
  for (const l of lines) {
    const key = groupKey(l);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        pageId: l.pageId,
        pageName: l.pageName,
        sector: l.sector,
        payoutMsisdn: l.payoutMsisdn,
        payoutLabel: l.payoutLabel,
        lines: [],
        subtotalRwf: 0,
        deliveryFeeRwf: 0,
        totalRwf: 0,
        leadTimeDays: 0,
        payable: true,
        problems: [],
      };
      groups.set(key, g);
    }
    g.lines.push(l);
    g.subtotalRwf += l.unitPriceRwf * l.qty;
    g.leadTimeDays = Math.max(g.leadTimeDays, l.leadTimeDays);
    const p = lineProblem(l);
    if (p) g.problems.push(p);
  }
  for (const g of groups.values()) {
    if (!g.payoutMsisdn) g.problems.push(`${g.pageName} hasn't set up Mobile Money yet. Order on WhatsApp instead.`);
    g.payable = g.problems.length === 0;
    g.deliveryFeeRwf = (delivery[g.key] ?? "DELIVERY") === "DELIVERY" ? DELIVERY_FEE_RWF : 0;
    g.totalRwf = g.subtotalRwf + g.deliveryFeeRwf;
  }
  return [...groups.values()];
}

/** Deterministic per-group idempotency key: a retried checkout re-finds the same orders. */
export const orderKey = (checkoutKey: string, g: Pick<MakerGroup, "key">) => `${checkoutKey}:${g.key}`;
