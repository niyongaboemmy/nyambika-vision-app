import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import cookieParser from "cookie-parser";
import { json } from "express";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

// E36 agentic commerce + E37 Try-on as a Service, against the real app, database, Redis and AI gateway.
let app: INestApplication;
let base: string;
const onThisApp = (url: string) => { const u = new URL(url); return `${base}${u.pathname}${u.search}`; };
let prisma: import("../src/common/prisma.service").PrismaService;
let payments: import("../src/modules/payments/payments.module").PaymentsService;
let checkout: import("../src/modules/agents/checkout.service").AgentCheckoutService;
let schemas: typeof import("../src/modules/agents/openapi");
let host: ReturnType<typeof request.agent>;
const stamp = String(Date.now()).slice(-6);
const stock: { id: string; stock: number }[] = [];
let agentKey = "";
let variant: { id: string; size: string; price: number };

async function login(p: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone: p }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone: p, code: r.body.devCode }).expect(200);
  return agent;
}
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });

async function newKey(clientId: string, body: object) {
  return (await host.post(`/admin/agents/clients/${clientId}/keys`).send(body).expect(201)).body as { id: string; secret: string; prefix: string };
}

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const { PaymentsService } = await import("../src/modules/payments/payments.module");
  const { AgentCheckoutService } = await import("../src/modules/agents/checkout.service");
  schemas = await import("../src/modules/agents/openapi");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication({ bodyParser: false });
  app.use("/v1/partner", json({ limit: "15mb" }));
  app.use(json({ limit: "2mb" }));
  app.use(cookieParser());
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  prisma = app.get(PrismaService);
  payments = app.get(PaymentsService);
  checkout = app.get(AgentCheckoutService);
  await prisma.featureFlag.updateMany({ where: { key: { in: ["agents.kill_switch", "partners.kill_switch"] } }, data: { enabled: false } });
  host = await login("0788900001");
  const v = await prisma.variant.findFirstOrThrow({ where: { stock: { gte: 3 }, product: { status: "PUBLISHED", madeToOrder: false, payoutTarget: "PAGE", page: { handle: "kigali-kitenge-house" } } }, include: { product: true } });
  stock.push({ id: v.id, stock: v.stock });
  variant = { id: v.id, size: v.sizes[0], price: v.product.priceRwf };
});

afterAll(async () => {
  for (const s of stock) await prisma?.variant.update({ where: { id: s.id }, data: { stock: s.stock } });
  await app?.close();
});

describe("public catalogue API (FR-AGT-01)", () => {
  it("serves published, verified makers and products with cursors, ETags and an OpenAPI 3.1 contract", async () => {
    const http = request(app.getHttpServer());
    const doc = (await http.get("/v1/public/openapi.json").expect(200)).body;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/v1/public/products", "/v1/agent/checkout_sessions", "/v1/partner/tryon"]));
    expect(doc.components.schemas.Product.type).toBe("object");

    const first = await http.get("/v1/public/products?limit=2").expect(200);
    schemas.ProductListSchema.parse(first.body);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.has_more).toBe(true);
    const next = await http.get(`/v1/public/products?limit=2&cursor=${first.body.next_cursor}`).expect(200);
    expect(next.body.data[0].id > first.body.data[1].id).toBe(true);
    expect(first.headers.etag).toMatch(/^W\//);
    await http.get("/v1/public/products?limit=2").set("if-none-match", first.headers.etag).expect(304);
    expect(first.headers["ratelimit-limit"]).toBe("30"); // anonymous: per-IP limit

    const makers = (await http.get("/v1/public/makers").expect(200)).body;
    schemas.MakerListSchema.parse(makers);
    expect(makers.data.every((m: { verified: boolean }) => m.verified)).toBe(true);
    expect(makers.data.some((m: { handle: string }) => m.handle.startsWith("tenant-"))).toBe(false); // unverified pages never listed
    const p = (await http.get(`/v1/public/products/${first.body.data[0].id}`).expect(200)).body;
    schemas.ProductDetailSchema.parse(p);
    expect(p.schema_org["@type"]).toBe("Product");
    expect(p.schema_org.offers[0]).toMatchObject({ "@type": "Offer", priceCurrency: "RWF", price: p.price.amount });
    const ld = await http.get(`/v1/public/products/${p.id}`).set("accept", "application/ld+json").expect(200);
    expect(ld.headers["content-type"]).toContain("application/ld+json");
    schemas.AvailabilitySchema.parse((await http.get(`/v1/public/products/${variant.id}/availability?size=${variant.size}`).expect(200)).body);
    // Never shopper data.
    expect(JSON.stringify(p)).not.toMatch(/\+2507|shopper|buyer/i);
  });

  it("hides pages that opted out of agent channels (FR-AGT-05)", async () => {
    const owner = await login("0788100003"); // seller, kigali-kitenge-house
    const page = await prisma.page.findUniqueOrThrow({ where: { handle: "kigali-kitenge-house" } });
    await owner.put(`/pages/${page.id}/agent-channels`).send({ agentsEnabled: false, marketplacesEnabled: true }).expect(200);
    const http = request(app.getHttpServer());
    await http.get("/v1/public/makers/kigali-kitenge-house").expect(404);
    await owner.put(`/pages/${page.id}/agent-channels`).send({ agentsEnabled: true, marketplacesEnabled: true }).expect(200);
    await http.get("/v1/public/makers/kigali-kitenge-house").expect(200);
  });
});

