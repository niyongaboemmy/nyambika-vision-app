import { All, Body, ConflictException, Controller, Get, Headers, HttpCode, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PARTNER_MODELS } from "@nyambika/contracts";
import type { Request, Response } from "express";
import { AuthUser, CurrentUser, Public } from "../../common/auth";
import { config } from "../../config";
import { Agent, AgentGuard, AgentRoute, type AgentContext, type AgentRequest } from "./access";
import { CatalogueApi, etagOf } from "./catalogue.service";
import { AgentCheckoutService } from "./checkout.service";
import { buildMcpServer } from "./mcp";
import { openApiDocument } from "./openapi";
import { PartnerService } from "./partner.service";

/** JSON with a weak ETag; 304 when the client already has it. */
function reply(req: Request, res: Response, body: unknown, maxAge = 60) {
  const tag = etagOf(body);
  res.setHeader("ETag", tag);
  res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
  res.setHeader("Vary", "Authorization, X-Api-Key, Accept");
  if (req.headers["if-none-match"] === tag) return res.status(304).end();
  return res.json(body);
}

// Protocol versions we align with (see docs/adr/0005-agentic-commerce.md for what is approximated).
export const UCP_VERSION = "2026-08-25";
export const ACP_VERSION = "2025-09-29";

/** FR-AGT-01: versioned, read-only public catalogue. Key optional (per-IP limits without one). */
@Controller("v1/public")
@Public()
@UseGuards(AgentGuard)
@AgentRoute({ scopes: ["catalogue:read"], keyRequired: false })
export class PublicCatalogueController {
  constructor(private catalogue: CatalogueApi) {}

  @Get("makers")
  async makers(@Req() req: Request, @Res() res: Response, @Query() q: Record<string, string>) {
    return reply(req, res, await this.catalogue.makers(q));
  }

  @Get("makers/:handle")
  async maker(@Req() req: Request, @Res() res: Response, @Param("handle") handle: string) {
    return reply(req, res, await this.catalogue.makerByHandle(handle));
  }

  @Get("products")
  async products(@Req() req: Request, @Res() res: Response, @Query() q: Record<string, string>) {
    return reply(req, res, await this.catalogue.products(q));
  }

  @Get("search")
  async search(@Req() req: Request, @Res() res: Response, @Query("q") q = "", @Query("max_price") max?: string, @Query("limit") limit?: string) {
    const body = await this.catalogue.search({ query: q.slice(0, 300) || "something to wear", max_price: max ? Number(max) || undefined : undefined, limit: limit ? Number(limit) : undefined });
    return reply(req, res, body, 30);
  }

  @Get("products/:id")
  async product(@Req() req: Request, @Res() res: Response, @Param("id") id: string) {
    const p = await this.catalogue.productById(id);
    if (String(req.headers.accept ?? "").includes("application/ld+json")) {
      res.type("application/ld+json");
      res.setHeader("ETag", etagOf(p.schema_org));
      return res.send(JSON.stringify(p.schema_org));
    }
    return reply(req, res, p);
  }

  @Get("products/:id/availability")
  async availability(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Query("size") size?: string) {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await this.catalogue.availability(id, size));
  }
}

/** Docs and discovery: never paused, never keyed. */
@Controller()
@Public()
export class AgentDiscoveryController {
  @Get("v1/public/openapi.json")
  openapi(@Res() res: Response) {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(openApiDocument());
  }

  /** UCP business profile (shape of UCP 2026-08-25 §Discovery). */
  @Get(".well-known/ucp")
  ucp() {
    const spec = "https://ucp.dev/specification/overview";
    return {
      ucp: {
        version: UCP_VERSION,
        services: {
          "dev.ucp.shopping": [
            { version: UCP_VERSION, spec, transport: "rest", endpoint: `${config.selfUrl}/ucp/v1`, schema: `${config.selfUrl}/v1/public/openapi.json` },
            { version: UCP_VERSION, spec, transport: "mcp", endpoint: `${config.selfUrl}/mcp` },
          ],
        },
        capabilities: { "dev.ucp.shopping.checkout": [{ version: UCP_VERSION, spec: "https://ucp.dev/specification/shopping/checkout/rest/", schema: `${config.selfUrl}/v1/public/openapi.json#/components/schemas/CheckoutSession` }] },
        // No delegated payment: the shopper pays the maker by Mobile Money inside Nyambika after confirming.
        payment_handlers: {},
      },
      keys: [],
      "rw.nyambika": {
        buyer_confirmation: "required",
        paid_directly_to_maker: true,
        acp: { version: ACP_VERSION, endpoint: `${config.selfUrl}/v1/agent/checkout_sessions` },
        catalogue: `${config.selfUrl}/v1/public/products`,
      },
    };
  }
}

