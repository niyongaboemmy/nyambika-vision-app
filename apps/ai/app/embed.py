"""Deterministic 64-d image embedding for Snap visual search (pgvector cosine).

48 dims: HSV colour histogram over foreground pixels (12 hue x 2 sat x 2 val).
16 dims: texture (8-bin gradient-orientation histogram + gradient/Laplacian
energy at 4 scales), so kitenge prints with similar motifs score close.
A real CLIP-style encoder can replace this behind the same endpoint.
"""
import numpy as np
from PIL import Image

from .imaging import dominant_colours, foreground_mask

DIM = 64
COLOUR_WEIGHT = 0.85
TEXTURE_WEIGHT = 0.15


def _colour_hist(hsv: np.ndarray, mask: np.ndarray) -> np.ndarray:
    px = hsv[mask].astype(np.int32)
    if len(px) == 0:
        return np.zeros(48)
    h = px[:, 0] * 12 // 256
    s = (px[:, 1] >= 90).astype(np.int32)
    v = (px[:, 2] >= 128).astype(np.int32)
    hist = np.bincount(h * 4 + s * 2 + v, minlength=48).astype(np.float64)
    return hist / (np.linalg.norm(hist) or 1.0)


def _texture(gray: np.ndarray, mask: np.ndarray) -> np.ndarray:
    feats = []
    gy, gx = np.gradient(gray)
    mag = np.hypot(gx, gy)[mask]
    ang = (np.arctan2(gy, gx)[mask] % np.pi) / np.pi
    hist = np.bincount(np.minimum((ang * 8).astype(int), 7), weights=mag, minlength=8)
    feats.extend(hist / (hist.sum() or 1.0))
    img = Image.fromarray(gray.astype(np.uint8))
    m_img = Image.fromarray(mask.astype(np.uint8) * 255)
    for scale in (1, 2, 4, 8):
        size = (max(8, gray.shape[1] // scale), max(8, gray.shape[0] // scale))
        g = np.asarray(img.resize(size, Image.BILINEAR), dtype=np.float64)
        m = np.asarray(m_img.resize(size, Image.NEAREST)) > 127
        gy, gx = np.gradient(g)
        lap = np.abs(np.gradient(gy, axis=0) + np.gradient(gx, axis=1))
        feats.append(float(np.hypot(gx, gy)[m].mean()) / 64 if m.any() else 0.0)
        feats.append(float(lap[m].mean()) / 32 if m.any() else 0.0)
    vec = np.array(feats)
    return vec / (np.linalg.norm(vec) or 1.0)


def embed_image(img: Image.Image) -> tuple[list[float], list[str]]:
    img = img.copy()
    img.thumbnail((256, 256), Image.BILINEAR)
    mask = foreground_mask(img)
    if mask.sum() < 50:
        mask = np.ones(mask.shape, dtype=bool)
    rgb = np.asarray(img.convert("RGB"))
    hsv = np.asarray(img.convert("RGB").convert("HSV"))
    gray = np.asarray(img.convert("L"), dtype=np.float64)
    vec = np.concatenate([_colour_hist(hsv, mask) * COLOUR_WEIGHT, _texture(gray, mask) * TEXTURE_WEIGHT])
    vec = vec / (np.linalg.norm(vec) or 1.0)
    return [round(float(v), 6) for v in vec], dominant_colours(rgb, mask)


def cosine(a, b) -> float:
    a, b = np.asarray(a), np.asarray(b)
    return float(a @ b / ((np.linalg.norm(a) * np.linalg.norm(b)) or 1.0))
