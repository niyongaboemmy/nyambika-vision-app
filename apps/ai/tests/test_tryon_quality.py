"""Try-on quality pass (Nov 2026): exposure on detail, category mapping, old clothing hidden, uniform scaling,
placement guard. Synthetic personas and garments; the real Wikimedia tee is fetched and skipped offline."""
import numpy as np
import pytest
from PIL import Image

import make_seed_assets as seeds
import quality_fixtures as fx
from app import garment, guard
from app.landmarks import landmarks
from app.main import _label
from app.providers import get_provider
from app.twin import subject

UNDERSHIRT = np.array([236, 232, 226])


@pytest.fixture(scope="module")
def tees(tmp_path_factory):
    out = tmp_path_factory.mktemp("tees")
    return {k: Image.open(seeds.tee(hx, out / f"tee-{k}.png")).convert("RGB") for k, hx in fx.TEE_SHADES.items()}


def _expose(img: Image.Image, kind: str) -> Image.Image:
    a = np.asarray(img, dtype=np.float32)
    rng = np.random.default_rng(3)
    a = {
        "under": lambda: a * 0.12 + rng.normal(0, 1.2, a.shape),     # far too little light, sensor noise
        "crushed": lambda: (a / 255) ** 2.6 * 255 * 0.35,          # shadows crushed to black
        "blown": lambda: a * 6.0 + 90,                              # highlights clipped
        "washed": lambda: 255 - (255 - a) * 0.15,                   # flat, washed-out
    }[kind]()
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


# ---- 3. exposure ---------------------------------------------------------------------------------------------
@pytest.mark.parametrize("shade", ["dark", "brown", "mid", "light"])
def test_dark_mid_light_garments_pass_exposure(tees, shade):
    r = garment.assess(tees[shade], "t-shirt")
    assert r["checks"]["exposure"], r["exposure"]
    assert r["readiness"] == "READY", r["notes"]


@pytest.mark.parametrize("kind,verdict", [("under", "under"), ("crushed", "under"), ("blown", "over"), ("washed", "flat")])
@pytest.mark.parametrize("shade", ["dark", "mid", "light"])
def test_badly_exposed_photos_fail(tees, shade, kind, verdict):
    r = garment.assess(_expose(tees[shade], kind), "t-shirt")
    assert not r["checks"]["exposure"]
    assert r["readiness"] == "NEEDS_BETTER_PHOTO"
    if r["exposure"]["verdict"] != verdict:  # a light tee blown out can read as 'flat'; both are failures
        assert kind in ("blown", "washed")


def test_seeded_patterned_garments_still_pass(assets):
    for name in ("dress-terracotta-circles", "skirt-terracotta-circles", "shirt-teal-waves"):
        assert garment.assess(Image.open(assets / f"{name}.png"))["checks"]["exposure"]


def test_real_brown_tee_passes_exposure():
    tee = fx.real_tee()
    if tee is None:
        pytest.skip("real tee fixture not reachable (offline)")
    r = garment.assess(tee, "T-Shirt")
    assert r["checks"]["exposure"], r["exposure"]
    assert r["tryon_class"] == "top"


# ---- 5. categories -------------------------------------------------------------------------------------------
@pytest.mark.parametrize("text,cls", [
    ("shirt", "top"), ("T-Shirt", "top"), ("tees", "top"), ("Polo", "top"), ("TOP", "top"), ("blouse", "top"),
    ("Jacket", "top"), ("dress shirt", "top"), ("skirt", "skirt"), ("Wrap skirt", "skirt"), ("jupe", "skirt"),
    ("dress", "dress"), ("Kitenge dress", "dress"), ("shirt dress", "dress"), ("UMUSHANANA", "dress"),
    ("gown", "dress"), ("robe longue", "dress"),
])
def test_catalogue_categories_map_case_insensitively(text, cls):
    assert garment.canonical_category(text) == cls


@pytest.mark.parametrize("text", ["kitenge", "wrap", "", None, "Other", "outfit"])
def test_unknown_categories_are_guessed_from_shape(text, assets, tees):
    cases = {"top": tees["mid"], "skirt": Image.open(assets / "skirt-terracotta-circles.png"),
             "dress": Image.open(assets / "dress-terracotta-circles.png")}
    for want, photo in cases.items():
        r = garment.assess(photo, text)
        assert (r["tryon_class"], r["tryon_class_source"]) == (want, "shape")


# ---- 1/2. compositor -----------------------------------------------------------------------------------------
def _render(persona_path, cut, category, tier="PREVIEW"):
    r = get_provider("local-compositor").generate(Image.open(persona_path), cut, category, tier)
    labelled, label_box = _label(r.image)
    v = guard.evaluate(r.twin_resized, labelled, cut, r.garment_alpha, r.subject_box, exclude_box=label_box,
                       category=category, edit_mask=r.edit_mask)
    return r, labelled, v