/** Agent checkout (ACP-shaped) + UCP aliases. Requires an AGENT key with checkout:write. */
@Controller()
@Public()
@UseGuards(AgentGuard)
@AgentRoute({ scopes: ["checkout:write"], kind: "AGENT" })
export class AgentCheckoutController {
  constructor(private checkout: AgentCheckoutService) {}

  @Post("v1/agent/checkout_sessions")
  async create(@Agent() agent: AgentContext, @Headers("idempotency-key") key: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader("API-Version", ACP_VERSION);
    return this.checkout.create(agent, key, body);
  }

  @Get("v1/agent/checkout_sessions/:id")
  async get(@Agent() agent: AgentContext, @Param("id") id: string) {
    return this.checkout.view(await this.checkout.forAgent(agent, id));
  }

  /** ACP "complete" carries a delegated payment token; Nyambika never takes payment from an agent. */
  @Post("v1/agent/checkout_sessions/:id/complete")
  async complete(@Agent() agent: AgentContext, @Param("id") id: string) {
    const view = await this.checkout.view(await this.checkout.forAgent(agent, id));
    throw new ConflictException({ ...view, code: "REQUIRES_USER_CONFIRMATION", message: "The shopper must confirm and pay the maker in Nyambika. Share mandate.confirmation_url." });
  }

  @Post("v1/agent/checkout_sessions/:id/cancel")
  @HttpCode(200)
  cancel(@Agent() agent: AgentContext, @Param("id") id: string) {
    return this.checkout.cancel(agent, id);
  }

  // UCP REST binding (same sessions, UCP status vocabulary + continue_url for the buyer handoff).
  @Post("ucp/v1/checkout-sessions")
  async ucpCreate(@Agent() agent: AgentContext, @Headers("idempotency-key") key: string | undefined, @Body() body: { line_items?: { item?: { id?: string }; quantity?: number; size?: string }[] } & Record<string, unknown>) {
    const items = Array.isArray(body?.line_items) ? body.line_items.map((l) => ({ id: l.item?.id ?? "", size: l.size ?? "", quantity: l.quantity ?? 1 })) : (body as { items?: unknown }).items;
    return toUcp(await this.checkout.create(agent, key, { items, external_reference: body?.external_reference }));
  }

  @Get("ucp/v1/checkout-sessions/:id")
  async ucpGet(@Agent() agent: AgentContext, @Param("id") id: string) {
    return toUcp(await this.checkout.view(await this.checkout.forAgent(agent, id)));
  }

  @Post("ucp/v1/checkout-sessions/:id/cancel")
  @HttpCode(200)
  async ucpCancel(@Agent() agent: AgentContext, @Param("id") id: string) {
    return toUcp(await this.checkout.cancel(agent, id));
  }
}

