"""Gateway routes for the inference layer (E42). Called by the API only (admin Inference panel).

GET  /v1/inference/status        policy, pool health, breakers, per-route/backend calls, cost, p50/p95
PUT  /v1/inference/policy        replace the routing policy (the API owns it, versioned + audited)
POST /v1/inference/health/check  probe the pool now instead of waiting for the monitor
POST /v1/inference/probe         n synthetic calls through the router (load / failover demo)
GET|POST /v1/inference/pool/chaos  dev only: read / set the fake GPU pool's failure mode
"""
from __future__ import annotations

import io
import math
import struct
import wave
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import NoBackend, check_health, get_router, pool, routing_enabled
from .policy import ROUTES, Policy

router = APIRouter()


def install(app: FastAPI) -> None:
    app.include_router(router)

    @app.exception_handler(NoBackend)
    async def _no_backend(_req: Request, exc: NoBackend):  # noqa: ANN202
        return JSONResponse(status_code=503, content={"detail": f"No inference backend available ({exc.detail})",
                                                      "route": exc.route, "attempts": exc.attempts})


@router.get("/v1/inference/status")
def status():
    r = get_router()
    p = pool()
    return {"routing_enabled": routing_enabled(),
            "pool": {"configured": p is not None, "host": urlparse(p.base).netloc if p else None, "region": r.regions["pool"]},
            "hosted": {"region": r.regions["hosted"]},
            **r.status()}


@router.put("/v1/inference/policy")
def put_policy(body: Policy):
    unknown = set(body.routes) - set(ROUTES)
    if unknown:
        raise HTTPException(422, f"Unknown routes: {sorted(unknown)}")
    r = get_router()
    merged = r.policy.model_copy(deep=True)
    merged.routes.update(body.routes)
    merged.breaker = body.breaker
    merged.version = body.version
    r.set_policy(merged)
    return {"version": merged.version}


@router.post("/v1/inference/health/check")
def health_check():
    return check_health()


class ProbeIn(BaseModel):
    route: Literal["tryon", "stt", "llm", "avatar"]
    n: int = Field(default=5, ge=1, le=50)
    region: str | None = None
    twin_b64: str | None = None
    garment_b64: str | None = None


def _tone_wav(seconds: float = 1.0, hz: float = 220.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        frames = b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / 16000))) for i in range(int(16000 * seconds)))
        w.writeframes(frames)
    return buf.getvalue()


@router.post("/v1/inference/probe")
def probe(body: ProbeIn):
    """Synthetic traffic: the same router path real calls take, with synthetic payloads only."""
    from .. import stt
    from ..imaging import decode_b64

    if body.route == "tryon":
        if not (body.twin_b64 and body.garment_b64):
            raise HTTPException(422, "tryon probe needs twin_b64 + garment_b64 (synthetic persona + seeded cut-out)")
        payload = {"twin": decode_b64(body.twin_b64), "garment": decode_b64(body.garment_b64).convert("RGBA"),
                   "category": "dress", "tier": "PREVIEW", "frame": None}
    elif body.route == "stt":
        payload = {"audio": stt.load(_tone_wav()), "language": "rw"}
    elif body.route == "llm":
        payload = {"system": "Rewrite each suggestion warmly. Keep numbers.", "user": "1. Add a photo of the back of the dress.",
                   "schema": {"type": "object", "properties": {"texts": {"type": "array", "items": {"type": "string"}}},
                              "required": ["texts"], "additionalProperties": False}}
    else:
        payload = {"ping": "probe"}
    results = []
    for _ in range(body.n):
        try:
            _out, info = get_router().call(body.route, payload, body.region)
            results.append({"ok": True, **info.view()})
        except NoBackend as exc:
            results.append({"ok": False, "route": body.route, "error": exc.detail, "attempts": exc.attempts})
    served = {}
    for x in results:
        if x["ok"]:
            served[x["backend"]] = served.get(x["backend"], 0) + 1
    return {"route": body.route, "n": body.n, "served": served, "fallbacks": sum(1 for x in results if x.get("fallback")),
            "failed": sum(1 for x in results if not x["ok"]), "results": results}


class ChaosIn(BaseModel):
    mode: Literal["healthy", "slow", "flaky", "failing", "down"]


def _chaos(method: str, body: dict | None = None) -> dict:
    p = pool()
    if p is None:
        raise HTTPException(404, "No inference pool configured")
    try:
        with httpx.Client(timeout=3) as c:
            res = c.request(method, f"{p.base}/fake/chaos", json=body)
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"Pool unreachable: {exc.__class__.__name__}") from exc
    if res.status_code == 404:
        raise HTTPException(404, "This pool is a real deployment; chaos controls exist only on the dev fake pool")
    return res.json()


@router.get("/v1/inference/pool/chaos")
def chaos_get():
    return _chaos("GET")


@router.post("/v1/inference/pool/chaos")
def chaos_set(body: ChaosIn):
    out = _chaos("POST", body.model_dump())
    check_health()
    return out
