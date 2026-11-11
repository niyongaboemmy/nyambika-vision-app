import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AiClient } from "../../common/ai.client";
import { Access } from "../../common/auth";
import { aiInferenceCalls, aiInferenceCost } from "../../common/metrics";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { counterDeltas, enforceInvariants, poolShare, policySchema, ROUTES, type BackendStats, type Policy, type Route, type RoutePolicy } from "./inference-rules";
import { activationDecision, NLB_GATED_TIERS } from "./nlb-gate";

export interface GatewayBackend extends BackendStats {
  configured: boolean;
  region: string;
  breaker: { state: string; consecutive_failures: number; retry_in_s: number | null };
  cost_per_call_rwf: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  last_error: string | null;
  last_at: number | null;
}
export interface GatewayStatus {
  routing_enabled: boolean;
  pool: { configured: boolean; host: string | null; region: string };
  hosted: { region: string };
  policy: Policy;
  routes: Record<Route, { health: { status: string; latency_ms?: number; error?: string | null; checked_at?: number }; backends: Record<"pool" | "hosted", GatewayBackend> }>;
}
export interface VideoProviderInfo {
  id: string;
  provider: string;
  configured: boolean;
  licence: string;
  commercial_use: boolean;
  zero_retention: boolean;
}
interface EvalReport {
  model_version: string;
  passed: boolean;
  licence: string;
  commercial_use: boolean;
  error: string | null;
  subgroups: number;
  subgroups_passed: number;
  failing_subgroups: string[];
  rows: unknown[];
  [k: string]: unknown;
}

const POLICY_ID = "default";

/**
 * E42 self-hosted inference (AI-GW-07) seen from the API: owns the routing policy (versioned, audited, pushed to
 * the gateway), syncs per-route cost/calls into Prometheus, and runs the E39 NLB video evals that feed the
 * model-registry activation gate.
 */
