"""Heuristic photo-twin capture checks (US-06.1). No ML: silhouette from background difference."""
import numpy as np
from PIL import Image

from .imaging import bbox, component_areas, downsample_mask, foreground_mask, luminance

MIN_SHORT_SIDE = 480
SIZE_THRESHOLDS = [(0.131, "S"), (0.146, "M"), (0.175, "L")]  # torso width / body height, calibrated on personas


def subject(img: Image.Image):
    """Return (mask, bbox) of the person silhouette."""
    mask = foreground_mask(img.convert("RGB"))
    return mask, bbox(mask)


def torso_run(mask: np.ndarray, box, frac: float = 0.38) -> tuple[int, int]:
    """Contiguous foreground run through the body centre at a given height fraction."""
    x0, y0, x1, y1 = box
    row = mask[min(mask.shape[0] - 1, int(y0 + (y1 - y0) * frac))]
    cx = (x0 + x1) // 2
    if not row[cx]:
        xs = np.nonzero(row)[0]
        if len(xs) == 0:
            return cx, cx
        cx = int(xs[np.argmin(np.abs(xs - cx))])
    left = cx
    while left > 0 and row[left - 1]:
        left -= 1
    right = cx
    while right < len(row) - 1 and row[right + 1]:
        right += 1
    return left, right + 1


def check(img: Image.Image) -> dict:
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[:2]
    checks = {}

    ok_res = min(w, h) >= MIN_SHORT_SIDE
    checks["resolution"] = {"pass": ok_res, "note": f"{w}x{h}" + ("" if ok_res else f"; need ≥{MIN_SHORT_SIDE}px")}
    checks["portrait"] = {"pass": h / w >= 1.2, "note": "Hold the phone upright" if h / w < 1.2 else "Upright frame"}

    mask, box = subject(img)
    lum = luminance(rgb.astype(np.float32))
    subj_lum = float(lum[mask].mean()) if mask.any() else 0.0
    contrast = float(np.percentile(lum, 95) - np.percentile(lum, 5))
    lit = 35 <= subj_lum <= 235 and contrast >= 50
    checks["lighting"] = {"pass": lit, "note": "Good light" if lit else "Move to brighter, even light"}

    small, scale = downsample_mask(mask, 160)
    areas = component_areas(small)
    big = [a for a in areas if a >= 0.015 * small.size]
    single = len(big) == 1
    checks["single_subject"] = {
        "pass": single,
        "note": "One person in frame" if single else f"Found {len(big)} subjects; only you should be in frame",
    }

    height_ratio = 0.0
    size = "M"
    if box:
        x0, y0, x1, y1 = box
        height_ratio = (y1 - y0) / h
        left, right = torso_run(mask, box)
        width_ratio = (right - left) / max(1, y1 - y0)
        size = next((s for t, s in SIZE_THRESHOLDS if width_ratio < t), "XL")
    full = height_ratio >= 0.70
    checks["full_body"] = {"pass": full, "note": "Head to feet visible" if full else "Step back so your whole body is visible"}

    return {
        "ok": all(c["pass"] for c in checks.values()),
        "checks": checks,
        "estimated_size": size,
        "height_ratio": round(height_ratio, 3),
    }
