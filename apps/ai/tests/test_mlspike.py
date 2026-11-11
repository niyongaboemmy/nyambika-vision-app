"""R4 spike: consented dataset manifests, withdrawal, PII screen, local attribute model + eval, attr routing."""
import numpy as np
import pytest

from app.mlspike import dataset, evaluate, pipeline, synth
from app.mlspike.model import train
from app.mlspike.screen import screen
from tests.conftest import b64_image

CONTRIB = [{"page_id": f"page-{i}", "consent_record_id": f"consent-{i}", "consented_at": "2026-11-01T00:00:00Z"} for i in range(3)]


def _cands(per_cell=1, seed=3):
    return dataset.synthetic_candidates(synth.corpus(per_cell, seed=seed), CONTRIB, "2026-11-01T00:00:00Z")


def _load(extra=None):
    return pipeline.image_loader(extra or {})


# ── manifest + provenance ─────────────────────────────────────────────────────

def test_manifest_has_full_provenance_and_is_deterministic():
    cands = _cands()
    m1 = dataset.build_version(cands, _load())
    m2 = dataset.build_version(cands, _load())
    assert m1["version"] == 1 and m1["parent_hash"] is None
    assert m1["hash"] == m2["hash"]
    assert len(m1["items"]) >= 55  # 60 cells, a few may be screened out
    for it in m1["items"]:
        for k in ("item_id", "source", "page_id", "product_id", "licence", "consent_record_id", "consented_at", "captured_at", "sha256", "labels"):
            assert it[k], k
        assert it["licence"] == dataset.SYNTHETIC_LICENCE
    assert m1["stats"]["pages"] == 3


def test_missing_provenance_is_dropped_not_trained():
    cands = _cands()[:4]
    cands[0] = {**cands[0], "consent_record_id": None}
    m = dataset.build_version(cands, _load(), run_screen=False)
    assert cands[0]["item_id"] not in {i["item_id"] for i in m["items"]}
    assert any(d["reason"].startswith("missing provenance") for d in m["dropped"])


@pytest.mark.parametrize("bad", [
    {"source": "twin", "image_ref": "private/twins/u1.bin"},
    {"source": "look", "image_ref": "private/looks/x.png"},
    {"source": "catalogue", "image_ref": "private/wardrobe/u1/a.png"},
    {"source": "catalogue", "image_ref": "public/personas/persona-1.png"},
    {"source": "catalogue", "image_ref": "https://example.com/a.png"},
])
def test_shopper_data_is_refused_by_code(bad):
    item = {**_cands()[0], **bad}
    with pytest.raises(dataset.ShopperDataError):
        dataset.build_version([item], _load())


def test_shopper_data_refused_over_http(client):
    img = synth.render(synth.corpus(1)[0])
    body = {"catalogue": [{"item_id": "x", "page_id": "p", "product_id": "q", "consent_record_id": "c", "consented_at": "2026-11-01",
                           "image_ref": "private/twins/user.bin", "image_b64": b64_image(img)}]}
    r = client.post("/v1/ml/dataset/build", json=body)
    assert r.status_code == 422 and "Refused" in r.json()["detail"]


# ── withdrawal ────────────────────────────────────────────────────────────────

def test_page_withdrawal_removes_items_from_next_version_and_tombstones_hashes():
    cands = _cands()
    v1 = dataset.build_version(cands, _load(), run_screen=False)
    v2 = dataset.build_version(cands, _load(), previous=v1, tombstones=[{"id": "t-1", "page_id": "page-1"}], run_screen=False)
    assert v2["version"] == 2 and v2["parent_hash"] == v1["hash"] and v2["hash"] != v1["hash"]
    assert not [i for i in v2["items"] if i["page_id"] == "page-1"]
    gone = {i["item_id"] for i in v1["items"] if i["page_id"] == "page-1"}
    assert set(v2["diff"]["removed_by_withdrawal"]) == gone
    assert len(v2["withdrawn_hashes"]) == len(gone)
    assert "t-1" in v2["tombstones"]
    # The same photo re-submitted under another page/product stays out of every later version.
    resub = {**next(c for c in cands if c["page_id"] == "page-1"), "item_id": "resub", "page_id": "page-0", "product_id": "other"}
    v3 = dataset.build_version(cands + [resub], _load(), previous=v2, tombstones=[{"id": "t-1", "page_id": "page-1"}], run_screen=False)
    assert "resub" not in {i["item_id"] for i in v3["items"]}
    assert any(d["reason"] == "withdrawn image re-submitted" for d in v3["dropped"])