@Injectable()
export class InferenceService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Inference");
  private timer?: NodeJS.Timeout;
  private seen = new Map<string, BackendStats>();

  constructor(
    private prisma: PrismaService,
    private ai: AiClient,
    private access: Access,
    private storage: StorageService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.sync().catch(() => undefined), 15_000);
    setTimeout(() => void this.sync().catch(() => undefined), 3_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Pull gateway status, re-push the policy if the gateway is behind, and record metric deltas. */
  async sync(): Promise<GatewayStatus> {
    const s = await this.ai.get<GatewayStatus>("/v1/inference/status");
    let row = await this.prisma.inferencePolicy.findUnique({ where: { id: POLICY_ID } });
    if (!row) {
      const initial = enforceInvariants({ ...s.policy, version: 1 });
      row = await this.prisma.inferencePolicy.create({ data: { id: POLICY_ID, policy: initial as unknown as Prisma.InputJsonValue, version: 1 } });
    }
    if (s.policy.version !== row.version) {
      await this.ai.put("/v1/inference/policy", { ...(row.policy as unknown as Policy), version: row.version });
      s.policy = { ...(row.policy as unknown as Policy), version: row.version };
    }
    for (const route of ROUTES) {
      for (const backend of ["pool", "hosted"] as const) {
        const cur = s.routes[route]?.backends[backend];
        if (!cur) continue;
        const key = `${route}:${backend}`;
        const d = counterDeltas(this.seen.get(key), cur);
        this.seen.set(key, { calls: cur.calls, ok: cur.ok, failures: cur.failures, served_as_fallback: cur.served_as_fallback, cost_rwf: cur.cost_rwf });
        if (d.cost > 0) aiInferenceCost.inc({ route, backend }, d.cost);
        if (d.ok > 0) aiInferenceCalls.inc({ route, backend, outcome: "ok" }, d.ok);
        if (d.failed > 0) aiInferenceCalls.inc({ route, backend, outcome: "failed" }, d.failed);
        if (d.fallback > 0) aiInferenceCalls.inc({ route, backend, outcome: "fallback" }, d.fallback);
      }
    }
    return s;
  }

  async overview() {
    let gateway: GatewayStatus | null = null;
    let error: string | null = null;
    try {
      gateway = await this.sync();
    } catch (e) {
      error = (e as Error).message;
    }
    let chaos: { mode: string } | null = null;
    if (gateway?.pool.configured && process.env.NODE_ENV !== "production") {
      chaos = await this.ai.get<{ mode: string }>("/v1/inference/pool/chaos").catch(() => null);
    }
    const routes = gateway
      ? ROUTES.map((route) => {
          const r = gateway!.routes[route];
          return { route, policy: gateway!.policy.routes[route], health: r.health, backends: r.backends, poolShare: poolShare(r.backends) };
        })
      : [];
    return {
      reachable: Boolean(gateway),
      error,
      routingEnabled: gateway?.routing_enabled ?? false,
      pool: gateway?.pool ?? null,
      hosted: gateway?.hosted ?? null,
      policyVersion: gateway?.policy.version ?? null,
      breaker: gateway?.policy.breaker ?? null,
      fakePool: chaos ? { mode: chaos.mode } : null,
      routes,
      videoModels: await this.videoModels(),
    };
  }

  async setRoutePolicy(userId: string, route: Route, input: RoutePolicy, breaker?: Policy["breaker"]) {
    const row = await this.prisma.inferencePolicy.findUnique({ where: { id: POLICY_ID } });
    const base = (row?.policy as unknown as Policy | undefined) ?? (await this.sync()).policy;
    const next = enforceInvariants(policySchema.parse({ ...base, version: (row?.version ?? 0) + 1, breaker: breaker ?? base.breaker, routes: { ...base.routes, [route]: input } }));
    await this.prisma.inferencePolicy.upsert({
      where: { id: POLICY_ID },
      create: { id: POLICY_ID, policy: next as unknown as Prisma.InputJsonValue, version: next.version, updatedBy: userId },
      update: { policy: next as unknown as Prisma.InputJsonValue, version: next.version, updatedBy: userId },
    });
    await this.ai.put("/v1/inference/policy", next);
    await this.access.audit(userId, "admin.inference_policy", { route, policy: next.routes[route], breaker: next.breaker, version: next.version });
    return { version: next.version, route, policy: next.routes[route] };
  }

  private async persona(n: number) {
    return readFile(join(this.storage.root, "personas", `persona-${n}.png`));
  }

  /** Two seeded, published try-on cut-outs (patterned garments) used as synthetic eval / probe inputs. */
  private async garments(n = 2) {
    const vs = await this.prisma.variant.findMany({
      where: { cutoutPath: { not: null }, product: { status: "PUBLISHED" } },
      include: { product: { select: { category: true } } },
      orderBy: { id: "asc" },
      take: n,
    });
    if (!vs.length) throw new BadRequestException("No try-on ready garments to evaluate with");
    return Promise.all(vs.map(async (v) => ({ b64: (await this.storage.read(v.cutoutPath!)).toString("base64"), category: v.product.category })));
  }

  async probe(userId: string, route: "tryon" | "stt" | "llm" | "avatar", n: number, region?: string) {
    const body: Record<string, unknown> = { route, n, region };
    if (route === "tryon") {
      const [g] = await this.garments(1);
      body.twin_b64 = (await this.persona(2)).toString("base64");
      body.garment_b64 = g.b64;
    }
    const r = await this.ai.post<{ served: Record<string, number>; fallbacks: number; failed: number }>("/v1/inference/probe", body, 120_000);
    await this.access.audit(userId, "admin.inference_probe", { route, n, served: r.served, fallbacks: r.fallbacks, failed: r.failed });
    await this.sync().catch(() => undefined);
    return r;
  }

  async chaos(userId: string, mode: string) {
    if (process.env.NODE_ENV === "production") throw new ForbiddenException("Chaos controls exist only on the dev fake pool");
    const r = await this.ai.post<{ mode: string }>("/v1/inference/pool/chaos", { mode }, 10_000);
    await this.access.audit(userId, "admin.inference_chaos", { mode });
    return r;
  }

  async healthCheck() {
    return this.ai.post("/v1/inference/health/check", {}, 15_000);
  }

  // ── E39: video try-on models + NLB evals ───────────────────────────────────
  async videoModels() {
    const models = await this.prisma.modelVersion.findMany({ where: { tier: { in: Object.keys(NLB_GATED_TIERS) } }, orderBy: { createdAt: "asc" } });
    const providers = await this.ai.get<VideoProviderInfo[]>("/v1/video/providers").catch(() => [] as VideoProviderInfo[]);
    return Promise.all(
      models.map(async (m) => {
        const latest = await this.prisma.modelEval.findFirst({ where: { modelId: m.id }, orderBy: { createdAt: "desc" } });
        const info = providers.find((p) => p.provider === m.provider) ?? null;
        const gate = activationDecision(m, latest);
        return {
          id: m.id,
          name: m.name,
          provider: m.provider,
          tier: m.tier,
          status: m.status,
          costRwf: m.costRwf,
          nlbScore: m.nlbScore,
          configured: info?.configured ?? false,
          licence: info?.licence ?? null,
          commercialUse: info?.commercial_use ?? null,
          canActivate: gate.ok,
          gateReason: gate.ok ? null : gate.reason,
          lastEval: latest
            ? { id: latest.id, passed: latest.passed, at: latest.createdAt, modelVersion: latest.modelVersion, summary: latest.summary }
            : null,
        };
      }),
    );
  }

  async runEval(userId: string, modelId: string) {
    const model = await this.prisma.modelVersion.findUnique({ where: { id: modelId } });
    if (!model) throw new NotFoundException();
    const kind = NLB_GATED_TIERS[model.tier];
    if (!kind) throw new BadRequestException(`${model.tier} models are evaluated by the still-image NLB, not here`);
    const personas = await Promise.all([1, 2, 3, 4, 5].map(async (i) => (await this.persona(i)).toString("base64")));
    const report = await this.ai.post<EvalReport>("/v1/video/eval", { provider: model.provider, personas_b64: personas, garments: await this.garments(2), frames: 8 }, 300_000);
    const { rows: _rows, ...summary } = report;
    const row = await this.prisma.modelEval.create({
      data: {
        modelId,
        kind,
        modelVersion: report.model_version,
        passed: report.passed,
        licence: report.licence ?? "",
        commercialUse: Boolean(report.commercial_use),
        summary: summary as Prisma.InputJsonValue,
        report: report as unknown as Prisma.InputJsonValue,
        createdBy: userId,
      },
    });
    await this.prisma.modelVersion.update({ where: { id: modelId }, data: { nlbScore: report.subgroups ? report.subgroups_passed / report.subgroups : 0 } });
    await this.access.audit(userId, "admin.nlb_eval", { modelId, kind, passed: report.passed, subgroups: report.subgroups, passedSubgroups: report.subgroups_passed, failing: report.failing_subgroups });
    return { id: row.id, passed: row.passed, summary };
  }
}

