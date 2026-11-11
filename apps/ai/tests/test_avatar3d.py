"""E33/E34: animatable avatar GLB validity, proportions, skin-tone fidelity, garment fitting, gateway jobs."""
import base64
import io
import time

import numpy as np
import pytest
from PIL import Image

from app import avatar_body as ab
from app import avatar_capture as cap
from app import avatar_dress as dr
from app import avatar_eval, c2pa, config, garment3d
from app.gltf import linear_to_srgb, read_accessor

from .conftest import b64, b64_image

PERSONA_SKIN = avatar_eval.PERSONA_SKIN


def _hex(h):
    return np.array([int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]) / 255


def _cutout(client, path) -> Image.Image:
    r = client.post("/v1/garment/assess", json={"image_b64": b64(path)}).json()
    return Image.open(io.BytesIO(base64.b64decode(r["cutout_b64"])))


def _wait(client, job_id, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        j = client.get(f"/v1/avatar/jobs/{job_id}").json()
        if j["status"] not in ("QUEUED", "RUNNING"):
            return j
        time.sleep(0.05)
    raise AssertionError("avatar job did not finish")


@pytest.fixture(scope="module")
def body_m():
    m, _ = ab.resolve_measurements({}, "M")
    return ab.build_body(m, (0.38, 0.25, 0.2))


@pytest.fixture(scope="module")
def glb_m(body_m):
    glb, stats = ab.body_glb(body_m, {"ai_generated": True})
    return glb, stats


# ── avatar GLB validity ────────────────────────────────────────────────────
def test_glb_is_valid_gltf2_with_skin_joints_and_clips(glb_m):
    glb, stats = glb_m
    gltf, binary = garment3d.parse_glb(glb)
    assert gltf["asset"]["version"] == "2.0"
    assert len(glb) <= 2 * 1024 * 1024
    for v in gltf["bufferViews"]:
        assert v["byteOffset"] % 4 == 0
        assert v["byteOffset"] + v["byteLength"] <= len(binary)
    skin = gltf["skins"][0]
    assert len(skin["joints"]) == len(ab.JOINTS) == stats["joints"] == 18
    names = [gltf["nodes"][j]["name"] for j in skin["joints"]]
    assert names == ab.JOINTS
    ibm = read_accessor(gltf, binary, skin["inverseBindMatrices"])
    assert ibm.shape == (18, 16)
    # Inverse bind = translation(-joint world position) in column-major order.
    hips = ab.JOINTS.index("hips")
    assert np.allclose(ibm[hips][12:15], -np.asarray(_world(gltf, skin["joints"][hips])), atol=1e-5)
    body_node = next(n for n in gltf["nodes"] if n.get("name") == "body")
    assert body_node["skin"] == 0 and "translation" not in body_node
    prim = gltf["meshes"][body_node["mesh"]]["primitives"][0]
    pos = read_accessor(gltf, binary, prim["attributes"]["POSITION"])
    joints = read_accessor(gltf, binary, prim["attributes"]["JOINTS_0"])
    weights = read_accessor(gltf, binary, prim["attributes"]["WEIGHTS_0"])
    assert len(pos) == len(joints) == len(weights) == stats["vertices"]
    assert joints.max() < 18
    assert np.allclose(weights.sum(axis=1), 1.0, atol=1e-4)
    assert (weights >= 0).all()
    clips = {a["name"]: a for a in gltf["animations"]}
    assert set(clips) == {"Idle", "Walk", "Turn"}
    for a in clips.values():
        for ch in a["channels"]:
            assert ch["target"]["node"] in skin["joints"]
            out = read_accessor(gltf, binary, a["samplers"][ch["sampler"]]["output"])
            if ch["target"]["path"] == "rotation":
                assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-5)
    # Turn ends where it starts: a full 360° about +Y on the root.
    turn = clips["Turn"]["channels"][0]
    assert gltf["nodes"][turn["target"]["node"]]["name"] == "root"


def _world(gltf, node_idx):
    parents = {c: i for i, n in enumerate(gltf["nodes"]) for c in n.get("children", [])}
    p = np.zeros(3)
    while node_idx is not None:
        p += np.asarray(gltf["nodes"][node_idx].get("translation", [0, 0, 0]))
        node_idx = parents.get(node_idx)
    return p


