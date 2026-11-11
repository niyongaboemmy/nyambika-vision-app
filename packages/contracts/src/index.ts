import { z } from "zod";

/** Supported UI and Muse languages (FR-ACC-09). */
export const Locale = z.enum(["rw", "en", "fr", "sw"]);
export type Locale = z.infer<typeof Locale>;

/** Roles evaluated per page (FR-ACC-03/04). */
export const Role = z.enum([
  "SHOPPER",
  "PAGE_OWNER",
  "PAGE_STAFF",
  "COOP_ADMIN",
  "COOP_MEMBER",
  "HOST_ADMIN",
  "MODERATOR",
  "DPO",
  "SUPPORT",
]);
export type Role = z.infer<typeof Role>;

export const MemberType = z.enum(["TAILOR", "COOPERATIVE", "SELLER"]);
export type MemberType = z.infer<typeof MemberType>;

/** Page lifecycle (SRS Appendix B3). */
export const PageStatus = z.enum(["DRAFT", "PENDING_VERIFICATION", "PUBLISHED", "PAUSED", "SUSPENDED", "CLOSED"]);
export type PageStatus = z.infer<typeof PageStatus>;

/** Product lifecycle (SRS Appendix B4). */
export const ProductStatus = z.enum(["DRAFT", "PENDING_APPROVAL", "PUBLISHED", "OUT_OF_STOCK", "ARCHIVED"]);
export type ProductStatus = z.infer<typeof ProductStatus>;

export const TryOnReadiness = z.enum(["NOT_ASSESSED", "READY", "NEEDS_BETTER_PHOTO", "NOT_SUPPORTED"]);
export type TryOnReadiness = z.infer<typeof TryOnReadiness>;

/** Order lifecycle (SRS Appendix B2). */
export const OrderStatus = z.enum([
  "NEW",
  "AWAITING_PAYMENT",
  "PAID",
  "ACCEPTED",
  "DECLINED",
  "IN_PREPARATION",
  "READY",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
  "RESOLVED",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Allowed owner-driven transitions after payment. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["ACCEPTED", "DECLINED"],
  ACCEPTED: ["IN_PREPARATION", "CANCELLED"],
  DECLINED: [],
  IN_PREPARATION: ["READY", "SHIPPED"],
  READY: ["DELIVERED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  CANCELLED: [],
  DISPUTED: ["RESOLVED"],
  RESOLVED: [],
};

/** Generation job lifecycle (SRS Appendix B1). Billing only on DELIVERED. */
export const GenerationStatus = z.enum([
  "QUEUED",
  "GENERATING",
  "GUARDING",
  "DELIVERED",
  "WITHHELD",
  "FAILED",
]);
export type GenerationStatus = z.infer<typeof GenerationStatus>;

/** Structured intent produced by the Muse (plan §4.4). */
export const Intent = z.object({
  occasion: z.string().nullable(),
  date: z.string().nullable(),
  budgetMax: z.number().int().nullable(),
  styles: z.array(z.string()),
  colours: z.array(z.string()),
  categories: z.array(z.string()),
  size: z.string().nullable(),
  location: z.string().nullable(),
  language: Locale,
  source: z.enum(["text", "voice", "snap"]),
  parser: z.enum(["rules", "llm"]),
});
export type Intent = z.infer<typeof Intent>;

export const IntentRequest = z.object({
  text: z.string().min(1).max(500),
  source: z.enum(["text", "voice"]).default("text"),
  locale: Locale.optional(),
});
export type IntentRequest = z.infer<typeof IntentRequest>;

export const OtpRequest = z.object({ phone: z.string().regex(/^\+?[0-9]{9,15}$/) });
export const OtpVerify = z.object({ phone: z.string().regex(/^\+?[0-9]{9,15}$/), code: z.string().length(6) });

export const PageInput = z.object({
  handle: z.string().regex(/^[a-z0-9-]{3,40}$/),
  name: z.string().min(2).max(80),
  memberType: MemberType,
  story: z.string().max(1000).optional().default(""),
  district: z.string().max(60).optional().default(""),
  sector: z.string().max(60).optional().default(""),
  whatsapp: z.string().max(20).optional().default(""),
  instagram: z.string().max(60).optional().default(""),
  theme: z.enum(["terra", "indigo", "forest", "violet"]).optional().default("terra"),
  momoMerchant: z.string().max(20).optional().default(""),
});
export type PageInput = z.infer<typeof PageInput>;

export const VariantInput = z.object({
  colourName: z.string().min(1).max(30),
  colourHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sizes: z.array(z.string()).min(1),
  stock: z.number().int().min(0),
});

export const ProductInput = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional().default(""),
  category: z.string().min(2).max(40),
  priceRwf: z.number().int().positive(),
  madeToOrder: z.boolean().default(false),
  leadTimeDays: z.number().int().min(0).max(90).default(0),
  styles: z.array(z.string()).default([]),
  occasions: z.array(z.string()).default([]),
  fabric: z.string().max(60).optional().default(""),
  makerIds: z.array(z.string()).default([]),
  payoutTarget: z.enum(["PAGE", "MAKER"]).default("PAGE"),
  variants: z.array(VariantInput).min(1),
});
export type ProductInput = z.infer<typeof ProductInput>;

export const HoldToBuyRequest = z.object({
  lookId: z.string().optional(),
  variantId: z.string(),
  size: z.string(),
  delivery: z.enum(["PICKUP", "DELIVERY"]),
  wallet: z.enum(["MTN_MOMO", "AIRTEL_MONEY"]),
  payerPhone: z.string().regex(/^\+?[0-9]{9,15}$/),
  address: z.string().max(200).optional().default(""),
  /** E30: maker-funded discount code (automatic offers apply without one). */
  discountCode: z.string().trim().max(20).optional(),
});
export type HoldToBuyRequest = z.infer<typeof HoldToBuyRequest>;

/** Daily per-user generation cap and progressive generation sizes (plan §4.4). */
export const LOOK_GUARDRAILS = {
  initialLooks: 3,
  prefetchPerSwipe: 2,
  dailyUserCap: 15,
} as const;

export const CONSENT_PURPOSES = ["TWIN_PROCESSING", "TRYON_GENERATION", "VOICE_PROCESSING", "MARKETING", "AVATAR_3D"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export * from "./tailor";

export * from "./pilot";

export * from "./agents";
export * from "./growth";
export * from "./ambient";
export * from "./vr";
export * from "./region";
export * from "./presence";
