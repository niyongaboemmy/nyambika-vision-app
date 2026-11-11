"""Video try-on, "See it on video" (E39, FR-VID-03/04/05).

Input: the shopper's short clip (frames extracted on the device, ≤ 4 s) or a turnaround of their
twin (a gentle ±30° turn synthesised from the twin still), plus the garment cut-out. Output: a
short labelled, watermarked, C2PA-credentialed clip, guarded on sampled frames.

Contract every provider implements (the gateway does the rest):

    frames(request, progress) -> VideoFrames(out, inputs, alphas?, boxes?, model_version)

`out[i]` must be the try-on of `inputs[i]` at the same size. The gateway then labels every frame,
runs the AI-GD guard on sampled frames (identity vs the same input frame, skin tone, garment
fidelity), measures identity *stability across frames*, and withholds the whole clip on any
failure. Providers never see labels or the guard and cannot skip them.

Providers:
  motion-compose  dev adapter (this repo): the E28 building blocks per frame (VTON provider →
                  same guard → label/watermark → frame-hash C2PA → WebP/MP4). Not generative.
  hosted-rest     slot for a licensed hosted video try-on API (VIDEO_TRYON_HOSTED_URL/_KEY):
                  async submit + poll, zero-retention/no-training flags in every request.
  pool            the self-hosted video-VTON server on the GPU pool via the E42 router.

A provider only reaches shoppers after the API's model registry holds a passing NLB video eval
for its exact model version (video_eval.py; activation is refused otherwise).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException
from PIL import Image, ImageDraw, ImageEnhance
from pydantic import BaseModel, Field

from . import config, guard
from .c2pa import CLAIM_GENERATOR, TRAINED_ALGORITHMIC, _canonical
from .imaging import decode_b64
from .motion import encode_webp
from .twin import subject

LABEL = "AI video try-on"
HEIGHT = 512
FPS = 8
MAX_FRAMES = 32
GUARD_SAMPLES = 8
MIN_STABILITY = float(os.environ.get("VIDEO_MIN_IDENTITY_STABILITY", "0.98"))

Source = Literal["CLIP", "TURNAROUND"]
Progress = Callable[[int], None]


class NotConfigured(RuntimeError):
    pass


def _even(img: Image.Image) -> Image.Image:
    w, h = img.width - img.width % 2, img.height - img.height % 2
    return img if (w, h) == img.size else img.crop((0, 0, w, h))


def normalise(img: Image.Image, height: int = HEIGHT) -> Image.Image:
    img = img.convert("RGB")
    if img.height != height:
        img = img.resize((max(2, round(img.width * height / img.height)), height), Image.LANCZOS)
    return _even(img)


def turn_frames(twin: Image.Image, n: int = 24, max_yaw: float = 30.0) -> list[Image.Image]:
    """Twin turnaround for video: a front-facing sway turn (yaw = ±max_yaw), foreshortened by cos(yaw).

    The head stays upright and un-warped (only narrowed), so the identity region is the twin's own.
    """
    img = normalise(twin)
    rgb = np.asarray(img)
    mask, box = subject(img)
    if box is None:
        raise ValueError("No subject found on twin")
    x0, y0, x1, y1 = box
    bg = tuple(int(v) for v in np.median(np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3)]), axis=0))
    cut = img.crop((x0, y0, x1, y1)).convert("RGBA")
    cut.putalpha(Image.fromarray((mask[y0:y1, x0:x1] * 255).astype(np.uint8)))
    cx = (x0 + x1) / 2
    out = []
    for k in range(n):
        yaw = max_yaw * np.sin(2 * np.pi * k / n)
        c = float(np.cos(np.radians(yaw)))
        w = max(4, int(round(cut.width * c)))
        part = cut.resize((w, cut.height), Image.LANCZOS)
        part = ImageEnhance.Brightness(part).enhance(0.94 + 0.06 * c)
        frame = Image.new("RGB", img.size, bg)
        shift = int(round(np.sin(np.radians(yaw)) * 0.04 * (x1 - x0)))
        frame.paste(part, (int(round(cx - w / 2)) + shift, y0), part)
        out.append(frame)
    return out


@dataclass
class VideoRequest:
    source: Source
    garment: Image.Image
    category: str = "dress"
    request_id: str = ""
    fps: int = FPS
    frames: list[Image.Image] | None = None
    twin: Image.Image | None = None
    # Data-residency region of the data subject (E41 region code, e.g. "RW"); the router keeps the job in it.
    region: str | None = None
    _inputs: list[Image.Image] | None = field(default=None, repr=False)

    def frames_in(self) -> list[Image.Image]:
        """Normalised input frames (512 px tall, even sizes, ≤ MAX_FRAMES), computed once."""
        if self._inputs is None:
            if self.source == "CLIP":
                if not self.frames:
                    raise ValueError("CLIP needs frames")
                frames = [normalise(f) for f in self.frames[:MAX_FRAMES]]
                size = frames[0].size
                self._inputs = [f if f.size == size else f.resize(size, Image.LANCZOS) for f in frames]
            else:
                if self.twin is None:
                    raise ValueError("TURNAROUND needs the twin")
                self._inputs = turn_frames(self.twin, n=max(8, min(MAX_FRAMES, self.fps * 3)))
        return self._inputs

    def drop_inputs(self) -> None:
        """Personal data minimisation: forget the shopper's frames as soon as rendering is done."""
        self.frames = None
        self.twin = None
        self._inputs = None


