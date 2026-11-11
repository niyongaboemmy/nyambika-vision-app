"""Routing policy for the inference layer (AI-GW-07, NFR-CST-01, AI-GW-04 residency).

The API is the source of truth (admin "Inference" panel, audited) and pushes the policy here with
a version number; the gateway starts from these defaults until the first push.
"""
from __future__ import annotations

import os
from typing import Literal

from pydantic import BaseModel, Field

ROUTES = ("tryon", "stt", "llm", "avatar", "video", "attr")
BACKENDS = ("pool", "hosted")
Strategy = Literal["cost", "latency", "pool-first", "hosted-only", "pool-only"]

POOL_REGION = os.environ.get("INFERENCE_POOL_REGION", "rw")
HOSTED_REGION = os.environ.get("INFERENCE_HOSTED_REGION", "eu")
DEFAULT_REGION = os.environ.get("INFERENCE_DEFAULT_REGION", "rw")


class BackendPolicy(BaseModel):
    enabled: bool = True
    cost_rwf: float = Field(default=0, ge=0, le=100_000)


class RoutePolicy(BaseModel):
    strategy: Strategy = "cost"
    latency_slo_ms: int = Field(default=15_000, ge=50, le=600_000)
    residency: Literal["any", "in-region"] = "any"
    fallback: bool = True
    pool: BackendPolicy = Field(default_factory=BackendPolicy)
    hosted: BackendPolicy = Field(default_factory=BackendPolicy)


class BreakerPolicy(BaseModel):
    failure_threshold: int = Field(default=3, ge=1, le=50)
    cooldown_s: float = Field(default=15, ge=1, le=3600)


class Policy(BaseModel):
    version: int = 0
    breaker: BreakerPolicy = Field(default_factory=BreakerPolicy)
    routes: dict[str, RoutePolicy]


# Cost per call in RWF. Pool = GPU-hour price / measured throughput at target utilisation (ADR-0007);
# hosted = list price of the contracted provider. Both are estimates until real invoices exist.
_DEFAULTS = {
    "tryon": dict(latency_slo_ms=15_000, pool=14, hosted=40),
    "stt": dict(latency_slo_ms=3_000, pool=2, hosted=8),
    "llm": dict(latency_slo_ms=4_000, pool=3, hosted=12),
    "avatar": dict(latency_slo_ms=120_000, pool=12, hosted=25),
    # Video: no silent fallback. Every backend that serves shoppers must have passed its own NLB eval.
    "video": dict(latency_slo_ms=90_000, pool=120, hosted=300, fallback=False),
    # R4 spike: garment-attribute suggestions from the self-hosted local model only; maker photos stay in-region.
    "attr": dict(latency_slo_ms=2_000, pool=0.2, hosted=0, strategy="pool-only", residency="in-region"),
}


def default_policy() -> Policy:
    routes = {}
    for route, d in _DEFAULTS.items():
        routes[route] = RoutePolicy(
            latency_slo_ms=d["latency_slo_ms"], fallback=d.get("fallback", True),
            strategy=d.get("strategy", "cost"), residency=d.get("residency", "any"),
            pool=BackendPolicy(cost_rwf=d["pool"]), hosted=BackendPolicy(cost_rwf=d["hosted"]),
        )
    return Policy(routes=routes)


def region_of(backend: str) -> str:
    return POOL_REGION if backend == "pool" else HOSTED_REGION
