"""E39: video try-on provider contracts, guard on sampled frames, C2PA, async job API, NLB video gate."""
import base64
import io
import json
import time

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import fake_pool, video_eval
from app import video_tryon as vt
from app.inference import PoolClient, Router, default_policy, reset_for_tests
from app.inference.backends import register_defaults

from .conftest import b64_image


@pytest.fixture(scope="module")
def personas(assets):
    return [Image.open(assets / f"persona-{i}.png") for i in range(1, 6)]


def test_motion_compose_turnaround_contract(assets, cutouts):
    req = vt.VideoRequest("TURNAROUND", cutouts["dress-indigo-zigzag"], "dress", "v1", 8, twin=Image.open(assets / "persona-3.png"))
    vf = vt.get("motion-compose").frames(req, lambda _p: None)
    assert len(vf.out) == len(vf.inputs) == 24
    assert all(o.size == i.size for o, i in zip(vf.out, vf.inputs))
    assert vf.model_version == "motion-compose@1.0"


def test_render_labels_guards_and_signs(assets, cutouts):
    twin = Image.open(assets / "persona-5.png")
    clip = vt.turn_frames(twin, 10)
    r = vt.render(vt.get("motion-compose"), vt.VideoRequest("CLIP", cutouts["dress-terracotta-circles"], "dress", "v2", 8, frames=clip))
    assert r["status"] == "DELIVERED" and r["source"] == "CLIP" and r["frames"] == 10
    g = r["guard"]
    assert g["passed"] and g["identity_stability"] >= vt.MIN_STABILITY and len(g["sampled_frames"]) == 8
    assert vt.verify_manifest(r["c2pa"], r["_frames"])
    gen = next(a for a in r["c2pa"]["manifest"]["assertions"] if a["label"] == "nyambika.generation")["data"]
    assert gen["kind"] == "video_tryon" and gen["source"] == "CLIP"
    webp = Image.open(io.BytesIO(r["webp"]))
    assert 1 < webp.n_frames <= 10 and b"nyambika:c2pa" in r["webp"]  # libwebp merges identical frames
    # Visible label: dark pill bottom-left on every frame.
    f = np.asarray(r["_frames"][3])
    assert f[f.shape[0] - 14, 14].mean() < 120