@dataclass
class VideoFrames:
    out: list[Image.Image]
    inputs: list[Image.Image]
    model_version: str
    alphas: list[np.ndarray] | None = None
    boxes: list[tuple[int, int, int, int] | None] | None = None
    routing: dict | None = None


class VideoTryOnProvider(ABC):
    name: str
    model_version: str
    licence: str = "proprietary"
    commercial_use: bool = True
    zero_retention: bool = True

    def configured(self) -> bool:
        return True

    @abstractmethod
    def frames(self, req: VideoRequest, progress: Progress) -> VideoFrames: ...

    def info(self) -> dict:
        return {"id": self.model_version, "provider": self.name, "tier": "VIDEO_TRYON", "configured": self.configured(),
                "licence": self.licence, "commercial_use": self.commercial_use, "zero_retention": self.zero_retention}


class MotionComposeProvider(VideoTryOnProvider):
    """Dev adapter: the still VTON provider applied frame by frame (no temporal model)."""

    name = "motion-compose"
    model_version = "motion-compose@1.0"
    licence = "in-house (Nyambika source code)"

    def frames(self, req, progress):
        from .providers import get_provider

        vton = get_provider(os.environ.get("HOSTED_VTON_PROVIDER", "local-compositor"))
        inputs = req.frames_in()
        out, alphas, boxes, ins = [], [], [], []
        for i, f in enumerate(inputs):
            r = vton.generate(f, req.garment, req.category, "PREVIEW")
            out.append(_even(r.image.convert("RGB")))
            ins.append(_even(r.twin_resized.convert("RGB")))
            alphas.append(r.garment_alpha)
            boxes.append(r.subject_box)
            progress(20 + int(55 * (i + 1) / len(inputs)))
        return VideoFrames(out, ins, f"{self.model_version}", alphas, boxes)


