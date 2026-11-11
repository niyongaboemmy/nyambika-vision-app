"""Tiny multi-head linear probe (numpy only): category · pattern family · dominant colour.

Softmax regression per head on standardised features, full-batch Adam with L2, then temperature scaling
per head on a held-out validation split (calibration). Rows whose label is unknown for a head (for
example a consented catalogue photo without a pattern-family label) are masked out of that head's loss.
The artefact is a small JSON file (~40 KB), versioned by the dataset hash it was trained on.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

HEADS = ("category", "pattern", "colour")
MODEL_FAMILY = "nyambika-attr-spike"
LICENCE = "Nyambika-internal (trained on CC0 synthetic + maker-consented catalogue images)"


def _softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


@dataclass
class Head:
    classes: list[str]
    W: np.ndarray
    b: np.ndarray
    T: float = 1.0

    def proba(self, Xs: np.ndarray, calibrated: bool = True) -> np.ndarray:
        return _softmax((Xs @ self.W + self.b) / (self.T if calibrated else 1.0))


@dataclass
class AttrModel:
    version: str
    dataset_hash: str
    mean: np.ndarray
    std: np.ndarray
    heads: dict[str, Head] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)

    def standardise(self, X: np.ndarray) -> np.ndarray:
        return (X - self.mean) / self.std

    def predict(self, X: np.ndarray, top: int = 3) -> list[dict]:
        Xs = self.standardise(np.atleast_2d(X))
        out = [{} for _ in range(len(Xs))]
        for name, h in self.heads.items():
            P = h.proba(Xs)
            for i, row in enumerate(P):
                order = np.argsort(row)[::-1][:top]
                out[i][name] = [{"label": h.classes[j], "p": round(float(row[j]), 4)} for j in order]
        return out

    # ── persistence ──────────────────────────────────────────────────────────
    def to_json(self) -> dict:
        r = lambda a: [round(float(v), 5) for v in np.ravel(a)]  # noqa: E731
        return {"family": MODEL_FAMILY, "version": self.version, "dataset_hash": self.dataset_hash, "licence": LICENCE,
                "dim": int(self.mean.shape[0]), "mean": r(self.mean), "std": r(self.std), "meta": self.meta,
                "heads": {k: {"classes": h.classes, "W": r(h.W), "b": r(h.b), "T": h.T} for k, h in self.heads.items()}}

    @classmethod
    def from_json(cls, d: dict) -> "AttrModel":
        dim = d["dim"]
        heads = {k: Head(v["classes"], np.array(v["W"]).reshape(dim, len(v["classes"])), np.array(v["b"]), float(v["T"]))
                 for k, v in d["heads"].items()}
        return cls(d["version"], d["dataset_hash"], np.array(d["mean"]), np.array(d["std"]), heads, d.get("meta", {}))

    def save(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_json()))
        return path

    @classmethod
    def load(cls, path: Path) -> "AttrModel":
        return cls.from_json(json.loads(path.read_text()))


def _fit_head(Xs: np.ndarray, y: np.ndarray, k: int, l2: float, iters: int, lr: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    n, d = Xs.shape
    W = rng.normal(0, 0.01, (d, k))
    b = np.zeros(k)
    Y = np.eye(k)[y]
    mW, vW, mb, vb = np.zeros_like(W), np.zeros_like(W), np.zeros_like(b), np.zeros_like(b)
    b1, b2, eps = 0.9, 0.999, 1e-8
    for t in range(1, iters + 1):
        P = _softmax(Xs @ W + b)
        G = (P - Y) / n
        gW = Xs.T @ G + l2 * W
        gb = G.sum(axis=0)
        mW = b1 * mW + (1 - b1) * gW
        vW = b2 * vW + (1 - b2) * gW**2
        mb = b1 * mb + (1 - b1) * gb
        vb = b2 * vb + (1 - b2) * gb**2
        W -= lr * (mW / (1 - b1**t)) / (np.sqrt(vW / (1 - b2**t)) + eps)
        b -= lr * (mb / (1 - b1**t)) / (np.sqrt(vb / (1 - b2**t)) + eps)
    return W, b


def nll(P: np.ndarray, y: np.ndarray) -> float:
    return float(-np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-12, 1))))


def fit_temperature(head: Head, Xs: np.ndarray, y: np.ndarray) -> float:
    """Grid-search the temperature that minimises validation NLL (Guo et al. 2017)."""
    if len(y) == 0:
        return 1.0
    logits = Xs @ head.W + head.b
    best, best_t = float("inf"), 1.0
    for t in np.concatenate([np.linspace(0.3, 1.0, 15), np.linspace(1.1, 6.0, 50)]):
        v = nll(_softmax(logits / t), y)
        if v < best:
            best, best_t = v, float(t)
    return round(best_t, 3)


def train(X: np.ndarray, labels: list[dict], *, version: str, dataset_hash: str, val_X: np.ndarray | None = None,
          val_labels: list[dict] | None = None, classes: dict[str, list[str]] | None = None, l2: float = 1e-3,
          iters: int = 400, lr: float = 0.05, seed: int = 0) -> AttrModel:
    mean = X.mean(axis=0)
    std = X.std(axis=0) + 1e-6
    model = AttrModel(version, dataset_hash, mean, std, meta={"n_train": len(X), "l2": l2, "iters": iters})
    Xs = model.standardise(X)
    for name in HEADS:
        cls = (classes or {}).get(name) or sorted({lb[name] for lb in labels if lb.get(name)})
        idx = {c: i for i, c in enumerate(cls)}
        rows = [i for i, lb in enumerate(labels) if lb.get(name) in idx]
        if not rows:
            continue
        y = np.array([idx[labels[i][name]] for i in rows])
        W, b = _fit_head(Xs[rows], y, len(cls), l2, iters, lr, seed)
        head = Head(list(cls), W, b)
        if val_X is not None and val_labels:
            vrows = [i for i, lb in enumerate(val_labels) if lb.get(name) in idx]
            vy = np.array([idx[val_labels[i][name]] for i in vrows])
            head.T = fit_temperature(head, model.standardise(val_X[vrows]), vy) if vrows else 1.0
        model.heads[name] = head
        model.meta[f"n_{name}"] = len(rows)
    return model
