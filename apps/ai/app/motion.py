"""Motion preview, "See it move" (E28, FR-VID-01/04/05/06).

A 4 s seamless loop of a try-on look: the body does a gentle weight-shift sway (hips move,
head and feet stay planted) and the garment layer swings a little more towards the hem, built
by frame-by-frame horizontal warping of the twin and the garment layer separately.

The head (identity region the guard checks) is never warped, so face pixels are bit-identical
to the approved still on every frame. Sampled frames still run through the same guard as
stills (identity, skin tone, garment fidelity); any failure withholds the whole clip.

Outputs an animated WebP (always) and an H.264 MP4 when ffmpeg is installed, both carrying a
visible "AI motion preview" label, a corner watermark and a C2PA-shaped manifest bound to the
hash of every frame.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from . import config, guard
from .c2pa import CLAIM_GENERATOR, TRAINED_ALGORITHMIC, _canonical
from .providers import get_provider

MODEL_SUFFIX = "sway-warp@1.0"
FPS = 12
DURATION_S = 4.0
LABEL = "AI motion preview"
GUARD_SAMPLES = 6
NECK = 0.20  # fraction of subject height above which nothing moves (guard head region is 0.16)


def _smooth(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def _profiles(h: int, box, garment_rows: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    """Per-row weights: body sway (0 at neck and feet, 1 at hips) and extra hem swing for the garment."""
    x0, y0, x1, y1 = box
    sh = max(1, y1 - y0)
    y = np.arange(h, dtype=np.float32)
    neck, hips = y0 + NECK * sh, y0 + 0.52 * sh
    up = _smooth((y - neck) / max(1, hips - neck))
    down = 1 - _smooth((y - hips) / max(1, y1 - hips))
    body = np.where(y < hips, up, down).astype(np.float32)
    body[y <= neck] = 0
    g0, g1 = garment_rows
    start = max(hips - 0.1 * sh, g0)
    hem = (_smooth((y - start) / max(1, g1 - start)) ** 1.6).astype(np.float32)
    hem[y <= neck] = 0
    return body, hem


def _shift_rows(img: np.ndarray, dx: np.ndarray) -> np.ndarray:
    """Shift every row by dx[row] pixels (bilinear along x, edge-clamped). Rows with dx == 0 are copied."""
    h, w = img.shape[:2]
    xs = np.arange(w, dtype=np.float32)[None, :] - dx[:, None]
    x0 = np.floor(xs)
    f = xs - x0
    if img.ndim == 3:
        f = f[..., None]
    i0 = np.clip(x0.astype(np.int64), 0, w - 1)
    i1 = np.clip(i0 + 1, 0, w - 1)
    rows = np.arange(h)[:, None]
    out = img[rows, i0] * (1 - f) + img[rows, i1] * f
    still = dx == 0
    out[still] = img[still]
    return out


def _label(img: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    img = img.convert("RGBA")
    s = img.height / 512
    w, h = int(118 * s), int(18 * s)
    x0, y0 = int(8 * s), img.height - h - int(8 * s)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=int(6 * s), fill=(0, 0, 0, 140))
    d.text((x0 + int(7 * s), y0 + int(3 * s)), LABEL, fill=(255, 255, 255, 230), font_size=max(10, int(11 * s)))
    # Corner watermark (FR-VID-05), bottom-right so it never covers the face.
    d.text((img.width - int(64 * s), img.height - int(22 * s)), "nyambika", fill=(255, 255, 255, 110),
           font_size=max(9, int(10 * s)))
    return Image.alpha_composite(img, overlay).convert("RGB"), (x0, y0, x0 + w, y0 + h)


def _even(img: Image.Image) -> Image.Image:
    w, h = img.width - img.width % 2, img.height - img.height % 2
    return img if (w, h) == img.size else img.crop((0, 0, w, h))


def render_frames(twin: Image.Image, garment: Image.Image, category: str, tier: str = "PREVIEW",
                  frame: tuple[int, int, int, int] | None = None, fps: int = FPS, duration_s: float = DURATION_S):
    """Return dict(frames, still, twin, alpha_frames, box, model_version, label_box)."""
    provider = get_provider(config.VTON_PROVIDER)
    garment = garment.convert("RGBA")
    r = provider.generate(twin, garment, category, tier, frame)
    base = np.asarray(r.twin_resized.convert("RGB"), dtype=np.float32)
    comp = np.asarray(r.image.convert("RGB"), dtype=np.float32)
    h, w = base.shape[:2]
    box = r.subject_box
    alpha = r.garment_alpha if r.garment_alpha is not None else (np.abs(comp - base).max(axis=-1) > 24).astype(np.float32)
    a = alpha[..., None]
    # Recover the garment layer colours from the composite (un-premultiply over the twin).
    layer = np.where(a > 0.05, (comp - (1 - a) * base) / np.maximum(a, 0.05), comp)
    layer = np.clip(layer, 0, 255)
    ys = np.nonzero(alpha.max(axis=1) > 0.02)[0]
    g_rows = (int(ys.min()), int(ys.max())) if len(ys) else (box[1], box[3])
    body_w, hem_w = _profiles(h, box, g_rows)
    sh = box[3] - box[1]
    amp_body, amp_hem = 0.011 * sh, 0.016 * sh

    n = max(1, int(round(fps * duration_s)))
    frames, alphas = [], []
    for i in range(n):
        phase = 2 * np.pi * i / n
        d_body = (amp_body * np.sin(phase) * body_w).astype(np.float32)
        d_garm = d_body + (amp_hem * np.sin(phase - 0.7) * hem_w).astype(np.float32)
        bg = _shift_rows(base, d_body)
        gl = _shift_rows(layer, d_garm)
        ga = _shift_rows(alpha, d_garm)
        # Soft contact shadow that follows the garment.
        shadow = _shift_rows(alpha, d_garm + 2.0)[..., None] * 0.18
        out = bg * (1 - shadow) * (1 - ga[..., None]) + gl * ga[..., None]
        frames.append(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)))
        alphas.append(ga)
    return {
        "frames": frames,
        "alphas": alphas,
        "twin": r.twin_resized.convert("RGB"),
        "still": r.image.convert("RGB"),
        "box": box,
        "model_version": f"{r.model_version}+{MODEL_SUFFIX}",
    }


def frames_hash(frames: list[Image.Image]) -> str:
    h = hashlib.sha256(f"{len(frames)}x{frames[0].width}x{frames[0].height}:RGB:".encode())
    for f in frames:
        h.update(f.convert("RGB").tobytes())
    return h.hexdigest()


def manifest(frames: list[Image.Image], model_version: str, request_id: str, fps: int) -> dict:
    digest = frames_hash(frames)
    m = {
        "claim_generator": CLAIM_GENERATOR,
        "title": f"motion-{request_id}",
        "format": "image/webp",
        "assertions": [
            {"label": "c2pa.actions", "data": {"actions": [
                {"action": "c2pa.created", "digitalSourceType": TRAINED_ALGORITHMIC, "softwareAgent": model_version}]}},
            {"label": "nyambika.generation", "data": {"model_version": model_version, "request_id": request_id,
                                                       "kind": "motion", "frames": len(frames), "fps": fps}},
            {"label": "c2pa.hash.data", "data": {"alg": "sha256", "hash": digest, "scope": "frames-rgb"}},
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    sig = hmac.new(config.C2PA_SIGNING_KEY, _canonical(m), hashlib.sha256).hexdigest()
    return {"manifest": m, "signature": sig, "sha256": digest}


def _xmp(credentials: dict) -> bytes:
    payload = json.dumps({"manifest": credentials["manifest"], "signature": credentials["signature"], "alg": "HS256"})
    esc = payload.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    return (
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
        '<rdf:Description xmlns:nyambika="https://nyambika.rw/ns/1.0/" '
        f'nyambika:c2pa="{esc}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    ).encode()


def encode_webp(frames: list[Image.Image], fps: int, credentials: dict) -> bytes:
    buf = io.BytesIO()
    frames[0].save(buf, format="WEBP", save_all=True, append_images=frames[1:], duration=int(1000 / fps), loop=0,
                   quality=72, method=4, xmp=_xmp(credentials))
    return buf.getvalue()


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


def generate(twin: Image.Image, garment: Image.Image, category: str = "dress", tier: str = "PREVIEW",
             frame: tuple[int, int, int, int] | None = None, request_id: str = "", with_mp4: bool = True) -> dict:
    r = render_frames(twin, garment, category, tier, frame)
    labelled, label_box = [], None
    for f in r["frames"]:
        lf, label_box = _label(_even(f))
        labelled.append(lf)
    twin_img = _even(r["twin"])
    # Guard on evenly sampled frames (FR-VID-05). A single failure withholds the clip.
    idx = np.linspace(0, len(labelled) - 1, GUARD_SAMPLES).round().astype(int)
    checks = []
    for i in idx:
        alpha = r["alphas"][i][: twin_img.height, : twin_img.width]
        checks.append(guard.evaluate(twin_img, labelled[i], garment.convert("RGBA"), alpha, r["box"], exclude_box=label_box))
    passed = all(c["passed"] for c in checks)
    verdict = {
        "passed": passed,
        "identity_similarity": min(c["identity_similarity"] for c in checks),
        "skin_tone_delta": max(c["skin_tone_delta"] for c in checks),
        "garment_fidelity": min(c["garment_fidelity"] for c in checks),
        "reasons": sorted({x for c in checks for x in c["reasons"]}),
        "sampled_frames": [int(i) for i in idx],
    }
    out = {"guard": verdict, "frames": len(labelled), "fps": FPS, "duration_ms": int(len(labelled) * 1000 / FPS),
           "width": labelled[0].width, "height": labelled[0].height, "model_version": r["model_version"]}
    if not passed:
        return {**out, "status": "WITHHELD"}
    credentials = manifest(labelled, r["model_version"], request_id, FPS)
    poster = io.BytesIO()
    labelled[0].save(poster, format="WEBP", quality=80)
    return {
        **out,
        "status": "DELIVERED",
        "webp": encode_webp(labelled, FPS, credentials),
        "mp4": encode_mp4(labelled, FPS, credentials) if with_mp4 else None,
        "poster": poster.getvalue(),
        "c2pa": credentials,
        "_frames": labelled,
        "_twin": twin_img,
        "_box": r["box"],
    }