class HostedRestProvider(VideoTryOnProvider):
    """Slot for a licensed hosted video try-on API (async job contract, mock-tested only).

    POST {url}/v1/video-tryon/jobs   {model, request_id, person: {frames_b64[] | image_b64, fps},
                                      garment: {image_b64, category}, output: {format: "frames", fps},
                                      data_policy: {retention: "none", training: false, region}}
                                  -> {id, status}
    GET  {url}/v1/video-tryon/jobs/{id}
                                  -> {status: queued|running|succeeded|failed, progress?, error?,
                                      model_version?, output?: {frames_b64[] | webp_b64}}
    The field mapping is adapted per vendor at contracting; frames come back aligned to inputs.
    """

    name = "hosted-rest"
    licence = "commercial API licence (vendor contract)"

    def __init__(self, transport: httpx.BaseTransport | None = None, sleep: Callable[[float], None] = time.sleep):
        self.transport = transport
        self.sleep = sleep

    @property
    def url(self) -> str | None:
        return os.environ.get("VIDEO_TRYON_HOSTED_URL")

    @property
    def model_version(self) -> str:  # type: ignore[override]
        return os.environ.get("VIDEO_TRYON_HOSTED_MODEL", "hosted-video@unconfigured")

    def configured(self) -> bool:
        return bool(self.url and os.environ.get("VIDEO_TRYON_HOSTED_KEY"))

    def frames(self, req, progress):
        if not self.configured():
            raise NotConfigured("hosted-rest video provider is not configured (VIDEO_TRYON_HOSTED_URL/_KEY)")
        inputs = req.frames_in()
        body = {
            "model": self.model_version, "request_id": req.request_id,
            "person": {"frames_b64": [_jpeg_b64(f) for f in inputs], "fps": req.fps},
            "garment": {"image_b64": _png_b64(req.garment), "category": req.category},
            "output": {"format": "frames", "fps": req.fps},
            "data_policy": {"retention": "none", "training": False, "region": os.environ.get("VIDEO_TRYON_HOSTED_REGION", "eu")},
        }
        headers = {"authorization": f"Bearer {os.environ.get('VIDEO_TRYON_HOSTED_KEY')}"}
        deadline = time.monotonic() + float(os.environ.get("VIDEO_TRYON_HOSTED_TIMEOUT_S", "300"))
        with httpx.Client(timeout=60, transport=self.transport, headers=headers) as c:
            res = c.post(f"{self.url.rstrip('/')}/v1/video-tryon/jobs", json=body)
            if res.status_code >= 400:
                raise RuntimeError(f"hosted video submit failed: {res.status_code}")
            job = res.json()
            while True:
                status = job.get("status")
                if status == "succeeded":
                    break
                if status == "failed":
                    raise RuntimeError(f"hosted video job failed: {job.get('error', 'unknown')}")
                if time.monotonic() > deadline:
                    raise TimeoutError("hosted video job timed out")
                if job.get("progress") is not None:
                    progress(20 + int(55 * float(job["progress"]) / 100))
                self.sleep(float(os.environ.get("VIDEO_TRYON_HOSTED_POLL_S", "2")))
                res = c.get(f"{self.url.rstrip('/')}/v1/video-tryon/jobs/{job['id']}")
                if res.status_code >= 400:
                    raise RuntimeError(f"hosted video poll failed: {res.status_code}")
                job = res.json()
        out = _decode_output(job.get("output") or {})
        size = inputs[0].size
        out = [f.convert("RGB").resize(size, Image.LANCZOS) if f.size != size else f.convert("RGB") for f in out]
        if len(out) != len(inputs):
            raise RuntimeError(f"hosted video returned {len(out)} frames for {len(inputs)} inputs")
        return VideoFrames(out, inputs, str(job.get("model_version") or self.model_version))


class PoolVideoProvider(VideoTryOnProvider):
    """Self-hosted video-VTON model server on the GPU pool, through the E42 router (route `video`)."""

    name = "pool"
    model_version = "pool-video-vton@1.0"
    licence = "model weights per ADR-0007 (permissive only; slot ships without weights)"

    def configured(self) -> bool:
        from .inference import get_router

        return "pool" in get_router().backends.get("video", {})

    def frames(self, req, progress):
        from .inference import get_router

        if not self.configured():
            raise NotConfigured("pool video provider needs INFERENCE_POOL_URL")
        progress(25)
        result, info = get_router().call("video", {"request": req, "progress": progress}, req.region)
        if isinstance(result, VideoFrames):
            result.routing = info.view()
            return result
        frames, meta = result
        inputs = req.frames_in()
        frames = [f.resize(inputs[0].size, Image.LANCZOS) if f.size != inputs[0].size else f for f in frames]
        if len(frames) != len(inputs):
            raise RuntimeError(f"pool returned {len(frames)} frames for {len(inputs)} inputs")
        return VideoFrames(frames, inputs, str(meta.get("model_version", self.model_version)), routing=info.view())


