"""Runtime quality and fairness guard (AI-GD-01..05).

identity_similarity: 1 - mean abs diff of the head region (top 16% of the subject).
skin_tone_delta:     mean colour shift of visible body pixels outside the garment.
garment_fidelity:    HSV histogram intersection, garment cut-out vs rendered garment.
"""
import numpy as np
from PIL import Image

from . import config
from .imaging import bbox
from .twin import subject


def _hsv_hist(px_rgb: np.ndarray) -> np.ndarray:
    if len(px_rgb) == 0:
        return np.zeros(72)
    hsv = np.asarray(Image.fromarray(px_rgb.reshape(1, -1, 3).astype(np.uint8)).convert("HSV")).reshape(-1, 3)
    h = hsv[:, 0].astype(int) * 8 // 256
    s = np.minimum(hsv[:, 1].astype(int) * 3 // 256, 2)
    v = np.minimum(hsv[:, 2].astype(int) * 3 // 256, 2)
    hist = np.bincount(h * 9 + s * 3 + v, minlength=72).astype(np.float64)
    return hist / hist.sum()


def _dilate(mask: np.ndarray, r: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(r):
        m = out.copy()
        m[1:] |= out[:-1]
        m[:-1] |= out[1:]
        m[:, 1:] |= out[:, :-1]
        m[:, :-1] |= out[:, 1:]
        out = m
    return out


def evaluate(
    twin: Image.Image,
    output: Image.Image,
    garment: Image.Image,
    garment_alpha: np.ndarray | None,
    subject_box=None,
    exclude_box=None,
) -> dict:
    """`twin` and `output` must be the same size. `garment` is the cut-out (RGBA)."""
    a = np.asarray(twin.convert("RGB"), dtype=np.float32)
    b = np.asarray(output.convert("RGB"), dtype=np.float32)
    mask, box = subject(twin)
    box = subject_box or box
    reasons = []
    if box is None:
        return {"passed": False, "identity_similarity": 0.0, "skin_tone_delta": 1.0,
                "garment_fidelity": 0.0, "reasons": ["no_subject"]}
    x0, y0, x1, y1 = box

    head_y1 = y0 + int(0.16 * (y1 - y0))
    head = np.zeros(mask.shape, dtype=bool)
    head[y0:head_y1, x0:x1] = True
    head &= mask
    identity = 1.0 - float(np.abs(a[head] - b[head]).mean() / 255) if head.any() else 0.0

    if garment_alpha is None:
        garment_alpha = (np.abs(a - b).max(axis=-1) > 24).astype(np.float32)
    footprint = _dilate(garment_alpha > 0.02, 12)
    body = mask & ~footprint & ~head
    if exclude_box:
        ex0, ey0, ex1, ey1 = exclude_box
        body[ey0:ey1, ex0:ex1] = False
    skin_delta = float(np.abs(a[body].mean(axis=0) - b[body].mean(axis=0)).mean() / 255) if body.any() else 0.0

    g = np.asarray(garment.convert("RGBA"))
    g_px = g[..., :3][g[..., 3] > 230]
    rendered = b[garment_alpha > 0.9]
    if len(g_px) and len(rendered):
        fidelity = float(np.minimum(_hsv_hist(g_px), _hsv_hist(rendered)).sum())
    else:
        fidelity = 0.0

    if identity < config.GUARD_MIN_IDENTITY:
        reasons.append("identity_drift")
    if skin_delta > config.GUARD_MAX_SKIN_DELTA:
        reasons.append("skin_tone_shift")
    if fidelity < config.GUARD_MIN_FIDELITY:
        reasons.append("garment_fidelity_low")
    return {
        "passed": not reasons,
        "identity_similarity": round(identity, 4),
        "skin_tone_delta": round(skin_delta, 4),
        "garment_fidelity": round(fidelity, 4),
        "reasons": reasons,
    }


__all__ = ["evaluate", "bbox"]
