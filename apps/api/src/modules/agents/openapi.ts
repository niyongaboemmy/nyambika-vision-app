import { AGENT_SCOPES, AgentCheckoutCreate, MandateConfirm, PARTNER_MODELS, PartnerTryonRequest } from "@nyambika/contracts";
import { z } from "zod";
import { config } from "../../config";

/**
 * OpenAPI 3.1 for the public catalogue, agent checkout and partner try-on APIs (FR-AGT-01, SI-14).
 * Response schemas are Zod (used by the contract tests too) and converted with `z.toJSONSchema`
 * (JSON Schema 2020-12, which OpenAPI 3.1 embeds natively).
 */
const Money = z.object({ amount: z.number().int().describe("Whole Rwandan francs (RWF has no minor unit)"), currency: z.literal("RWF") });
const Availability = z.enum(["in_stock", "low_stock", "out_of_stock", "made_to_order"]);

export const PublicMakerSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  type: z.enum(["tailor", "cooperative", "seller"]),
  verified: z.literal(true),
  location: z.object({ district: z.string(), sector: z.string(), country: z.literal("RW") }),
  rating: z.number(),
  review_count: z.number().int(),
  maker_space_url: z.string().url(),
  payments: z.object({ paid_directly_to_maker: z.literal(true), methods: z.array(z.string()) }),
  product_count: z.number().int().optional(),
  updated_at: z.string(),
});

export const PublicVariantSchema = z.object({
  id: z.string(),
  colour_name: z.string(),
  colour_hex: z.string(),
  sizes: z.array(z.string()),
  availability: Availability,
  image_url: z.string().url().nullable(),
});

export const PublicProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  fabric: z.string(),
  styles: z.array(z.string()),
  occasions: z.array(z.string()),
  price: Money,
  made_to_order: z.boolean(),
  lead_time_days: z.number().int(),
  try_on: z.object({ readiness: z.string(), ready: z.boolean(), url: z.string().url().nullable() }),
  maker: z.object({ id: z.string(), handle: z.string(), name: z.string(), verified: z.boolean(), maker_space_url: z.string().url() }),
  made_by: z.array(z.string()),
  variants: z.array(PublicVariantSchema),
  url: z.string().url(),
  updated_at: z.string(),
});

const list = <T extends z.ZodType>(item: T) => z.object({ object: z.literal("list"), data: z.array(item), has_more: z.boolean(), next_cursor: z.string().nullable() });
export const MakerListSchema = list(PublicMakerSchema);
export const ProductListSchema = list(PublicProductSchema);
export const ProductDetailSchema = PublicProductSchema.extend({ schema_org: z.record(z.string(), z.unknown()).describe("schema.org Product with one Offer per variant") });
export const MakerDetailSchema = PublicMakerSchema.extend({ products: z.array(PublicProductSchema) });

export const AvailabilitySchema = z.object({
  product_id: z.string(),
  title: z.string(),
  price: Money,
  made_to_order: z.boolean(),
  lead_time_days: z.number().int(),
  ready_by: z.object({ pickup: z.string(), delivery: z.string() }),
  delivery: z.object({ fee: Money, pickup_sector: z.string() }),
  variants: z.array(
    z.object({ variant_id: z.string(), colour_name: z.string(), sizes: z.array(z.string()), availability: Availability, orderable: z.boolean(), size: z.string().optional(), size_offered: z.boolean().optional() }),
  ),
  checked_at: z.string(),
});

export const SearchSchema = z.object({
  query: z.string(),
  understood: z.record(z.string(), z.unknown()),
  results: z.array(PublicProductSchema.extend({ suggested_variant_id: z.string().nullable(), why: z.array(z.string()), score: z.number() })),
});

export const CheckoutSessionSchema = z.object({
  id: z.string(),
  object: z.literal("checkout_session"),
  status: z.enum(["not_ready_for_payment", "in_progress", "completed", "canceled"]),
  nyambika_status: z.enum(["awaiting_user_confirmation", "awaiting_payment", "paid", "declined", "canceled", "expired"]),
  currency: z.literal("RWF"),
  maker: z.object({ id: z.string(), handle: z.string(), name: z.string(), maker_space_url: z.string().url() }),
  line_items: z.array(
    z.object({ id: z.string(), item: z.object({ id: z.string(), quantity: z.number().int() }), title: z.string(), colour_name: z.string(), size: z.string(), base_amount: z.number().int(), subtotal: z.number().int() }),
  ),
  totals: z.array(z.object({ type: z.string(), display_text: z.string(), amount: z.number().int() })),
  payment: z.object({ paid_directly_to: z.string(), methods: z.array(z.string()), handled_by: z.literal("shopper_in_nyambika") }),
  mandate: z.object({ type: z.literal("user_confirmation"), confirmation_url: z.string().url().nullable(), expires_at: z.string(), single_use: z.literal(true) }),
  order: z.object({ code: z.string(), status: z.string() }).nullable(),
  messages: z.array(z.object({ type: z.enum(["info", "error"]), content: z.string() })),
  links: z.array(z.object({ type: z.string(), url: z.string().url() })),
  external_reference: z.string().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
});

