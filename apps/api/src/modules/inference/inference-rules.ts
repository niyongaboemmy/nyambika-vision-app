import { z } from "zod";

/** E42 routing policy (mirrors apps/ai/app/inference/policy.py). The API owns it; the gateway applies it. */
export const ROUTES = ["tryon", "stt", "llm", "avatar", "video", "attr"] as const; // attr: R4 spike local model
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

/**
 * Defaults for routes added after policies were first stored (mirror `_DEFAULTS` in apps/ai/app/inference/policy.py).
 * `attr` (R4 spike): garment attributes from the in-process local model only, maker photos stay in-region.
 */
export const ADDED_ROUTE_DEFAULTS: Partial<Record<Route, RoutePolicy>> = {
  attr: { strategy: "pool-only", latency_slo_ms: 2_000, residency: "in-region", fallback: true, pool: { enabled: true, cost_rwf: 0.2 }, hosted: { enabled: true, cost_rwf: 0 } },
};

/**
 * Compat step for stored policies: `routes` is an exhaustive record, so a policy saved before a route existed (no
 * `attr`) or by an API that did not know a route yet (an `attr` key it rejected) would fail `policySchema`. Keep every
 * valid known route, fill a missing one from the gateway's live policy, else from the defaults, and drop unknown keys.
 */
export function upgradePolicy(stored: unknown, live?: { routes?: Record<string, unknown> } | null): { policy: Policy; changed: boolean } {
  const s = (stored ?? {}) as { version?: unknown; breaker?: unknown; routes?: Record<string, unknown> };
  const routes: Partial<Record<Route, RoutePolicy>> = {};
  let changed = Object.keys(s.routes ?? {}).some((k) => !(ROUTES as readonly string[]).includes(k));
  for (const route of ROUTES) {
    const own = routePolicy.safeParse(s.routes?.[route]);
    if (own.success) {
      routes[route] = own.data;
      continue;
    }
    const fromLive = routePolicy.safeParse(live?.routes?.[route]);
    const filled = fromLive.success ? fromLive.data : ADDED_ROUTE_DEFAULTS[route];
    if (!filled) throw new Error(`Stored inference policy has no valid "${route}" route`);
    routes[route] = filled;
    changed = true;
  }
  const breaker = breakerPolicy.safeParse(s.breaker);
  const policy = policySchema.parse({ version: typeof s.version === "number" ? s.version : 0, breaker: breaker.success ? breaker.data : { failure_threshold: 3, cooldown_s: 15 }, routes });
  return { policy, changed: changed || !breaker.success };
}

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
