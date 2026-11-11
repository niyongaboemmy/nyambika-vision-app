"""E42: router policy (cost / latency / residency), circuit breaker states, fallback, pool wire contracts."""
import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import fake_pool
from app.inference import CLOSED, HALF_OPEN, OPEN, CircuitBreaker, NoBackend, PoolClient, Router, check_health, default_policy
from app.inference.backends import register_defaults

from .conftest import b64


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def ok(name):
    return lambda payload: {"served": name, "payload": payload}


def boom(payload):
    raise RuntimeError("CUDA OOM")


def router(clock=None, **regions):
    r = Router(default_policy(), clock=clock or Clock(), regions={"pool": "rw", "hosted": "eu", **regions})
    for route in ("tryon", "llm", "video"):
        r.register(route, "pool", ok("pool"))
        r.register(route, "hosted", ok("hosted"))
    return r


# ── policy ────────────────────────────────────────────────────────────────────
def test_cost_strategy_picks_cheapest_backend():
    r = router()
    out, info = r.call("tryon", {"x": 1})
    assert out["served"] == "pool" and info.backend == "pool" and not info.fallback
    assert info.cost_rwf == r.policy.routes["tryon"].pool.cost_rwf
    r.policy.routes["tryon"].pool.cost_rwf = 99
    assert r.call("tryon", {})[1].backend == "hosted"


