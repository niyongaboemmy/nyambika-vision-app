"""Self-hosted inference layer (E42, AI-GW-07): router, circuit breakers, pool health, cost accounting."""
from __future__ import annotations

import os
import threading
import time

from .breaker import CLOSED, HALF_OPEN, OPEN, CircuitBreaker
from .policy import ROUTES, Policy, default_policy
from .pool import PoolClient
from .router import NoBackend, RouteInfo, Router

_router: Router | None = None
_pool: PoolClient | None = None
_monitor: threading.Thread | None = None
_lock = threading.Lock()


def routing_enabled() -> bool:
    return os.environ.get("INFERENCE_ROUTING") == "1"


def pool() -> PoolClient | None:
    get_router()
    return _pool


def check_health(router: Router | None = None, client: PoolClient | None = None) -> dict:
    """Probe every route's model server on the pool once (KServe `/v2/models/{name}/ready`)."""
    router = router or get_router()
    client = client or _pool
    for route in ROUTES:
        if client is None or "pool" not in router.backends.get(route, {}):
            router.set_health(route, "UNCONFIGURED")
            continue
        ok, ms, err = client.ready(route)
        router.set_health(route, "UP" if ok else "DOWN", latency_ms=ms, error=err, checked_at=time.time())
    return router.health


def _watch(interval: float) -> None:
    while True:
        try:
            check_health()
        except Exception:  # noqa: BLE001 - the monitor must never die
            pass
        time.sleep(interval)


def get_router() -> Router:
    """Process-wide router; the health monitor starts with it when a pool is configured."""
    global _router, _pool, _monitor
    with _lock:
        if _router is None:
            from .backends import register_defaults

            _pool = PoolClient.from_env()
            _router = register_defaults(Router(), _pool)
            interval = float(os.environ.get("INFERENCE_HEALTH_INTERVAL_S", "5"))
            if _pool is not None and interval > 0 and _monitor is None:
                _monitor = threading.Thread(target=_watch, args=(interval,), daemon=True, name="pool-health")
                _monitor.start()
        return _router


def reset_for_tests(router: Router | None = None, client: PoolClient | None = None) -> None:
    global _router, _pool
    with _lock:
        _router, _pool = router, client


__all__ = ["CLOSED", "HALF_OPEN", "OPEN", "CircuitBreaker", "NoBackend", "Policy", "PoolClient", "RouteInfo", "Router",
           "check_health", "default_policy", "get_router", "pool", "reset_for_tests", "routing_enabled"]