type SessionView = Awaited<ReturnType<AgentCheckoutService["view"]>>;
export function toUcp(v: SessionView) {
  const status = { awaiting_user_confirmation: "incomplete", awaiting_payment: "complete_in_progress", paid: "completed", declined: "canceled", canceled: "canceled", expired: "canceled" }[v.nyambika_status];
  return {
    ucp: { version: UCP_VERSION, capabilities: { "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }] } },
    id: v.id,
    status,
    currency: v.currency,
    line_items: v.line_items.map((l) => ({ id: l.id, item: { id: l.item.id, title: `${l.title} · ${l.colour_name} · ${l.size}`, price: l.base_amount }, quantity: l.item.quantity, totals: [{ type: "subtotal", amount: l.subtotal }] })),
    totals: v.totals.map((t) => ({ type: t.type === "items_base_amount" ? "subtotal" : t.type, amount: t.amount })),
    continue_url: v.mandate.confirmation_url,
    messages: v.messages.map((m) => ({ type: m.type, content: m.content })),
    links: v.links,
    expires_at: v.expires_at,
    "rw.nyambika": { nyambika_status: v.nyambika_status, maker: v.maker, payment: v.payment, order: v.order },
  };
}

/** MCP (Streamable HTTP, stateless) for AI assistants. */
@Controller("mcp")
@Public()
@UseGuards(AgentGuard)
@AgentRoute({ scopes: ["mcp:use"], kind: "AGENT" })
export class McpController {
  constructor(
    private catalogue: CatalogueApi,
    private checkout: AgentCheckoutService,
  ) {}

  @All()
  async handle(@Req() req: AgentRequest, @Res() res: Response) {
    const body = req.body as { method?: string; params?: { name?: string } } | undefined;
    if (body?.method === "tools/call") req.agent!.tool = String(body.params?.name ?? "").slice(0, 40);
    else if (body?.method === "resources/read") req.agent!.tool = "resource:catalogue";
    if (req.method !== "POST") {
      // Stateless server: no standalone SSE stream or session to delete.
      return res.status(405).setHeader("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    }
    const server = buildMcpServer(req.agent!, this.catalogue, this.checkout);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}

/** E37 Try-on as a Service. PARTNER keys only; live or sandbox. */
@Controller("v1/partner")
@Public()
@UseGuards(AgentGuard)
@AgentRoute({ scopes: ["tryon:write"], kind: "PARTNER", channel: "partners" })
export class PartnerController {
  constructor(private partners: PartnerService) {}

  @Get("models")
  models() {
    return { object: "list", data: PARTNER_MODELS.map((m) => ({ id: m.id, label: m.label, synthetic: true })), note: "Synthetic AI models only. Nyambika shoppers' twins are never available to partners." };
  }

  @Post("tryon")
  @HttpCode(202)
  create(@Agent() agent: AgentContext, @Body() body: unknown, @Headers("idempotency-key") key?: string) {
    return this.partners.create(agent, body, key && key.length >= 8 && key.length <= 80 ? key : undefined);
  }

  @Get("tryon/:id")
  async get(@Agent() agent: AgentContext, @Param("id") id: string) {
    return this.partners.view(await this.partners.get(agent.client!.id, id));
  }

  @Get("usage.csv")
  @AgentRoute({ scopes: ["usage:read"], kind: "PARTNER", channel: "partners" })
  async usage(@Agent() agent: AgentContext, @Query("month") month: string | undefined, @Res() res: Response) {
    const s = await this.partners.statement(agent.client!.id, month);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="nyambika-tryon-${s.month}.csv"`);
    res.send(s.csv);
  }
}

/** Signed, 5-minute result links (no key needed: the signature is the capability). */
@Controller("v1/partner/results")
@Public()
export class PartnerResultController {
  constructor(private partners: PartnerService) {}

  @Get(":id")
  async image(@Param("id") id: string, @Query("exp") exp: string, @Query("sig") sig: string, @Res() res: Response) {
    if (!this.partners.verifyResult(id, exp, sig)) throw new NotFoundException();
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "private, max-age=300");
    res.send(await this.partners.resultImage(id));
  }
}

/** Shopper side of the mandate (FR-AGT-04): view without an account, confirm only when signed in. */
@Controller("agent-mandates")
export class MandateController {
  constructor(private checkout: AgentCheckoutService) {}

  @Public()
  @Get(":token")
  preview(@Param("token") token: string, @CurrentUser() user: AuthUser | null) {
    return this.checkout.preview(token, user?.id);
  }

  @Post(":token/confirm")
  confirm(@CurrentUser() user: AuthUser, @Param("token") token: string, @Body() body: unknown) {
    return this.checkout.confirm(user.id, token, body);
  }

  @Public()
  @Post(":token/decline")
  decline(@Param("token") token: string) {
    return this.checkout.decline(token);
  }
}