def test_cost_strategy_skips_backend_that_misses_latency_slo():
    r = router()
    slo = r.policy.routes["tryon"].latency_slo_ms
    r.stat("tryon", "pool").latencies.extend([slo * 2] * 20)  # cheap but too slow
    r.stat("tryon", "hosted").latencies.extend([slo // 2] * 20)
    assert r.plan("tryon")[0] == ["hosted", "pool"]


def test_latency_strategy_picks_fastest():
    r = router()
    r.policy.routes["llm"].strategy = "latency"
    r.stat("llm", "pool").latencies.extend([900] * 10)
    r.stat("llm", "hosted").latencies.extend([300] * 10)
    assert r.call("llm", {})[1].backend == "hosted"


def test_residency_in_region_never_leaves_the_country():
    r = router()
    r.policy.routes["tryon"].residency = "in-region"
    r.policy.routes["tryon"].pool.cost_rwf = 999  # even when the pool is dearer
    order, skipped = r.plan("tryon", region="rw")
    assert order == ["pool"]
    assert any("residency" in s["reason"] for s in skipped)
    # The pool fails -> no silent fallback abroad: 503 instead.
    r.register("tryon", "pool", boom)
    with pytest.raises(NoBackend):
        r.call("tryon", {}, region="rw")
    # A Kenyan request has no compliant backend at all.
    with pytest.raises(NoBackend, match="residency"):
        r.call("tryon", {}, region="ke")


def test_hosted_only_and_disabled_backends():
    r = router()
    r.policy.routes["tryon"].strategy = "hosted-only"
    assert r.call("tryon", {})[1].backend == "hosted"
    r.policy.routes["tryon"].strategy = "cost"
    r.policy.routes["tryon"].pool.enabled = False
    order, skipped = r.plan("tryon")
    assert order == ["hosted"] and skipped[0]["reason"] == "disabled by policy"


# ── breaker ───────────────────────────────────────────────────────────────────
def test_breaker_open_half_open_close():
    c = Clock()
    b = CircuitBreaker(failure_threshold=3, cooldown_s=10, clock=c)
    assert b.allow() and b.current() == CLOSED
    b.failure()
    b.failure()
    assert b.current() == CLOSED
    b.failure()
    assert b.current() == OPEN and not b.allow()
    c.t += 9.9
    assert b.current() == OPEN
    c.t += 0.2
    assert b.current() == HALF_OPEN
    assert b.allow() is True  # one trial
    assert b.allow() is False  # second caller waits
    b.failure()  # trial failed -> open again, timer restarts
    assert b.current() == OPEN and b.snapshot()["retry_in_s"] == 10
    c.t += 10
    assert b.allow()
    b.success()
    assert b.current() == CLOSED and b.failures == 0
    assert [s for s, _ in b.transitions] == [OPEN, HALF_OPEN, OPEN, HALF_OPEN, CLOSED]


def test_fallback_to_hosted_and_breaker_recovery():
    c = Clock()
    r = router(clock=c)
    r.register("tryon", "pool", boom)
    for i in range(3):
        out, info = r.call("tryon", {})
        assert out["served"] == "hosted" and info.fallback
        assert info.attempts[0] == {"backend": "pool", "ok": False, "latency_ms": 0, "error": "RuntimeError: CUDA OOM"}
    assert r.breaker("tryon", "pool").current() == OPEN
    # While open the pool is not even tried.
    out, info = r.call("tryon", {})
    assert not info.fallback and [a["backend"] for a in info.attempts] == ["hosted"]
    assert {"backend": "pool", "reason": "circuit OPEN"} in info.skipped
    # Pool recovers; after the cooldown one half-open trial closes the circuit.
    r.register("tryon", "pool", ok("pool"))
    c.t += r.policy.breaker.cooldown_s
    assert r.breaker("tryon", "pool").current() == HALF_OPEN
    assert r.call("tryon", {})[1].backend == "pool"
    assert r.breaker("tryon", "pool").current() == CLOSED
    st = r.status()["routes"]["tryon"]["backends"]
    assert st["pool"]["failures"] == 3 and st["pool"]["ok"] == 1
    assert st["hosted"]["served_as_fallback"] == 3 and st["hosted"]["ok"] == 4
    assert st["hosted"]["cost_rwf"] == 4 * r.policy.routes["tryon"].hosted.cost_rwf


def test_video_route_does_not_fall_back_silently():
    r = router()
    r.register("video", "pool", boom)
    with pytest.raises(NoBackend) as e:
        r.call("video", {})
    assert [a["backend"] for a in e.value.attempts] == ["pool"]


def test_health_down_skips_pool():
    r = router()
    r.set_health("tryon", "DOWN")
    order, skipped = r.plan("tryon")
    assert order == ["hosted"] and {"backend": "pool", "reason": "health check DOWN"} in skipped


# ── pool wire contracts against the fake GPU pool ─────────────────────────────
@pytest.fixture()
def pool():
    fake_pool.STATE["mode"] = "healthy"
    client = PoolClient("http://pool.test", "k", transport=TestClient(fake_pool.app)._transport)
    yield client
    fake_pool.STATE["mode"] = "healthy"


def test_pool_contracts(pool, assets, cutouts):
    twin = Image.open(assets / "persona-2.png")
    garment = cutouts["dress-terracotta-circles"]
    img, meta = pool.vton(twin, garment, {"category": "dress", "tier": "PREVIEW"})
    assert img.size[1] == 512 and meta["model_version"].startswith("local-compositor")
    frames, vmeta = pool.video([twin, twin], garment, {"category": "dress"})
    assert len(frames) == 2 and vmeta["model_version"] == "pool-video-vton@1.0"
    assert pool.chat_json("s", "Suggestions to rewrite:\n1. Add a back photo.\n2. Reply faster.", {})["texts"] == ["Add a back photo.", "Reply faster."]
    assert pool.ready("tryon")[0] is True


def test_router_with_fake_pool_chaos(pool, assets, cutouts):
    c = Clock()
    r = register_defaults(Router(default_policy(), clock=c, regions={"pool": "rw", "hosted": "eu"}), pool)
    payload = {"twin": Image.open(assets / "persona-3.png"), "category": "dress", "tier": "PREVIEW", "frame": None,
               "garment": cutouts["dress-indigo-zigzag"]}
    res, info = r.call("tryon", payload)
    assert info.backend == "pool" and res.image.size == res.twin_resized.size
    check_health(r, pool)
    assert r.health["tryon"]["status"] == "UP"

    fake_pool.STATE["mode"] = "failing"  # model errors while health still says READY
    for _ in range(3):
        assert r.call("tryon", payload)[1].backend == "hosted"
    assert r.breaker("tryon", "pool").current() == OPEN

    fake_pool.STATE["mode"] = "down"
    check_health(r, pool)
    assert r.health["tryon"]["status"] == "DOWN"

    fake_pool.STATE["mode"] = "healthy"
    check_health(r, pool)
    c.t += r.policy.breaker.cooldown_s
    assert r.call("tryon", payload)[1].backend == "pool"
    assert r.breaker("tryon", "pool").current() == CLOSED


def test_gateway_inference_endpoints(client):
    s = client.get("/v1/inference/status").json()
    assert set(s["routes"]) == {"tryon", "stt", "llm", "avatar", "video"}
    assert s["routes"]["tryon"]["backends"]["hosted"]["configured"] is True
    pol = s["policy"]
    pol["version"] = 7
    pol["routes"]["avatar"]["strategy"] = "hosted-only"
    assert client.put("/v1/inference/policy", json=pol).json() == {"version": 7}
    p = client.post("/v1/inference/probe", json={"route": "avatar", "n": 3}).json()
    assert p["served"] == {"hosted": 3}
    bad = dict(pol, routes={"teleport": pol["routes"]["tryon"]})
    assert client.put("/v1/inference/policy", json=bad).status_code == 422
    stt = client.post("/v1/inference/probe", json={"route": "stt", "n": 1}).json()
    assert stt["served"] == {"hosted": 1}
