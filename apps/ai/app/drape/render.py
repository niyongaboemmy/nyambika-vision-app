"""Tiny software rasteriser for drape posters / spike-report figures (PIL, painter's algorithm)."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw

from ..avatar_body import Body


def _rot_y(deg: float) -> np.ndarray:
    a = np.radians(deg)
    return np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])


def render(body: Body | None, layers: list[tuple[np.ndarray, np.ndarray, np.ndarray]], yaw: float = 0.0,
           size: tuple[int, int] = (360, 640), bg=(18, 15, 25)) -> Image.Image:
    """layers: (positions (n,3), tris (t,3), per-face sRGB colour (t,3) in 0..1). Orthographic, camera on +z."""
    R = _rot_y(yaw)
    polys, depth, cols = [], [], []
    light = np.array([-0.35, 0.45, 0.82])
    light /= np.linalg.norm(light)
    allL = list(layers)
    if body is not None:
        tris = np.concatenate(list(body.groups.values()))
        skin = np.asarray(body.skin_srgb)
        col = np.tile(skin, (len(tris), 1))
        off = 0
        cols_b = []
        for k, t in body.groups.items():
            c = {"suit": (0.2, 0.19, 0.24), "hair": (0.12, 0.09, 0.07), "shoes": (0.12, 0.1, 0.1), "eyes": (0.06, 0.05, 0.04)}.get(k, tuple(skin))
            cols_b.append(np.tile(c, (len(t), 1)))
            off += len(t)
        col = np.concatenate(cols_b)
        allL = [(body.positions.astype(np.float64), tris, col)] + allL
    pts_all = np.concatenate([p for p, _, _ in allL]) @ R.T
    lo, hi = pts_all.min(axis=0), pts_all.max(axis=0)
    W, H = size
    scale = 0.9 * min(W / max(hi[0] - lo[0], 1e-6), H / max(hi[1] - lo[1], 1e-6))
    cx, cy = (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2
    for pos, tris, col in allL:
        P = pos @ R.T
        v0, v1, v2 = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
        n = np.cross(v1 - v0, v2 - v0)
        nl = np.linalg.norm(n, axis=1, keepdims=True)
        n = n / np.maximum(nl, 1e-12)
        shade = 0.35 + 0.65 * np.abs(n @ light)
        c = np.clip(np.asarray(col) * shade[:, None], 0, 1)
        xy = np.stack([(P[:, 0] - cx) * scale + W / 2, H / 2 - (P[:, 1] - cy) * scale], axis=1)
        polys.append(xy[tris])
        depth.append((v0[:, 2] + v1[:, 2] + v2[:, 2]) / 3)
        cols.append(c)
    polys = np.concatenate(polys)
    depth = np.concatenate(depth)
    cols = (np.concatenate(cols) * 255).astype(np.uint8)
    img = Image.new("RGB", size, bg)
    d = ImageDraw.Draw(img)
    for i in np.argsort(depth):
        d.polygon([tuple(p) for p in polys[i]], fill=tuple(cols[i]))
    return img


def png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def sheet(images: list[Image.Image]) -> Image.Image:
    w = sum(i.width for i in images)
    h = max(i.height for i in images)
    out = Image.new("RGB", (w, h))
    x = 0
    for i in images:
        out.paste(i, (x, 0))
        x += i.width
    return out
