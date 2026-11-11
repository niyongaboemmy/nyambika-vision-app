"""HTTP clients for the self-hosted GPU pool (AI-GW-07).

Two wire protocols, both what the deployment in infra/inference/ serves:
  * KServe / Open Inference Protocol v2 (`/v2/models/{name}/infer`, `/v2/models/{name}/ready`)
    for the VTON, video-VTON and avatar model servers. Images travel as base64 PNG/JPEG strings in
    BYTES tensors (one element per image / frame).
  * OpenAI-compatible (`/v1/chat/completions`, `/v1/audio/transcriptions`) for vLLM serving the
    open LLM and the Whisper-family speech model.

Personal images are sent only to the pool in the approved region, never logged, and the pool
keeps nothing (stateless model servers, no request logging; ADR-0006).
"""
from __future__ import annotations

import base64
import io
import json
import os

import httpx
from PIL import Image

# Model server names on the pool, per route.
MODELS = {"tryon": "vton", "video": "video-vton", "avatar": "avatar", "llm": "llm", "stt": "whisper"}


class PoolError(RuntimeError):
    pass


def _b64png(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _b64jpeg(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode()


def decode(data: str) -> Image.Image:
    img = Image.open(io.BytesIO(base64.b64decode(data)))
    img.load()
    return img


def bytes_tensor(name: str, items: list[str]) -> dict:
    return {"name": name, "datatype": "BYTES", "shape": [len(items)], "data": items}


def json_tensor(name: str, obj: dict) -> dict:
    return bytes_tensor(name, [json.dumps(obj)])


def output(body: dict, name: str) -> list:
    for o in body.get("outputs", []):
        if o.get("name") == name:
            return o.get("data", [])
    raise PoolError(f"pool response has no output '{name}'")


class PoolClient:
    def __init__(self, base_url: str, key: str | None = None, timeout_s: float = 60,
                 transport: httpx.BaseTransport | None = None):
        self.base = base_url.rstrip("/")
        self.key = key
        self.timeout = timeout_s
        self.transport = transport

    @classmethod
    def from_env(cls) -> "PoolClient | None":
        url = os.environ.get("INFERENCE_POOL_URL")
        return cls(url, os.environ.get("INFERENCE_POOL_KEY")) if url else None

    def _headers(self) -> dict:
        return {"authorization": f"Bearer {self.key}"} if self.key else {}

    def _client(self, timeout: float | None = None) -> httpx.Client:
        return httpx.Client(timeout=timeout or self.timeout, transport=self.transport, headers=self._headers())

    def _post(self, path: str, body: dict, timeout: float | None = None) -> dict:
        try:
            with self._client(timeout) as c:
                res = c.post(f"{self.base}{path}", json=body)
        except httpx.HTTPError as exc:
            raise PoolError(f"pool unreachable: {exc.__class__.__name__}") from exc
        if res.status_code >= 400:
            raise PoolError(f"pool {path} -> {res.status_code}")
        return res.json()

    # ── KServe v2 ─────────────────────────────────────────────────────────────
    def ready(self, route: str, timeout: float = 2.0) -> tuple[bool, int, str | None]:
        """(ready, latency_ms, error) for the route's model server."""
        import time

        started = time.perf_counter()
        try:
            with self._client(timeout) as c:
                res = c.get(f"{self.base}/v2/models/{MODELS[route]}/ready")
            ms = int((time.perf_counter() - started) * 1000)
            return res.status_code == 200, ms, None if res.status_code == 200 else f"HTTP {res.status_code}"
        except httpx.HTTPError as exc:
            return False, int((time.perf_counter() - started) * 1000), exc.__class__.__name__

    def infer(self, model: str, inputs: list[dict], timeout: float | None = None) -> dict:
        return self._post(f"/v2/models/{model}/infer", {"inputs": inputs}, timeout)

    def vton(self, twin: Image.Image, garment: Image.Image, params: dict) -> tuple[Image.Image, dict]:
        body = self.infer(MODELS["tryon"], [bytes_tensor("person", [_b64png(twin)]), bytes_tensor("garment", [_b64png(garment)]),
                                            json_tensor("params", params)])
        img = decode(output(body, "image")[0])
        meta = json.loads(output(body, "meta")[0]) if any(o.get("name") == "meta" for o in body.get("outputs", [])) else {}
        meta.setdefault("model_version", body.get("model_version", "pool"))
        return img, meta

    def video(self, frames: list[Image.Image], garment: Image.Image, params: dict) -> tuple[list[Image.Image], dict]:
        body = self.infer(MODELS["video"], [bytes_tensor("frames", [_b64jpeg(f) for f in frames]),
                                            bytes_tensor("garment", [_b64png(garment)]), json_tensor("params", params)], timeout=180)
        out = [decode(x).convert("RGB") for x in output(body, "frames")]
        meta = json.loads(output(body, "meta")[0]) if any(o.get("name") == "meta" for o in body.get("outputs", [])) else {}
        meta.setdefault("model_version", body.get("model_version", "pool"))
        return out, meta

    def avatar_probe(self, params: dict) -> dict:
        body = self.infer(MODELS["avatar"], [json_tensor("params", params)])
        return json.loads(output(body, "result")[0])

    # ── OpenAI-compatible (vLLM) ──────────────────────────────────────────────
    def chat_json(self, system: str, user: str, schema: dict, max_tokens: int = 800) -> dict:
        body = self._post("/v1/chat/completions", {
            "model": os.environ.get("INFERENCE_POOL_LLM_MODEL", "llm"),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_tokens": max_tokens, "temperature": 0.2,
            "response_format": {"type": "json_schema", "json_schema": {"name": "out", "schema": schema, "strict": True}},
        })
        try:
            return json.loads(body["choices"][0]["message"]["content"])
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            raise PoolError("pool LLM returned no JSON") from exc
