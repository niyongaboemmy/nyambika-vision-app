import { z } from "zod";

/** E42 routing policy (mirrors apps/ai/app/inference/policy.py). The API owns it; the gateway applies it. */
export const ROUTES = ["tryon", "stt", "llm", "avatar", "video"] as const;
export type Route = (typeof ROUTES)[number];
export const BACKENDS = ["pool", "hosted"] as const;

const backend = z.object({ enabled: z.boolean(), cost_rwf: z.number().min(0).max(100_000) });
export const routePolicy = z.object({
  strategy: z.enum(["cost", "latency", "pool-first", "hosted-only", "pool-only"]),
  latency_slo_ms: z.number().int().min(50).max(600_000),
  residency: z.enum(["any", "in-region"]),
  fallback: z.boolean(),
  pool: backend,
  hosted: backend,
});
export const breakerPolicy = z.object({ failure_threshold: z.number().int().min(1).max(50), cooldown_s: z.number().min(1).max(3600) });
export const policySchema = z.object({
  version: z.number().int().min(0),
  breaker: breakerPolicy,
  routes: z.record(z.enum(ROUTES), routePolicy),
});
export type Policy = z.infer<typeof policySchema>;
export type RoutePolicy = z.infer<typeof routePolicy>;

/** Video must never silently fall back to a backend without its own NLB pass. */
export function enforceInvariants(p: Policy): Policy {
  const routes = { ...p.routes };
  if (routes.video) routes.video = { ...routes.video, fallback: false };
  return { ...p, routes };
}

export interface BackendStats {
  calls: number;
  ok: number;
  failures: number;
  served_as_fallback: number;
  cost_rwf: number;
}

/**
 * Turn the gateway's cumulative counters into Prometheus increments. A counter that went backwards means the
 * gateway restarted, so its current value is the whole delta.
 */
export function counterDeltas(prev: BackendStats | undefined, cur: BackendStats) {
  const d = (k: keyof BackendStats) => {
    const before = prev?.[k] ?? 0;
    return cur[k] >= before ? cur[k] - before : cur[k];
  };
  const restarted = prev ? (Object.keys(cur) as (keyof BackendStats)[]).some((k) => cur[k] < (prev[k] ?? 0)) : false;
  if (restarted) return { cost: cur.cost_rwf, ok: cur.ok, failed: cur.failures, fallback: cur.served_as_fallback };
  return { cost: d("cost_rwf"), ok: d("ok"), failed: d("failures"), fallback: d("served_as_fallback") };
}

/** Pool versus hosted share of served calls on a route (for the admin panel headline). */
export function poolShare(stats: Record<string, BackendStats>) {
  const pool = stats.pool?.ok ?? 0;
  const total = pool + (stats.hosted?.ok ?? 0);
  return total ? pool / total : null;
}
