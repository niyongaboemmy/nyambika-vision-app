import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/** Prometheus metrics for the SLOs in plan §14.4. Scraped from GET /metrics. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "nyambika_" });

export const httpDuration = new Histogram({
  name: "nyambika_http_request_duration_seconds",
  help: "HTTP request duration by route",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const firstLook = new Histogram({
  name: "nyambika_first_look_seconds",
  help: "Intent created → first look delivered (SLO p50 ≤ 15 s)",
  buckets: [1, 2, 5, 8, 10, 15, 20, 30, 60],
  registers: [registry],
});

export const generationDuration = new Histogram({
  name: "nyambika_generation_seconds",
  help: "Look generation time from queue to final state",
  labelNames: ["tier", "status"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [registry],
});

export const generations = new Counter({
  name: "nyambika_generations_total",
  help: "Look generations by final status (WITHHELD = guard failure)",
  labelNames: ["status", "model"] as const,
  registers: [registry],
});

export const aiSpend = new Counter({
  name: "nyambika_ai_spend_rwf_total",
  help: "AI spend in RWF, billed on delivery only",
  labelNames: ["kind"] as const,
  registers: [registry],
});

export const payments = new Counter({
  name: "nyambika_payments_total",
  help: "Payment settlements by result",
  labelNames: ["provider", "status"] as const,
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: "nyambika_generation_queue_jobs",
  help: "Generation queue jobs by state",
  labelNames: ["state"] as const,
  registers: [registry],
});
