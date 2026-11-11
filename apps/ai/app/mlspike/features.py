"""Features for the attribute spike: the existing Snap embedding (64-d colour + texture) plus a shape code.

No downloads: everything comes from the readiness pipeline's own primitives (foreground mask, HSV
histogram, gradient texture). The production version would replace this with the frozen image encoder
of an open vision model (see the spike report) and keep the same heads.
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from ..embed import embed_image
from ..imaging import bbox, foreground_mask

SHAPE_GRID = (10, 8)  # rows, cols of the occupancy code
FEATURES_VERSION = "snap64+shape82+tone8/1"


def _shape(mask: np.ndarray) -> np.ndarray:
    box = bbox(mask)
    if not box:
        return np.zeros(SHAPE_GRID[0] * SHAPE_GRID[1] + 2)
    x0, y0, x1, y1 = box
    crop = mask[y0:y1, x0:x1].astype(np.uint8) * 255
    small = np.asarray(Image.fromarray(crop).resize((SHAPE_GRID[1], SHAPE_GRID[0]), Image.BILINEAR), dtype=np.float64) / 255
    h, w = mask.shape
    return np.concatenate([small.ravel(), [(y1 - y0) / max(1, x1 - x0) / 2, (y1 - y0) * (x1 - x0) / (h * w)]])


def _tone(img: Image.Image, mask: np.ndarray) -> np.ndarray:
    """Foreground colour moments, normalised by the background so low light shifts both."""
    rgb = np.asarray(img.convert("RGB"), dtype=np.float64)
    fg = rgb[mask] if mask.any() else rgb.reshape(-1, 3)
    bg = rgb[~mask] if (~mask).any() else np.full((1, 3), 240.0)
    bg_lum = float(bg.mean()) or 1.0
    rel = fg.mean(axis=0) / bg_lum
    hsv = np.asarray(img.convert("HSV"), dtype=np.float64)[mask] if mask.any() else np.zeros((1, 3))
    ang = hsv[:, 0] / 255 * 2 * np.pi
    sat = hsv[:, 1] / 255
    return np.array([*rel, float(np.mean(np.cos(ang) * sat)), float(np.mean(np.sin(ang) * sat)), float(sat.mean()),
                     float(fg.std() / 64), float(np.median(fg, axis=0).mean() / bg_lum)])


def features(img: Image.Image) -> np.ndarray:
    img = img.convert("RGB")
    if max(img.size) > 200:
        img = img.copy()
        img.thumbnail((160, 200))
    mask = foreground_mask(img)
    if mask.sum() < 50:
        mask = np.ones(mask.shape, dtype=bool)
    emb, _ = embed_image(img)
    return np.concatenate([np.asarray(emb), _shape(mask), _tone(img, mask)])
