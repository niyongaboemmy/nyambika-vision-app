import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Query, Res } from "@nestjs/common";
import { ApiClientCreate, ApiKeyCreate, DEFAULT_SCOPES, PARTNER_MODELS, PartnerContractInput, type ApiClientKind } from "@nyambika/contracts";
import type { Response } from "express";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { generateKey, hashKey, keyState, monthRange } from "./keys";
import { PartnerService } from "./partner.service";
import { MCP_TOOLS } from "./mcp";
import { config } from "../../config";

const DAY = 86400_000;

/** Host admin "Agents & partners" (FR-AGT-08): clients, keys, quotas, contracts, usage, mandate conversions. */
@Controller("admin/agents")
export class AgentsAdminController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private partners: PartnerService,
    private storage: StorageService,
  ) {}

  @Get()
  async overview(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const since = new Date(Date.now() - 13 * DAY);
    since.setUTCHours(0, 0, 0, 0);
    const [clients, keys, contracts, calls, sessions, jobs, recentCalls, flags] = await Promise.all([
      this.prisma.apiClient.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
      this.prisma.partnerContract.findMany(),
      this.prisma.agentCall.findMany({ where: { createdAt: { gte: since } }, select: { clientId: true, status: true, createdAt: true, tool: true } }),
      this.prisma.agentCheckout.findMany({ where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } }, select: { status: true, orderId: true, channel: true, clientId: true } }),
      this.prisma.partnerTryonJob.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      this.prisma.agentCall.findMany({ orderBy: { createdAt: "desc" }, take: 25 }),
      this.prisma.featureFlag.findMany({ where: { key: { in: ["agents.kill_switch", "partners.kill_switch"] } } }),
    ]);
    const orders = await this.prisma.order.findMany({ where: { id: { in: sessions.map((s) => s.orderId).filter((x): x is string => Boolean(x)) } }, select: { id: true, status: true, totalRwf: true } });
    const paidStatuses = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"];
    const paid = orders.filter((o) => paidStatuses.includes(o.status));
    const days = Array.from({ length: 14 }, (_, i) => new Date(since.getTime() + i * DAY).toISOString().slice(0, 10));
    const kindOf = new Map(clients.map((c) => [c.id, c.kind]));
    const byDay = days.map((d) => {
      const rows = calls.filter((c) => c.createdAt.toISOString().slice(0, 10) === d);
      return { day: d, agent: rows.filter((r) => kindOf.get(r.clientId ?? "") === "AGENT").length, partner: rows.filter((r) => kindOf.get(r.clientId ?? "") === "PARTNER").length, anonymous: rows.filter((r) => !r.clientId).length, errors: rows.filter((r) => r.status >= 400).length };
    });
    const { start } = monthRange();
    const monthUse = await this.prisma.partnerTryonJob.groupBy({ by: ["clientId", "sandbox", "billable", "overage"], where: { createdAt: { gte: start } }, _count: true, _sum: { priceRwf: true } });
    const name = new Map(clients.map((c) => [c.id, c.name]));
    return {
      killSwitch: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
      totals: {
        clients: clients.length,
        activeKeys: keys.filter((k) => keyState(k, "ACTIVE") === "OK").length,
        calls14d: calls.length,
        errorRate14d: calls.length ? calls.filter((c) => c.status >= 400).length / calls.length : 0,
      },
      callsByDay: byDay,
      tools: Object.entries(calls.reduce<Record<string, number>>((m, c) => (c.tool && ((MCP_TOOLS as readonly string[]).includes(c.tool) || c.tool.startsWith("resource:")) ? { ...m, [c.tool]: (m[c.tool] ?? 0) + 1 } : m), {})).map(([tool, n]) => ({ tool, n })).sort((a, b) => b.n - a.n),
      mandates: {
        created: sessions.length,
        confirmed: sessions.filter((s) => s.orderId).length,
        paid: paid.length,
        expired: sessions.filter((s) => s.status === "EXPIRED").length,
        canceled: sessions.filter((s) => s.status === "CANCELED").length,
        viaMcp: sessions.filter((s) => s.channel === "MCP").length,
        paidRwf: paid.reduce((s, o) => s + o.totalRwf, 0),
        conversion: sessions.length ? paid.length / sessions.length : 0,
      },
      clients: clients.map((c) => {
        const contract = contracts.find((x) => x.clientId === c.id) ?? null;
        const use = monthUse.filter((u) => u.clientId === c.id);
        const live = use.filter((u) => !u.sandbox);
        return {
          id: c.id,
          name: c.name,
          kind: c.kind,
          status: c.status,
          contactEmail: c.contactEmail,
          hasWebhookSecret: Boolean(c.webhookSecretSealed),
          calls14d: calls.filter((x) => x.clientId === c.id).length,
          keys: keys
            .filter((k) => k.clientId === c.id)
            .map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, env: k.env, scopes: k.scopes, rateLimitPerMin: k.rateLimitPerMin, monthlyQuota: k.monthlyQuota, state: keyState(k, c.status), lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, createdAt: k.createdAt })),
          contract,
          usage: c.kind === "PARTNER" ? { live: live.reduce((s, u) => s + u._count, 0), billed: live.filter((u) => u.billable).reduce((s, u) => s + u._count, 0), overage: live.filter((u) => u.overage && u.billable).reduce((s, u) => s + u._count, 0), overageRwf: live.filter((u) => u.billable).reduce((s, u) => s + (u._sum.priceRwf ?? 0), 0), sandbox: use.filter((u) => u.sandbox).reduce((s, u) => s + u._count, 0) } : null,
        };
      }),
      jobs: jobs.map((j) => ({ ...this.partners.view(j, ""), clientName: name.get(j.clientId) ?? "", image: j.status === "DELIVERED" && j.outputPath ? `/api${this.partners.signResult(j.id).path}` : null })),
      recentCalls: recentCalls.map((c) => ({ id: c.id, client: c.clientId ? (name.get(c.clientId) ?? "?") : "anonymous", method: c.method, route: c.route, tool: c.tool, status: c.status, latencyMs: c.latencyMs, at: c.createdAt })),
      models: PARTNER_MODELS,
    };
  }

  @Post("clients")
  async createClient(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const input = parse(ApiClientCreate, body);
    const c = await this.prisma.apiClient.create({ data: { ...input, createdBy: user.id } });
    if (c.kind === "PARTNER") await this.prisma.partnerContract.create({ data: { clientId: c.id, status: "DRAFT", updatedBy: user.id } });
    await this.access.audit(user.id, "agents.client.create", { clientId: c.id, name: c.name, kind: c.kind });
    return c;
  }

  @Post("clients/:id/status")
  async clientStatus(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { status } = parse(z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }), body);
    await this.prisma.apiClient.update({ where: { id }, data: { status } });
    await this.access.audit(user.id, "agents.client.status", { clientId: id, status });
    return { ok: true };
  }

  /** The secret is returned exactly once; only its peppered hash is stored. */
  @Post("clients/:id/keys")
  async createKey(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const c = await this.prisma.apiClient.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    const input = parse(ApiKeyCreate, body);
    const scopes = input.scopes ?? DEFAULT_SCOPES[c.kind as ApiClientKind];
    if (c.kind === "AGENT" && scopes.includes("tryon:write")) throw new BadRequestException("Try-on scopes are for partner clients");
    const { secret, prefix } = generateKey(input.env);
    const k = await this.prisma.apiKey.create({
      data: {
        clientId: id,
        name: input.name,
        prefix,
        hash: hashKey(secret, config.jwtSecret),
        env: input.env,
        scopes,
        rateLimitPerMin: input.rateLimitPerMin,
        monthlyQuota: input.monthlyQuota,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY) : null,
        createdBy: user.id,
      },
    });
    await this.access.audit(user.id, "agents.key.create", { clientId: id, keyId: k.id, prefix, env: k.env, scopes });
    return { id: k.id, prefix, secret, env: k.env, scopes, note: "Copy this key now. Nyambika stores only a hash and cannot show it again." };
  }

  @Post("keys/:id/revoke")
  async revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.access.requireHost(user.id);
    const k = await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.access.audit(user.id, "agents.key.revoke", { keyId: id, prefix: k.prefix });
    return { ok: true };
  }

  @Put("clients/:id/contract")
  async contract(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const c = await this.prisma.apiClient.findUnique({ where: { id } });
    if (c?.kind !== "PARTNER") throw new BadRequestException("Contracts are for partner clients");
    const input = parse(PartnerContractInput, body);
    const data = { ...input, endsAt: input.endsAt ? new Date(input.endsAt) : null, updatedBy: user.id };
    const row = await this.prisma.partnerContract.upsert({ where: { clientId: id }, create: { clientId: id, ...data }, update: data });
    await this.access.audit(user.id, "agents.contract.update", { clientId: id, ...input });
    return row;
  }

  @Post("clients/:id/webhook-secret")
  async webhookSecret(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.access.requireHost(user.id);
    const secret = await this.partners.rotateWebhookSecret(id);
    await this.access.audit(user.id, "agents.webhook_secret.rotate", { clientId: id });
    return { secret, note: "Shown once. Verify Nyambika-Signature: t=<unix>,v1=HMAC-SHA256(secret, `${t}.${body}`)." };
  }

  @Get("clients/:id/usage.csv")
  async usage(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query("month") month: string | undefined, @Res() res: Response) {
    await this.access.requireHost(user.id);
    const s = await this.partners.statement(id, month);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="tryon-${s.client.name.replace(/\W+/g, "-").toLowerCase()}-${s.month}.csv"`);
    res.send(s.csv);
  }

  /** Run a sandbox job as the partner (host demo / support), using a sample garment from the catalogue. */
  @Post("clients/:id/sandbox-tryon")
  async sandbox(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { modelId, variantId } = parse(z.object({ modelId: z.string(), variantId: z.string().optional() }), body);
    const client = await this.prisma.apiClient.findUnique({ where: { id } });
    const key = await this.prisma.apiKey.findFirst({ where: { clientId: id, env: "SANDBOX", revokedAt: null } });
    if (client?.kind !== "PARTNER" || !key) throw new BadRequestException("Create a sandbox key for this partner first");
    const v = await this.prisma.variant.findFirst({
      where: { ...(variantId ? { id: variantId } : {}), imagePath: { not: null }, product: { status: "PUBLISHED", readiness: "READY" } },
      include: { product: true },
      orderBy: { id: "asc" },
    });
    if (!v?.imagePath) throw new BadRequestException("No sample garment available");
    const img = await this.storage.read(v.imagePath);
    const category = ["dress", "shirt", "skirt", "umushanana"].includes(v.product.category) ? v.product.category : "dress";
    const job = await this.partners.create({ client, key, ipHash: "admin" }, { model_id: modelId, garment_image_b64: img.toString("base64"), garment_category: category, client_reference: `host-demo-${v.product.title}`.slice(0, 80) });
    await this.access.audit(user.id, "agents.sandbox_tryon", { clientId: id, jobId: job.id });
    return job;
  }

  /** Samples for the sandbox picker. */
  @Get("samples")
  async samples(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const vs = await this.prisma.variant.findMany({ where: { imagePath: { not: null }, product: { status: "PUBLISHED", readiness: "READY", category: { in: ["dress", "shirt", "skirt", "umushanana"] } } }, include: { product: true }, take: 6, orderBy: { id: "asc" } });
    return vs.map((v) => ({ id: v.id, title: v.product.title, colourName: v.colourName, image: this.storage.publicUrl(v.imagePath) }));
  }
}

/** FR-AGT-05: a member opts their page in or out of agent channels and external marketplaces. */
@Controller("pages/:pageId/agent-channels")
export class AgentChannelsController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const s = await this.prisma.agentChannelSetting.findUnique({ where: { pageId } });
    const since = new Date(Date.now() - 30 * DAY);
    const [sessions, paid] = await Promise.all([
      this.prisma.agentCheckout.count({ where: { pageId, createdAt: { gte: since } } }),
      this.prisma.agentCheckout.count({ where: { pageId, createdAt: { gte: since }, orderId: { not: null } } }),
    ]);
    return { agentsEnabled: s?.agentsEnabled ?? true, marketplacesEnabled: s?.marketplacesEnabled ?? true, last30d: { agentCheckouts: sessions, confirmed: paid } };
  }

  @Put()
  async set(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const input = parse(z.object({ agentsEnabled: z.boolean(), marketplacesEnabled: z.boolean() }), body);
    await this.prisma.agentChannelSetting.upsert({ where: { pageId }, create: { pageId, ...input, updatedBy: user.id }, update: { ...input, updatedBy: user.id } });
    await this.access.audit(user.id, "page.agent_channels", input, pageId);
    return this.get(user, pageId);
  }
}
