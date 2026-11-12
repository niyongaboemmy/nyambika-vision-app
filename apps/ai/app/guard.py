"""Runtime quality and fairness guard (AI-GD-01..05).

identity_similarity: 1 - mean abs diff of the head region (top 16% of the subject).
skin_tone_delta:     mean colour shift of visible skin outside the garment (twin pixels close to the skin tone
                     sampled at the neck; falls back to all visible body pixels when too little skin shows).
                     Pixels the provider deliberately edited (old clothing hidden) are excluded.
garment_fidelity:    HSV histogram intersection, garment cut-out vs rendered garment.
placement (when the garment category is known): the rendered garment box against body landmarks:
                     collar near the neck base (skirts: waistband near the waist), hem inside the class band,
                     width relative to the shoulders, centred on the body -> `placement_implausible`;
                     rendered aspect vs cut-out aspect beyond what wrapping explains -> `garment_distorted`.
"""
import numpy as np
from PIL import Image

from . import config
from .garment import resolve_category
from .imaging import bbox
from .landmarks import PLACEMENT, landmarks
from .twin import subject

# Plausibility limits (fractions of body height / shoulder width). Generous: they catch a garment of the
# wrong class or a broken placement, not a slightly long shirt.
ANCHOR_TOL = 0.07
SKIRT_TOP = (0.30, 0.52)
WIDTH_RANGE = (0.7, 3.4)
CENTRE_TOL = 0.25
ASPECT_RANGE = (0.6, 1.6)


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
    category: str | None = None,
    edit_mask: np.ndarray | None = None,
) -> dict:
    """`twin` and `output` must be the same size. `garment` is the cut-out (RGBA).

    `category` (catalogue text) enables the placement check; `edit_mask` marks pixels the provider changed on
    purpose outside the garment (hidden old clothing)."""
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
    if edit_mask is not None and edit_mask.shape == body.shape:
        body &= ~edit_mask
    if exclude_box:
        ex0, ey0, ex1, ey1 = exclude_box
        body[ey0:ey1, ex0:ex1] = False
    skin = body & _skin_like(a, mask, box)
    region = skin if skin.sum() >= 200 else body
    skin_delta = float(np.abs(a[region].mean(axis=0) - b[region].mean(axis=0)).mean() / 255) if region.any() else 0.0

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
    placement = None
    if category is not None:
        placement = check_placement(mask, box, garment_alpha, g, category)
        reasons += placement["reasons"]
    out = {
        "passed": not reasons,
        "identity_similarity": round(identity, 4),
        "skin_tone_delta": round(skin_delta, 4),
        "garment_fidelity": round(fidelity, 4),
        "reasons": reasons,
    }
    if placement is not None:
        out["placement"] = {k: v for k, v in placement.items() if k != "reasons"}
    return out


def _skin_like(rgb: np.ndarray, mask: np.ndarray, box) -> np.ndarray:
    """Twin pixels close to the skin tone sampled on the neck (just under the head)."""
    x0, y0, x1, y1 = box
    hgt = y1 - y0
    cx = (x0 + x1) // 2
    ny0, ny1 = y0 + int(0.15 * hgt), y0 + int(0.18 * hgt)
    patch = rgb[ny0:ny1, max(0, cx - max(1, hgt // 120)): cx + max(1, hgt // 120) + 1].reshape(-1, 3)
    patch = patch[mask[ny0:ny1, max(0, cx - max(1, hgt // 120)): cx + max(1, hgt // 120) + 1].reshape(-1)]
    if len(patch) < 3:
        return np.zeros(mask.shape, dtype=bool)
    tone = np.median(patch, axis=0)
    return mask & (np.abs(rgb - tone).max(axis=-1) <= 18)


def check_placement(mask: np.ndarray, box, garment_alpha: np.ndarray, cutout: np.ndarray, category: str) -> dict:
    """Placement plausibility of the rendered garment for its class (top / skirt / dress)."""
    cut_img = Image.fromarray(cutout)
    cb = bbox(cutout[..., 3] > 127)
    cls, source = resolve_category(category, cut_img.crop(cb) if cb else None)
    gb = bbox(garment_alpha > 0.5)
    res = {"class": cls, "class_source": source, "reasons": []}
    if gb is None or cb is None:
        res["reasons"].append("placement_implausible")
        return res
    body = landmarks(mask, box)
    H = body.height
    top, hem = body.frac(gb[1]), body.frac(gb[3])
    width = (gb[2] - gb[0]) / max(1, body.shoulder_w)
    centre = abs((gb[0] + gb[2]) / 2 - body.cx) / max(1, body.shoulder_w)
    aspect = ((gb[3] - gb[1]) / max(1, gb[2] - gb[0])) / ((cb[3] - cb[1]) / max(1, cb[2] - cb[0]))
    lo, hi = PLACEMENT[cls]["hem"]
    if PLACEMENT[cls]["anchor"] == "neck":
        anchor_ok = abs(gb[1] - body.neck_y) <= ANCHOR_TOL * H
    else:
        anchor_ok = SKIRT_TOP[0] <= top <= SKIRT_TOP[1]
    checks = {
        "anchor": bool(anchor_ok),
        "hem": bool(lo <= hem <= hi),
        "width": bool(WIDTH_RANGE[0] <= width <= WIDTH_RANGE[1]),
        "centred": bool(centre <= CENTRE_TOL),
    }
    res.update(top=round(top, 3), hem=round(hem, 3), width_over_shoulders=round(width, 3),
               aspect_ratio=round(aspect, 3), checks=checks)
    if not all(checks.values()):
        res["reasons"].append("placement_implausible")
    if not ASPECT_RANGE[0] <= aspect <= ASPECT_RANGE[1]:
        res["reasons"].append("garment_distorted")
    return res


__all__ = ["evaluate", "bbox"]