export const PartnerJobSchema = z.object({
  id: z.string(),
  object: z.literal("tryon_job"),
  status: z.enum(["queued", "generating", "guarding", "delivered", "withheld", "failed"]),
  environment: z.enum(["live", "sandbox"]),
  model_id: z.string(),
  client_reference: z.string().nullable(),
  result: z
    .object({
      image_url: z.string().url().describe("Signed, expires after 5 minutes; poll again for a fresh link"),
      expires_at: z.string(),
      watermarked: z.boolean(),
      ai_label: z.literal("AI preview"),
      c2pa: z.object({ signed: z.boolean(), sha256: z.string().nullable(), model: z.string() }),
    })
    .nullable(),
  guard: z.object({ passed: z.boolean(), reasons: z.array(z.string()) }).nullable(),
  billing: z.object({ billable: z.boolean(), band: z.enum(["included", "overage", "none"]), price: Money }),
  webhook: z.object({ status: z.string(), attempts: z.number().int() }).nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  delivered_at: z.string().nullable(),
});

const ErrorSchema = z.object({ statusCode: z.number().int(), message: z.unknown(), code: z.string().optional() });

const js = (s: z.ZodType) => z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "any", io: "input" }) as Record<string, unknown>;
const jsOut = (s: z.ZodType) => z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string, description = "OK") => ({ description, content: { "application/json": { schema: ref(name) } } });
const errors = {
  "400": json("Error", "Validation failed"),
  "401": json("Error", "Missing, unknown, revoked or expired API key"),
  "403": json("Error", "Key lacks the scope, or the client is suspended"),
  "404": json("Error", "Not found (or not on the public catalogue)"),
  "429": json("Error", "Rate limit (per key / per IP) or monthly quota exceeded. See Retry-After."),
  "503": json("Error", "Channel paused by the host kill switch"),
};
const cursor = [
  { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque cursor from `next_cursor`" },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
];
const etag = { name: "If-None-Match", in: "header", schema: { type: "string" }, description: "Weak ETag from a previous response; 304 when unchanged" };
const idem = { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 80 } };