def test_triangle_budget_and_materials(glb_m):
    glb, stats = glb_m
    assert 3_000 < stats["triangles"] <= ab.MAX_TRIANGLES
    gltf, _ = garment3d.parse_glb(glb)
    names = {m["name"] for m in gltf["materials"]}
    assert {"skin", "bodysuit", "hair"} <= names
    # Stylised, not a likeness: no textures on the body at all (no photo is ever projected onto it).
    assert "images" not in gltf


# ── proportions from measurements (FR-AVA-03/06) ──────────────────────────
@pytest.mark.parametrize("m", [
    {"heightCm": 172, "bustCm": 100, "waistCm": 82, "hipsCm": 108, "shoulderCm": 41},
    {"heightCm": 154, "bustCm": 80, "waistCm": 63, "hipsCm": 88, "shoulderCm": 35},
    {"heightCm": 181, "bustCm": 118, "waistCm": 104, "hipsCm": 124},
])
def test_proportions_follow_the_measurement_profile(m):
    used, sources = ab.resolve_measurements(m, "M")
    assert set(m) <= set(sources)
    body = ab.build_body(used, (0.5, 0.35, 0.25))
    got = ab.measured(body)
    for k in ("heightCm", "bustCm", "waistCm", "hipsCm"):
        assert abs(got[k] - m[k]) / m[k] < 0.01, (k, got[k], m[k])
    assert ab.proportion_error(body) < 0.01
    # Height read straight from the GLB accessor bounds as well.
    glb, _ = ab.body_glb(body, {})
    gltf, _ = garment3d.parse_glb(glb)
    acc = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    assert abs((acc["max"][1] - acc["min"][1]) * 100 - m["heightCm"]) < 1.0


def test_bigger_profile_means_bigger_body():
    small = ab.build_body(ab.resolve_measurements({}, "S")[0], (0.5, 0.4, 0.3))
    large = ab.build_body(ab.resolve_measurements({}, "XL")[0], (0.5, 0.4, 0.3))
    assert large.torso_axes(large.y["hips"])[0] > small.torso_axes(small.y["hips"])[0]
    assert ab.measured(large)["waistCm"] > ab.measured(small)["waistCm"] + 15


def test_out_of_range_measurements_fall_back_to_the_size_estimate():
    used, sources = ab.resolve_measurements({"heightCm": 400, "bustCm": 95}, "L")
    assert used["heightCm"] == ab.SIZE_PREFILL["L"]["heightCm"] and used["bustCm"] == 95
    assert sources == ["bustCm"]


# ── skin tone (sampled from the twin, guarded) ─────────────────────────────
@pytest.mark.parametrize("i", range(1, 6))
def test_skin_tone_sampled_from_turnaround_matches_persona(assets, i):
    frames, yaws = cap.turnaround(Image.open(assets / f"persona-{i}.png"), 24)
    sample = cap.sample_skin(frames, yaws)
    assert np.abs(np.asarray(sample["rgb"]) - _hex(PERSONA_SKIN[i - 1])).mean() <= config.GUARD_MAX_SKIN_DELTA
    body = ab.build_body(ab.resolve_measurements({}, "M")[0], sample["rgb"])
    glb, _ = ab.body_glb(body, {})
    gltf, _ = garment3d.parse_glb(glb)
    mat = next(m for m in gltf["materials"] if m["name"] == "skin")
    rendered = linear_to_srgb(np.asarray(mat["pbrMetallicRoughness"]["baseColorFactor"][:3]))
    assert np.abs(rendered - _hex(PERSONA_SKIN[i - 1])).mean() <= config.GUARD_MAX_SKIN_DELTA


def test_turnaround_capture_checks_pass_and_flat_capture_is_rejected(assets):
    frames, yaws = cap.turnaround(Image.open(assets / "persona-2.png"), 24)
    r = cap.check_frames(frames, yaws)
    assert r["ok"], r["checks"]
    assert r["coverage"] == 1.0 and r["rotation"] > 0.3
    # Same frame 10 times, claimed angles over a quarter turn only: no rotation, no coverage.
    flat = cap.check_frames([frames[0]] * 10, [i * 9.0 for i in range(10)])
    assert not flat["ok"]
    assert not flat["checks"]["rotation"]["pass"] and not flat["checks"]["coverage"]["pass"]


def test_nlb_avatar_harness_passes_every_subgroup(assets):
    report = avatar_eval.run(assets)
    assert report["subgroups"] == 30
    assert report["nlb_score"] == 1.0 and report["parity_ok"]
    assert report["worst_skin_tone_delta"] <= config.GUARD_MAX_SKIN_DELTA


