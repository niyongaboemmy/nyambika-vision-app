"""Server-side poster render for avatars (FR-AVA-04 low-end fallback, viewer poster).

Painter's-algorithm rasteriser on PIL: orthographic camera at a yaw angle, Lambert key + fill
light, per-face colour (material colour or the garment texture sampled at the face's UV
centroid), 2x supersampling, studio floor shadow, transparent background, WebP out.
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

KEY = np.array([-0.45, 0.55, 0.7])
KEY = KEY / np.linalg.norm(KEY)
FILL = np.array([0.6, 0.2, 0.5])
FILL = FILL / np.linalg.norm(FILL)


def render(layers: list[dict], size=(480, 720), yaw_deg: float = 18.0, quality: int = 82) -> bytes:
    """layers: [{positions (N,3), tris (M,3), colour (3,) sRGB 0..1 | face_colours (M,3), two_sided}]"""
    W, Hh = size[0] * 2, size[1] * 2
    yaw = np.radians(yaw_deg)
    R = np.array([[np.cos(yaw), 0, np.sin(yaw)], [0, 1, 0], [-np.sin(yaw), 0, np.cos(yaw)]])
    allp = np.concatenate([lay["positions"] for lay in layers]) @ R.T
    lo, hi = allp.min(axis=0), allp.max(axis=0)
    scale = min(W * 0.8 / max(hi[0] - lo[0], 1e-6), Hh * 0.86 / max(hi[1] - lo[1], 1e-6))
    cx = (lo[0] + hi[0]) / 2
    faces = []
    for lay in layers:
        p = lay["positions"] @ R.T
        t = lay["tris"]
        v0, v1, v2 = p[t[:, 0]], p[t[:, 1]], p[t[:, 2]]
        n = np.cross(v1 - v0, v2 - v0)
        ln = np.linalg.norm(n, axis=1, keepdims=True)
        n = n / np.where(ln == 0, 1, ln)
        facing = n[:, 2] > 0
        if lay.get("two_sided"):
            n = np.where(facing[:, None], n, -n)
            keep = np.ones(len(t), dtype=bool)
        else:
            keep = facing
        lam = 0.32 + 0.62 * np.clip(n @ KEY, 0, 1) + 0.18 * np.clip(n @ FILL, 0, 1)
        col = lay["face_colours"] if "face_colours" in lay else np.tile(np.asarray(lay["colour"]), (len(t), 1))
        rgb = np.clip(col * lam[:, None], 0, 1)
        depth = (v0[:, 2] + v1[:, 2] + v2[:, 2]) / 3
        sx = lambda v: (v[:, 0] - cx) * scale + W / 2  # noqa: E731
        sy = lambda v: Hh * 0.93 - (v[:, 1] - lo[1]) * scale  # noqa: E731
        pts = np.stack([sx(v0), sy(v0), sx(v1), sy(v1), sx(v2), sy(v2)], axis=1)
        alpha = lay.get("alpha")
        for i in np.nonzero(keep)[0]:
            if alpha is not None and alpha[i] < 0.5:
                continue
            faces.append((depth[i], pts[i], rgb[i]))
    faces.sort(key=lambda f: f[0])
    img = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    # Floor shadow first (soft ellipse under the feet).
    sh = Image.new("L", (W, Hh), 0)
    fw = (hi[0] - lo[0]) * scale * 0.7
    ImageDraw.Draw(sh).ellipse((W / 2 - fw / 2, Hh * 0.93 - 18, W / 2 + fw / 2, Hh * 0.93 + 22), fill=120)
    shadow = Image.new("RGBA", (W, Hh), (0, 0, 0, 255))
    shadow.putalpha(sh.filter(ImageFilter.GaussianBlur(16)))
    img = Image.alpha_composite(img, shadow)
    d = ImageDraw.Draw(img)
    for _, p, c in faces:
        fill = tuple(int(x * 255) for x in c) + (255,)
        d.polygon([(p[0], p[1]), (p[2], p[3]), (p[4], p[5])], fill=fill, outline=fill)
    out = img.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="WEBP", quality=quality, method=4)
    return buf.getvalue()


def body_layers(body) -> list[dict]:
    from .avatar_body import BODYSUIT, EYES, HAIR, SHOES

    colours = {"skin": body.skin_srgb, "suit": BODYSUIT, "hair": HAIR, "eyes": EYES, "shoes": SHOES}
    return [{"positions": body.positions, "tris": tris.astype(np.int64), "colour": np.asarray(colours[k])} for k, tris in body.groups.items()]
