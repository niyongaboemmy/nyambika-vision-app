"""Inference router (AI-GW-07): send a job to the self-hosted GPU pool or a hosted provider by policy.

For every call on a route:
  1. candidates = backends enabled for the route (policy) that are configured
  2. residency: with `in-region`, only backends whose region equals the request region
     (data never leaves the country silently; no compliant backend -> NoBackend, 503)
  3. rank by strategy:
       cost         cheapest backend whose observed p95 meets the latency SLO (else the fastest)
       latency      lowest observed p95 (unknown p95 counts as exactly the SLO)
       pool-first   pool, then hosted        hosted-only / pool-only   just that one
  4. skip backends whose circuit is OPEN or whose last health check is DOWN
  5. call in order; a failure trips the breaker and falls back to the next backend
     (unless the route's policy says `fallback: false`, as for video)

Per (route, backend) it accounts calls, failures, fallbacks, cost and latency (p50/p95); the API
reads them from GET /v1/inference/status into Prometheus (nyambika_ai_inference_cost_rwf_total).
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

from .breaker import OPEN, CircuitBreaker
from .policy import BACKENDS, DEFAULT_REGION, ROUTES, Policy, default_policy, region_of

Backend = Callable[[Any], Any]


class NoBackend(RuntimeError):
    """No backend is eligible (residency, disabled, open circuits) or every attempt failed."""

    def __init__(self, route: str, detail: str, attempts: list[dict] | None = None):
        super().__init__(f"{route}: {detail}")
        self.route = route
        self.detail = detail
        self.attempts = attempts or []


@dataclass
class Stats:
    calls: int = 0
    ok: int = 0
    failures: int = 0
    served_as_fallback: int = 0
    cost_rwf: float = 0.0
    latencies: deque = field(default_factory=lambda: deque(maxlen=200))
    last_error: str | None = None
    last_at: float | None = None

    def pct(self, q: float) -> int | None:
        if not self.latencies:
            return None
        xs = sorted(self.latencies)
        return int(xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))])

    def view(self) -> dict:
        return {"calls": self.calls, "ok": self.ok, "failures": self.failures, "served_as_fallback": self.served_as_fallback,
                "cost_rwf": round(self.cost_rwf, 2), "cost_per_call_rwf": round(self.cost_rwf / self.ok, 2) if self.ok else None,
                "p50_ms": self.pct(0.5), "p95_ms": self.pct(0.95), "last_error": self.last_error, "last_at": self.last_at}


@dataclass
class RouteInfo:
    route: str
    backend: str
    region: str
    cost_rwf: float
    latency_ms: int
    fallback: bool
    attempts: list[dict]
    skipped: list[dict]

    def view(self) -> dict:
        return {"route": self.route, "backend": self.backend, "region": self.region, "cost_rwf": self.cost_rwf,
                "latency_ms": self.latency_ms, "fallback": self.fallback, "attempts": self.attempts, "skipped": self.skipped}


class Router:
    def __init__(self, policy: Policy | None = None, clock: Callable[[], float] = time.monotonic,
                 regions: dict[str, str] | None = None):
        self.clock = clock
        self.policy = policy or default_policy()
        self.regions = regions or {b: region_of(b) for b in BACKENDS}
        self.backends: dict[str, dict[str, Backend]] = {r: {} for r in ROUTES}
        self.breakers: dict[tuple[str, str], CircuitBreaker] = {}
        self.stats: dict[tuple[str, str], Stats] = {}
        # Pool health per route model server: {"status": UP|DOWN|UNKNOWN, ...}
        self.health: dict[str, dict] = {r: {"status": "UNKNOWN"} for r in ROUTES}
        self._lock = threading.Lock()

    # ── configuration ─────────────────────────────────────────────────────────
    def register(self, route: str, backend: str, fn: Backend) -> None:
        self.backends.setdefault(route, {})[backend] = fn

    def set_policy(self, policy: Policy) -> None:
        with self._lock:
            self.policy = policy
            for b in self.breakers.values():
                b.configure(policy.breaker.failure_threshold, policy.breaker.cooldown_s)

    def breaker(self, route: str, backend: str) -> CircuitBreaker:
        key = (route, backend)
        if key not in self.breakers:
            p = self.policy.breaker
            self.breakers[key] = CircuitBreaker(p.failure_threshold, p.cooldown_s, self.clock)
        return self.breakers[key]

    def stat(self, route: str, backend: str) -> Stats:
        return self.stats.setdefault((route, backend), Stats())

    def set_health(self, route: str, status: str, **extra) -> None:
        self.health[route] = {"status": status, **extra}

    # ── selection ─────────────────────────────────────────────────────────────
    def plan(self, route: str, region: str | None = None) -> tuple[list[str], list[dict]]:
        """Ordered backends to try for this call, plus the ones skipped and why."""
        if route not in self.policy.routes:
            raise NoBackend(route, "unknown route")
        rp = self.policy.routes[route]
        region = (region or DEFAULT_REGION).lower()
        skipped: list[dict] = []
        cands = []
        allowed = {"hosted-only": ["hosted"], "pool-only": ["pool"]}.get(rp.strategy, list(BACKENDS))
        for b in BACKENDS:
            if b not in allowed:
                skipped.append({"backend": b, "reason": f"strategy {rp.strategy}"})
            elif not getattr(rp, b).enabled:
                skipped.append({"backend": b, "reason": "disabled by policy"})
            elif b not in self.backends.get(route, {}):
                skipped.append({"backend": b, "reason": "not configured"})
            elif rp.residency == "in-region" and self.regions[b].lower() != region:
                skipped.append({"backend": b, "reason": f"residency: {self.regions[b]} is outside {region}"})
            else:
                cands.append(b)

        def p95(b: str) -> float:
            v = self.stat(route, b).pct(0.95)
            return float(rp.latency_slo_ms if v is None else v)

        if rp.strategy == "cost":
            cands.sort(key=lambda b: (p95(b) > rp.latency_slo_ms, getattr(rp, b).cost_rwf, p95(b)))
        elif rp.strategy == "latency":
            cands.sort(key=lambda b: (p95(b), getattr(rp, b).cost_rwf))
        elif rp.strategy == "pool-first":
            cands.sort(key=lambda b: 0 if b == "pool" else 1)

        ordered = []
        for b in cands:
            if b == "pool" and self.health.get(route, {}).get("status") == "DOWN":
                skipped.append({"backend": b, "reason": "health check DOWN"})
            elif self.breaker(route, b).current() == OPEN:
                skipped.append({"backend": b, "reason": "circuit OPEN"})
            else:
                ordered.append(b)
        return ordered, skipped

    # ── execution ─────────────────────────────────────────────────────────────
    def call(self, route: str, payload: Any, region: str | None = None) -> tuple[Any, RouteInfo]:
        ordered, skipped = self.plan(route, region)
        rp = self.policy.routes[route]
        if not ordered:
            raise NoBackend(route, "no eligible backend: " + "; ".join(f"{s['backend']} {s['reason']}" for s in skipped))
        attempts: list[dict] = []
        tried = 0
        for b in ordered:
            if tried and not rp.fallback:
                skipped.append({"backend": b, "reason": "fallback disabled for this route"})
                break
            brk = self.breaker(route, b)
            if not brk.allow():
                skipped.append({"backend": b, "reason": "circuit half-open trial in flight"})
                continue
            tried += 1
            st = self.stat(route, b)
            started = self.clock()
            try:
                result = self.backends[route][b](payload)
            except Exception as exc:  # noqa: BLE001 - every backend failure is a fallback trigger
                ms = int((self.clock() - started) * 1000)
                brk.failure()
                with self._lock:
                    st.calls += 1
                    st.failures += 1
                    st.last_error = f"{exc.__class__.__name__}: {str(exc)[:160]}"
                    st.last_at = time.time()
                attempts.append({"backend": b, "ok": False, "latency_ms": ms, "error": st.last_error})
                continue
            ms = int((self.clock() - started) * 1000)
            brk.success()
            cost = getattr(rp, b).cost_rwf
            with self._lock:
                st.calls += 1
                st.ok += 1
                st.cost_rwf += cost
                st.latencies.append(ms)
                st.last_at = time.time()
                if attempts:
                    st.served_as_fallback += 1
            attempts.append({"backend": b, "ok": True, "latency_ms": ms})
            return result, RouteInfo(route, b, self.regions[b], cost, ms, bool(len(attempts) > 1), attempts, skipped)
        raise NoBackend(route, "all backends failed", attempts)

    # ── reporting ─────────────────────────────────────────────────────────────
    def status(self) -> dict:
        routes = {}
        for r in ROUTES:
            rp = self.policy.routes.get(r)
            if rp is None:
                continue
            routes[r] = {
                "health": self.health.get(r, {"status": "UNKNOWN"}),
                "backends": {
                    b: {
                        "configured": b in self.backends.get(r, {}),
                        "region": self.regions[b],
                        "breaker": self.breaker(r, b).snapshot(),
                        **self.stat(r, b).view(),
                    }
                    for b in BACKENDS
                },
            }
        return {"policy": self.policy.model_dump(), "routes": routes}

    def reset(self) -> None:
        self.stats.clear()
        for b in self.breakers.values():
            b.reset()
