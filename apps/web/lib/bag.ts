/** Optional classic bag (E29): one order + one Mobile Money request per maker. */

export const BAG_DELIVERY_FEE = 2000;

export interface BagLine {
  id: string;
  productId: string;
  variantId: string;
  size: string;
  qty: number;
  title: string;
  colourName: string;
  unitPriceRwf: number;
  madeToOrder: boolean;
  stock: number;
  makerName: string;
  image: string | null;
}

export interface BagGroup {
  key: string;
  pageId: string;
  pageName: string;
  sector: string;
  payoutLabel: string;
  lines: BagLine[];
  subtotalRwf: number;
  deliveryFeeRwf: number;
  totalRwf: number;
  leadTimeDays: number;
  payable: boolean;
  problems: string[];
}

export interface Bag {
  groups: BagGroup[];
  count: number;
  totalRwf: number;
  payments: number;
}

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  isDefault: boolean;
}

export interface CheckoutResult {
  checkoutId: string;
  orders: { id: string; code: string; pageName: string; payoutLabel: string; totalRwf: number; items: number; status: string }[];
  failed: { pageName: string; reason: string }[];
}
