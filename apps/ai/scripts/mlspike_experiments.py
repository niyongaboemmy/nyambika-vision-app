"""R4 spike experiments behind docs/spikes/r4-local-model-trends.md (JSON lines).

Usage: python scripts/mlspike_experiments.py main|curve|drift|screen
"""
import json
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
from app.mlspike import dataset, evaluate, pipeline, synth  # noqa: E402

C = [{"page_id": f"page{i}", "consent_record_id": f"cr{i}", "consented_at": "2026-11-01T00:00:00Z"} for i in range(6)]


def build(pc, gen=1, prev=None, tomb=None, seed=7):
    specs = synth.corpus(pc, seed=seed, gen=gen)
    cands = dataset.synthetic_candidates(specs, C, "2026-11-01T00:00:00Z")
    return dataset.build_version(cands, pipeline.image_loader({}), previous=prev, tombstones=tomb or [])


def summary(r):
    h = r["heads"]
    return {
        "passed": r["passed"], "heads_passed": r["heads_passed"],
        **{f"{k}_acc": h[k]["accuracy"] for k in h},
        **{f"{k}_f1": h[k]["macro_f1"] for k in h},
        **{f"{k}_ece": h[k]["ece"] for k in h},
        **{f"{k}_ece_raw": h[k]["ece_uncalibrated"] for k in h},
        **{f"{k}_T": h[k]["temperature"] for k in h},
        **{f"{k}_gap_quality": h[k]["marginal"]["quality"]["gap"] for k in h},
        **{f"{k}_gap_pattern": h[k]["marginal"]["pattern"]["gap"] for k in h},
        **{f"{k}_gap_category": h[k]["marginal"]["category"]["gap"] for k in h},
        **{f"{k}_worst_quality": h[k]["marginal"]["quality"]["accuracy"] for k in h},
        **{f"{k}_cell_worst": h[k].get("cell_worst") for k in h},
        **{f"{k}_coverage": h[k]["coverage_at_threshold"] for k in h},
        **{f"{k}_acc_shown": h[k]["accuracy_when_shown"] for k in h},
        "ood": {k: (v.get("accuracy"), v.get("mean_confidence")) for k, v in r["ood"]["heads"].items()},
        "drift": r["drift"]["worst"] if r["drift"] else None,
        "failing": r["failing"], "train_items": r["dataset"]["splits"],
    }


which = sys.argv[1]
t = time.time()
if which == "main":
    for gen in (1, 2):
        v1 = build(16, gen)
        v2 = build(16, gen, prev=v1, tomb=[{"id": "t1", "page_id": "page2"}])
        r = pipeline.train_and_evaluate(v2, {}, previous=v1, save=False)
        print(json.dumps({"exp": f"gen{gen}_pc16", "items_v1": len(v1["items"]), "items_v2": len(v2["items"]), "dropped_v1": v1["stats"]["dropped"],
                          "removed_by_withdrawal": len(v2["diff"]["removed_by_withdrawal"]), "screen": r["screen"], **summary(r)}))
elif which == "curve":
    for pc in (4, 8, 16, 32):
        v = build(pc)
        r = pipeline.train_and_evaluate(v, {}, screen_eval=False, save=False)
        print(json.dumps({"exp": f"curve_pc{pc}", "items": len(v["items"]), **summary(r)}))
elif which == "drift":
    a = build(16, 1)
    b = build(16, 1, seed=8)
    c = build(16, 2, seed=9)
    # skewed batch: only low-light photos of 2 colours (a contributor with a dark workshop)
    skew = [i for i in build(16, 1, seed=10)["items"] if i["labels"]["quality"] == "low_light" and i["labels"]["colour"] in ("gold", "crimson")]
    load = pipeline.image_loader({})
    Xa, La = pipeline.featurise(a["items"], load), [i["labels"] for i in a["items"]]
    for name, other in (("v1→fresh seed", b["items"]), ("v1→generator v2", c["items"]), ("v1→v1+skewed batch", a["items"] + skew * 3)):
        d = evaluate.drift(Xa, La, pipeline.featurise(other, load), [i["labels"] for i in other])
        print(json.dumps({"exp": f"drift {name}", **d}))
elif which == "screen":
    print(json.dumps({"exp": "screen", **evaluate.evaluate_screen(per_tone=30, garments=6)}))
print(f"# {which} {time.time() - t:.1f}s", file=sys.stderr)
