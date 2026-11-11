"""NLB-style evaluation harness for the R4 drape spike.

Grid: synthetic bodies S..3XL x 3 garments x 3 fabrics (matching size) for stability and runtime,
plus a sizing grid (cotton; garment one size down / same / two up) whose heatmap readings are
compared with size-chart arithmetic (finished garment - body at bust / waist / hips).

Spike gate (all must hold to recommend "Go" for a production investment, see the spike report):
  * stability >= 95% of runs: no explosion, penetration <= 5 mm, seam gap p95 <= 10 mm,
    strain p99 <= 20%;
  * runtime p95 <= 5 s per drape on one CPU core (standard quality);
  * heatmap agreement with the size chart >= 85% of assessed lines.
Synthetic bodies only (parametric E33 bodies from the size table). Results are a model-registry
eval record (kind DRAPE_SPIKE), not a production sign-off: real-tailor review is still required.
"""
from __future__ import annotations

import time

import numpy as np

from . import fit
from . import pattern as pt
from .service import MODEL_ID, body_for
from .solver import SOLVER_VERSION, drape
from .service import QUALITY

BODIES = ["S", "M", "L", "XL", "XXL", "3XL"]
GATE = {"stability": 0.95, "runtime_p95_s": 5.0, "agreement": 0.85, "max_penetration_m": 0.005, "seam_gap_p95_m": 0.01, "strain_p99": 0.2}
SIZE_OFFSETS = (-1, 0, 2)

EXPERT_CHECKLIST = [
    {"id": "silhouette", "question": "Does the overall silhouette match how this cut hangs on a real body of this size?", "scale": "1-5"},
    {"id": "length", "question": "Do hem and sleeve lengths land where you would expect for the pattern?", "scale": "1-5"},
    {"id": "tight_zones", "question": "Are the zones shown tight the ones you would expect to pull or need letting out?", "scale": "1-5"},
    {"id": "loose_zones", "question": "Are the zones shown loose the ones you would take in?", "scale": "1-5"},
    {"id": "fabric", "question": "Does the drape differ between cotton, kitenge and jersey as the real fabrics would?", "scale": "1-5"},
    {"id": "seams", "question": "Do seams sit where they should (shoulder, side, armhole)?", "scale": "yes/no + note"},
    {"id": "decision", "question": "Would this preview change a quote, an alteration or a size recommendation?", "scale": "yes/no + note"},
    {"id": "trust", "question": "Would you show this to a customer with the 'visual guidance only' label?", "scale": "yes/no + note"},
]


def stable(m: dict) -> bool:
    return (not m["exploded"] and m["max_penetration_m"] <= GATE["max_penetration_m"] and m["seam_gap_p95_m"] <= GATE["seam_gap_p95_m"]
            and m["strain_p99"] <= GATE["strain_p99"])


def _hem_flare(r, body) -> float:
    y = r.x[:, 1]
    lo = y.min()
    sel = y < lo + 0.03
    return round(fit._hull_perimeter(r.x[sel][:, [0, 2]]) * 100, 1) if sel.sum() >= 3 else 0.0


def run(bodies=None, garments=None, fabrics=None, sizing: bool = True, quality: str = "standard", progress=None) -> dict:
    bodies = bodies or BODIES
    garments = garments or list(pt.GARMENTS)
    fabrics = fabrics or list(pt.FABRICS)
    cfg = QUALITY[quality]
    t0 = time.time()
    runs, sizing_rows = [], []
    total = len(bodies) * len(garments) * (len(fabrics) + (len(SIZE_OFFSETS) - 1 if sizing else 0))
    done = 0
    for b in bodies:
        body = body_for(None, b)
        for g in garments:
            for f in fabrics:
                p = pt.generate(g, size=b, fabric=f)
                r = drape(p, body, cfg)
                a = fit.analyse(r, p, body)
                m = r.metrics
                runs.append({"body": b, "garment": g, "fabric": f, "size": b, "stable": stable(m), "hem_cm": _hem_flare(r, body),
                             **{k: m[k] for k in ("runtime_s", "exploded", "max_penetration_m", "seam_gap_p95_m", "strain_p99", "strain_max", "vertices")},
                             "share": a["summary"]["share"]})
                if sizing and f == "cotton":
                    sizing_rows.append(_sizing_row(b, g, b, a))
                done += 1
                if progress:
                    progress(done / total)
            if not sizing:
                continue
            for off in SIZE_OFFSETS:
                if off == 0:
                    continue
                i = pt.SIZE_ORDER.index(b) + off
                if not 0 <= i < len(pt.SIZE_ORDER):
                    done += 1
                    continue
                gs = pt.SIZE_ORDER[i]
                p = pt.generate(g, size=gs, fabric="cotton")
                r = drape(p, body, cfg)
                a = fit.analyse(r, p, body)
                runs.append({"body": b, "garment": g, "fabric": "cotton", "size": gs, "stable": stable(r.metrics), "hem_cm": _hem_flare(r, body),
                             **{k: r.metrics[k] for k in ("runtime_s", "exploded", "max_penetration_m", "seam_gap_p95_m", "strain_p99", "strain_max", "vertices")},
                             "share": a["summary"]["share"]})
                sizing_rows.append(_sizing_row(b, g, gs, a))
                done += 1
                if progress:
                    progress(done / total)
    return summarise(runs, sizing_rows, quality, time.time() - t0)


