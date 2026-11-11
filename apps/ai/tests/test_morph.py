"""Live morph transforms (E23): colour keeps the print, length/sleeve geometry, alpha, guard on personas."""
import base64
import io

import numpy as np
import pytest
from PIL import Image

from app import morph

from .conftest import b64


def _cut(client, path) -> Image.Image:
    r = client.post("/v1/garment/assess", json={"image_b64": b64(path)}).json()
    return Image.open(io.BytesIO(base64.b64decode(r["cutout_b64"]))).convert("RGBA")


@pytest.fixture(scope="module")
def dress(client, assets):
    return _cut(client, assets / "dress-terracotta-circles.png")


@pytest.fixture(scope="module")
def zigzag(client, assets):
    return _cut(client, assets / "dress-indigo-zigzag.png")


def _hsv(img):
    a = np.asarray(img.convert("RGBA")).astype(np.float64) / 255
    return morph._rgb_to_hsv(a[..., :3]), a[..., 3]


def _circ_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


@pytest.mark.parametrize("hue", [0, 95, 210, 300])
def test_recolour_keeps_pattern_and_value(dress, hue):
    out = morph.recolour(dress, hue)
    (h0, a0), (h1, a1) = _hsv(dress), _hsv(out)
    m = a0 > 0.5
    # Alpha untouched, value (light/dark structure) and saturation preserved per pixel.
    assert np.array_equal(np.asarray(dress)[..., 3], np.asarray(out)[..., 3])
    assert np.abs(h0[..., 2][m] - h1[..., 2][m]).max() <= 2 / 255
    assert np.abs(h0[..., 1][m] - h1[..., 1][m]).mean() < 0.01
    # The print is still there: value maps correlate almost perfectly, motif pixels stay motif pixels.
    assert np.corrcoef(h0[..., 2][m], h1[..., 2][m])[0, 1] > 0.99
    motif0 = h0[..., 1][m] < 0.45
    motif1 = h1[..., 1][m] < 0.45
    assert (motif0 == motif1).mean() > 0.98
    # The dominant colour landed on the requested hue.
    assert _circ_diff(morph.dominant_hue(out), hue) < 4


def test_recolour_relative_hues_survive(zigzag):
    """Multi-colour prints keep their hue relationships (rotation, not flood fill)."""
    out = morph.recolour(zigzag, 30)
    (h0, a0), (h1, _) = _hsv(zigzag), _hsv(out)
    m = (a0 > 0.5) & (h0[..., 1] > 0.25)
    rot = (h1[..., 0][m] - h0[..., 0][m]) % 1.0
    assert np.std(np.minimum(rot, 1 - rot)) < 0.02


def _extent(img):
    a = np.asarray(img)[..., 3] > 127
    ys = np.where(a.any(axis=1))[0]
    return ys[0], ys[-1], a


def test_length_geometry(dress):
    top0, bot0, a0 = _extent(dress)
    gh = bot0 - top0 + 1
    heights = {}
    for target in morph.LENGTHS:
        r = morph.morph(dress, "dress", length=target)
        top, bot, a = _extent(r["cutout"])
        heights[target] = bot - top + 1
        expected = gh * morph.HEM[target] / morph.HEM["knee"]
        assert abs(heights[target] - expected) <= max(4, 0.02 * expected), target
        fx0, fy0, fx1, fy1 = r["frame"]
        assert (fx1 - fx0, fy1 - fy0) == dress.size  # frame = the original garment
        # Everything above the new hem band (and the waist) is untouched.
        keep = min(bot, bot0) - 14
        assert np.array_equal(a[top:keep, fx0:fx1], a0[top0:keep])
    assert heights["mini"] < heights["knee"] < heights["midi"] < heights["maxi"]


def test_maxi_continues_flare_and_print(dress):
    r = morph.morph(dress, "dress", length="maxi")
    out = np.asarray(r["cutout"])
    _, bot0, a0 = _extent(dress)
    _, bot, a = _extent(r["cutout"])
    hem0 = a0[bot0 - 12].sum()
    assert a[bot - 12].sum() > hem0 * 1.1  # wider at the new hem: A-line flare continued
    # New rows are fully opaque fabric with the same colours as the skirt (no smearing).
    fx0 = r["frame"][0]
    ext = out[bot0 + 20:bot - 20]
    opaque = ext[..., 3] > 127
    assert opaque.sum() > 0
    src = np.asarray(dress)[..., :3][a0][::7]
    new = ext[..., :3][opaque][::7]
    assert abs(new.mean() - src.mean()) < 12
    del fx0