describe("agent identity and safety (FR-AGT-08)", () => {
  it("issues hashed keys once, enforces scopes, revocation, rate limits and quotas, and audits every call", async () => {
    const client = (await host.post("/admin/agents/clients").send({ name: `Test agent ${stamp}`, kind: "AGENT" }).expect(201)).body;
    const k = await newKey(client.id, { name: "main" });
    agentKey = k.secret;
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(stored.hash).not.toContain(k.secret.slice(9));
    expect(JSON.stringify(stored)).not.toContain(k.secret);
    expect((await host.get("/admin/agents").expect(200)).text).not.toContain(k.secret);

    const http = request(app.getHttpServer());
    const ok = await http.get("/v1/public/makers").set(bearer(k.secret)).expect(200);
    expect(ok.headers["ratelimit-limit"]).toBe("120");
    await http.get("/v1/public/makers").set(bearer("nya_live_" + "x".repeat(32))).expect(401);

    // Scope: a catalogue-only key can't create checkouts.
    const readOnly = await newKey(client.id, { scopes: ["catalogue:read"] });
    const denied = await http.post("/v1/agent/checkout_sessions").set(bearer(readOnly.secret)).set("idempotency-key", `t-${stamp}-x`).send({ items: [] }).expect(403);
    expect(denied.body.code).toBe("INSUFFICIENT_SCOPE");

    // Rate limit and monthly quota per key.
    const tiny = await newKey(client.id, { rateLimitPerMin: 2 });
    await http.get("/v1/public/makers").set(bearer(tiny.secret)).expect(200);
    await http.get("/v1/public/makers").set(bearer(tiny.secret)).expect(200);
    const limited = await http.get("/v1/public/makers").set(bearer(tiny.secret)).expect(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    const quota = await newKey(client.id, { monthlyQuota: 1 });
    await http.get("/v1/public/makers").set(bearer(quota.secret)).expect(200);
    expect((await http.get("/v1/public/makers").set(bearer(quota.secret)).expect(429)).body.code).toBe("QUOTA_EXCEEDED");

    // Revocation is immediate.
    await host.post(`/admin/agents/keys/${readOnly.id}/revoke`).expect(201);
    expect((await http.get("/v1/public/makers").set(bearer(readOnly.secret)).expect(401)).body.code).toBe("KEY_REVOKED");

    await new Promise((r) => setTimeout(r, 300));
    const calls = await prisma.agentCall.findMany({ where: { clientId: client.id } });
    expect(calls.length).toBeGreaterThanOrEqual(7);
    expect(calls.map((c) => c.status)).toEqual(expect.arrayContaining([200, 403, 429, 401]));
    expect(calls.every((c) => /^[0-9a-f]{32}$/.test(c.ipHash))).toBe(true);
    expect((await prisma.auditLog.count({ where: { action: "agents.key.revoke", actorId: { not: null } } })) > 0).toBe(true);
  });

  it("the host kill switch pauses the agent channel", async () => {
    await prisma.featureFlag.update({ where: { key: "agents.kill_switch" }, data: { enabled: true } });
    try {
      expect((await request(app.getHttpServer()).get("/v1/public/makers").expect(503)).body.code).toBe("KILL_SWITCH");
    } finally {
      await prisma.featureFlag.update({ where: { key: "agents.kill_switch" }, data: { enabled: false } });
    }
  });
});

describe("MCP server + mandate checkout (FR-AGT-02..04)", () => {
  let confirmationUrl = "";
  let sessionId = "";

  it("exposes every tool over Streamable HTTP to the official SDK client", async () => {
    const client = new Client({ name: "nyambika-test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: bearer(agentKey) } }));
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["check_availability", "create_checkout_intent", "get_maker", "get_product", "search_products"]);
    const text = (r: Awaited<ReturnType<typeof client.callTool>>) => JSON.parse((r.content as { text: string }[])[0].text);

    const search = text(await client.callTool({ name: "search_products", arguments: { query: "kitenge dress for a wedding under 40000", limit: 4 } }));
    schemas.SearchSchema.parse(search);
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results.every((r: { price: { amount: number } }) => r.price.amount <= 40000)).toBe(true);
    expect(new Set(search.results.slice(0, 2).map((r: { maker: { handle: string } }) => r.maker.handle)).size).toBe(2); // Muse fairness

    const product = text(await client.callTool({ name: "get_product", arguments: { product_id: search.results[0].id } }));
    schemas.ProductDetailSchema.parse(product);
    const maker = text(await client.callTool({ name: "get_maker", arguments: { handle: "kigali-kitenge-house" } }));
    schemas.MakerDetailSchema.parse(maker);
    const avail = text(await client.callTool({ name: "check_availability", arguments: { id: variant.id, size: variant.size } }));
    expect(avail.variants[0]).toMatchObject({ variant_id: variant.id, orderable: true });
    const missing = await client.callTool({ name: "get_product", arguments: { product_id: "nope" } });
    expect(missing.isError).toBe(true);

    const res = await client.readResource({ uri: "nyambika://catalogue" });
    const snap = JSON.parse((res.contents[0] as { text: string }).text);
    expect(snap.makers.length).toBeGreaterThan(2);

    const session = text(await client.callTool({ name: "create_checkout_intent", arguments: { items: [{ variant_id: variant.id, size: variant.size, quantity: 1 }], external_reference: `mcp-${stamp}` } }));
    schemas.CheckoutSessionSchema.parse(session);
    expect(session.status).toBe("not_ready_for_payment");
    expect(session.mandate.confirmation_url).toMatch(/\/confirm\//);
    expect(session.payment.paid_directly_to).toBe("Kigali Kitenge House");
    confirmationUrl = session.mandate.confirmation_url;
    sessionId = session.id;
    await client.close();
    expect((await prisma.agentCall.findMany({ where: { tool: "create_checkout_intent" } })).length).toBeGreaterThan(0);
  });

  it("orders nothing until the shopper confirms the single-use mandate; then pays the maker directly", async () => {
    const token = confirmationUrl.split("/confirm/")[1];
    const stockBefore = (await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
    expect(await prisma.order.count({ where: { idempotencyKey: `agent:${sessionId}` } })).toBe(0);

    const http = request(app.getHttpServer());
    const preview = (await http.get(`/agent-mandates/${token}`).expect(200)).body;
    expect(preview).toMatchObject({ state: "open", paidTo: "Kigali Kitenge House", subtotalRwf: variant.price });
    await http.post(`/agent-mandates/${token}/confirm`).send({}).expect(401); // must be signed in
    const [b, s] = token.split(".");
    await http.get(`/agent-mandates/${b.slice(0, -2)}xx.${s}`).expect(400); // tampered

    const shopper = await login(`0786${stamp}`);
    const body = { delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: `0786${stamp}` };
    const first = (await shopper.post(`/agent-mandates/${token}/confirm`).send(body).expect(201)).body;
    expect(first.reused).toBe(false);
    const again = (await shopper.post(`/agent-mandates/${token}/confirm`).send(body).expect(201)).body;
    expect(again).toEqual({ orderId: first.orderId, reused: true });
    const other = await login(`0785${stamp}`);
    expect((await other.post(`/agent-mandates/${token}/confirm`).send(body).expect(409)).body.code).toBe("MANDATE_USED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: first.orderId }, include: { payments: true, page: true } });
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0].merchant).toBe(order.page.momoMerchant);
    expect(order.totalRwf).toBe(variant.price);
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(stockBefore - 1);

    const agentView = (await http.get(`/v1/agent/checkout_sessions/${sessionId}`).set(bearer(agentKey)).expect(200)).body;
    expect(agentView).toMatchObject({ status: "in_progress", nyambika_status: "awaiting_payment" });
    expect(agentView.mandate.confirmation_url).toBeNull();
    expect(JSON.stringify(agentView)).not.toMatch(new RegExp(`786${stamp}|payer|address`)); // no payer phone or shopper data

    await payments.settle(order.payments[0].providerRef, "SUCCESSFUL", { source: "test" });
    const done = (await http.get(`/v1/agent/checkout_sessions/${sessionId}`).set(bearer(agentKey)).expect(200)).body;
    expect(done).toMatchObject({ status: "completed", nyambika_status: "paid", order: { status: "paid" } });
    const ucp = (await http.get(`/ucp/v1/checkout-sessions/${sessionId}`).set(bearer(agentKey)).expect(200)).body;
    expect(ucp.status).toBe("completed");
    expect((await http.post(`/v1/agent/checkout_sessions/${sessionId}/complete`).set(bearer(agentKey)).expect(409)).body.code).toBe("REQUIRES_USER_CONFIRMATION");
  });

  it("is idempotent for the agent, rejects multi-maker carts, and expires unconfirmed mandates", async () => {
    const http = request(app.getHttpServer());
    const key = `rest-${stamp}-1`;
    const items = { items: [{ id: variant.id, size: variant.size, quantity: 1 }] };
    const a = (await http.post("/v1/agent/checkout_sessions").set(bearer(agentKey)).set("idempotency-key", key).send(items).expect(201)).body;
    const b = (await http.post("/v1/agent/checkout_sessions").set(bearer(agentKey)).set("idempotency-key", key).send(items).expect(201)).body;
    expect(b.id).toBe(a.id);
    const other = await prisma.variant.findFirstOrThrow({ where: { stock: { gte: 1 }, product: { status: "PUBLISHED", page: { handle: "imena-styles" } } } });
    const multi = await http.post("/v1/agent/checkout_sessions").set(bearer(agentKey)).set("idempotency-key", `rest-${stamp}-2`).send({ items: [...items.items, { id: other.id, size: other.sizes[0], quantity: 1 }] }).expect(400);
    expect(multi.body.code).toBe("MULTIPLE_MAKERS");

    // Expire: the token's exp comes from the stored expiry.
    const s = await prisma.agentCheckout.update({ where: { id: a.id }, data: { mandateExpiresAt: new Date(Date.now() - 1000) } });
    const expired = checkout.token(s);
    const shopper = await login(`0784${stamp}`);
    expect((await shopper.post(`/agent-mandates/${expired}/confirm`).send({ delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: `0784${stamp}` }).expect(410)).body.code).toBe("MANDATE_EXPIRED");
    expect((await http.get(`/v1/agent/checkout_sessions/${a.id}`).set(bearer(agentKey)).expect(200)).body.nyambika_status).toBe("expired");
    // The old (pre-expiry) link no longer matches anything either: its exp/nonce binding broke.
    expect(await prisma.order.count({ where: { idempotencyKey: `agent:${a.id}` } })).toBe(0);
  });
});

describe("Try-on as a Service (E37, FR-AGT-06)", () => {
  let hook: Server;
  let hookUrl = "";
  const received: { body: string; sig: string }[] = [];

  beforeAll(async () => {
    hook = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ body, sig: String(req.headers["nyambika-signature"] ?? "") });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
    hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hooks`;
  });
  afterAll(() => new Promise<void>((r) => hook.close(() => r())));

  const waitFor = async (key: string, id: string) => {
    for (let i = 0; i < 120; i++) {
      const j = (await request(app.getHttpServer()).get(`/v1/partner/tryon/${id}`).set(bearer(key)).expect(200)).body;
      if (!["queued", "generating", "guarding"].includes(j.status)) return j;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("job did not finish");
  };

  it("meters live calls against the contract, signs webhooks, watermarks sandbox results and issues statements", async () => {
    const { verifyWebhook } = await import("../src/modules/agents/webhook");
    const partner = (await host.post("/admin/agents/clients").send({ name: `Test partner ${stamp}`, kind: "PARTNER" }).expect(201)).body;
    const live = await newKey(partner.id, { env: "LIVE" });
    const sandbox = await newKey(partner.id, { env: "SANDBOX" });
    const http = request(app.getHttpServer());
    const garment = readFileSync(join(__dirname, "../storage/seed/a-line-dress-crimson-circles.png")).toString("base64");
    const job = { model_id: "nya-model-2", garment_image_b64: garment, garment_category: "dress" };

    // Draft contract: live refused, sandbox allowed.
    expect((await http.post("/v1/partner/tryon").set(bearer(live.secret)).send(job).expect(402)).body.code).toBe("CONTRACT_INACTIVE");
    await host.put(`/admin/agents/clients/${partner.id}/contract`).send({ status: "ACTIVE", monthlyQuota: 1, monthlyFeeRwf: 50000, overagePriceRwf: 150, hardCap: false, sandboxDailyCap: 5 }).expect(200);
    const secret = (await host.post(`/admin/agents/clients/${partner.id}/webhook-secret`).expect(201)).body.secret as string;
    expect((await http.get("/v1/partner/models").set(bearer(agentKey)).expect(403)).body.code).toBe("WRONG_CLIENT_KIND");
    expect((await http.get("/v1/partner/models").set(bearer(live.secret)).expect(200)).body.data).toHaveLength(5);

    const a = (await http.post("/v1/partner/tryon").set(bearer(live.secret)).set("idempotency-key", `job-${stamp}-a`).send({ ...job, webhook_url: hookUrl, client_reference: "sku-1" }).expect(202)).body;
    schemas.PartnerJobSchema.parse(a);
    const again = (await http.post("/v1/partner/tryon").set(bearer(live.secret)).set("idempotency-key", `job-${stamp}-a`).send(job).expect(202)).body;
    expect(again.id).toBe(a.id);
    const doneA = await waitFor(live.secret, a.id);
    schemas.PartnerJobSchema.parse(doneA);
    expect(doneA.status).toBe("delivered");
    expect(doneA.result).toMatchObject({ watermarked: false, ai_label: "AI preview", c2pa: { signed: true } });
    expect(doneA.billing).toEqual({ billable: true, band: "included", price: { amount: 0, currency: "RWF" } });
    // The URL names SELF_URL; ask this test app, not a dev API that may or may not be running.
    const img = await fetch(onThisApp(doneA.result.image_url));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect((await fetch(onThisApp(doneA.result.image_url.replace(/sig=\w{4}/, "sig=0000")))).status).toBe(404);

    const b = (await http.post("/v1/partner/tryon").set(bearer(live.secret)).send(job).expect(202)).body;
    const doneB = await waitFor(live.secret, b.id);
    expect(doneB.billing).toEqual({ billable: true, band: "overage", price: { amount: 150, currency: "RWF" } });

    const sb = (await http.post("/v1/partner/tryon").set(bearer(sandbox.secret)).send(job).expect(202)).body;
    const doneS = await waitFor(sandbox.secret, sb.id);
    expect(doneS).toMatchObject({ environment: "sandbox", result: { watermarked: true }, billing: { billable: false, band: "none" } });

    for (let i = 0; i < 40 && !received.length; i++) await new Promise((r) => setTimeout(r, 250));
    expect(received).toHaveLength(1);
    expect(verifyWebhook(received[0].body, received[0].sig, secret)).toBe(true);
    expect(verifyWebhook(received[0].body, received[0].sig, "whsec_wrong")).toBe(false);
    expect(JSON.parse(received[0].body)).toMatchObject({ type: "tryon.finished", data: { id: a.id, status: "delivered", client_reference: "sku-1" } });
    await new Promise((r) => setTimeout(r, 200));
    expect((await prisma.partnerTryonJob.findUniqueOrThrow({ where: { id: a.id } })).webhookStatus).toBe("DELIVERED");

    const csv = (await http.get("/v1/partner/usage.csv").set(bearer(live.secret)).expect(200)).text;
    expect(csv).toContain('"overage_looks",1');
    expect(csv).toContain('"total_due_rwf",50150');
    expect(csv).toContain(`"${sb.id}"`);
    expect(await prisma.usageEvent.count({ where: { kind: "PARTNER_TRYON", refId: { in: [a.id, b.id, sb.id] } } })).toBe(3);
  }, 120_000);
});
