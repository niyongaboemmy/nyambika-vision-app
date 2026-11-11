"""Orchestration for the R4 spike: manifest → features → train → evaluate → artefact."""
from __future__ import annotations

import hashlib
import os
import threading
from pathlib import Path

import numpy as np
from PIL import Image

from . import dataset, evaluate, synth
from .features import FEATURES_VERSION, features
from .model import HEADS, LICENCE, AttrModel, train

MODEL_DIR = Path(os.environ.get("ML_SPIKE_DIR", Path(__file__).resolve().parents[2] / "storage" / "mlspike"))
_feat_cache: dict[str, np.ndarray] = {}
_models: dict[str, AttrModel] = {}
_lock = threading.Lock()


def split_of(item_id: str) -> str:
    b = int(hashlib.sha256(item_id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return "train" if b < 0.85 else "val"


BENCHMARK_SEED = 4242
BENCHMARK_PER_CELL = 10  # 60 garment × pattern × quality cells × 10 = 600 held-out images (never in a manifest)


def benchmark(per_cell: int = BENCHMARK_PER_CELL) -> list[dict]:
    """Fixed, versioned synthetic test set (like the NLB persona set): disjoint seeds from any manifest."""
    return [{"item_id": f"bench-{s['seed']}", "source": "synthetic", "seed": s["seed"], "gen": 1, "labels": s["labels"]}
            for s in synth.corpus(per_cell, seed=BENCHMARK_SEED)]


def image_loader(catalogue_images: dict[str, Image.Image]):
    def load(item: dict) -> Image.Image:
        if item.get("source") == "synthetic":
            return synth.render({"seed": item["seed"], "gen": item.get("gen"), "labels": item["labels"]})
        img = catalogue_images.get(item["item_id"])
        if img is None:
            raise KeyError(f"no pixels for catalogue item {item['item_id']}")
        return img

    return load


def featurise(items: list[dict], load) -> np.ndarray:
    rows = []
    for it in items:
        key = it.get("sha256") or it["item_id"]
        f = _feat_cache.get(key)
        if f is None:
            f = features(load(it))
            if len(_feat_cache) < 20_000:
                _feat_cache[key] = f
        rows.append(f)
    return np.array(rows) if rows else np.zeros((0, 1))


def model_version_id(manifest: dict) -> str:
    return f"attr-spike-d{manifest['version']}-{manifest['hash'][:8]}"


def train_and_evaluate(manifest: dict, catalogue_images: dict[str, Image.Image], previous: dict | None = None,
                       screen_eval: bool = True, save: bool = True, bench_per_cell: int = BENCHMARK_PER_CELL) -> dict:
    load = image_loader(catalogue_images)
    items = manifest["items"]
    parts = {s: [i for i in items if split_of(i["item_id"]) == s] for s in ("train", "val")}
    parts["test"] = benchmark(bench_per_cell)
    X = {s: featurise(v, load) for s, v in parts.items()}
    L = {s: [i["labels"] for i in v] for s, v in parts.items()}
    version = model_version_id(manifest)
    classes = {"category": list(synth.GARMENTS), "pattern": list(synth.PATTERNS), "colour": list(synth.COLOURS)}
    model = train(X["train"], L["train"], version=version, dataset_hash=manifest["hash"], val_X=X["val"], val_labels=L["val"], classes=classes)
    model.meta.update({"features": FEATURES_VERSION, "dataset_version": manifest["version"], "splits": {s: len(v) for s, v in parts.items()}})
    report = evaluate.evaluate_model(model, X["test"], L["test"])
    drift = None
    if previous and previous.get("items"):
        # Withdrawn catalogue items of the previous version are never re-read: drift uses what is still available.
        prev_items = [i for i in previous["items"] if i.get("source") == "synthetic" or i["item_id"] in catalogue_images]
        drift = evaluate.drift(featurise(prev_items, load), [i["labels"] for i in prev_items], featurise(items, load), [i["labels"] for i in items])
        if not drift["passed"]:
            report["failing"].append(f"drift PSI {drift['worst']:.2f} between dataset v{previous.get('version')} and v{manifest['version']}")
    scr = evaluate.evaluate_screen() if screen_eval else None
    if scr and not scr["passed"]:
        report["failing"].extend(scr["failing"])
    ood = evaluate.evaluate_ood(model)
    for h, o in ood["heads"].items():
        if not o["passed"]:
            report["failing"].append(f"{h}: out-of-distribution " + (f"accuracy {o['accuracy']:.2f}, overconfidence {o['overconfidence']:.2f}" if o["accuracy"] is not None else "not measurable"))
    # Per-head release: a head is served only if all of its own checks pass, including OOD evidence.
    # The model as a whole may be activated when the shared checks (screen, drift) pass and >= 1 head passes.
    heads_passed = [h for h, r in report["heads"].items() if not r["failing"] and ood["heads"].get(h, {}).get("passed")]
    shared_ok = (scr is None or scr["passed"]) and (drift is None or drift["passed"])
    report["passed"] = shared_ok and bool(heads_passed)
    if save:
        model.save(MODEL_DIR / f"{version}.json")
        with _lock:
            _models[version] = model
    return {
        "model_version": version,
        "passed": report["passed"],
        "licence": LICENCE,
        "commercial_use": True,
        "dataset": {"version": manifest["version"], "hash": manifest["hash"], "items": len(items), "splits": model.meta["splits"]},
        "benchmark": {"seed": BENCHMARK_SEED, "per_cell": bench_per_cell, "items": len(parts["test"]), "generator": synth.GENERATOR_VERSION},
        "thresholds": evaluate.THRESHOLDS,
        "heads": report["heads"],
        "cells": report["cells"],
        "failing": report["failing"],
        "heads_passed": heads_passed,
        "heads_blocked": [h for h in report["heads"] if h not in heads_passed],
        "all_heads_passed": not report["failing"],
        "ood": ood,
        "drift": drift,
        "screen": scr,
        "artifact_bytes": (MODEL_DIR / f"{version}.json").stat().st_size if save else None,
    }


def get_model(version: str) -> AttrModel | None:
    with _lock:
        m = _models.get(version)
    if m:
        return m
    path = MODEL_DIR / f"{Path(version).name}.json"
    if not path.exists():
        return None
    m = AttrModel.load(path)
    with _lock:
        _models[version] = m
    return m


def suggest(model: AttrModel, img: Image.Image) -> dict:
    pred = model.predict(features(img), top=3)[0]
    return {"model_version": model.version, "heads": {h: pred[h] for h in HEADS if h in pred}, "threshold": evaluate.THRESHOLDS["suggest_p_min"]}
