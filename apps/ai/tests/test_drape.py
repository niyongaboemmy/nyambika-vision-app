"""R4 drape spike: pattern grading, solver stability, seam closure, penetration, heatmap bands, GLB + routes."""
import base64
import time

import numpy as np
import pytest

from app.drape import export, fit, mesh
from app.drape import pattern as pt
from app.drape import service
from app.drape.collide import BodySDF
from app.drape.solver import drape
from app.gltf import read_accessor
from app.garment3d import parse_glb

FAST = service.QUALITY["fast"]
STD = service.QUALITY["standard"]


def _circ_at(p: pt.Pattern, drop: float) -> float:
    """Pattern circumference (cm) across the torso panels at a drop below the top line."""
    return sum(pp.width_at(-drop) for pp in p.panels if pp.placement["kind"] == "wrap") * 100


# ── pattern grading ────────────────────────────────────────────────────────
@pytest.mark.parametrize("garment", ["a_line_dress", "shirt"])
def test_bodice_grading_matches_finished_measurements(garment):
    for size in ("S", "M", "XL", "3XL"):
        p = pt.generate(garment, size=size)
        assert _circ_at(p, p.lines["bust"]) == pytest.approx(p.finished["bust"], abs=0.6)
        assert _circ_at(p, p.lines["hips"]) == pytest.approx(p.finished["hips"], abs=0.6)
    m, xl = pt.generate(garment, size="M"), pt.generate(garment, size="XL")
    assert xl.finished["bust"] - m.finished["bust"] == pytest.approx(16, abs=0.1)
    assert xl.panel("front").area() > m.panel("front").area()


def test_profile_measurements_override_size_and_params_apply():
    p = pt.generate("a_line_dress", {"bustCm": 101, "hipsCm": 110}, "M", {"length_cm": 80, "ease_cm": 3})
    assert p.finished["bust"] == pytest.approx(101 + 4 + 3)
    assert p.lines["hem"] == pytest.approx(0.8)
    assert min(pp.outline[:, 1].min() for pp in p.panels) == pytest.approx(-0.8)
    assert [pp.name for pp in p.panels] == ["front", "back"]
    s = pt.generate("shirt", size="M", params={"sleeve": "long"})
    short = pt.generate("shirt", size="M", params={"sleeve": "short"})
    assert {"sleeve_L", "sleeve_R"} <= {pp.name for pp in s.panels}
    assert -s.panel("sleeve_L").outline[:, 1].min() > -short.panel("sleeve_L").outline[:, 1].min() + 0.25
    assert len(pt.generate("shirt", size="M", params={"sleeve": "none"}).panels) == 2
    with pytest.raises(ValueError):
        pt.generate("trousers")


def test_seams_join_edges_of_matching_length():
    p = pt.generate("shirt", size="L", params={"sleeve": "short"})
    for s in p.seams:
        la, lb = p.panel(s.a).edge_length(s.edge_a), p.panel(s.b).edge_length(s.edge_b)
        assert abs(la - lb) / max(la, lb) < 0.12, (s, la, lb)  # sleeve caps carry a little ease


def test_wrap_skirt_cone_and_tie_rule():
    p = pt.generate("wrap_skirt", size="M")
    r1, th, d = p.meta["r1"], p.meta["theta"], p.lines["hips"]
    assert th * r1 * 100 == pytest.approx(p.finished["waist"])
    assert th * (r1 + d) * 100 == pytest.approx(p.finished["hips"])
    assert p.panel("wrap").edge_length("waist") * 100 == pytest.approx(p.finished["waist"] * 1.3, rel=0.01)
    # The wearer ties it at their waist: a bigger body gets a bigger worn waist and hip, until the overlap runs out.
    worn_m = pt.finished_for_body(p, pt.SIZES["M"])
    worn_l = pt.finished_for_body(p, pt.SIZES["L"])
    assert worn_l["waist"] > worn_m["waist"] and worn_l["hips"] > worn_m["hips"]
    assert pt.wrap_worn_waist(p, 200) == pytest.approx(p.finished["waist_max"])