PROVIDERS: dict[str, VideoTryOnProvider] = {
    "motion-compose": MotionComposeProvider(),
    "hosted-rest": HostedRestProvider(),
    "pool": PoolVideoProvider(),
}


def get(name: str) -> VideoTryOnProvider:
    if name not in PROVIDERS:
        raise ValueError(f"Unknown video provider '{name}'. Available: {sorted(PROVIDERS)}")
    return PROVIDERS[name]


# ── encoding helpers ─────────────────────────────────────────────────────────
def _png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _jpeg_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode()


def _decode_output(out: dict) -> list[Image.Image]:
    if out.get("frames_b64"):
        return [decode_b64(x) for x in out["frames_b64"]]
    if out.get("webp_b64"):
        img = Image.open(io.BytesIO(base64.b64decode(out["webp_b64"])))
        frames = []
        for i in range(getattr(img, "n_frames", 1)):
            img.seek(i)
            frames.append(img.convert("RGB").copy())
        return frames
    raise RuntimeError("hosted video output has no frames_b64 or webp_b64")


def _label(img: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    img = img.convert("RGBA")
    s = img.height / 512
    w, h = int(104 * s), int(18 * s)
    x0, y0 = img.width - w - int(8 * s), int(8 * s)  # top-right, clear of the app's chips and maker card
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=int(6 * s), fill=(0, 0, 0, 140))
    d.text((x0 + int(7 * s), y0 + int(3 * s)), LABEL, fill=(255, 255, 255, 230), font_size=max(10, int(11 * s)))
    d.text((img.width - int(64 * s), img.height - int(22 * s)), "nyambika", fill=(255, 255, 255, 110), font_size=max(9, int(10 * s)))
    return Image.alpha_composite(img, overlay).convert("RGB"), (x0, y0, x0 + w, y0 + h)


def frames_hash(frames: list[Image.Image]) -> str:
    h = hashlib.sha256(f"{len(frames)}x{frames[0].width}x{frames[0].height}:RGB:".encode())
    for f in frames:
        h.update(f.convert("RGB").tobytes())
    return h.hexdigest()


