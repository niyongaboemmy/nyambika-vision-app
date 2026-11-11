"""Dress the parametric avatar with an E27 garment (E34, FR-FIT-01/04).

The garment comes from the same try-on cut-out the E27 image-to-3D pipeline uses (silhouette
extents, metre length from the category and size chart, the print as a PBR texture with an
alpha mask for the neckline/hem). Instead of E27's free-standing "lifted panel", the garment is
wrapped around the body:

  1. align: top edge at the shoulder line (dresses, tops) or the waist (skirts);
  2. offset along the body normal by a size-dependent ease (S < M < L relative to the avatar's
     own size), with a minimum clearance so fabric never enters the body;
  3. below the waist the cut-out silhouette drives the flare (A-line, maxi), but never narrower
     than the envelope of both legs + ease (collision against the body);
  4. skinned to the avatar skeleton (torso joints by height, legs by side below the crotch), so
     Idle/Walk/Turn animate the dress with the body.

Sleeves are not modelled (sleeve fabric is cropped: the garment reads as sleeveless on the
avatar). There is no cloth simulation: drape is a geometric approximation. Both are documented.
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image

from . import garment3d
from .avatar_body import J, SIZE_ORDER, Body, _smooth, normals
from .gltf import GltfBuilder

MODEL_VERSION = "wrap-fit@1.0"
FULL = {"dress", "umushanana", "kitenge", "gown", "bridal", "wrap"}
TOPS = {"shirt", "top", "blouse", "jacket", "suit"}
BOTTOMS = {"skirt"}
BASE_EASE = {"full": 0.02, "top": 0.018, "bottom": 0.016}
EASE_STEP = 0.013  # metres of ease per size step
MIN_CLEARANCE = 0.005
ROWS, SEG = 56, 56


def garment_class(category: str | None) -> str:
    c = (category or "dress").lower()
    if c in FULL:
        return "full"
    if c in TOPS:
        return "top"
    if c in BOTTOMS:
        return "bottom"
    raise ValueError(f"3D try-on is not available for '{category}' yet")


def size_ease(size: str, body_size: str, cls: str = "full") -> float:
    """Raw ease (can be negative when the garment is smaller than the body)."""
    def idx(s):
        s = (s or "M").upper()
        return SIZE_ORDER.index(s) if s in SIZE_ORDER else 2
    return BASE_EASE[cls] + EASE_STEP * (idx(size) - idx(body_size))


def fit_label(raw_ease: float) -> str:
    if raw_ease < 0.008:
        return "tight"
    if raw_ease > 0.036:
        return "relaxed"
    return "regular"


class FittedGarment:
    def __init__(self, positions, uvs, tris, joints, weights, texture_png, info):
        self.positions, self.uvs, self.tris = positions, uvs, tris
        self.joints, self.weights = joints, weights
        self.texture_png, self.info = texture_png, info

    def add_to(self, g: GltfBuilder, skin_id: int) -> int:
        mat = g.material("fabric", texture=self.texture_png, roughness=0.86, alpha_mask=True, double_sided=True, sheen=(0.35, 0.33, 0.3))
        prim = {
            "attributes": {
                "POSITION": g.accessor(self.positions, minmax=True),
                "NORMAL": g.accessor(normals(self.positions, self.tris)),
                "TEXCOORD_0": g.accessor(self.uvs),
                "JOINTS_0": g.accessor(self.joints, 5121),
                "WEIGHTS_0": g.accessor(self.weights),
            },
            "indices": g.indices(self.tris), "material": mat, "mode": 4,
        }
        node = g.node(name="garment", mesh=g.mesh("garment", [prim]), skin=skin_id)
        g.root(node)
        return int(len(self.tris))

    def face_colours(self, tex: Image.Image) -> tuple[np.ndarray, np.ndarray]:
        """Per-face sRGB colour + alpha sampled at UV centroids (poster render)."""
        t = tex.convert("RGBA")
        arr = np.asarray(t, dtype=np.float32) / 255
        uv = self.uvs[self.tris].mean(axis=1)
        xs = np.clip((uv[:, 0] * (t.width - 1)).astype(int), 0, t.width - 1)
        ys = np.clip((uv[:, 1] * (t.height - 1)).astype(int), 0, t.height - 1)
        px = arr[ys, xs]
        return px[:, :3], px[:, 3]


def _row_extents(alpha: np.ndarray, rows: int):
    h, _ = alpha.shape
    ys = np.linspace(0, h - 1, rows)
    left, right, _ = garment3d._extents(alpha, ys)
    return ys, left, right


def fit(body: Body, cutout: Image.Image, category: str | None, size: str, body_size: str) -> FittedGarment:
    cls = garment_class(category)
    cut = cutout.convert("RGBA")
    a_full = np.asarray(cut)[..., 3]
    yy, xx = np.nonzero(a_full > 10)
    if len(yy) == 0:
        raise ValueError("Cut-out is empty")
    cut = cut.crop((int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1))
    work = cut.copy()
    work.thumbnail((512, 512), Image.LANCZOS)
    alpha = np.asarray(work)[..., 3]
    h_px, w_px = alpha.shape
    ys_px, left, right = _row_extents(alpha, ROWS)
    half_px = (right - left) / 2
    mid_px = (left + right) / 2

    s = body.H / 1.65
    length = garment3d.garment_height_m(category, size) * s
    y_top = body.y["shoulder"] + 0.004 if cls != "bottom" else body.y["waist"] + 0.02
    y_hem = max(0.08, y_top - length)
    raw = size_ease(size, body_size, cls)
    ease = max(MIN_CLEARANCE, raw)

    # Silhouette reference row: the garment row that lands on the body's waist (narrowest torso).
    ys_m = y_top - (ys_px / (h_px - 1)) * (y_top - y_hem)
    waist_row = int(np.argmin(np.abs(ys_m - body.y["waist"]))) if cls != "bottom" else 0
    ref_half = max(1.0, float(half_px[waist_row]))
    torso_half_px = float(np.quantile(half_px, 0.45))

    th = np.linspace(0, 2 * np.pi, SEG + 1)  # duplicated seam column for UVs
    P, UV = [], []
    a_prev = 0.0
    for r in range(ROWS):
        y = float(ys_m[r])
        ea, eb, ecz = body.envelope(y)
        a = ea + ease
        b = eb + ease
        if y < body.y["waist"] or cls == "bottom":
            flare = float(half_px[r]) / ref_half
            wa, _, _ = body.torso_axes(min(max(y, body.y["crotch"]), body.y["waist"]))
            fa = (body.torso_axes(body.y["waist"])[0] + ease) * flare
            if fa > a:
                b = max(b, b + (fa - a) * 0.75)
                a = fa
            if y < body.y["hips"]:
                a = max(a, a_prev * 0.985)  # fabric falls from the hips; it does not tuck between the legs
        a_prev = a
        cz = ecz
        P.append(np.stack([a * np.cos(th), np.full(SEG + 1, y), cz + b * np.sin(th)], axis=1))
        # Texture: front half maps across the row's silhouette; the back reuses it (mirrored), like E27.
        hw = float(half_px[r]) if y < body.y["waist"] or cls == "bottom" else min(float(half_px[r]), torso_half_px * 1.04)
        u_img = mid_px[r] + np.cos(th) * hw * 0.93  # stay inside the alpha edge so the side seam stays closed
        UV.append(np.stack([u_img / (w_px - 1), np.full(SEG + 1, ys_px[r] / (h_px - 1))], axis=1))
    pos = np.concatenate(P).astype(np.float32)
    uvs = np.clip(np.concatenate(UV), 0, 1).astype(np.float32)
    tris = []
    for r in range(ROWS - 1):
        for c in range(SEG):
            a0 = r * (SEG + 1) + c
            a1, b0 = a0 + 1, a0 + SEG + 1
            b1 = b0 + 1
            # Rows run top → bottom, angle increases: (a0, a1, b0) faces outward.
            tris.append((a0, a1, b0))
            tris.append((a1, b1, b0))
    tris = np.asarray(tris, dtype=np.uint32)

    wj, ww = garment_weights(body, pos)
    # Clearance against the analytic body envelope (same ellipse family the body mesh is built from).
    clear = clearance(body, pos)
    tex = garment3d._texture(cut)
    rows_at = {k: int(np.argmin(np.abs(ys_m - body.y[k]))) for k in ("bust", "waist", "hips") if y_hem <= body.y[k] <= y_top}
    ring_clear = {k: round(float(clear[r * (SEG + 1):(r + 1) * (SEG + 1)].mean()), 4) for k, r in rows_at.items()}
    info = {
        "class": cls, "size": size, "body_size": body_size, "ease_m": round(raw, 4), "fit": fit_label(raw),
        "length_m": round(y_top - y_hem, 3), "min_clearance_m": round(float(clear.min()), 4),
        "mean_clearance_m": round(float(clear.mean()), 4), "ring_clearance_m": ring_clear,
        "model_version": MODEL_VERSION,
    }
    return FittedGarment(pos, uvs, tris, wj, ww, tex, info)


def clearance(body: Body, pos: np.ndarray) -> np.ndarray:
    """Radial distance from the body envelope ellipse to each garment vertex, along the ray from the axis."""
    out = np.empty(len(pos))
    for i, (x, y, z) in enumerate(pos):
        a, b, cz = body.envelope(float(y))
        th = np.arctan2((z - cz) / b, x / a)
        rb = np.hypot(a * np.cos(th), b * np.sin(th))
        out[i] = np.hypot(x, z - cz) - rb
    return out


def garment_weights(body: Body, pos: np.ndarray):
    y = pos[:, 1]
    yc = body.y
    chain = [("hips", yc["hips"]), ("spine", yc["waist"]), ("chest", yc["bust"]), ("neck", yc["neck"])]
    cy = np.array([c[1] for c in chain])
    ci = np.array([J[c[0]] for c in chain])
    seg_i = np.clip(np.searchsorted(cy, y) - 1, 0, len(cy) - 2)
    tt = np.clip((y - cy[seg_i]) / (cy[seg_i + 1] - cy[seg_i]), 0, 1)
    w_up = _smooth(tt)
    side = pos[:, 0] > 0
    a_hips = body.torso_axes(yc["hips"])[0]
    w_leg = _smooth((yc["crotch"] + 0.05 - y) / 0.35) * _smooth(np.abs(pos[:, 0]) / (a_hips * 0.9)) * 0.7
    a_sh = body.torso_axes(yc["shoulder"])[0]
    w_sh = _smooth((np.abs(pos[:, 0]) / a_sh - 0.6) / 0.4) * _smooth((y - yc["armpit"]) / (yc["shoulder"] - yc["armpit"])) * 0.5
    rest = 1 - w_leg - w_sh
    wj = np.zeros((len(pos), 4), dtype=np.uint8)
    ww = np.zeros((len(pos), 4), dtype=np.float32)
    wj[:, 0], ww[:, 0] = ci[seg_i], rest * (1 - w_up)
    wj[:, 1], ww[:, 1] = ci[seg_i + 1], rest * w_up
    wj[:, 2], ww[:, 2] = np.where(side, J["upleg_L"], J["upleg_R"]), w_leg
    wj[:, 3], ww[:, 3] = np.where(side, J["shoulder_L"], J["shoulder_R"]), w_sh
    ww /= np.maximum(ww.sum(axis=1, keepdims=True), 1e-9)
    return wj, ww


def texture_image(g: FittedGarment) -> Image.Image:
    return Image.open(io.BytesIO(g.texture_png))