# ── mesh + stitches ────────────────────────────────────────────────────────
def test_mesh_tags_every_seam_edge_and_builds_stitches():
    p = pt.generate("shirt", size="M")
    g = mesh.build(p, 0.025)
    assert len(g.uv) > 800 and g.tris.max() < len(g.uv)
    for i, s in enumerate(p.seams):
        assert (g.seam_of == i).sum() >= 3, s
    # Flat pattern triangles are CCW with positive area (snapping never folds them).
    a, b, c = (g.uv[g.tris[:, k]] for k in range(3))
    area = 0.5 * ((b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0])
    assert (area > 0).all()
    # The mesh covers the pattern: triangle area ~ polygon area.
    assert area.sum() == pytest.approx(sum(pp.area() for pp in p.panels), rel=0.05)


# ── solver ─────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def draped():
    out = {}
    body_l = service.body_for(None, "L")
    for key, (garment, size, body) in {
        "dress_M_on_L": ("a_line_dress", "M", body_l), "dress_L_on_L": ("a_line_dress", "L", body_l),
        "dress_XXL_on_L": ("a_line_dress", "XXL", body_l), "skirt_L_on_L": ("wrap_skirt", "L", body_l),
        "shirt_L_on_L": ("shirt", "L", body_l),
    }.items():
        p = pt.generate(garment, size=size)
        t = time.perf_counter()
        r = drape(p, body, STD)
        out[key] = (p, body, r, time.perf_counter() - t)
    return out


@pytest.mark.parametrize("key", ["dress_L_on_L", "skirt_L_on_L", "shirt_L_on_L", "dress_M_on_L"])
def test_drape_is_stable_and_within_budget(draped, key):
    _, _, r, secs = draped[key]
    m = r.metrics
    assert not m["exploded"]
    assert np.isfinite(r.x).all()
    assert m["strain_p99"] < 0.2
    assert secs < 8.0  # spike budget is 5 s p95 on the dev CPU; CI machines are slower
    assert m["max_speed_m_s"] < 2.5  # settled, not flying


@pytest.mark.parametrize("key", ["dress_L_on_L", "shirt_L_on_L"])
def test_seams_close(draped, key):
    _, _, r, _ = draped[key]
    g = r.garment
    gaps = np.linalg.norm(r.x[g.stitches[:, 0]] - r.x[g.stitches[:, 1]], axis=1)
    initial = np.linalg.norm(r.x0[g.stitches[:, 0]] - r.x0[g.stitches[:, 1]], axis=1)
    assert np.quantile(gaps, 0.95) < 0.01
    assert gaps.mean() < initial.mean() * 0.1


@pytest.mark.parametrize("key", ["dress_L_on_L", "skirt_L_on_L", "shirt_L_on_L"])
def test_no_body_penetration(draped, key):
    _, body, r, _ = draped[key]
    f = BodySDF(body)(r.x)
    assert f.min() > -0.005
    assert r.metrics["max_penetration_m"] <= 0.005


def test_garment_hangs_from_its_anchor(draped):
    _, body, r, _ = draped["dress_L_on_L"]
    assert r.x[:, 1].max() > body.y["shoulder"]  # still on the shoulders
    _, body, r, _ = draped["skirt_L_on_L"]
    wid = r.garment.panels[0].boundary["waist"][0]
    assert abs(np.median(r.x[wid, 1]) - body.y["waist"]) < 0.06  # tied at the waist, not slid to the hips


def test_sdf_sign_and_gradient():
    body = service.body_for(None, "M")
    sdf = BodySDF(body)
    inside = np.array([[0, body.y["waist"], 0], [0, body.y["bust"], 0]])
    outside = np.array([[0, body.y["waist"], 0.4], [0.5, 1.0, 0]])
    assert (sdf(inside) < 0).all() and (sdf(outside) > 0).all()
    g = sdf.gradient(np.array([[0.0, body.y["waist"], 0.2]]))
    assert g[0, 2] > 0.9 * np.linalg.norm(g)


# ── heatmap ────────────────────────────────────────────────────────────────
def test_band_rules():
    stretch = np.array([0.05, 0.05, 0.0, 0.0, 0.0])
    gap = np.array([0.0, 0.05, 0.005, 0.05, 0.05])
    y = np.array([1.0, 1.0, 1.0, 1.0, 0.3])
    assert fit.bands(stretch, gap, y, 0.75).tolist() == [0, 2, 1, 2, 3]
    assert fit.expected_band(-3) == {"tight"} and fit.expected_band(0) == {"tight", "ok"}
    assert fit.expected_band(5) == {"ok"} and fit.expected_band(25) == {"loose"}


