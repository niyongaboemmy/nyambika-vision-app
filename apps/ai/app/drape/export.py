"""GLB + poster export for a draped pattern garment (R4 spike).

Two GLBs share the same geometry:
  * print: the cloth carries the fabric print mapped by panel UVs (pattern metres / tile size, so the
    print keeps its real scale across panels and sizes; REPEAT sampler);
  * heatmap: the cloth carries per-vertex COLOR_0 fit bands (tight / ok / loose / drape).
The body is a static (unskinned) copy of the E33 parametric body; the drape is a rest pose, so no
animation clips are exported. Posters are software renders for phones without WebGL2.
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw

from ..avatar_body import BODYSUIT, EYES, HAIR, SHOES, Body, normals
from ..gltf import GltfBuilder, srgb_to_linear
from . import render
from .solver import DrapeResult

TILE_M = 0.18  # one print repeat = 18 cm of fabric
REPEAT = 10497


def print_tile(hue: float | None = None, size: int = 256) -> Image.Image:
    """Procedural wax-print style tile (synthetic; no third-party artwork)."""
    h = 18.0 if hue is None else float(hue) % 360
    import colorsys

    def rgb(hh, s, v):
        r, g, b = colorsys.hsv_to_rgb((hh % 360) / 360, s, v)
        return int(r * 255), int(g * 255), int(b * 255)
    img = Image.new("RGB", (size, size), rgb(h, 0.72, 0.78))
    d = ImageDraw.Draw(img)
    c = size // 2
    for k, (hh, s, v) in enumerate([(h + 180, 0.65, 0.42), (h + 40, 0.6, 0.96), (h, 0.85, 0.5), (h + 180, 0.4, 0.95)]):
        r = int(size * (0.42 - k * 0.09))
        d.ellipse([c - r, c - r, c + r, c + r], fill=rgb(hh, s, v))
    for cx, cy in ((0, 0), (size, 0), (0, size), (size, size)):
        r = int(size * 0.2)
        d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=rgb(h + 40, 0.6, 0.96))
        r2 = int(size * 0.1)
        d.polygon([(cx, cy - r2), (cx + r2, cy), (cx, cy + r2), (cx - r2, cy)], fill=rgb(h + 180, 0.65, 0.42))
    return img


def tile_from_image(img: Image.Image, size: int = 256) -> Image.Image:
    """Centre square crop of a product cut-out / swatch as the print repeat."""
    im = img.convert("RGBA")
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 10)
    if len(ys):
        im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    w, h = im.size
    s = int(min(w, h) * 0.4)
    box = (w // 2 - s // 2, h // 2 - s // 2, w // 2 + s // 2, h // 2 + s // 2)
    tile = im.crop(box).convert("RGB").resize((size, size), Image.LANCZOS)
    return tile


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _body(g: GltfBuilder, body: Body):
    pos = body.positions
    tris_all = np.concatenate(list(body.groups.values()))
    nrm = normals(pos, tris_all)
    a_pos, a_nrm = g.accessor(pos, minmax=True), g.accessor(nrm)
    skin = [*srgb_to_linear(np.asarray(body.skin_srgb)).tolist(), 1.0]
    mats = {
        "skin": g.material("skin", skin, roughness=0.62),
        "suit": g.material("bodysuit", [*srgb_to_linear(np.array(BODYSUIT)).tolist(), 1], roughness=0.8),
        "hair": g.material("hair", [*srgb_to_linear(np.array(HAIR)).tolist(), 1], roughness=0.95, double_sided=True),
        "eyes": g.material("eyes", [*srgb_to_linear(np.array(EYES)).tolist(), 1], roughness=0.3),
        "shoes": g.material("shoes", [*srgb_to_linear(np.array(SHOES)).tolist(), 1], roughness=0.55),
    }
    prims = [{"attributes": {"POSITION": a_pos, "NORMAL": a_nrm}, "indices": g.indices(t), "material": mats[k], "mode": 4}
             for k, t in body.groups.items()]
    g.root(g.node(name="body", mesh=g.mesh("body", prims)))
    return int(len(tris_all))


def glb(body: Body, r: DrapeResult, extras: dict, tile: Image.Image | None = None, vertex_rgb: np.ndarray | None = None) -> bytes:
    g = GltfBuilder("Nyambika AI Gateway drape spike", extras)
    _body(g, body)
    x = r.x.astype(np.float32)
    tris = r.garment.tris.astype(np.uint32)
    attrs = {"POSITION": g.accessor(x, minmax=True), "NORMAL": g.accessor(normals(x, tris))}
    if vertex_rgb is not None:
        lin = srgb_to_linear(vertex_rgb).astype(np.float32)
        attrs["COLOR_0"] = g.accessor(lin)
        mat = g.material("fit-heatmap", (1, 1, 1, 1), roughness=0.9, double_sided=True)
    else:
        g.gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": REPEAT, "wrapT": REPEAT}]
        attrs["TEXCOORD_0"] = g.accessor((r.garment.uv / TILE_M * np.array([1, -1])).astype(np.float32))
        mat = g.material("fabric-print", texture=_png(tile or print_tile()), roughness=0.85, double_sided=True, sheen=(0.3, 0.28, 0.26))
    prim = {"attributes": attrs, "indices": g.indices(tris), "material": mat, "mode": 4}
    g.root(g.node(name="garment", mesh=g.mesh("garment", [prim])))
    return g.build()


def _inset_body(body: Body, d: float = 0.005) -> Body:
    """Body shrunk along its normals for the painter's-algorithm poster (no z-fighting with the cloth)."""
    tris = np.concatenate(list(body.groups.values()))
    n = normals(body.positions, tris)
    b = Body(m=body.m, skin_srgb=body.skin_srgb)
    b.positions = body.positions - n * d
    b.groups = body.groups
    return b


def face_colours_from_tile(r: DrapeResult, tile: Image.Image) -> np.ndarray:
    arr = np.asarray(tile.convert("RGB"), dtype=np.float64) / 255
    uv = (r.garment.uv[r.garment.tris].mean(axis=1) / TILE_M) % 1.0
    xs = np.clip((uv[:, 0] * (arr.shape[1] - 1)).astype(int), 0, arr.shape[1] - 1)
    ys = np.clip(((1 - uv[:, 1]) * (arr.shape[0] - 1)).astype(int), 0, arr.shape[0] - 1)
    return arr[ys, xs]


def poster(body: Body, r: DrapeResult, face_rgb: np.ndarray, size=(360, 640), yaw: float = -18.0) -> bytes:
    return _png(render.render(_inset_body(body), [(r.x, r.garment.tris, face_rgb)], yaw=yaw, size=size))