def test_sleeve_geometry(dress):
    p = morph._profile(np.asarray(dress)[..., 3] > 127)
    assert p["has_sleeves"]
    cx, torso, top = p["cx"], p["torso"], p["top"]

    def sleeve_px(img, upto=None):
        a = np.asarray(img)[..., 3] > 127
        xs = np.abs(np.arange(a.shape[1]) - cx) > torso + 3
        rows = slice(top, upto or top + int(0.42 * p["height"]))
        return int((a[rows] & xs[None, :]).sum()), a

    base, _ = sleeve_px(dress)
    none, _ = sleeve_px(morph.morph(dress, "dress", sleeve="sleeveless")["cutout"])
    elbow_img = morph.morph(dress, "dress", sleeve="elbow")["cutout"]
    long_img = morph.morph(dress, "dress", sleeve="long")["cutout"]
    # Restrict to rows above the skirt flare for the longer sleeves too.
    elbow, _ = sleeve_px(elbow_img, top + int(0.42 * p["height"]))
    assert base > 500
    assert none < base * 0.05
    assert elbow > base

    def lowest_sleeve_row(img):
        a = np.asarray(img)[..., 3] > 127
        half = np.abs(np.arange(a.shape[1]) - cx)
        # Sleeve pixels: separated from the bodice by a gap (arm side), above the hem.
        rows = [y for y in range(top, top + int(0.7 * p["height"])) if (a[y] & (half > torso + 25) & (half < torso + 140)).any()
                and not a[y][(half > torso + 4) & (half < torso + 10)].all()]
        return max(rows) if rows else top

    assert lowest_sleeve_row(long_img) > lowest_sleeve_row(elbow_img) > top + int(0.25 * p["height"])
    # Bodice and skirt are never painted over.
    a0 = np.asarray(dress)
    for img in (elbow_img, long_img):
        a1 = np.asarray(img)
        assert np.array_equal(a1[a0[..., 3] > 127, 3], a0[a0[..., 3] > 127, 3])


def test_alpha_preserved_and_binary_edges(dress):
    r = morph.morph(dress, "dress", hue=140, length="midi", sleeve="long")
    out = np.asarray(r["cutout"])
    assert out.shape[2] == 4
    alpha = out[..., 3]
    assert alpha.min() == 0 and alpha.max() == 255
    # Original soft edges survive where the garment was not reshaped.
    fx0 = r["frame"][0]
    a0 = np.asarray(dress)[..., 3]
    top0, _, _ = _extent(dress)
    band = slice(top0, top0 + 20)
    assert np.array_equal(alpha[band, fx0:fx0 + dress.width], a0[band])


def test_morph_endpoint_and_guard_passes_on_personas(client, assets, dress):
    from .conftest import b64_image

    cut_b64 = b64_image(dress)
    specs = [
        {"hue": 220},
        {"length": "mini", "sleeve": "sleeveless"},
        {"hue": 150, "length": "maxi", "sleeve": "long"},
        {"length": "midi", "sleeve": "elbow", "hue": 45},
    ]
    for i, spec in enumerate(specs):
        m = client.post("/v1/garment/morph", json={"cutout_b64": cut_b64, "category": "dress", **spec}).json()
        assert set(m["applied"]) == set(spec)
        for p in range(1, 6):
            r = client.post("/v1/tryon", json={"twin_b64": b64(assets / f"persona-{p}.png"), "garment_b64": m["cutout_b64"],
                                               "garment_category": "dress", "garment_frame": m["frame"],
                                               "request_id": f"morph-{i}-{p}"}).json()
            assert r["status"] == "DELIVERED", (spec, p, r["guard"])
            assert r["c2pa"] and r["guard"]["passed"]


def test_morph_rejects_bad_options(client, dress):
    from .conftest import b64_image

    r = client.post("/v1/garment/morph", json={"cutout_b64": b64_image(dress), "length": "floor"})
    assert r.status_code == 422
    r = client.post("/v1/garment/morph", json={"cutout_b64": b64_image(dress), "hue": 400})
    assert r.status_code == 422
