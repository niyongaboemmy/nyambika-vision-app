#!/usr/bin/env python3
"""Load test for the self-hosted inference pool (E42).

Hits one model server with concurrent requests for a fixed duration and reports throughput,
p50/p95/p99 latency and error rate; exits 1 when p95 exceeds --slo-ms or errors exceed --max-error.
Use the numbers to set the pool's cost per call (GPU-hour price / sustained calls per hour) in the
admin Inference panel.

  # against the local fake pool (dev)
  python infra/inference/loadtest.py --url http://localhost:8144 --model llm -c 8 -d 20
  python infra/inference/loadtest.py --url http://localhost:8144 --model vton --image apps/api/storage/personas/persona-2.png \
      --garment <cutout.png> -c 4 -d 20 --slo-ms 15000
  # against a real pool (bearer key from the inference-pool-key secret)
  INFERENCE_POOL_KEY=... python infra/inference/loadtest.py --url https://inference.internal.nyambika.rw --model llm

Needs only httpx (already in apps/ai/requirements.txt).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import statistics
import sys
import time

import httpx


def body_for(model: str, image: str | None, garment: str | None) -> tuple[str, dict | None, dict | None]:
    if model == "llm":
        return "/v1/chat/completions", {
            "model": "llm", "max_tokens": 120, "temperature": 0.2,
            "messages": [{"role": "system", "content": "Rewrite each suggestion warmly. Keep numbers."},
                         {"role": "user", "content": "Suggestions to rewrite:\n1. Add a photo of the back of the dress.\n2. Reply to 3 messages."}],
        }, None
    if model == "whisper":
        import math
        import struct
        import wave
        from io import BytesIO

        buf = BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 220 * i / 16000))) for i in range(16000)))
        return "/v1/audio/transcriptions", None, {"file": ("probe.wav", buf.getvalue(), "audio/wav")}
    if model in ("vton", "video-vton"):
        if not (image and garment):
            sys.exit("--image and --garment are required for vton (synthetic persona + garment cut-out only)")
        person = base64.b64encode(open(image, "rb").read()).decode()
        cut = base64.b64encode(open(garment, "rb").read()).decode()
        name = "frames" if model == "video-vton" else "person"
        data = [person] * (8 if model == "video-vton" else 1)
        return f"/v2/models/{model}/infer", {"inputs": [
            {"name": name, "datatype": "BYTES", "shape": [len(data)], "data": data},
            {"name": "garment", "datatype": "BYTES", "shape": [1], "data": [cut]},
            {"name": "params", "datatype": "BYTES", "shape": [1], "data": [json.dumps({"category": "dress", "tier": "PREVIEW"})]},
        ]}, None
    sys.exit(f"unknown model {model}")


async def worker(client: httpx.AsyncClient, path: str, js: dict | None, files: dict | None, until: float, out: list, errors: list):
    while time.monotonic() < until:
        started = time.perf_counter()
        try:
            if files:
                r = await client.post(path, data={"model": "whisper"}, files=files)
            else:
                r = await client.post(path, json=js)
            ms = (time.perf_counter() - started) * 1000
            if r.status_code >= 400:
                errors.append(r.status_code)
            else:
                out.append(ms)
        except httpx.HTTPError as exc:
            errors.append(exc.__class__.__name__)


def pct(xs: list[float], q: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", required=True)
    p.add_argument("--model", default="llm", choices=["llm", "whisper", "vton", "video-vton"])
    p.add_argument("-c", "--concurrency", type=int, default=4)
    p.add_argument("-d", "--duration", type=float, default=15.0, help="seconds")
    p.add_argument("--image")
    p.add_argument("--garment")
    p.add_argument("--slo-ms", type=float, default=4000)
    p.add_argument("--max-error", type=float, default=0.01)
    p.add_argument("--json", help="write the report here")
    a = p.parse_args()
    path, js, files = body_for(a.model, a.image, a.garment)
    key = os.environ.get("INFERENCE_POOL_KEY")
    headers = {"authorization": f"Bearer {key}"} if key else {}
    ok: list[float] = []
    errors: list = []
    started = time.monotonic()
    async with httpx.AsyncClient(base_url=a.url.rstrip("/"), headers=headers, timeout=300) as client:
        until = started + a.duration
        await asyncio.gather(*(worker(client, path, js, files, until, ok, errors) for _ in range(a.concurrency)))
    elapsed = time.monotonic() - started
    total = len(ok) + len(errors)
    report = {
        "model": a.model, "url": a.url, "concurrency": a.concurrency, "duration_s": round(elapsed, 1),
        "requests": total, "rps": round(len(ok) / elapsed, 2), "error_rate": round(len(errors) / total, 4) if total else None,
        "p50_ms": round(pct(ok, 0.5)), "p95_ms": round(pct(ok, 0.95)), "p99_ms": round(pct(ok, 0.99)),
        "mean_ms": round(statistics.fmean(ok)) if ok else None, "errors": sorted({str(e) for e in errors}),
        "calls_per_gpu_hour": round(len(ok) / elapsed * 3600),
    }
    print(json.dumps(report, indent=2))
    if a.json:
        open(a.json, "w").write(json.dumps(report, indent=2))
    failed = (report["error_rate"] or 0) > a.max_error or not ok or report["p95_ms"] > a.slo_ms
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