export function openApiDocument() {
  const pub = { tags: ["Public catalogue"], security: [{}, { apiKey: [] }] };
  return {
    openapi: "3.1.0",
    info: {
      title: "Nyambika public catalogue, agent commerce and Try-on as a Service",
      version: "1.0.0",
      summary: "Rwandan fashion makers' catalogues for AI agents and partners. Every purchase is confirmed by the shopper and paid directly to the maker.",
      description:
        "Read-only catalogue (published, verified Maker Spaces that opted in to agent channels), agent checkout sessions that require an explicit shopper confirmation (signed, single-use, expiring mandate) before anything is ordered or paid, an MCP server at `/mcp` (Streamable HTTP), and the B2B try-on API. Never exposes shopper data.",
      contact: { name: "Nyambika partnerships", email: "partners@nyambika.rw" },
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    servers: [{ url: config.selfUrl, description: "This environment" }],
    tags: [
      { name: "Public catalogue", description: "Anonymous access is limited per IP; send an API key for higher limits." },
      { name: "Agent checkout", description: "ACP-shaped checkout sessions; UCP discovery at /.well-known/ucp. Payment is never delegated to the agent." },
      { name: "Try-on as a Service", description: "Partner API: garment image + synthetic AI model → guarded, labelled, C2PA-signed result." },
    ],
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "nya_live_… / nya_test_…", description: `Scopes: ${AGENT_SCOPES.join(", ")}` },
      },
      schemas: {
        Error: jsOut(ErrorSchema),
        Maker: jsOut(PublicMakerSchema),
        MakerDetail: jsOut(MakerDetailSchema),
        MakerList: jsOut(MakerListSchema),
        Product: jsOut(PublicProductSchema),
        ProductDetail: jsOut(ProductDetailSchema),
        ProductList: jsOut(ProductListSchema),
        Availability: jsOut(AvailabilitySchema),
        Search: jsOut(SearchSchema),
        CheckoutSessionCreate: js(AgentCheckoutCreate),
        CheckoutSession: jsOut(CheckoutSessionSchema),
        MandateConfirm: js(MandateConfirm),
        TryonRequest: js(PartnerTryonRequest),
        TryonJob: jsOut(PartnerJobSchema),
      },
    },
    paths: {
      "/v1/public/makers": { get: { ...pub, operationId: "listMakers", summary: "List makers (Maker Spaces)", parameters: [...cursor, { name: "district", in: "query", schema: { type: "string" } }, { name: "type", in: "query", schema: { enum: ["tailor", "cooperative", "seller"] } }, etag], responses: { "200": json("MakerList"), "304": { description: "Not modified" }, ...errors } } },
      "/v1/public/makers/{handle}": { get: { ...pub, operationId: "getMaker", summary: "One maker with its published products", parameters: [{ name: "handle", in: "path", required: true, schema: { type: "string" } }, etag], responses: { "200": json("MakerDetail"), "304": { description: "Not modified" }, ...errors } } },
      "/v1/public/products": {
        get: {
          ...pub,
          operationId: "listProducts",
          summary: "List products with variants, availability, RWF price and try-on readiness",
          parameters: [...cursor, ...["maker", "category", "min_price", "max_price"].map((name) => ({ name, in: "query", schema: { type: "string" } })), { name: "try_on_ready", in: "query", schema: { type: "boolean" } }, { name: "in_stock", in: "query", schema: { type: "boolean" } }, etag],
          responses: { "200": json("ProductList"), "304": { description: "Not modified" }, ...errors },
        },
      },
      "/v1/public/products/{id}": { get: { ...pub, operationId: "getProduct", summary: "One product, with schema.org Product/Offer JSON-LD (also served as application/ld+json on request)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, etag], responses: { "200": json("ProductDetail"), "304": { description: "Not modified" }, ...errors } } },
      "/v1/public/products/{id}/availability": { get: { ...pub, operationId: "checkAvailability", summary: "Live availability for a product or variant id", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "size", in: "query", schema: { type: "string" } }], responses: { "200": json("Availability"), ...errors } } },
      "/v1/public/search": { get: { ...pub, operationId: "searchProducts", summary: "Natural-language search with the Muse ranking (fair across makers)", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", maxLength: 300 } }, { name: "max_price", in: "query", schema: { type: "integer" } }, { name: "limit", in: "query", schema: { type: "integer", maximum: 20 } }], responses: { "200": json("Search"), ...errors } } },
      "/v1/agent/checkout_sessions": {
        post: {
          tags: ["Agent checkout"],
          security: [{ apiKey: ["checkout:write"] }],
          operationId: "createCheckoutSession",
          summary: "Create a checkout session for one maker → returns the shopper confirmation link",
          parameters: [idem],
          requestBody: { required: true, content: { "application/json": { schema: ref("CheckoutSessionCreate") } } },
          responses: { "201": json("CheckoutSession", "Created. Nothing is ordered until the shopper confirms."), ...errors },
        },
      },
      "/v1/agent/checkout_sessions/{id}": { get: { tags: ["Agent checkout"], security: [{ apiKey: ["checkout:write"] }], operationId: "getCheckoutSession", summary: "Poll a checkout session (status follows the shopper's confirmation and payment)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json("CheckoutSession"), ...errors } } },
      "/v1/agent/checkout_sessions/{id}/complete": { post: { tags: ["Agent checkout"], security: [{ apiKey: ["checkout:write"] }], operationId: "completeCheckoutSession", summary: "Always 409: payment cannot be completed by an agent; the shopper confirms and pays the maker in Nyambika", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "409": json("CheckoutSession", "Requires user confirmation"), ...errors } } },
      "/v1/agent/checkout_sessions/{id}/cancel": { post: { tags: ["Agent checkout"], security: [{ apiKey: ["checkout:write"] }], operationId: "cancelCheckoutSession", summary: "Cancel before the shopper confirms", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json("CheckoutSession"), ...errors } } },
      "/v1/partner/models": { get: { tags: ["Try-on as a Service"], security: [{ apiKey: ["tryon:write"] }], operationId: "listModels", summary: `Synthetic AI models (${PARTNER_MODELS.length}); shoppers' twins are never available`, responses: { "200": { description: "OK" }, ...errors } } },
      "/v1/partner/tryon": {
        post: {
          tags: ["Try-on as a Service"],
          security: [{ apiKey: ["tryon:write"] }],
          operationId: "createTryon",
          summary: "Queue a try-on (async). Poll GET /v1/partner/tryon/{id} or receive a signed webhook.",
          parameters: [{ ...idem, required: false }],
          requestBody: { required: true, content: { "application/json": { schema: ref("TryonRequest") } } },
          responses: { "202": json("TryonJob", "Accepted"), ...errors },
          callbacks: {
            tryonFinished: {
              "{$request.body#/webhook_url}": {
                post: {
                  summary: "Job finished. Header Nyambika-Signature: t=<unix>,v1=<hex HMAC-SHA-256 of `t.body`>",
                  requestBody: { content: { "application/json": { schema: { type: "object", properties: { type: { const: "tryon.finished" }, data: ref("TryonJob") } } } } },
                  responses: { "200": { description: "Acknowledge with any 2xx" } },
                },
              },
            },
          },
        },
      },
      "/v1/partner/tryon/{id}": { get: { tags: ["Try-on as a Service"], security: [{ apiKey: ["tryon:write"] }], operationId: "getTryon", summary: "Poll a try-on job", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": json("TryonJob"), ...errors } } },
      "/v1/partner/usage.csv": { get: { tags: ["Try-on as a Service"], security: [{ apiKey: ["usage:read"] }], operationId: "usageStatement", summary: "Monthly usage statement (CSV)", parameters: [{ name: "month", in: "query", schema: { type: "string", pattern: "^\\d{4}-\\d{2}$" } }], responses: { "200": { description: "CSV", content: { "text/csv": { schema: { type: "string" } } } }, ...errors } } },
    },
    "x-mcp": { url: `${config.selfUrl}/mcp`, transport: "streamable-http", tools: ["search_products", "get_product", "get_maker", "check_availability", "create_checkout_intent"], resources: ["nyambika://catalogue"] },
  };
}
