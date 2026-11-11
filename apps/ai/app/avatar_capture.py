"""360° turn capture analysis (E33, FR-AVA-01).

- `check_frames`: server-side checks on the ~24 sampled frames (light, framing on the front frame,
  one person, rotation evidence from silhouette width change, yaw coverage).
- `sample_skin`: skin tone from the face region of front-facing frames (median, robust to eyes,
  mouth and hair), with a spread figure used as confidence.
- `turnaround`: synthetic 24-frame turnaround from a persona illustration (dev/testing only: no
  real person is ever used to make synthetic frames).
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

from .imaging import luminance
from .twin import check as twin_check
from .twin import subject

MIN_FRAMES = 8
MAX_FRAMES = 32
COVERAGE_BINS = 12  # 30° bins
MIN_COVERAGE = 0.75
MIN_ROTATION = 0.12


def _front_indices(yaws: list[float]) -> list[int]:
    return [i for i, y in enumerate(yaws) if abs(((y + 180) % 360) - 180) <= 40]


def coverage(yaws: list[float]) -> float:
    bins = {int(((y % 360) + 360) % 360 // (360 / COVERAGE_BINS)) for y in yaws}
    return len(bins) / COVERAGE_BINS


def _width_ratio(img: Image.Image) -> float | None:
    mask, box = subject(img)
    if not box:
        return None
    x0, y0, x1, y1 = box
    row = mask[int(y0 + (y1 - y0) * 0.45), x0:x1]
    return float(row.sum()) / max(1, y1 - y0)


def check_frames(frames: list[Image.Image], yaws: list[float]) -> dict:
    checks: dict[str, dict] = {}
    n = len(frames)
    checks["frames"] = {"pass": MIN_FRAMES <= n <= MAX_FRAMES, "note": f"{n} frames" + ("" if n >= MIN_FRAMES else f"; need at least {MIN_FRAMES}")}
    cov = coverage(yaws) if yaws else 0.0
    checks["coverage"] = {"pass": cov >= MIN_COVERAGE, "note": f"{round(cov * 100)}% of the turn" + ("" if cov >= MIN_COVERAGE else "; turn all the way round")}
    lums = []
    for f in frames:
        rgb = np.asarray(f.convert("RGB"), dtype=np.float32)
        mask, _ = subject(f)
        lums.append(float(luminance(rgb)[mask].mean()) if mask.any() else 0.0)
    dark = sum(1 for v in lums if not 30 <= v <= 235)
    checks["lighting"] = {"pass": dark <= n // 6, "note": "Even light all round" if dark <= n // 6 else "Some angles are too dark or too bright"}
    fronts = _front_indices(yaws) or [0]
    front = twin_check(frames[fronts[0]]) if frames else {"checks": {}, "estimated_size": "M"}
    fc = front.get("checks", {})
    checks["framing"] = {"pass": fc.get("full_body", {}).get("pass", False), "note": fc.get("full_body", {}).get("note", "No front frame")}
    checks["single_subject"] = {"pass": fc.get("single_subject", {}).get("pass", False), "note": fc.get("single_subject", {}).get("note", "")}
    widths = [w for w in (_width_ratio(f) for f in frames) if w]
    rot = (max(widths) - min(widths)) / max(widths) if len(widths) >= 2 else 0.0
    checks["rotation"] = {"pass": rot >= MIN_ROTATION, "note": "Turn detected" if rot >= MIN_ROTATION else "We could not see you turn; turn slowly on the spot"}
    return {
        "ok": all(c["pass"] for c in checks.values()),
        "checks": checks,
        "estimated_size": front.get("estimated_size", "M"),
        "coverage": round(cov, 3),
        "rotation": round(rot, 3),
        "front_frames": fronts,
    }


def sample_skin(frames: list[Image.Image], yaws: list[float]) -> dict:
    """Median face colour over front-facing frames → sRGB (0..1). Spread = mean abs deviation (0..1)."""
    px = []
    for i in _front_indices(yaws) or [0]:
        img = frames[i].convert("RGB")
        rgb = np.asarray(img)
        mask, box = subject(img)
        if not box:
            continue
        x0, y0, x1, y1 = box
        hgt = y1 - y0
        cx = (x0 + x1) // 2
        half = max(2, int(hgt * 0.028))
        ya, yb = y0 + int(hgt * 0.085), y0 + int(hgt * 0.165)
        region = rgb[ya:yb, cx - half:cx + half].reshape(-1, 3)
        m = mask[ya:yb, cx - half:cx + half].reshape(-1)
        px.append(region[m])
    if not px or not sum(len(p) for p in px):
        return {"rgb": None, "spread": 1.0, "pixels": 0}
    allpx = np.concatenate(px).astype(np.float64)
    med = np.median(allpx, axis=0)
    # Drop features (eyes/mouth/hair) far from the median, then re-take the median.
    keep = np.abs(allpx - med).max(axis=1) < 40
    if keep.sum() > 10:
        med = np.median(allpx[keep], axis=0)
    spread = float(np.abs(allpx[keep] - med).mean() / 255) if keep.any() else 1.0
    return {"rgb": (med / 255).round(4).tolist(), "spread": round(spread, 4), "pixels": int(keep.sum())}


def turnaround(persona: Image.Image, n: int = 24, size=(480, 854)) -> tuple[list[Image.Image], list[float]]:
    """Synthetic turn: horizontal foreshortening by |cos|, back views mirrored with the face covered by hair."""
    img = persona.convert("RGB")
    rgb = np.asarray(img)
    mask, box = subject(img)
    if not box:
        raise ValueError("Persona has no subject")
    x0, y0, x1, y1 = box
    hgt = y1 - y0
    bg = tuple(int(v) for v in np.median(np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3)]), axis=0))
    hair = tuple(int(v) for v in np.median(rgb[y0 + 2:y0 + int(hgt * 0.03), (x0 + x1) // 2 - 10:(x0 + x1) // 2 + 10].reshape(-1, 3), axis=0))
    cut = img.crop((x0, y0, x1, y1)).convert("RGBA")
    cut.putalpha(Image.fromarray((mask[y0:y1, x0:x1] * 255).astype(np.uint8)))
    back = np.asarray(cut).copy()
    # Cover the face/neck area (skin-coloured pixels in the head band) with hair for back views.
    skin = sample_skin([img], [0.0])["rgb"]
    if skin:
        s = np.array(skin) * 255
        band = slice(0, int(hgt * 0.2))
        head = back[band]
        near = (np.abs(head[..., :3].astype(np.float32) - s).max(axis=-1) < 38) & (head[..., 3] > 0)
        head[near, :3] = hair
        # Close small holes (eyes, mouth) inside the now hair-coloured head so the back view has no face features.
        hairy = (np.abs(head[..., :3].astype(np.int16) - np.array(hair)).max(axis=-1) < 12).astype(np.uint8) * 255
        closed = np.asarray(Image.fromarray(hairy).filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))) > 0
        head[closed & (head[..., 3] > 0), :3] = hair
    back_img = Image.fromarray(back).transpose(Image.FLIP_LEFT_RIGHT)
    frames, yaws = [], []
    W, H = img.size
    for k in range(n):
        yaw = 360.0 * k / n
        c = np.cos(np.radians(yaw))
        src = cut if c >= 0 else back_img
        sx = 0.38 + 0.62 * abs(c)
        w = max(4, int(cut.width * sx))
        part = src.resize((w, cut.height), Image.LANCZOS)
        # Side light falls off as the body turns away from the key light.
        part = ImageEnhance.Brightness(part).enhance(0.86 + 0.14 * abs(c))
        frame = Image.new("RGB", (W, H), bg)
        frame.paste(part, ((W - w) // 2, y0), part)
        frames.append(frame.resize(size, Image.LANCZOS))
        yaws.append(yaw)
    return frames, yaws