# ── garment fitting (FR-FIT-01) ────────────────────────────────────────────
@pytest.fixture(scope="module")
def dress_cut(client, assets):
    return _cutout(client, assets / "dress-terracotta-circles.png")


def _body_tris(body):
    """Triangles of the torso and legs (the surfaces a dress can touch)."""
    keep = set()
    for p in body.parts:
        if p.name in ("torso", "torso_cap", "leg_L", "leg_R"):
            keep.update(range(p.start, p.end))
    tris = np.concatenate(list(body.groups.values())).astype(np.int64)
    mask = np.isin(tris, list(keep)).all(axis=1)
    return body.positions.astype(np.float64)[tris[mask]]


def _closest_on_triangles(p, tri):
    """Closest point on each triangle to p (Ericson, Real-Time Collision Detection 5.1.5), vectorised over triangles."""
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    ab_, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab_ * ap).sum(1), (ac * ap).sum(1)
    bp = p - b
    d3, d4 = (ab_ * bp).sum(1), (ac * bp).sum(1)
    cp = p - c
    d5, d6 = (ab_ * cp).sum(1), (ac * cp).sum(1)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    denom = np.where(va + vb + vc == 0, 1e-12, va + vb + vc)
    v, w = vb / denom, vc / denom
    out = a + ab_ * v[:, None] + ac * w[:, None]
    with np.errstate(divide="ignore", invalid="ignore"):
        e_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
        out = np.where(e_ab[:, None], a + ab_ * np.nan_to_num(d1 / (d1 - d3))[:, None], out)
        e_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
        out = np.where(e_ac[:, None], a + ac * np.nan_to_num(d2 / (d2 - d6))[:, None], out)
        e_bc = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
        t_bc = np.nan_to_num((d4 - d3) / ((d4 - d3) + (d5 - d6)))
        out = np.where(e_bc[:, None], b + (c - b) * t_bc[:, None], out)
    out = np.where(((d1 <= 0) & (d2 <= 0))[:, None], a, out)
    out = np.where(((d3 >= 0) & (d4 <= d3))[:, None], b, out)
    out = np.where(((d6 >= 0) & (d5 <= d6))[:, None], c, out)
    return out


def signed_distance(points, tri):
    """Signed distance of each point to the closed body surface: + outside, - inside (by the nearest face normal)."""
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    centroid = tri.mean(axis=1)
    out = np.empty(len(points))
    for i, p in enumerate(points):
        near = np.argsort(((centroid - p) ** 2).sum(1))[:64]
        q = _closest_on_triangles(p, tri[near])
        d = np.linalg.norm(p - q, axis=1)
        k = d.argmin()
        out[i] = d[k] * np.sign(np.dot(p - q[k], n[near][k]) or 1.0)
    return out


@pytest.mark.parametrize("size", ["S", "M", "L"])
def test_garment_never_penetrates_the_body(body_m, dress_cut, size):
    g = dr.fit(body_m, dress_cut, "dress", size, "M")
    tris = _body_tris(body_m)
    # The measure itself: a point on the spine is deep inside, one 5 cm in front of the waist is outside.
    probe = signed_distance(np.array([[0, body_m.y["waist"], 0], [0, body_m.y["waist"], body_m.torso_axes(body_m.y["waist"])[1] + 0.05]]), tris)
    assert probe[0] < -0.05 and 0.04 < probe[1] < 0.06
    sd = signed_distance(g.positions.astype(np.float64), tris)
    assert sd.min() >= -0.002, f"garment enters the body by {-sd.min() * 1000:.1f} mm"
    assert g.info["min_clearance_m"] >= dr.MIN_CLEARANCE - 1e-6


def test_size_ease_ordering(body_m, dress_cut):
    fits = {s: dr.fit(body_m, dress_cut, "dress", s, "M").info for s in ("S", "M", "L")}
    assert fits["S"]["mean_clearance_m"] < fits["M"]["mean_clearance_m"] < fits["L"]["mean_clearance_m"]
    for k in ("bust", "waist", "hips"):
        assert fits["S"]["ring_clearance_m"][k] < fits["M"]["ring_clearance_m"][k] < fits["L"]["ring_clearance_m"][k]
    assert fits["S"]["length_m"] < fits["M"]["length_m"] < fits["L"]["length_m"]
    assert fits["S"]["fit"] == "tight" and fits["M"]["fit"] == "regular"
    # Ease is relative to the avatar's own size: an L dress on an L body fits like M on M.
    assert dr.size_ease("L", "L") == dr.size_ease("M", "M")