def test_reconsent_after_withdrawal_covers_only_new_contributions():
    cands = _cands()
    v1 = dataset.build_version(cands, _load(), run_screen=False)
    tomb = [{"id": "t-1", "page_id": "page-1", "at": "2026-11-05T00:00:00Z"}]
    v2 = dataset.build_version(cands, _load(), previous=v1, tombstones=tomb, run_screen=False)
    old = next(c for c in cands if c["page_id"] == "page-1")
    # Re-consented on 7 Nov: a new photo enters, the old (withdrawn) pixels never come back.
    new_spec = synth.corpus(1, seed=77)[0]
    fresh = {**old, "item_id": "fresh", "seed": new_spec["seed"], "labels": new_spec["labels"], "consented_at": "2026-11-07T00:00:00Z", "consent_record_id": "consent-1b"}
    again = {**old, "item_id": "again", "consented_at": "2026-11-07T00:00:00Z", "consent_record_id": "consent-1b"}
    v3 = dataset.build_version(cands + [fresh, again], _load(), previous=v2, tombstones=tomb, run_screen=False)
    ids = {i["item_id"] for i in v3["items"]}
    assert "fresh" in ids and "again" not in ids and old["item_id"] not in ids


def test_product_level_withdrawal_only_removes_that_product():
    cands = _cands()
    target = cands[0]
    v2 = dataset.build_version(cands, _load(), tombstones=[{"id": "t-2", "page_id": target["page_id"], "product_id": target["product_id"]}], run_screen=False)
    ids = {i["item_id"] for i in v2["items"]}
    assert all(c["item_id"] not in ids for c in cands if c["product_id"] == target["product_id"])
    assert any(i["page_id"] == target["page_id"] for i in v2["items"])


# ── PII screen ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tone", list(synth.SKIN_TONES))
def test_screen_drops_synthetic_people_of_every_skin_tone(tone):
    hits = [screen(synth.person_image(tone, s, synth.GARMENTS[s % 4]))["has_person"] for s in range(6)]
    assert all(hits)


def test_screen_keeps_garments_and_builder_drops_people(assets):
    from PIL import Image

    kept = [not screen(synth.render(s))["has_person"] for s in synth.corpus(1, seed=11)]
    assert np.mean(kept) >= 0.95
    assert screen(Image.open(assets / "persona-3.png"))["has_person"]
    assert not screen(Image.open(assets / "dress-terracotta-circles.png"))["has_person"]
    person = synth.person_image("mst8", 1)
    cand = {**_cands()[0], "source": "catalogue", "image_ref": "public/media/p/x.png", "item_id": "cat-1"}
    m = dataset.build_version([cand], _load({"cat-1": person}))
    assert m["items"] == [] and m["dropped"][0]["reason"].startswith("person detected")


# ── model + evaluation ───────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def small_run(tmp_path_factory):
    pipeline.MODEL_DIR = tmp_path_factory.mktemp("models")
    v1 = dataset.build_version(_cands(per_cell=8, seed=5), _load(), run_screen=False)
    v2 = dataset.build_version(_cands(per_cell=8, seed=5), _load(), previous=v1, tombstones=[{"id": "t", "page_id": "page-2"}], run_screen=False)
    return v1, v2, pipeline.train_and_evaluate(v2, {}, previous=v1, screen_eval=False, bench_per_cell=2)


