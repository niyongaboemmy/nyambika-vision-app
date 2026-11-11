"""Fake GPU pool for local development (E42). NOT a model server and never deployed.

Speaks the same wire protocols as the real pool in infra/inference/ so routing, the circuit
breaker and fallback can be demonstrated without GPUs:
  KServe / Open Inference Protocol v2: /v2/health/{live,ready}, /v2/models/{name}/ready,
      /v2/models/{vton,video-vton,avatar}/infer
  OpenAI-compatible (vLLM): /v1/models, /v1/chat/completions, /v1/audio/transcriptions
Behind them it runs the repo's CPU stand-ins (local compositor, echo phrasing, scripted words)
and adds simulated GPU latency. /fake/chaos switches the failure mode:
  healthy  ~GPU latency, no errors        slow     +2.5 s per call (breaks a tight SLO)
  flaky    30% of inferences fail (500)    failing  every inference fails, health still READY
  down     everything answers 503, health included

Run: uvicorn app.fake_pool:app --port 8144
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import random
import re
import time

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel

from .providers.local_compositor import LocalCompositor

app = FastAPI(title="Nyambika fake GPU pool (dev only)")
MODELS = ["vton", "video-vton", "avatar", "llm", "whisper"]
BASE_MS = {"vton": 120, "video-vton": 600, "avatar": 300, "llm": 90, "whisper": 60}
STATE = {"mode": "healthy", "since": time.time(), "calls": 0, "errors": 0}
_vton = LocalCompositor()


class ChaosIn(BaseModel):
    mode: str


@app.get("/fake/chaos")
def chaos_get():
    return STATE


@app.post("/fake/chaos")
def chaos_set(body: ChaosIn):
    if body.mode not in ("healthy", "slow", "flaky", "failing", "down"):
        raise HTTPException(422, "mode must be healthy|slow|flaky|failing|down")
    STATE.update(mode=body.mode, since=time.time())
    return STATE


def _model_of(path: str) -> str | None:
    m = re.match(r"^/v2/models/([^/]+)/", path)
    if m:
        return m.group(1)
    if path.startswith("/v1/chat"):
        return "llm"
    if path.startswith("/v1/audio"):
        return "whisper"
    return None


@app.middleware("http")
async def chaos(request: Request, call_next):
    path = request.url.path
    if path.startswith("/fake") or path in ("/docs", "/openapi.json"):
        return await call_next(request)
    mode = STATE["mode"]
    if mode == "down":
        return JSONResponse({"error": "pool down (fake)"}, status_code=503)
    model = _model_of(path)
    inference = path.endswith("/infer") or path.startswith("/v1/chat") or path.startswith("/v1/audio")
    if inference:
        STATE["calls"] += 1
        delay = BASE_MS.get(model or "", 50) * random.uniform(0.8, 1.3) / 1000
        if mode == "slow":
            delay += 2.5
        await asyncio.sleep(delay)
        if mode == "failing" or (mode == "flaky" and random.random() < 0.3):
            STATE["errors"] += 1
            return JSONResponse({"error": "CUDA error: out of memory (fake)"}, status_code=500)
    return await call_next(request)


@app.get("/v2/health/live")
def live():
    return {"live": True}


@app.get("/v2/health/ready")
def ready():
    return {"ready": True}


@app.get("/v2/models/{name}/ready")
def model_ready(name: str):
    if name not in MODELS:
        raise HTTPException(404, "unknown model")
    return {"name": name, "ready": True}


def _img(b: str) -> Image.Image:
    img = Image.open(io.BytesIO(base64.b64decode(b)))
    img.load()
    return img


def _b64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt, **({"quality": 90} if fmt == "JPEG" else {}))
    return base64.b64encode(buf.getvalue()).decode()


def _inputs(body: dict) -> dict:
    return {i["name"]: i["data"] for i in body.get("inputs", [])}


def _out(model: str, version: str, outputs: dict[str, list[str]]) -> dict:
    return {"model_name": model, "model_version": version,
            "outputs": [{"name": k, "datatype": "BYTES", "shape": [len(v)], "data": v} for k, v in outputs.items()]}


@app.post("/v2/models/vton/infer")
async def vton(request: Request):
    x = _inputs(await request.json())
    params = json.loads(x["params"][0]) if "params" in x else {}
    frame = tuple(params["frame"]) if params.get("frame") else None
    r = _vton.generate(_img(x["person"][0]), _img(x["garment"][0]).convert("RGBA"), params.get("category", "dress"),
                       params.get("tier", "PREVIEW"), frame)
    meta = {"model_version": r.model_version, "subject_box": list(r.subject_box) if r.subject_box else None, "gpu": "fake"}
    return _out("vton", r.model_version, {"image": [_b64(r.image)], "meta": [json.dumps(meta)]})


@app.post("/v2/models/video-vton/infer")
async def video_vton(request: Request):
    x = _inputs(await request.json())
    params = json.loads(x["params"][0]) if "params" in x else {}
    garment = _img(x["garment"][0]).convert("RGBA")
    frames = []
    for f in x["frames"]:
        r = _vton.generate(_img(f), garment, params.get("category", "dress"), "PREVIEW")
        frames.append(_b64(r.image, "JPEG"))
    version = "pool-video-vton@1.0"
    return _out("video-vton", version, {"frames": frames, "meta": [json.dumps({"model_version": version, "gpu": "fake"})]})


@app.post("/v2/models/avatar/infer")
async def avatar(request: Request):
    x = _inputs(await request.json())
    params = json.loads(x["params"][0]) if "params" in x else {}
    return _out("avatar", "avatar-pool@0.1", {"result": [json.dumps({"ok": True, "provider": "pool:avatar", "echo": params.get("ping")})]})


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "llm", "object": "model"}, {"id": "whisper", "object": "model"}]}


@app.post("/v1/chat/completions")
async def chat(request: Request):
    """Echo phrasing: returns the numbered suggestions unchanged, as schema-valid JSON."""
    body = await request.json()
    user = next((m["content"] for m in body.get("messages", []) if m.get("role") == "user"), "")
    texts = [m.group(1).strip() for m in re.finditer(r"^\s*\d+\.\s*(.+)$", user, flags=re.M)]
    content = json.dumps({"texts": texts})
    return {"id": "chatcmpl-fake", "object": "chat.completion", "model": body.get("model", "llm"),
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": len(user) // 4, "completion_tokens": len(content) // 4}}


@app.post("/v1/audio/transcriptions")
async def transcriptions(file: UploadFile = File(...), model: str = Form("whisper"), language: str | None = Form(None),
                         response_format: str = Form("json"), prompt: str | None = Form(None), temperature: str = Form("0")):
    data = await file.read()
    words = ["Ndashaka imyenda y'ubukwe", "I want a kitenge dress for church", "Une tenue en kitenge pour l'église"]
    text = words[len(data) % len(words)]
    return {"text": text, "language": language or "rw", "duration": 1.0,
            "segments": [{"start": 0.0, "end": 1.0, "avg_logprob": -0.25, "text": text}]}
