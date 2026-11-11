"""Gateway routes for the R4 drape spike (experimental, flag-gated in the API).

GET  /v1/drape/catalog        -> garments, fabrics, sizes, bands, limits
POST /v1/drape/simulate       -> print GLB + heatmap GLB + posters + fit summary + metrics (sync, ~2 s CPU)
POST /v1/drape/eval           -> {job_id}  (NLB-style harness; minutes for the full grid)
GET  /v1/drape/eval/{job_id}  -> {status, progress, report?}
"""
from __future__ import annotations

import threading
import time
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..imaging import decode_b64
from . import evaluate, service

router = APIRouter()
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


class PatternParams(BaseModel):
    length_cm: float | None = Field(default=None, ge=30, le=140)
    ease_cm: float = Field(default=0.0, ge=-6, le=20)
    sleeve: Literal["none", "short", "long"] | None = None


class SimulateIn(BaseModel):
    garment: Literal["a_line_dress", "wrap_skirt", "shirt"] = "a_line_dress"
    size: str | None = Field(default=None, max_length=4)
    garment_measurements: dict[str, float] | None = None
    params: PatternParams = Field(default_factory=PatternParams)
    fabric: Literal["cotton", "kitenge", "jersey"] = "cotton"
    body_measurements: dict[str, float] | None = None
    body_size: str | None = Field(default=None, max_length=4)
    skin_rgb: list[float] | None = Field(default=None, min_length=3, max_length=3)
    print_b64: str | None = None
    hue: float | None = None
    quality: Literal["fast", "standard", "fine"] = "standard"
    posters: bool = True
    request_id: str = Field(default_factory=lambda: uuid.uuid4().hex)


class EvalIn(BaseModel):
    scope: Literal["smoke", "quick", "full"] = "quick"
    quality: Literal["fast", "standard", "fine"] = "standard"


@router.get("/v1/drape/catalog")
def catalog():
    return service.catalog()


@router.post("/v1/drape/simulate")
def simulate(body: SimulateIn):
    params = {k: v for k, v in body.params.model_dump().items() if v is not None}
    img = None
    if body.print_b64:
        try:
            img = decode_b64(body.print_b64)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"Invalid print image: {exc}") from exc
    try:
        out = service.simulate(body.garment, size=body.size, garment_measurements=body.garment_measurements, params=params,
                               fabric=body.fabric, body_measurements=body.body_measurements, body_size=body.body_size,
                               skin_rgb=body.skin_rgb, print_image=img, hue=body.hue, quality=body.quality, posters=body.posters)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return service._np({**out, "request_id": body.request_id})


@router.post("/v1/drape/eval")
def start_eval(body: EvalIn):
    job_id = uuid.uuid4().hex
    with _lock:
        for k in [k for k, j in _jobs.items() if time.time() - j["created"] > 3600]:
            _jobs.pop(k, None)
        _jobs[job_id] = {"id": job_id, "status": "RUNNING", "progress": 0.0, "created": time.time(), "scope": body.scope}

    def progress(p: float):
        _jobs[job_id]["progress"] = round(p, 3)

    def run():
        try:
            kw = {"smoke": {"bodies": ["M"], "garments": ["a_line_dress"], "fabrics": ["cotton"]},
                  "quick": {"bodies": ["S", "L", "3XL"], "fabrics": ["cotton", "jersey"]}}.get(body.scope, {})
            rep = evaluate.run(quality=body.quality, progress=progress, **kw)
            rep["scope"] = body.scope
            _jobs[job_id].update(status="DONE", progress=1.0, report=service._np(rep))
        except Exception as exc:  # noqa: BLE001
            _jobs[job_id].update(status="FAILED", error=f"{type(exc).__name__}: {exc}")

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id, "status": "RUNNING", "scope": body.scope}


@router.get("/v1/drape/eval/{job_id}")
def get_eval(job_id: str):
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(status_code=404, detail="Unknown or expired eval job")
    return {k: v for k, v in j.items() if k != "created"}