def manifest(frames: list[Image.Image], model_version: str, request_id: str, fps: int, source: str) -> dict:
    digest = frames_hash(frames)
    m = {
        "claim_generator": CLAIM_GENERATOR,
        "title": f"video-tryon-{request_id}",
        "format": "image/webp",
        "assertions": [
            {"label": "c2pa.actions", "data": {"actions": [
                {"action": "c2pa.created", "digitalSourceType": TRAINED_ALGORITHMIC, "softwareAgent": model_version}]}},
            {"label": "nyambika.generation", "data": {"model_version": model_version, "request_id": request_id,
                                                       "kind": "video_tryon", "source": source, "frames": len(frames), "fps": fps}},
            {"label": "c2pa.hash.data", "data": {"alg": "sha256", "hash": digest, "scope": "frames-rgb"}},
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    sig = hmac.new(config.C2PA_SIGNING_KEY, _canonical(m), hashlib.sha256).hexdigest()
    return {"manifest": m, "signature": sig, "sha256": digest}


def verify_manifest(credentials: dict, frames: list[Image.Image]) -> bool:
    expected = hmac.new(config.C2PA_SIGNING_KEY, _canonical(credentials["manifest"]), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, credentials["signature"]) and credentials["sha256"] == frames_hash(frames)


def encode_mp4(frames: list[Image.Image], fps: int, credentials: dict) -> bytes | None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    w, h = frames[0].size
    raw = b"".join(f.convert("RGB").tobytes() for f in frames)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "clip.mp4"
        cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
               "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
               "-movflags", "+faststart", "-metadata", f"comment=c2pa:{credentials['sha256']}:{credentials['signature']}",
               "-metadata", f"title={LABEL}", str(out)]
        try:
            subprocess.run(cmd, input=raw, check=True, timeout=60)
        except (subprocess.SubprocessError, OSError):
            return None
        return out.read_bytes()


# ── guard + finalise ─────────────────────────────────────────────────────────
def assess(vf: VideoFrames, garment: Image.Image, samples: int = GUARD_SAMPLES, labelled: list[Image.Image] | None = None,
           label_box=None) -> dict:
    """Guard on sampled frames + identity stability across frames (FR-VID-05, NLB video)."""
    if not vf.out or len(vf.out) != len(vf.inputs):
        return {"passed": False, "reasons": ["frame_mismatch"], "identity_similarity": 0.0, "identity_stability": 0.0,
                "skin_tone_delta": 1.0, "garment_fidelity": 0.0, "sampled_frames": [], "frames_passed": 0}
    frames = labelled or vf.out
    idx = sorted(set(np.linspace(0, len(frames) - 1, min(samples, len(frames))).round().astype(int).tolist()))
    g = garment.convert("RGBA")
    checks = []
    for i in idx:
        alpha = vf.alphas[i] if vf.alphas else None
        box = vf.boxes[i] if vf.boxes else None
        inp = vf.inputs[i]
        out = frames[i] if frames[i].size == inp.size else frames[i].resize(inp.size, Image.LANCZOS)
        if alpha is not None:
            alpha = alpha[: inp.height, : inp.width]
        checks.append(guard.evaluate(inp, out, g, alpha, box, exclude_box=label_box))
    ids = [c["identity_similarity"] for c in checks]
    stability = round(1.0 - (max(ids) - min(ids)), 4) if ids else 0.0
    reasons = sorted({x for c in checks for x in c["reasons"]})
    if stability < MIN_STABILITY:
        reasons.append("identity_unstable")
    return {
        "passed": not reasons,
        "identity_similarity": min(ids) if ids else 0.0,
        "identity_stability": stability,
        "skin_tone_delta": max(c["skin_tone_delta"] for c in checks) if checks else 1.0,
        "garment_fidelity": min(c["garment_fidelity"] for c in checks) if checks else 0.0,
        "reasons": reasons,
        "sampled_frames": idx,
        "frames_passed": sum(1 for c in checks if c["passed"]),
        "thresholds": {"identity": config.GUARD_MIN_IDENTITY, "identity_stability": MIN_STABILITY,
                       "skin_tone_delta": config.GUARD_MAX_SKIN_DELTA, "garment_fidelity": config.GUARD_MIN_FIDELITY},
    }


def render(provider: VideoTryOnProvider, req: VideoRequest, progress: Progress = lambda _: None, with_mp4: bool = True) -> dict:
    vf = provider.frames(req, progress)
    garment = req.garment
    req.drop_inputs()
    progress(80)
    labelled, label_box = [], None
    for f in vf.out:
        lf, label_box = _label(f)
        labelled.append(lf)
    verdict = assess(vf, garment, labelled=labelled, label_box=label_box)
    out = {"guard": verdict, "frames": len(labelled), "fps": req.fps, "duration_ms": int(len(labelled) * 1000 / req.fps),
           "width": labelled[0].width, "height": labelled[0].height, "model_version": vf.model_version,
           "provider": provider.name, "source": req.source, "routing": vf.routing}
    vf.inputs = []
    if not verdict["passed"]:
        return {**out, "status": "WITHHELD"}
    credentials = manifest(labelled, vf.model_version, req.request_id, req.fps, req.source)
    poster = io.BytesIO()
    labelled[0].save(poster, format="WEBP", quality=80)
    return {**out, "status": "DELIVERED", "webp": encode_webp(labelled, req.fps, credentials),
            "mp4": encode_mp4(labelled, req.fps, credentials) if with_mp4 else None, "poster": poster.getvalue(),
            "c2pa": credentials, "_frames": labelled}


# ── HTTP: async jobs ─────────────────────────────────────────────────────────
router = APIRouter()
_jobs: dict[str, dict] = {}
_lock = threading.Lock()
JOB_TTL_S = 15 * 60


class VideoIn(BaseModel):
    provider: str = "motion-compose"
    source: Source = "TURNAROUND"
    frames_b64: list[str] = Field(default_factory=list, max_length=MAX_FRAMES)
    twin_b64: str | None = None
    garment_b64: str
    garment_category: str = "dress"
    fps: int = Field(default=FPS, ge=4, le=12)
    request_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    region: str | None = Field(default=None, max_length=8)


def _gc() -> None:
    now = time.time()
    with _lock:
        for k in [k for k, j in _jobs.items() if now - j["created"] > JOB_TTL_S]:
            del _jobs[k]


def _run(job_id: str, provider: VideoTryOnProvider, req: VideoRequest) -> None:
    def progress(p: int) -> None:
        _jobs[job_id]["progress"] = max(_jobs[job_id]["progress"], min(99, int(p)))

    _jobs[job_id].update(status="RUNNING", progress=10)
    try:
        r = render(provider, req, progress)
        result = {k: v for k, v in r.items() if not k.startswith("_") and k not in ("webp", "mp4", "poster")}
        if r["status"] == "DELIVERED":
            result["webp_b64"] = base64.b64encode(r["webp"]).decode()
            result["mp4_b64"] = base64.b64encode(r["mp4"]).decode() if r.get("mp4") else None
            result["poster_b64"] = base64.b64encode(r["poster"]).decode()
        _jobs[job_id].update(status=r["status"], progress=100, result=result)
    except Exception as exc:  # noqa: BLE001
        _jobs[job_id].update(status="FAILED", progress=100, error=f"{exc.__class__.__name__}: {str(exc)[:200]}")
    finally:
        req.drop_inputs()


@router.get("/v1/video/providers")
def providers():
    return [p.info() for p in PROVIDERS.values()]


@router.post("/v1/video/tryon")
def video_tryon(body: VideoIn):
    """Start a video try-on job → {job_id, status: QUEUED}. Poll GET /v1/video/jobs/{id}."""
    try:
        provider = get(body.provider)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not provider.configured():
        raise HTTPException(503, f"Video provider '{body.provider}' is not configured")
    try:
        garment = decode_b64(body.garment_b64).convert("RGBA")
        if body.source == "CLIP":
            if len(body.frames_b64) < 6:
                raise HTTPException(422, "A clip needs at least 6 frames")
            req = VideoRequest("CLIP", garment, body.garment_category, body.request_id, body.fps,
                               frames=[decode_b64(f) for f in body.frames_b64], region=body.region)
        else:
            if not body.twin_b64:
                raise HTTPException(422, "TURNAROUND needs twin_b64")
            req = VideoRequest("TURNAROUND", garment, body.garment_category, body.request_id, body.fps, twin=decode_b64(body.twin_b64), region=body.region)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Invalid image: {exc}") from exc
    _gc()
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {"status": "QUEUED", "progress": 5, "created": time.time(), "provider": provider.name}
    threading.Thread(target=_run, args=(job_id, provider, req), daemon=True).start()
    return {"job_id": job_id, "status": "QUEUED"}


@router.get("/v1/video/jobs/{job_id}")
def video_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown or expired job")
    out = {"job_id": job_id, "status": job["status"], "progress": job["progress"], "provider": job["provider"]}
    if job.get("result") is not None:
        out["result"] = job["result"]
    if job.get("error"):
        out["error"] = job["error"]
    if job["status"] in ("DELIVERED", "WITHHELD", "FAILED"):
        # Results are handed over once; the API stores them privately.
        with _lock:
            _jobs.pop(job_id, None)
    return out


class EvalIn(BaseModel):
    provider: str
    personas_b64: list[str] = Field(min_length=1, max_length=10)
    garments: list[dict] = Field(min_length=1, max_length=6)
    frames: int = Field(default=8, ge=6, le=24)


@router.post("/v1/video/eval")
def video_eval_route(body: EvalIn):
    """NLB video evaluation (skin tone × body size subgroups). Synchronous: ~10-30 s on CPU."""
    from . import video_eval

    try:
        provider = get(body.provider)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    personas = [decode_b64(p) for p in body.personas_b64]
    garments = [(decode_b64(g["b64"]).convert("RGBA"), str(g.get("category", "dress"))) for g in body.garments]
    return video_eval.run(provider, personas, garments, frames=body.frames)