def test_garment_is_skinned_to_the_avatar_skeleton(body_m, dress_cut):
    g = dr.fit(body_m, dress_cut, "dress", "M", "M")
    glb, stats = ab.body_glb(body_m, {}, g)
    gltf, binary = garment3d.parse_glb(glb)
    node = next(n for n in gltf["nodes"] if n.get("name") == "garment")
    assert node["skin"] == 0
    prim = gltf["meshes"][node["mesh"]]["primitives"][0]
    w = read_accessor(gltf, binary, prim["attributes"]["WEIGHTS_0"])
    assert np.allclose(w.sum(axis=1), 1, atol=1e-4)
    mat = gltf["materials"][prim["material"]]
    assert mat["alphaMode"] == "MASK" and "baseColorTexture" in mat["pbrMetallicRoughness"]
    assert stats["triangles"] <= 40_000 and len(glb) <= 2 * 1024 * 1024


def test_unsupported_categories_are_refused(body_m, dress_cut):
    with pytest.raises(ValueError):
        dr.fit(body_m, dress_cut, "bag", "M", "M")


# ── gateway routes ─────────────────────────────────────────────────────────
def test_build_job_from_persona_turnaround(client, assets):
    t = client.post("/v1/avatar/turnaround", json={"persona_b64": b64(assets / "persona-4.png")}).json()
    assert len(t["frames_b64"]) == 24 and t["synthetic"] is True
    r = client.post("/v1/avatar/build", json={"frames_b64": t["frames_b64"], "yaw_deg": t["yaw_deg"], "measurements": {"heightCm": 170}, "request_id": "t-build"})
    assert r.status_code == 200 and r.json()["status"] == "QUEUED"
    j = _wait(client, r.json()["job_id"])
    assert j["status"] == "DONE", j
    res = j["result"]
    assert res["eval"]["passed"] and res["joints"] == 18
    assert res["measurements_used"]["heightCm"] == 170 and res["measurement_sources"] == ["heightCm"]
    assert np.abs(np.asarray(res["skin_rgb"]) - _hex(PERSONA_SKIN[3])).mean() <= config.GUARD_MAX_SKIN_DELTA
    glb = base64.b64decode(res["glb_b64"])
    assert glb[:4] == b"glTF"
    assert c2pa.verify(base64.b64decode(res["poster_b64"]))


def test_build_rejects_a_capture_without_turning(client, assets):
    frame = b64(assets / "persona-1.png")
    r = client.post("/v1/avatar/build", json={"frames_b64": [frame] * 8, "yaw_deg": [0.0] * 8})
    j = _wait(client, r.json()["job_id"])
    assert j["status"] == "REJECTED"
    assert not j["result"]["checks"]["checks"]["coverage"]["pass"]


def test_measurements_only_body_shape_avatar(client):
    r = client.post("/v1/avatar/build", json={"measurements": {"heightCm": 160, "hipsCm": 110}, "skin_rgb": [0.3, 0.2, 0.15]})
    j = _wait(client, r.json()["job_id"])
    assert j["status"] == "DONE"
    assert j["result"]["skin_rgb"] == [0.3, 0.2, 0.15]
    assert j["result"]["checks"] is None


def test_photoreal_and_unconfigured_providers(client):
    assert client.post("/v1/avatar/build", json={"style": "photoreal"}).status_code == 422
    r = client.post("/v1/avatar/build", json={"provider": "gaussian-splat"})
    j = _wait(client, r.json()["job_id"])
    assert j["status"] == "FAILED" and "not configured" in j["error"]
    assert client.get("/v1/avatar/jobs/nope").status_code == 404
    ids = [m["id"] for m in client.get("/v1/avatar/models").json()]
    assert ab.MODEL_VERSION in ids


def test_dress_route(client, dress_cut):
    params = {"measurements": {"heightCm": 165}, "size_estimate": "M", "skin_rgb": [0.4, 0.28, 0.2]}
    r = client.post("/v1/avatar/dress", json={"params": params, "cutout_b64": b64_image(dress_cut), "category": "dress", "size": "L"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fit"]["size"] == "L" and body["fit"]["fit"] in ("regular", "relaxed")
    assert body["garment_triangles"] > 1000
    assert c2pa.verify(base64.b64decode(body["poster_b64"]))
    bad = client.post("/v1/avatar/dress", json={"params": params, "cutout_b64": b64_image(dress_cut), "category": "shoes"})
    assert bad.status_code == 422