def test_train_eval_reports_subgroups_calibration_and_drift(small_run):
    _v1, v2, r = small_run
    assert r["model_version"] == pipeline.model_version_id(v2)
    assert set(r["heads"]) == {"category", "pattern", "colour"}
    cat = r["heads"]["category"]
    assert cat["accuracy"] >= 0.9 and cat["macro_f1"] >= 0.85
    for axis in ("category", "pattern", "quality"):
        assert axis in cat["marginal"] and "gap" in cat["marginal"][axis]
    assert len({c["cell"] for c in r["cells"]}) == 60
    assert 0 <= r["heads"]["colour"]["ece"] <= 1 and r["heads"]["colour"]["temperature"] > 0
    assert r["drift"]["passed"] and r["drift"]["n_prev"] > r["drift"]["n_cur"]
    assert (pipeline.MODEL_DIR / f"{r['model_version']}.json").exists() and r["artifact_bytes"] < 80_000


def test_eval_flags_unfair_or_weak_models():
    specs = synth.corpus(3, seed=21)
    X = np.array([pipeline.features(synth.render(s)) for s in specs])
    labels = [s["labels"] for s in specs]
    # A model trained only on good-quality photos must be caught on the photo-quality axis or elsewhere.
    good = [i for i, lb in enumerate(labels) if lb["quality"] == "good"]
    rng = np.random.default_rng(0)
    noisy = [dict(lb, pattern=str(rng.choice(synth.PATTERNS))) for lb in labels]
    m = train(X[good], [noisy[i] for i in good], version="bad", dataset_hash="x", iters=50)
    rep = evaluate.evaluate_model(m, X, labels)
    assert not rep["passed"] and any(f.startswith("pattern") for f in rep["failing"])


def test_metric_helpers():
    assert evaluate.macro_f1(["a", "b"], ["a", "b"], ["a", "b"]) == 1.0
    assert evaluate.ece(np.array([1.0, 1.0]), np.array([1.0, 1.0])) == 0.0
    x = np.random.default_rng(1).normal(0, 1, 500)
    assert evaluate.psi(x, x) < 0.01
    assert evaluate.psi(x, x + 2) > 0.2
    shifted = evaluate.drift(x[:, None], [{"category": "dress"}] * 500, (x + 2)[:, None], [{"category": "shirt"}] * 500)
    assert not shifted["passed"]


# ── suggestion through the E42 router (route attr, pool backend) ─────────────

def test_suggest_served_by_pool_model_then_rules_when_unavailable(client, small_run):
    _v1, _v2, r = small_run
    img = synth.garment_image("shirt", "imigongo", "teal", "good", 123)
    ok = client.post("/v1/ml/attr/suggest", json={"image_b64": b64_image(img), "model_version": r["model_version"]}).json()
    assert ok["served_by"] == "pool" and ok["model_version"] == r["model_version"]
    assert ok["heads"]["category"][0]["label"] == "shirt"
    assert ok["heads"]["colour"][0]["label"] == "teal"
    # Residency: attr is in-region only; a request from another country never leaves -> rules fallback.
    away = client.post("/v1/ml/attr/suggest", json={"image_b64": b64_image(img), "model_version": r["model_version"], "region": "ke"}).json()
    assert away["served_by"] == "rules" and "residency" in away["route"]["error"]
    missing = client.post("/v1/ml/attr/suggest", json={"image_b64": b64_image(img), "model_version": "attr-spike-d99-nope"}).json()
    assert missing["served_by"] == "rules" and missing["heads"]["colour"][0]["label"] == "teal"


def test_attr_route_policy_defaults():
    from app.inference.policy import default_policy

    p = default_policy().routes["attr"]
    assert p.strategy == "pool-only" and p.residency == "in-region"
