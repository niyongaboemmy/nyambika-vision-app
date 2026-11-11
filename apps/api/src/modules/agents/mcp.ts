import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AGENT_LIMITS } from "@nyambika/contracts";
import { HttpException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentContext } from "./access";
import type { CatalogueApi } from "./catalogue.service";
import type { AgentCheckoutService } from "./checkout.service";
import { hasScopes } from "./keys";

export const MCP_TOOLS = ["search_products", "get_product", "get_maker", "check_availability", "create_checkout_intent"] as const;
export const CATALOGUE_RESOURCE = "nyambika://catalogue";

const INSTRUCTIONS =
  "Nyambika lists Rwandan fashion makers (tailors, cooperatives, sellers). Prices are whole Rwandan francs (RWF). " +
  "Always send shoppers to the maker's Maker Space and never promise an order: create_checkout_intent returns a confirmation link " +
  "the shopper must open and confirm in Nyambika; payment goes directly to the maker by Mobile Money.";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> });
const fail = (e: unknown) => {
  const r = e instanceof HttpException ? (e.getResponse() as { message?: unknown; code?: string }) : null;
  const message = r ? (typeof r === "string" ? r : String(r.message ?? e)) : (e as Error).message;
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: r?.code ?? "ERROR", message }) }] };
};
const guard = async <T>(fn: () => Promise<T>) => {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
};

/**
 * MCP server for AI assistants (FR-AGT-03). Stateless: one server per Streamable HTTP request, bound to
 * the calling agent's key (scopes, audit). Tools reuse the public catalogue and the Muse ranking.
 */
export function buildMcpServer(agent: AgentContext, catalogue: CatalogueApi, checkout: AgentCheckoutService) {
  const server = new McpServer({ name: "nyambika", title: "Nyambika makers", version: "1.0.0" }, { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {} } });

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description: "Natural-language search across verified Rwandan makers (Muse ranking: relevance first, then fair rotation across makers). Example: 'kitenge dress for a wedding under 40000'.",
      inputSchema: {
        query: z.string().min(1).max(300),
        max_price_rwf: z.number().int().positive().optional(),
        category: z.string().max(40).optional(),
        colour: z.string().max(20).optional(),
        occasion: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (a) => guard(() => catalogue.search({ query: a.query, max_price: a.max_price_rwf, category: a.category, colour: a.colour, occasion: a.occasion, limit: a.limit })),
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description: "One product with variants (colours, sizes, availability), RWF price, try-on readiness, Maker Space URL and schema.org JSON-LD.",
      inputSchema: { product_id: z.string().min(1).max(64) },
      annotations: { readOnlyHint: true },
    },
    (a) => guard(() => catalogue.productById(a.product_id)),
  );

  server.registerTool(
    "get_maker",
    {
      title: "Get maker",
      description: "A maker's public page (Maker Space): location, rating, how they are paid, and their published products.",
      inputSchema: { handle: z.string().min(1).max(64).describe("Maker handle, e.g. kigali-kitenge-house") },
      annotations: { readOnlyHint: true },
    },
    (a) => guard(() => catalogue.makerByHandle(a.handle)),
  );

  server.registerTool(
    "check_availability",
    {
      title: "Check availability",
      description: "Live availability for a product id or a variant id, optionally for one size, with ready-by dates for pickup and delivery.",
      inputSchema: { id: z.string().min(1).max(64).describe("Product or variant id"), size: z.string().max(10).optional() },
      annotations: { readOnlyHint: true },
    },
    (a) => guard(() => catalogue.availability(a.id, a.size)),
  );

  server.registerTool(
    "create_checkout_intent",
    {
      title: "Create checkout intent",
      description:
        "Prepare a purchase from ONE maker for the shopper. Returns a confirmation link (expires in 30 minutes, single use) to give the shopper. Nothing is ordered or paid until the shopper confirms in Nyambika and approves the Mobile Money request; money goes directly to the maker.",
      inputSchema: {
        items: z
          .array(z.object({ variant_id: z.string().min(1).max(64), size: z.string().min(1).max(10), quantity: z.number().int().min(1).max(AGENT_LIMITS.maxQty).default(1) }))
          .min(1)
          .max(AGENT_LIMITS.maxLineItems),
        external_reference: z.string().max(80).optional(),
        idempotency_key: z.string().min(8).max(80).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (a) =>
      guard(async () => {
        if (!agent.key || !hasScopes(agent.key.scopes, ["checkout:write"])) throw new HttpException({ message: "This key lacks the checkout:write scope", code: "INSUFFICIENT_SCOPE" }, 403);
        const items = a.items.map((i) => ({ id: i.variant_id, size: i.size, quantity: i.quantity }));
        // Same items within 10 minutes = the same session (safe retries) unless the agent sends its own key.
        const key = a.idempotency_key ?? `mcp:${createHash("sha256").update(JSON.stringify(items) + Math.floor(Date.now() / 600_000)).digest("hex").slice(0, 40)}`;
        return checkout.create(agent, key, { items, external_reference: a.external_reference }, "MCP");
      }),
  );

  server.registerResource(
    "catalogue",
    CATALOGUE_RESOURCE,
    { title: "Nyambika catalogue", description: "Verified makers and their published products (snapshot).", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await catalogue.snapshot()) }] }),
  );

  return server;
}
