export interface StudioVariant {
  id: string;
  colourName: string;
  colourHex: string;
  sizes: string[];
  stock: number;
  image: string | null;
  cutout: string | null;
}

export interface StudioProduct {
  id: string;
  pageId: string;
  title: string;
  description: string;
  category: string;
  priceRwf: number;
  madeToOrder: boolean;
  leadTimeDays: number;
  styles: string[];
  occasions: string[];
  fabric: string;
  status: string;
  readiness: string;
  readinessNotes: string[];
  qualityScore: number | null;
  payoutTarget: "PAGE" | "MAKER";
  featured: boolean;
  variants: StudioVariant[];
  makers: { id: string; name: string }[];
}

export interface Maker {
  id: string;
  name: string;
  phone: string;
  momoMerchant: string;
  active: boolean;
  attributionConsent: boolean;
  productCount: number;
  salesRwf: number;
}

export const CATEGORIES = ["dress", "umushanana", "kitenge", "shirt", "skirt", "top", "suit", "kids", "bridal", "shoes", "bag"];
export const OCCASIONS = ["wedding", "office", "church", "party", "graduation", "casual", "traditional-ceremony"];
export const STYLES = ["elegant", "modern", "traditional", "casual", "bold", "minimal"];
