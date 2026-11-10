export interface MakerProductVariant {
  id: string;
  colourName: string;
  colourHex: string;
  sizes: string[];
  inStock: boolean;
  image: string | null;
}

export interface MakerProduct {
  id: string;
  title: string;
  category: string;
  priceRwf: number;
  madeToOrder: boolean;
  leadTimeDays: number;
  readiness: string;
  featured: boolean;
  makers: string[];
  variants: MakerProductVariant[];
}

export interface MakerSpace {
  id: string;
  handle: string;
  name: string;
  memberType: "TAILOR" | "COOPERATIVE" | "SELLER";
  verified: boolean;
  district: string;
  sector: string;
  theme: string;
  rating: number;
  reviewCount: number;
  story: string;
  whatsapp: string;
  instagram: string;
  following: boolean;
  followers: number;
  productCount: number;
  tagline: string;
  products: MakerProduct[];
  reviews: { rating: number; text: string; by: string; at: string }[];
}

export const THEMES: Record<string, string> = {
  terra: "linear-gradient(160deg,#E0703F 0%,#F2B84B 55%,#3a2140 100%)",
  indigo: "linear-gradient(160deg,#2B4EA2 0%,#38BDF8 55%,#1b1838 100%)",
  forest: "linear-gradient(160deg,#1F7A4D 0%,#34D399 55%,#14241f 100%)",
  violet: "linear-gradient(160deg,#6D28D9 0%,#C084FC 55%,#22163a 100%)",
};

export const TYPE_LABEL = { TAILOR: "✂️ Tailor", COOPERATIVE: "🧵 Cooperative", SELLER: "🛍️ Seller" } as const;

export function waLink(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
