"""NLB-style evaluation for the attribute spike: subgroup accuracy/F1, fairness gap, calibration, drift,
selective accuracy at the suggestion threshold, and the PII screen per skin tone.

Thresholds are fixed up front (before any run) and live in THRESHOLDS; the report says which failed.
"""
from __future__ import annotations

from itertools import product

import numpy as np

from . import synth
from .model import HEADS, AttrModel
from .screen import screen

THRESHOLDS = {
    "macro_f1_min": 0.90,           # per head, whole test split
    "marginal_worst_min": 0.85,     # per head, worst garment-type / pattern-family / photo-quality group
    "fairness_gap_max": 0.10,       # per head, best minus worst marginal group accuracy
    "cell_worst_min": 0.70,         # per head, worst garment × pattern × quality cell with n >= cell_min_n
    "cell_min_n": 8,
    "ece_max": 0.05,                # per head, after temperature scaling (15 bins)
    "drift_psi_max": 0.20,          # label + feature PSI between consecutive dataset versions
    "suggest_p_min": 0.60,          # suggestions below this calibrated confidence are not shown
    "screen_recall_min": 0.98,      # persons caught, per skin tone
    "screen_false_drop_max": 0.03,  # garment photos wrongly dropped
}
SUBGROUP_AXES = ("category", "pattern", "quality")


def macro_f1(y: list[str], p: list[str], classes: list[str]) -> float:
    f1s = []
    for c in classes:
        tp = sum(1 for a, b in zip(y, p) if a == c and b == c)
        fp = sum(1 for a, b in zip(y, p) if a != c and b == c)
        fn = sum(1 for a, b in zip(y, p) if a == c and b != c)
        if tp + fp + fn == 0:
            continue
        f1s.append(2 * tp / (2 * tp + fp + fn))
    return float(np.mean(f1s)) if f1s else 0.0


def ece(conf: np.ndarray, correct: np.ndarray, bins: int = 15) -> float:
    if len(conf) == 0:
        return 0.0
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            total += m.mean() * abs(conf[m].mean() - correct[m].mean())
    return float(total)


def psi(expected: np.ndarray, actual: np.ndarray, bins: int = 10) -> float:
    """Population stability index of a numeric feature (quantile bins from `expected`)."""
    if len(expected) < 2 or len(actual) < 2:
        return 0.0
    qs = np.unique(np.quantile(expected, np.linspace(0, 1, bins + 1)))
    if len(qs) < 3:
        return 0.0
    e = np.histogram(np.clip(expected, qs[0], qs[-1]), qs)[0] / len(expected)
    a = np.histogram(np.clip(actual, qs[0], qs[-1]), qs)[0] / len(actual)
    e, a = np.clip(e, 1e-4, None), np.clip(a, 1e-4, None)
    return float(np.sum((a - e) * np.log(a / e)))


def label_psi(prev: list[str], cur: list[str]) -> float:
    cats = sorted(set(prev) | set(cur))
    if not prev or not cur:
        return 0.0
    e = np.clip(np.array([prev.count(c) / len(prev) for c in cats]), 1e-4, None)
    a = np.clip(np.array([cur.count(c) / len(cur) for c in cats]), 1e-4, None)
    return float(np.sum((a - e) * np.log(a / e)))


def drift(prev_X: np.ndarray, prev_labels: list[dict], cur_X: np.ndarray, cur_labels: list[dict]) -> dict:
    per_dim = [psi(prev_X[:, j], cur_X[:, j]) for j in range(prev_X.shape[1])] if len(prev_X) and len(cur_X) else [0.0]
    labels = {h: round(label_psi([l[h] for l in prev_labels if l.get(h)], [l[h] for l in cur_labels if l.get(h)]), 4) for h in HEADS}
    feat = float(np.mean(per_dim))
    worst = max([feat, *labels.values()])
    return {"feature_psi_mean": round(feat, 4), "feature_psi_p95": round(float(np.quantile(per_dim, 0.95)), 4),
            "label_psi": labels, "worst": round(worst, 4), "passed": worst < THRESHOLDS["drift_psi_max"],
            "n_prev": len(prev_X), "n_cur": len(cur_X)}