def _sizing_row(b, g, gs, a) -> dict:
    lines = a["summary"]["size_chart"]
    return {"body": b, "garment": g, "size": gs, "lines": lines}


def summarise(runs: list, sizing_rows: list, quality: str, wall_s: float) -> dict:
    rt = np.array([r["runtime_s"] for r in runs])
    stab = float(np.mean([r["stable"] for r in runs])) if runs else 0.0
    lines = [(row, k, v) for row in sizing_rows for k, v in row["lines"].items()]
    agree = float(np.mean([v["agree"] for _, _, v in lines])) if lines else 0.0
    by_garment = {}
    for g in sorted({r["garment"] for r in runs}):
        rr = [r for r in runs if r["garment"] == g]
        ll = [v for row, _, v in lines if row["garment"] == g]
        by_garment[g] = {"runs": len(rr), "stability": round(float(np.mean([r["stable"] for r in rr])), 3),
                         "runtime_p95_s": round(float(np.quantile([r["runtime_s"] for r in rr], 0.95)), 2),
                         "agreement": round(float(np.mean([v["agree"] for v in ll])), 3) if ll else None}
    by_fabric = {}
    for f in sorted({r["fabric"] for r in runs}):
        rr = [r for r in runs if r["fabric"] == f and r["size"] == r["body"]]
        by_fabric[f] = {"runs": len(rr), "stability": round(float(np.mean([r["stable"] for r in rr])), 3),
                        "hem_cm_mean": {g: round(float(np.mean([r["hem_cm"] for r in rr if r["garment"] == g])), 1)
                                        for g in sorted({r["garment"] for r in rr})}}
    case_tight = [v for row, k, v in lines if row["size"] != row["body"] and pt.SIZE_ORDER.index(row["size"]) < pt.SIZE_ORDER.index(row["body"])
                  and row["garment"] != "wrap_skirt" and k in ("bust", "hips")]
    summary = {
        "runs": len(runs), "stability": round(stab, 3),
        "runtime_p50_s": round(float(np.median(rt)), 2) if len(rt) else None,
        "runtime_p95_s": round(float(np.quantile(rt, 0.95)), 2) if len(rt) else None,
        "runtime_max_s": round(float(rt.max()), 2) if len(rt) else None,
        "agreement": round(agree, 3), "assessed_lines": len(lines),
        "one_size_down_reads_tight": round(float(np.mean([v["reading"] == "tight" for v in case_tight])), 3) if case_tight else None,
        "max_penetration_m": round(float(max(r["max_penetration_m"] for r in runs)), 4) if runs else None,
        "seam_gap_p95_max_m": round(float(max(r["seam_gap_p95_m"] for r in runs)), 4) if runs else None,
        "by_garment": by_garment, "by_fabric": by_fabric, "quality": quality, "wall_s": round(wall_s, 1),
    }
    gate = {
        "stability": summary["stability"] >= GATE["stability"],
        "runtime": (summary["runtime_p95_s"] or 99) <= GATE["runtime_p95_s"],
        "agreement": summary["agreement"] >= GATE["agreement"],
    }
    disagreements = [{"body": row["body"], "garment": row["garment"], "size": row["size"], "line": k, **v}
                     for row, k, v in lines if not v["agree"]]
    return {
        "kind": "DRAPE_SPIKE", "model_id": MODEL_ID, "solver": SOLVER_VERSION, "pattern_version": pt.PATTERN_VERSION,
        "passed": all(gate.values()), "gate": gate, "thresholds": GATE, "summary": summary,
        "runs": runs, "sizing": sizing_rows, "disagreements": disagreements,
        "expert_checklist": EXPERT_CHECKLIST, "synthetic": True,
        "licence": "in-house (numpy, no third-party solver or pattern data)", "commercial_use": True,
    }
