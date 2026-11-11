import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AGENT_LIMITS, type AgentScope } from "@nyambika/contracts";
import type { ApiClient, ApiKey } from "@prisma/client";
import type { Request, Response } from "express";
import { Redis } from "ioredis";
import { PrismaService } from "../../common/prisma.service";
import { config } from "../../config";
import { MemoryCounterStore, RedisCounterStore, type CounterStore } from "../circle/guards";
import { extractKey, hasScopes, hashKey, ipHash, keyState, monthKey, quotaDecision } from "./keys";

export interface AgentContext {
  client: ApiClient | null;
  key: ApiKey | null;
  ipHash: string;
  /** set by the MCP controller so the audit row names the tool */
  tool?: string;
}

export type AgentRequest = Request & { agent?: AgentContext };

export interface AgentRouteOptions {
  /** Scopes the key must hold. Empty + optional key = anonymous access allowed (per-IP limit). */
  scopes?: AgentScope[];
  keyRequired?: boolean;
  kind?: "AGENT" | "PARTNER";
  /** Which kill switch pauses this route. */
  channel?: "agents" | "partners";
}

const META = "agentRoute";
/** Mark a controller or route as an external agent/partner surface. Use together with `@Public()`. */
export const AgentRoute = (o: AgentRouteOptions = {}) => SetMetadata(META, o);

export const Agent = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AgentRequest>().agent!);

const clientIp = (req: Request) => (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "unknown");

/** Key lookup, rate limits, quotas and the agent-call audit log (FR-AGT-08). */
@Injectable()
export class AgentAccessService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("AgentAccess");
  private redis?: Redis;
  counters: CounterStore = new MemoryCounterStore();

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, keyPrefix: config.redisKeyPrefix });
    this.redis.on("error", () => undefined);
    this.redis.on("ready", () => (this.counters = new RedisCounterStore(this.redis!)));
    this.redis.on("end", () => (this.counters = new MemoryCounterStore()));
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  async findKey(secret: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { hash: hashKey(secret, config.jwtSecret) } });
    if (!key) return null;
    const client = await this.prisma.apiClient.findUnique({ where: { id: key.clientId } });
    return client ? { key, client } : null;
  }

  async killSwitch(channel: "agents" | "partners") {
    const f = await this.prisma.featureFlag.findUnique({ where: { key: `${channel}.kill_switch` } });
    return Boolean(f?.enabled);
  }

  /** Fixed one-minute window. Sets RateLimit-* headers; throws 429 with Retry-After when over. */
  async rateLimit(res: Response, bucket: string, max: number) {
    const minute = Math.floor(Date.now() / 60_000);
    const n = await this.counters.incr(`ag:${bucket}:${minute}`, 61);
    const reset = 60 - Math.floor((Date.now() / 1000) % 60);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - n)));
    res.setHeader("RateLimit-Reset", String(reset));
    if (n > max) {
      res.setHeader("Retry-After", String(reset));
      throw new HttpException({ message: `Rate limit of ${max} requests per minute exceeded`, code: "RATE_LIMITED" }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Monthly per-key quota (counted in Redis; the AgentCall table is the durable record). */
  async quota(res: Response, key: ApiKey) {
    if (key.monthlyQuota === null) return;
    const used = await this.counters.incr(`agq:${key.id}:${monthKey()}`, 40 * 86400);
    const d = quotaDecision(used, key.monthlyQuota);
    res.setHeader("X-Quota-Limit", String(key.monthlyQuota));
    res.setHeader("X-Quota-Remaining", String(d.remaining));
    if (!d.allowed) throw new HttpException({ message: `Monthly quota of ${key.monthlyQuota} calls used up`, code: "QUOTA_EXCEEDED" }, HttpStatus.TOO_MANY_REQUESTS);
  }

  audit(ctx: AgentContext, req: Request, status: number, started: number) {
    const route = (req.baseUrl + (req.route?.path ?? req.path)) || req.path;
    void this.prisma.agentCall
      .create({
        data: {
          clientId: ctx.client?.id ?? null,
          keyId: ctx.key?.id ?? null,
          method: req.method,
          route: route.slice(0, 120),
          tool: ctx.tool ?? null,
          status,
          latencyMs: Date.now() - started,
          ipHash: ctx.ipHash,
        },
      })
      .catch((e: Error) => this.log.warn(`audit failed: ${e.message}`));
    if (ctx.key) void this.prisma.apiKey.update({ where: { id: ctx.key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
}

/**
 * Guard for every external agent/partner route: kill switch → key (hashed lookup, revocation, expiry,
 * client status, kind, scopes) → per-IP and per-key rate limits → monthly quota. Every call, allowed or
 * refused, lands in the AgentCall audit log.
 */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private access: AgentAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const opts = this.reflector.getAllAndOverride<AgentRouteOptions>(META, [ctx.getHandler(), ctx.getClass()]) ?? {};
    const req = ctx.switchToHttp().getRequest<AgentRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const started = Date.now();
    const agent: AgentContext = { client: null, key: null, ipHash: ipHash(clientIp(req), config.jwtSecret) };
    req.agent = agent;
    res.on("finish", () => this.access.audit(agent, req, res.statusCode, started));

    if (await this.access.killSwitch(opts.channel ?? "agents")) {
      throw new HttpException({ message: "This channel is paused by Nyambika. Please try again later.", code: "KILL_SWITCH" }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const secret = extractKey(req.headers);
    const required = opts.keyRequired ?? Boolean(opts.scopes?.length);
    if (!secret) {
      if (req.headers.authorization?.startsWith("Bearer nya_") || req.headers["x-api-key"]) throw new UnauthorizedException({ message: "Malformed API key", code: "INVALID_KEY" });
      if (required) throw new UnauthorizedException({ message: "API key required (Authorization: Bearer nya_…)", code: "KEY_REQUIRED" });
      await this.access.rateLimit(res, `ip:${agent.ipHash}`, AGENT_LIMITS.anonymousPerMin);
      return true;
    }
    const found = await this.access.findKey(secret);
    if (!found) throw new UnauthorizedException({ message: "Unknown API key", code: "INVALID_KEY" });
    agent.client = found.client;
    agent.key = found.key;
    const state = keyState(found.key, found.client.status);
    if (state === "REVOKED") throw new UnauthorizedException({ message: "This API key was revoked", code: "KEY_REVOKED" });
    if (state === "EXPIRED") throw new UnauthorizedException({ message: "This API key has expired", code: "KEY_EXPIRED" });
    if (state === "CLIENT_SUSPENDED") throw new ForbiddenException({ message: "This client is suspended", code: "CLIENT_SUSPENDED" });
    if (opts.kind && found.client.kind !== opts.kind) throw new ForbiddenException({ message: `Only ${opts.kind.toLowerCase()} keys can call this`, code: "WRONG_CLIENT_KIND" });
    if (opts.scopes?.length && !hasScopes(found.key.scopes, opts.scopes)) {
      throw new ForbiddenException({ message: `Missing scope: ${opts.scopes.filter((s) => !found.key.scopes.includes(s)).join(", ")}`, code: "INSUFFICIENT_SCOPE" });
    }
    await this.access.rateLimit(res, `ipk:${agent.ipHash}`, AGENT_LIMITS.ipCeilingPerMin);
    await this.access.rateLimit(res, `key:${found.key.id}`, Math.min(found.key.rateLimitPerMin, AGENT_LIMITS.maxKeyPerMin));
    await this.access.quota(res, found.key);
    return true;
  }
}