def evaluate_model(model: AttrModel, X: np.ndarray, labels: list[dict]) -> dict:
    Xs = model.standardise(X)
    heads: dict[str, dict] = {}
    failing: list[str] = []
    cells_out: list[dict] = []
    for name, h in model.heads.items():
        rows = [i for i, lb in enumerate(labels) if lb.get(name) in h.classes]
        if not rows:
            continue
        P = h.proba(Xs[rows])
        P_raw = h.proba(Xs[rows], calibrated=False)
        pred = [h.classes[j] for j in P.argmax(axis=1)]
        true = [labels[i][name] for i in rows]
        correct = np.array([a == b for a, b in zip(true, pred)], dtype=float)
        conf = P.max(axis=1)
        shown = conf >= THRESHOLDS["suggest_p_min"]
        res = {
            "n": len(rows),
            "accuracy": round(float(correct.mean()), 4),
            "macro_f1": round(macro_f1(true, pred, h.classes), 4),
            "ece": round(ece(conf, correct), 4),
            "ece_uncalibrated": round(ece(P_raw.max(axis=1), correct), 4),
            "temperature": h.T,
            "coverage_at_threshold": round(float(shown.mean()), 4),
            "accuracy_when_shown": round(float(correct[shown].mean()), 4) if shown.any() else None,
            "marginal": {},
        }
        for axis in SUBGROUP_AXES:
            groups: dict[str, list[float]] = {}
            for k, i in enumerate(rows):
                g = labels[i].get(axis)
                if g:
                    groups.setdefault(g, []).append(correct[k])
            accs = {g: round(float(np.mean(v)), 4) for g, v in sorted(groups.items())}
            if accs:
                gap = round(max(accs.values()) - min(accs.values()), 4)
                res["marginal"][axis] = {"accuracy": accs, "n": {g: len(v) for g, v in sorted(groups.items())}, "gap": gap,
                                         "worst": min(accs, key=accs.get)}
                if min(accs.values()) < THRESHOLDS["marginal_worst_min"]:
                    failing.append(f"{name}: {axis}={min(accs, key=accs.get)} accuracy {min(accs.values()):.2f}")
                if gap > THRESHOLDS["fairness_gap_max"]:
                    failing.append(f"{name}: {axis} fairness gap {gap:.2f}")
        # Intersectional cells.
        cells: dict[tuple, list[float]] = {}
        for k, i in enumerate(rows):
            key = tuple(labels[i].get(a) for a in SUBGROUP_AXES)
            if all(key):
                cells.setdefault(key, []).append(correct[k])
        gated = {k: float(np.mean(v)) for k, v in cells.items() if len(v) >= THRESHOLDS["cell_min_n"]}
        res["cells_evaluated"] = len(cells)
        res["cells_gated"] = len(gated)
        if gated:
            wk = min(gated, key=gated.get)
            res["cell_worst"] = {"cell": "×".join(wk), "accuracy": round(gated[wk], 4)}
            if gated[wk] < THRESHOLDS["cell_worst_min"]:
                failing.append(f"{name}: cell {'×'.join(wk)} accuracy {gated[wk]:.2f}")
        for key, v in sorted(cells.items()):
            cells_out.append({"head": name, "cell": "×".join(key), "n": len(v), "accuracy": round(float(np.mean(v)), 4)})
        if res["macro_f1"] < THRESHOLDS["macro_f1_min"]:
            failing.append(f"{name}: macro-F1 {res['macro_f1']:.2f}")
        if res["ece"] > THRESHOLDS["ece_max"]:
            failing.append(f"{name}: ECE {res['ece']:.3f}")
        heads[name] = res
    return {"heads": heads, "failing": failing, "cells": cells_out, "passed": not failing}


def evaluate_screen(per_tone: int = 12, garments: int = 2, seed: int = 99) -> dict:
    """Person recall per synthetic skin tone + false drops on synthetic garment photos."""
    tones = {}
    for t, tone in enumerate(synth.SKIN_TONES):
        hits = sum(screen(synth.person_image(tone, seed + 31 * t + i, synth.GARMENTS[i % 4]))["has_person"] for i in range(per_tone))
        tones[tone] = round(hits / per_tone, 4)
    specs = synth.corpus(garments, seed=seed + 1)
    drops = sum(screen(synth.render(s))["has_person"] for s in specs)
    false_drop = round(drops / len(specs), 4)
    failing = [f"screen recall {t} {r:.2f}" for t, r in tones.items() if r < THRESHOLDS["screen_recall_min"]]
    if false_drop > THRESHOLDS["screen_false_drop_max"]:
        failing.append(f"screen false drops {false_drop:.2f}")
    return {"recall_by_tone": tones, "false_drop_rate": false_drop, "n_garments": len(specs), "n_persons": per_tone * len(tones),
            "failing": failing, "passed": not failing}


def subgroup_names() -> list[str]:
    return ["×".join(k) for k in product(synth.GARMENTS, synth.PATTERNS, synth.QUALITIES)]