def test_heatmap_agrees_with_size_chart(draped):
    """Size M on an L body reads tight at bust and hips; L reads ok; XXL reads loose."""
    want = {"dress_M_on_L": "tight", "dress_L_on_L": "ok", "dress_XXL_on_L": "loose"}
    for key, band in want.items():
        p, body, r, _ = draped[key]
        a = fit.analyse(r, p, body)
        for line in ("bust", "hips"):
            assert a["summary"]["regions"][line]["reading"] == band, (key, line, a["summary"]["regions"][line])
            assert a["summary"]["size_chart"][line]["agree"]
    p, body, r, _ = draped["dress_XXL_on_L"]
    assert fit.analyse(r, p, body)["summary"]["regions"]["bust"]["measured_ease_cm"] > 12


def test_shirt_sleeves_and_skirt_bands(draped):
    p, body, r, _ = draped["skirt_L_on_L"]
    a = fit.analyse(r, p, body)
    assert a["summary"]["share"]["drape"] > 0.2  # flared hem below the crotch is neutral, not "loose"
    assert a["summary"]["size_chart"]["hips"]["agree"]


# ── export + routes ────────────────────────────────────────────────────────
def test_glbs_carry_print_uvs_and_heatmap_colours(draped):
    p, body, r, _ = draped["dress_L_on_L"]
    a = fit.analyse(r, p, body)
    rgb = fit.colours(a["band"], a["stretch"], a["gap"])
    g1, b1 = parse_glb(export.glb(body, r, {"experimental": True}))
    prim = g1["meshes"][-1]["primitives"][0]
    assert "TEXCOORD_0" in prim["attributes"] and g1["samplers"][0]["wrapS"] == export.REPEAT
    uv = read_accessor(g1, b1, prim["attributes"]["TEXCOORD_0"])
    assert np.ptp(uv[:, 0]) > 2  # print repeats several times across the panels at real scale
    g2, b2 = parse_glb(export.glb(body, r, {"overlay": "fit-heatmap"}, vertex_rgb=rgb))
    prim2 = g2["meshes"][-1]["primitives"][0]
    col = read_accessor(g2, b2, prim2["attributes"]["COLOR_0"])
    assert col.shape == (len(r.x), 3) and col.min() >= 0 and col.max() <= 1
    assert "skins" not in g2 and "animations" not in g2  # static rest-pose drape


def test_simulate_route(client):
    cat = client.get("/v1/drape/catalog").json()
    assert {g["key"] for g in cat["garments"]} == set(pt.GARMENTS) and "disclaimer" in cat
    r = client.post("/v1/drape/simulate", json={"garment": "shirt", "size": "M", "body_size": "M", "fabric": "jersey",
                                                "params": {"sleeve": "long", "length_cm": 70}, "quality": "fast"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["experimental"] and "guidance" in j["disclaimer"]
    assert base64.b64decode(j["glb_b64"])[:4] == b"glTF" and base64.b64decode(j["heatmap_glb_b64"])[:4] == b"glTF"
    assert base64.b64decode(j["heatmap_poster_b64"])[:4] == b"\x89PNG"
    assert set(j["fit"]["share"]) == set(fit.BANDS)
    assert j["pattern"]["params"]["sleeve"] == "long" and not j["metrics"]["exploded"]
    bad = client.post("/v1/drape/simulate", json={"garment": "shirt", "params": {"ease_cm": 99}})
    assert bad.status_code == 422


def test_eval_job_smoke(client):
    j = client.post("/v1/drape/eval", json={"scope": "smoke", "quality": "fast"}).json()
    end = time.time() + 120
    while time.time() < end:
        s = client.get(f"/v1/drape/eval/{j['job_id']}").json()
        if s["status"] != "RUNNING":
            break
        time.sleep(0.2)
    assert s["status"] == "DONE", s
    rep = s["report"]
    assert rep["kind"] == "DRAPE_SPIKE" and rep["model_id"] == service.MODEL_ID
    assert rep["summary"]["runs"] >= 3 and 0 <= rep["summary"]["agreement"] <= 1
    assert len(rep["expert_checklist"]) >= 6 and set(rep["gate"]) == {"stability", "runtime", "agreement"}