class Flicker(vt.MotionComposeProvider):
    """Bad provider: alters the face on one frame of every clip (identity drift + instability)."""

    model_version = "flicker@0"

    def frames(self, req, progress):
        vf = super().frames(req, progress)
        a = np.asarray(vf.out[-1]).copy()  # the last frame is always sampled
        a[: a.shape[0] // 5] = np.clip(a[: a.shape[0] // 5].astype(int) + 40, 0, 255)
        vf.out[-1] = Image.fromarray(a.astype(np.uint8))
        return vf


def test_withheld_when_one_frame_drifts(assets, cutouts):
    r = vt.render(Flicker(), vt.VideoRequest("TURNAROUND", cutouts["dress-indigo-zigzag"], "dress", "v3", 8, twin=Image.open(assets / "persona-2.png")))
    assert r["status"] == "WITHHELD" and "webp" not in r
    assert "identity_drift" in r["guard"]["reasons"] and "identity_unstable" in r["guard"]["reasons"]


# ── hosted-rest slot: mock-tested request/response contract ──────────────────
def test_hosted_rest_contract(monkeypatch, assets, cutouts):
    monkeypatch.setenv("VIDEO_TRYON_HOSTED_URL", "https://video.vendor.test")
    monkeypatch.setenv("VIDEO_TRYON_HOSTED_KEY", "sk-test")
    monkeypatch.setenv("VIDEO_TRYON_HOSTED_MODEL", "vendor-vton-video@2026-10")
    seen = {"polls": 0}

    def handler(request: httpx.Request):
        assert request.headers["authorization"] == "Bearer sk-test"
        if request.method == "POST":
            body = json.loads(request.content)
            seen["body"] = body
            return httpx.Response(202, json={"id": "job1", "status": "queued"})
        seen["polls"] += 1
        if seen["polls"] < 2:
            return httpx.Response(200, json={"id": "job1", "status": "running", "progress": 50})
        frames = [vt._jpeg_b64(vt.normalise(Image.open(io.BytesIO(base64.b64decode(f))))) for f in seen["body"]["person"]["frames_b64"]]
        return httpx.Response(200, json={"id": "job1", "status": "succeeded", "model_version": "vendor-vton-video@2026-10",
                                         "output": {"frames_b64": frames}})

    p = vt.HostedRestProvider(transport=httpx.MockTransport(handler), sleep=lambda _s: None)
    assert p.configured()
    clip = vt.turn_frames(Image.open(assets / "persona-1.png"), 8)
    vf = p.frames(vt.VideoRequest("CLIP", cutouts["dress-indigo-zigzag"], "dress", "h1", 8, frames=clip), lambda _p: None)
    body = seen["body"]
    assert body["data_policy"] == {"retention": "none", "training": False, "region": "eu"}
    assert len(body["person"]["frames_b64"]) == 8 and body["garment"]["category"] == "dress"
    assert body["model"] == "vendor-vton-video@2026-10" and body["request_id"] == "h1"
    assert len(vf.out) == 8 and vf.out[0].size == vf.inputs[0].size and vf.model_version == "vendor-vton-video@2026-10"


def test_hosted_rest_failure_and_unconfigured(monkeypatch, cutouts, assets):
    req = vt.VideoRequest("TURNAROUND", cutouts["dress-indigo-zigzag"], "dress", "h2", 8, twin=Image.open(assets / "persona-1.png"))
    monkeypatch.delenv("VIDEO_TRYON_HOSTED_URL", raising=False)
    with pytest.raises(vt.NotConfigured):
        vt.HostedRestProvider().frames(req, lambda _p: None)
    monkeypatch.setenv("VIDEO_TRYON_HOSTED_URL", "https://video.vendor.test")
    monkeypatch.setenv("VIDEO_TRYON_HOSTED_KEY", "sk")
    t = httpx.MockTransport(lambda r: httpx.Response(202, json={"id": "j", "status": "failed", "error": "nsfw"}))
    with pytest.raises(RuntimeError, match="nsfw"):
        vt.HostedRestProvider(transport=t, sleep=lambda _s: None).frames(req, lambda _p: None)


def test_pool_provider_through_router(assets, cutouts):
    fake_pool.STATE["mode"] = "healthy"
    client = PoolClient("http://pool.test", transport=TestClient(fake_pool.app)._transport)
    reset_for_tests(register_defaults(Router(default_policy(), regions={"pool": "rw", "hosted": "eu"}), client), client)
    try:
        r = vt.render(vt.get("pool"), vt.VideoRequest("TURNAROUND", cutouts["dress-terracotta-circles"], "dress", "p1", 8,
                                                      twin=Image.open(assets / "persona-4.png")))
        assert r["status"] == "DELIVERED" and r["model_version"] == "pool-video-vton@1.0"
        assert r["routing"]["backend"] == "pool" and r["routing"]["route"] == "video"
    finally:
        reset_for_tests(None, None)


# ── HTTP: async job ──────────────────────────────────────────────────────────
def test_async_job_api(client, assets, cutouts):
    clip = [b64_image(f) for f in vt.turn_frames(Image.open(assets / "persona-2.png"), 8)]
    start = client.post("/v1/video/tryon", json={"provider": "motion-compose", "source": "CLIP", "frames_b64": clip,
                                                 "garment_b64": b64_image(cutouts["dress-indigo-zigzag"])}).json()
    assert start["status"] == "QUEUED"
    for _ in range(100):
        j = client.get(f"/v1/video/jobs/{start['job_id']}").json()
        if j["status"] not in ("QUEUED", "RUNNING"):
            break
        time.sleep(0.1)
    assert j["status"] == "DELIVERED", j
    assert j["result"]["webp_b64"] and j["result"]["poster_b64"] and j["result"]["c2pa"]["signature"]
    # Handed over once, then forgotten.
    assert client.get(f"/v1/video/jobs/{start['job_id']}").status_code == 404
    assert client.post("/v1/video/tryon", json={"provider": "hosted-rest", "source": "CLIP", "frames_b64": clip,
                                                "garment_b64": "x"}).status_code == 503
    assert client.post("/v1/video/tryon", json={"source": "CLIP", "frames_b64": clip[:3], "garment_b64": clip[0]}).status_code == 422
    ids = {p["provider"]: p for p in client.get("/v1/video/providers").json()}
    assert ids["motion-compose"]["configured"] and not ids["hosted-rest"]["configured"]


# ── NLB video gate ───────────────────────────────────────────────────────────
def test_nlb_eval_passes_every_subgroup(personas, cutouts):
    rep = video_eval.run(vt.get("motion-compose"), personas, [(cutouts["dress-indigo-zigzag"], "dress")], frames=6)
    assert rep["passed"] and rep["subgroups"] == 15 and rep["subgroups_passed"] == 15
    assert {r["monk_skin_tone"] for r in rep["rows"]} == {6, 7, 8, 9, 10}
    assert {r["size"] for r in rep["rows"]} == {"S", "M", "XL"}
    assert rep["model_version"] == "motion-compose@1.0" and rep["commercial_use"]


class DarkSkinDrift(vt.MotionComposeProvider):
    """Bad provider: lightens skin on the darkest tones only (the bias the NLB exists to catch)."""

    model_version = "skin-drift@0"

    def frames(self, req, progress):
        vf = super().frames(req, progress)
        if req.request_id.startswith(("nlb-4-", "nlb-5-")):
            vf.out = [Image.fromarray(np.clip(np.asarray(o).astype(int) + 30, 0, 255).astype(np.uint8)) for o in vf.out]
        return vf


def test_nlb_eval_fails_on_a_subgroup(personas, cutouts):
    rep = video_eval.run(DarkSkinDrift(), personas, [(cutouts["dress-indigo-zigzag"], "dress")], frames=6)
    assert not rep["passed"]
    assert set(rep["failing_subgroups"]) == {f"MST{t}×{s}" for t in (9, 10) for s in ("S", "M", "XL")}


def test_nlb_eval_refuses_unconfigured_and_non_commercial(personas, cutouts, monkeypatch):
    monkeypatch.delenv("VIDEO_TRYON_HOSTED_URL", raising=False)
    rep = video_eval.run(vt.get("hosted-rest"), personas, [(cutouts["dress-indigo-zigzag"], "dress")])
    assert not rep["passed"] and "not configured" in rep["error"]

    class NonCommercial(vt.MotionComposeProvider):
        licence = "CC BY-NC-SA 4.0"
        commercial_use = False

    rep = video_eval.run(NonCommercial(), personas[:1], [(cutouts["dress-indigo-zigzag"], "dress")], frames=6)
    assert rep["subgroups_passed"] == 3 and not rep["passed"]


def test_eval_endpoint(client, personas, cutouts):
    body = {"provider": "motion-compose", "personas_b64": [b64_image(p) for p in personas],
            "garments": [{"b64": b64_image(cutouts["dress-terracotta-circles"]), "category": "dress"}], "frames": 6}
    rep = client.post("/v1/video/eval", json=body).json()
    assert rep["passed"] and rep["kind"] == "NLB_VIDEO"
