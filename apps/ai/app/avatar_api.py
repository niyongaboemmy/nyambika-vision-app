"""Gateway routes for the 3D twin (E33) and 3D try-on (E34).

POST /v1/avatar/build        → {job_id, status: QUEUED}   (async: real 3DGS providers take minutes)
GET  /v1/avatar/jobs/{id}    → {status, progress, result?}
POST /v1/avatar/dress        → dressed GLB + poster + fit report (synchronous, < 1 s on CPU)
POST /v1/avatar/turnaround   → synthetic 24-frame turnaround of a persona (dev/testing only)
GET  /v1/avatar/models       → avatar provider registry entries

Jobs live in memory in this dev gateway (lost on restart; the API marks them FAILED and the
shopper retries). A production deployment backs this with the provider's own job store.
"""
from __future__ import annotations

import base64
import io
import threading
import time
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from . import avatar_capture as cap
from . import avatar_providers as providers
from .imaging import decode_b64

router = APIRouter()
_jobs: dict[str, dict] = {}
_lock = threading.Lock()
JOB_TTL_S = 15 * 60


class BuildIn(BaseModel):
    frames_b64: list[str] = Field(default_factory=list, max_length=cap.MAX_FRAMES)
    yaw_deg: list[float] = Field(default_factory=list, max_length=cap.MAX_FRAMES)
    measurements: dict[str, float] = Field(default_factory=dict)
    size_estimate: str | None = None
    skin_rgb: list[float] | None = Field(default=None, min_length=3, max_length=3)
    style: Literal["stylised", "photoreal"] = "stylised"
    provider: str | None = None
    request_id: str = Field(default_factory=lambda: uuid.uuid4().hex)


class DressIn(BaseModel):
    params: dict
    cutout_b64: str
    category: str = "dress"
    size: str = "M"
    provider: str | None = None
    request_id: str = Field(default_factory=lambda: uuid.uuid4().hex)


class TurnaroundIn(BaseModel):
    persona_b64: str
    frames: int = Field(default=24, ge=8, le=32)


def _img(data: str) -> Image.Image:
    try:
        return decode_b64(data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Invalid image: {exc}") from exc


def _encode(result: dict) -> dict:
    out = {k: v for k, v in result.items() if k not in ("glb", "poster")}
    if result.get("glb"):
        out["glb_b64"] = base64.b64encode(result["glb"]).decode()
    if result.get("poster"):
        out["poster_b64"] = base64.b64encode(result["poster"]).decode()
    return out


def _gc():
    now = time.time()
    for k in [k for k, j in _jobs.items() if now - j["created"] > JOB_TTL_S]:
        _jobs.pop(k, None)


@router.post("/v1/avatar/build")
def build(body: BuildIn):
    if body.style == "photoreal" and (body.provider or "parametric-cpu") == "parametric-cpu":
        raise HTTPException(status_code=422, detail="Photoreal avatars need the gaussian-splat provider (not configured here)")
    if body.frames_b64 and len(body.yaw_deg) != len(body.frames_b64):
        raise HTTPException(status_code=422, detail="yaw_deg must have one angle per frame")
    try:
        provider = providers.get(body.provider)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    frames = [_img(f).convert("RGB") for f in body.frames_b64]
    job_id = uuid.uuid4().hex
    with _lock:
        _gc()
        _jobs[job_id] = {"id": job_id, "status": "QUEUED", "progress": 0, "created": time.time(), "provider": provider.name,
                         "model_version": provider.model_version}

    def progress(p: int):
        _jobs[job_id]["progress"] = p

    def run():
        _jobs[job_id]["status"] = "RUNNING"
        try:
            r = provider.build(frames, body.yaw_deg, body.measurements, body.size_estimate, body.skin_rgb, body.style, body.request_id, progress)
            _jobs[job_id].update(status=r["status"], progress=100, result=_encode(r))
        except NotImplementedError as exc:
            _jobs[job_id].update(status="FAILED", progress=100, error=str(exc))
        except Exception as exc:  # noqa: BLE001
            _jobs[job_id].update(status="FAILED", progress=100, error=f"{type(exc).__name__}: {exc}")

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id, "status": "QUEUED", "provider": provider.name, "model_version": provider.model_version}


@router.get("/v1/avatar/jobs/{job_id}")
def job(job_id: str):
    j = _jobs.get(job_id)
    if not j:
        raise HTTPException(status_code=404, detail="Unknown or expired avatar job")
    return {k: v for k, v in j.items() if k != "created"}


@router.post("/v1/avatar/dress")
def dress(body: DressIn):
    try:
        r = providers.get(body.provider).dress(body.params, _img(body.cutout_b64), body.category, body.size, body.request_id)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _encode(r)


@router.post("/v1/avatar/turnaround")
def turnaround(body: TurnaroundIn):
    try:
        frames, yaws = cap.turnaround(_img(body.persona_b64), body.frames)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    out = []
    for f in frames:
        buf = io.BytesIO()
        f.save(buf, format="JPEG", quality=84)
        out.append(base64.b64encode(buf.getvalue()).decode())
    return {"frames_b64": out, "yaw_deg": yaws, "synthetic": True}


@router.get("/v1/avatar/models")
def models():
    return [p.info() for p in providers.PROVIDERS.values()]
