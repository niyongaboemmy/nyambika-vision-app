import base64
import io
import json

import numpy as np
from PIL import Image

from app import c2pa
from app.embed import cosine

from .conftest import b64, b64_image


def test_health_and_models(client):
    assert client.get("/health").json()["status"] == "ok"
    ids = {m["id"] for m in client.get("/v1/models").json()}
    assert {"local-compositor@1.0-preview", "local-compositor@1.0-hd"} <= ids


def test_garment_assess_ready(client, assets):
    r = client.post("/v1/garment/assess", json={"image_b64": b64(assets / "dress-terracotta-circles.png")}).json()
    assert r["readiness"] == "READY"
    assert len(r["dominant_colours"]) >= 1
    assert len(r["embedding"]) == 64
    cut = Image.open(io.BytesIO(base64.b64decode(r["cutout_b64"])))
    assert cut.mode == "RGBA"
    alpha = np.asarray(cut)[..., 3]
    assert alpha.min() == 0 and alpha.max() == 255


def test_garment_unsupported_and_bad_photo(client, assets):
    r = client.post("/v1/garment/assess", json={"image_b64": b64(assets / "dress-terracotta-circles.png"),
                                               "category": "shoes"}).json()
    assert r["readiness"] == "NOT_SUPPORTED"
    noisy = Image.fromarray(np.random.default_rng(1).integers(0, 255, (300, 300, 3), dtype=np.uint8))
    r = client.post("/v1/garment/assess", json={"image_b64": b64_image(noisy)}).json()
    assert r["readiness"] == "NEEDS_BETTER_PHOTO"
    assert r["notes"]


def test_twin_check_personas(client, assets):
    sizes = []
    for i in range(1, 6):
        r = client.post("/v1/twin/check", json={"image_b64": b64(assets / f"persona-{i}.png")}).json()
        assert r["ok"], r
        assert r["height_ratio"] >= 0.7
        sizes.append(r["estimated_size"])
    assert sizes[0] == "S" and sizes[-1] == "XL"


def test_twin_check_bad(client):
    dark = Image.fromarray(np.random.default_rng(2).integers(0, 12, (240, 160, 3), dtype=np.uint8))
    r = client.post("/v1/twin/check", json={"image_b64": b64_image(dark)}).json()
    assert not r["ok"]
    assert not r["checks"]["resolution"]["pass"]
    assert not r["checks"]["lighting"]["pass"]


def _cutout(client, path):
    return client.post("/v1/garment/assess", json={"image_b64": b64(path)}).json()["cutout_b64"]


def test_tryon_delivered_signed(client, assets):
    garment = _cutout(client, assets / "dress-terracotta-circles.png")
    for i in range(1, 6):
        r = client.post("/v1/tryon", json={"twin_b64": b64(assets / f"persona-{i}.png"), "garment_b64": garment,
                                           "garment_category": "dress", "tier": "PREVIEW",
                                           "request_id": f"t{i}"}).json()
        assert r["status"] == "DELIVERED", r["guard"]
        assert r["guard"]["passed"]
        png = base64.b64decode(r["image_b64"])
        img = Image.open(io.BytesIO(png))
        assert img.height == 512
        payload = json.loads(img.info["c2pa"])
        assert payload["signature"] == r["c2pa"]["signature"]
        assert c2pa.verify(png)


def test_tryon_hd_and_shirt(client, assets):
    garment = _cutout(client, assets / "shirt-teal-waves.png")
    r = client.post("/v1/tryon", json={"twin_b64": b64(assets / "persona-3.png"), "garment_b64": garment,
                                       "garment_category": "shirt", "tier": "HD"}).json()
    assert r["status"] == "DELIVERED"
    assert Image.open(io.BytesIO(base64.b64decode(r["image_b64"]))).height == 1024
    assert r["model_version"] == "local-compositor@1.0-hd"


def test_c2pa_tamper_detected(client, assets):
    garment = _cutout(client, assets / "dress-indigo-zigzag.png")
    r = client.post("/v1/tryon", json={"twin_b64": b64(assets / "persona-2.png"), "garment_b64": garment}).json()
    img = Image.open(io.BytesIO(base64.b64decode(r["image_b64"])))
    img.load()
    info = img.info["c2pa"]
    img.putpixel((10, 10), (255, 0, 0))
    from PIL import PngImagePlugin
    meta = PngImagePlugin.PngInfo()
    meta.add_itxt("c2pa", info)
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=meta)
    assert not c2pa.verify(buf.getvalue())


def test_guard_withholds_identity_drift(assets):
    from app import guard
    twin = Image.open(assets / "persona-1.png").convert("RGB")
    garment = Image.open(assets / "dress-terracotta-circles.png").convert("RGBA")
    altered = twin.copy()
    altered.paste((200, 30, 30), (300, 140, 420, 300))  # repaint the face
    verdict = guard.evaluate(twin, altered, garment, None)
    assert not verdict["passed"]
    assert "identity_drift" in verdict["reasons"]


def test_embedding_stable_and_similarity(client, assets):
    def emb(name):
        return client.post("/v1/embed/image", json={"image_b64": b64(assets / name)}).json()["embedding"]

    a1, a2 = emb("dress-terracotta-circles.png"), emb("dress-terracotta-circles.png")
    assert a1 == a2
    assert abs(np.linalg.norm(a1) - 1) < 1e-4
    same = cosine(a1, emb("skirt-terracotta-circles.png"))
    different = cosine(a1, emb("dress-indigo-zigzag.png"))
    assert same > different
