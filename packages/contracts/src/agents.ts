import { z } from "zod";

// ==== E36 Agentic commerce · E37 Try-on as a Service (FR-AGT-01..06, 08) ====

/** API key scopes. A key can only call routes whose scope it holds. */
export const AGENT_SCOPES = ["catalogue:read", "checkout:write", "mcp:use", "tryon:write", "usage:read"] as const;
export const AgentScope = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof AgentScope>;

export const ApiClientKind = z.enum(["AGENT", "PARTNER"]);
export type ApiClientKind = z.infer<typeof ApiClientKind>;

export const ApiKeyEnv = z.enum(["LIVE", "SANDBOX"]);
export type ApiKeyEnv = z.infer<typeof ApiKeyEnv>;

/** Sensible defaults per client kind (the admin can narrow them). */
export const DEFAULT_SCOPES: Record<ApiClientKind, AgentScope[]> = {
  AGENT: ["catalogue:read", "checkout:write", "mcp:use"],
  PARTNER: ["tryon:write", "usage:read"],
};

/** Limits that apply without a key (per IP) and the ceiling on any single key. */
export const AGENT_LIMITS = {
  anonymousPerMin: 30,
  ipCeilingPerMin: 600,
  maxKeyPerMin: 1200,
  mandateTtlMin: 30,
  maxLineItems: 5,
  maxQty: 5,
  pageSizeDefault: 20,
  pageSizeMax: 50,
} as const;

export const ApiClientCreate = z.object({
  name: z.string().trim().min(2).max(80),
  kind: ApiClientKind,
  contactEmail: z.string().trim().email().max(120).or(z.literal("")).default(""),
});

export const ApiKeyCreate = z.object({
  name: z.string().trim().max(60).default(""),
  env: ApiKeyEnv.default("LIVE"),
  scopes: z.array(AgentScope).min(1).max(AGENT_SCOPES.length).optional(),
  rateLimitPerMin: z.number().int().min(1).max(AGENT_LIMITS.maxKeyPerMin).default(120),
  monthlyQuota: z.number().int().min(1).max(10_000_000).nullable().default(null),
  expiresInDays: z.number().int().min(1).max(730).nullable().default(null),
});

export const PartnerContractStatus = z.enum(["DRAFT", "ACTIVE", "SUSPENDED", "ENDED"]);
export const PartnerContractInput = z.object({
  status: PartnerContractStatus,
  monthlyQuota: z.number().int().min(0).max(10_000_000),
  monthlyFeeRwf: z.number().int().min(0).max(1_000_000_000),
  overagePriceRwf: z.number().int().min(0).max(1_000_000),
  hardCap: z.boolean(),
  sandboxDailyCap: z.number().int().min(1).max(10_000).default(50),
  endsAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).default(""),
});
export type PartnerContractInput = z.infer<typeof PartnerContractInput>;

/** Agent checkout session request (ACP `CheckoutSessionCreateRequest`-shaped, snake_case). */
export const AgentCheckoutCreate = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64).describe("Variant id from the public catalogue"),
        size: z.string().min(1).max(10),
        quantity: z.number().int().min(1).max(AGENT_LIMITS.maxQty).default(1),
      }),
    )
    .min(1)
    .max(AGENT_LIMITS.maxLineItems),
  external_reference: z.string().max(80).optional(),
});
export type AgentCheckoutCreate = z.infer<typeof AgentCheckoutCreate>;

/** What the shopper confirms on the mandate page (the agent never sees these). */
export const MandateConfirm = z.object({
  delivery: z.enum(["DELIVERY", "PICKUP"]),
  wallet: z.enum(["MTN_MOMO", "AIRTEL_MONEY"]),
  address: z.string().trim().max(200).default(""),
  payerPhone: z.string().regex(/^\+?[0-9]{9,15}$/),
});
export type MandateConfirm = z.infer<typeof MandateConfirm>;

/**
 * Synthetic AI models for Try-on as a Service. Partners pick one of these; Nyambika shoppers' twins
 * are never offered or used (OP-5, FR-AGT-06).
 */
export const PARTNER_MODELS = [
  { id: "nya-model-1", label: "Synthetic model 1", persona: 1 },
  { id: "nya-model-2", label: "Synthetic model 2", persona: 2 },
  { id: "nya-model-3", label: "Synthetic model 3", persona: 3 },
  { id: "nya-model-4", label: "Synthetic model 4", persona: 4 },
  { id: "nya-model-5", label: "Synthetic model 5", persona: 5 },
] as const;
export const PartnerModelId = z.enum(PARTNER_MODELS.map((m) => m.id) as [string, ...string[]]);

export const PartnerTryonRequest = z.object({
  model_id: PartnerModelId,
  garment_image_b64: z.string().min(100).max(14_000_000).describe("PNG/JPEG/WebP garment image, base64 (≤ 10 MB)"),
  garment_category: z.enum(["dress", "shirt", "skirt", "umushanana"]).default("dress"),
  webhook_url: z.string().url().max(500).optional(),
  client_reference: z.string().max(80).optional(),
});
export type PartnerTryonRequest = z.infer<typeof PartnerTryonRequest>;