@pytest.mark.parametrize("p", [1, 2, 3, 4, 5])
def test_tee_hides_undershirt_and_sits_at_the_hips(assets, tees, p):
    cut = garment.assess(tees["brown"], "t-shirt")["cutout"]
    r, out, v = _render(assets / f"persona-{p}.png", cut, "t-shirt")
    assert v["passed"], v
    assert r.garment_class == "top"
    tw = np.asarray(r.twin_resized, dtype=np.int32)
    o = np.asarray(out, dtype=np.int32)
    mask, box = subject(r.twin_resized)
    body = landmarks(mask, box)
    shirt = (np.abs(tw - UNDERSHIRT).max(-1) <= 18) & mask
    shirt[: body.head_y1] = False
    left = shirt & (np.abs(o - UNDERSHIRT).max(-1) <= 18)
    assert left.sum() / shirt.sum() < 0.005
    # identity region untouched
    assert np.array_equal(tw[: body.head_y1], o[: body.head_y1])
    ys = np.nonzero(r.garment_alpha.max(axis=1) > 0.5)[0]
    assert abs(ys.min() - body.neck_y) <= 0.03 * body.height
    assert 0.45 <= body.frac(ys.max()) <= 0.66


def test_scaling_is_uniform_up_to_the_wrap(assets, tees):
    cut = garment.assess(tees["mid"], "t-shirt")["cutout"]
    for p in (1, 5):
        r, _, v = _render(assets / f"persona-{p}.png", cut, "t-shirt")
        assert v["placement"]["aspect_ratio"] < 1.35  # flat -> worn wrap only, never the old 2x stretch


def test_skirt_starts_at_the_waist_and_leaves_the_top(assets):
    cut = garment.assess(Image.open(assets / "skirt-terracotta-circles.png"), "skirt")["cutout"]
    r, out, v = _render(assets / "persona-3.png", cut, "skirt")
    assert v["passed"], v
    assert r.garment_class == "skirt" and not r.edit_mask.any()
    assert 0.33 <= v["placement"]["top"] <= 0.45


def test_hd_latency_budget(assets, tees):
    import time

    cut = garment.assess(tees["brown"], "t-shirt")["cutout"]
    prov = get_provider("local-compositor")
    twin = Image.open(assets / "persona-5.png")
    prov.generate(twin, cut, "t-shirt", "HD")
    t = time.perf_counter()
    for _ in range(3):
        prov.generate(twin, cut, "t-shirt", "HD")
    # ~300 ms target on a dev laptop; the assertion is loose because CI and shared machines are noisy.
    assert (time.perf_counter() - t) / 3 < 1.0


# ---- 4. placement guard --------------------------------------------------------------------------------------
def test_guard_withholds_a_shirt_placed_as_a_dress(assets, tees):
    """The lead's case: a tee stretched shoulders-to-calf passed with fidelity 0.97 before the placement check."""
    cut = garment.assess(tees["brown"], "t-shirt")["cutout"]
    r = get_provider("local-compositor").generate(Image.open(assets / "persona-3.png"), cut, "t-shirt", "PREVIEW")
    mask, box = subject(r.twin_resized)
    body = landmarks(mask, box)
    # Re-render the old way: cut-out resized independently in x and y into a dress box.
    gb = garment.bbox(np.asarray(cut)[..., 3] > 10)
    g = cut.crop(gb).resize((int(body.chest_w * 1.8), int(0.53 * body.height)), Image.LANCZOS)
    out = r.twin_resized.convert("RGBA")
    layer = Image.new("RGBA", out.size, (0, 0, 0, 0))
    layer.paste(g, (int(body.cx - g.width / 2), int(body.top + 0.19 * body.height)), g)
    out = Image.alpha_composite(out, layer).convert("RGB")
    alpha = np.asarray(layer)[..., 3] / 255
    labelled, lb = _label(out)
    old = guard.evaluate(r.twin_resized, labelled, cut, alpha, r.subject_box, exclude_box=lb)
    assert old["passed"]  # without a category the guard cannot know
    v = guard.evaluate(r.twin_resized, labelled, cut, alpha, r.subject_box, exclude_box=lb, category="t-shirt")
    assert not v["passed"]
    assert "placement_implausible" in v["reasons"] and "garment_distorted" in v["reasons"]


def test_guard_placement_passes_good_renders_all_personas(assets):
    for name, cat in (("dress-terracotta-circles", "dress"), ("shirt-teal-waves", "shirt"),
                      ("skirt-terracotta-circles", "Skirt")):
        cut = garment.assess(Image.open(assets / f"{name}.png"), cat)["cutout"]
        for p in range(1, 6):
            _, _, v = _render(assets / f"persona-{p}.png", cut, cat)
            assert v["passed"], (name, p, v)


def test_tryon_endpoint_reports_placement(client, assets):
    from .conftest import b64

    r = client.post("/v1/tryon", json={"twin_b64": b64(assets / "persona-2.png"),
                                       "garment_b64": b64(assets / "shirt-teal-waves.png"),
                                       "garment_category": "Kitenge Shirt"}).json()
    assert r["status"] == "DELIVERED", r["guard"]
    assert r["guard"]["placement"]["class"] == "top"


def test_top_hem_band_allows_long_shirts_but_not_dress_length():
    # Regression: wardrobe outfits with a long shirt (hem 0.66–0.68 of body height) were withheld as
    # placement_implausible. Tunic length is plausible; a top stretched into a dress box (~0.72+) is not.
    from app.landmarks import PLACEMENT

    lo, hi = PLACEMENT["top"]["hem"]
    assert lo <= 0.676 <= hi
    assert not (lo <= 0.72 <= hi)
