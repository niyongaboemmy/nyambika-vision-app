"""E28: motion preview frames (count, size, identity region unchanged), guard, labels, C2PA."""
import base64
import hashlib
import hmac
import io
import shutil

import numpy as np
import pytest
from PIL import Image

from app import config, motion
from app.c2pa import _canonical

from .conftest import b64


def _cutout(client, path) -> Image.Image:
    r = client.post("/v1/garment/assess", json={"image_b64": b64(path)}).json()
    return Image.open(io.BytesIO(base64.b64decode(r["cutout_b64"])))


@pytest.fixture(scope="module")
def clip(client, assets):
    twin = Image.open(assets / "persona-3.png")
    return motion.generate(twin, _cutout(client, assets / "dress-indigo-zigzag.png"), "dress", request_id="m1")


def test_frame_count_duration_and_size(clip):
    assert clip["status"] == "DELIVERED"
    assert clip["frames"] == len(clip["_frames"]) == 48
    assert 3000 <= clip["duration_ms"] <= 5000
    w, h = clip["width"], clip["height"]
    assert h == 512 and w % 2 == 0 and h % 2 == 0
    assert all(f.size == (w, h) for f in clip["_frames"])
    webp = Image.open(io.BytesIO(clip["webp"]))
    assert webp.format == "WEBP" and webp.n_frames == 48 and webp.info.get("loop") == 0
    assert len(clip["webp"]) <= 2 * 1024 * 1024
    assert len(clip["poster"]) <= 300 * 1024


def test_identity_region_unchanged_on_every_frame(clip):
    twin = np.asarray(clip["_twin"])
    x0, y0, x1, y1 = clip["_box"]
    head_y1 = y0 + int(0.16 * (y1 - y0))
    head = twin[y0:head_y1, x0:x1]
    for f in clip["_frames"]:
        assert np.array_equal(np.asarray(f)[y0:head_y1, x0:x1], head)
    assert clip["guard"]["passed"] and clip["guard"]["identity_similarity"] == 1.0
    assert len(clip["guard"]["sampled_frames"]) >= 4


def test_it_actually_moves_and_loops(clip):
    frames = [np.asarray(f, dtype=np.int16) for f in clip["_frames"]]
    x0, y0, x1, y1 = clip["_box"]
    hips = slice(y0 + int(0.4 * (y1 - y0)), y1)
    quarter = np.abs(frames[12][hips] - frames[0][hips]).mean()
    assert quarter > 1.0  # visible sway at the quarter period
    # Seamless loop: last frame is one step before the first.
    assert np.abs(frames[-1][hips] - frames[0][hips]).mean() < quarter


def test_label_watermark_and_c2pa(clip):
    lab = np.asarray(clip["_frames"][0])
    h = lab.shape[0]
    corner = lab[h - 26: h - 8, 8: 120].astype(np.int16)
    bare = np.asarray(clip["_twin"])[h - 26: h - 8, 8: 120].astype(np.int16)
    assert np.abs(corner - bare).mean() > 3  # "AI motion preview" label pill drawn on every frame
    cred = clip["c2pa"]
    expected = hmac.new(config.C2PA_SIGNING_KEY, _canonical(cred["manifest"]), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(expected, cred["signature"])
    assert cred["sha256"] == motion.frames_hash(clip["_frames"])
    assert b"nyambika:c2pa" in clip["webp"]


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
def test_mp4_when_ffmpeg_exists(clip):
    assert clip["mp4"] is not None and clip["mp4"][4:8] == b"ftyp"


def test_guard_withholds_drifted_frames(client, assets, monkeypatch):
    # Force identity drift: warp everything including the head.
    monkeypatch.setattr(motion, "NECK", -1.0)
    monkeypatch.setattr(config, "GUARD_MIN_IDENTITY", 0.999)
    twin = Image.open(assets / "persona-2.png")
    r = motion.generate(twin, _cutout(client, assets / "dress-terracotta-circles.png"), "dress", with_mp4=False)
    assert r["status"] == "WITHHELD" and "identity_drift" in r["guard"]["reasons"]
    assert "webp" not in r


def test_endpoint(client, assets):
    r = client.post("/v1/motion", json={"twin_b64": b64(assets / "persona-1.png"),
                                        "garment_b64": b64(assets / "shirt-teal-waves.png"), "garment_category": "shirt"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "DELIVERED" and body["frames"] == 48
    assert Image.open(io.BytesIO(base64.b64decode(body["webp_b64"]))).n_frames == 48
    assert body["c2pa"]["sha256"]
