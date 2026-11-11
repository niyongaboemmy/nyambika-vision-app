"""R4 drape spike: pattern -> drape -> fit heatmap -> GLBs (one synchronous call, CPU)."""
from __future__ import annotations

import base64
import time

import numpy as np

from .. import avatar_body as ab
from . import export, fit
from . import pattern as pt
from .solver import SOLVER_VERSION, SolverConfig, drape

MODEL_ID = "drape-pbd-cpu@0.1"
A_POSE_DEG = 42.0  # wider than the twin's 24 deg so cloth has room between arm and torso
NEUTRAL_SKIN = (0.55, 0.47, 0.42)  # synthetic mannequin tone for tailor previews (never the shopper's)
QUALITY = {"fast": SolverConfig(h=0.03, sew_steps=26, drape_steps=50), "standard": SolverConfig(), "fine": SolverConfig(h=0.02)}


def body_for(measurements: dict | None, size: str | None, skin_rgb=None) -> ab.Body:
    m = pt.resolve(measurements, size)
    return ab.build_body(m, tuple(skin_rgb) if skin_rgb else NEUTRAL_SKIN, a_pose_deg=A_POSE_DEG)


def simulate(garment: str, *, size: str | None = None, garment_measurements: dict | None = None, params: dict | None = None,
             fabric: str = "cotton", body_measurements: dict | None = None, body_size: str | None = None, skin_rgb=None,
             print_image=None, hue: float | None = None, quality: str = "standard", posters: bool = True) -> dict:
    t0 = time.perf_counter()
    if quality not in QUALITY:
        raise ValueError(f"Unknown quality '{quality}'")
    body = body_for(body_measurements, body_size, skin_rgb)
    # The pattern is graded from the garment size (catalogue) or from measurements (tailor made-to-measure).
    pattern = pt.generate(garment, garment_measurements, size, params, fabric)
    r = drape(pattern, body, QUALITY[quality])
    a = fit.analyse(r, pattern, body)
    rgb = fit.colours(a["band"], a["stretch"], a["gap"])
    tile = export.tile_from_image(print_image) if print_image is not None else export.print_tile(hue)
    extras = {"model": MODEL_ID, "experimental": True, "garment": garment, "fabric": fabric, "disclaimer": fit.DISCLAIMER}
    glb = export.glb(body, r, extras, tile=tile)
    heat = export.glb(body, r, {**extras, "overlay": "fit-heatmap"}, vertex_rgb=rgb)
    out = {
        "glb_b64": base64.b64encode(glb).decode(), "heatmap_glb_b64": base64.b64encode(heat).decode(),
        "bytes": len(glb), "heatmap_bytes": len(heat),
        "fit": a["summary"], "metrics": r.metrics, "pattern": pattern.summary(),
        "body": {k: round(v, 1) for k, v in body.m.items()},
        "legend": [{"band": k, "rgb": [round(c, 3) for c in fit.COLOURS[k]]} for k in fit.BANDS],
        "model_id": MODEL_ID, "solver": SOLVER_VERSION, "pattern_version": pt.PATTERN_VERSION,
        "experimental": True, "disclaimer": fit.DISCLAIMER,
    }
    if posters:
        tri_print = export.face_colours_from_tile(r, tile)
        tri_heat = rgb[r.garment.tris].mean(axis=1)
        out["poster_b64"] = base64.b64encode(export.poster(body, r, tri_print)).decode()
        out["heatmap_poster_b64"] = base64.b64encode(export.poster(body, r, tri_heat)).decode()
    out["latency_s"] = round(time.perf_counter() - t0, 3)
    return out


def catalog() -> dict:
    return {
        "garments": [{"key": "a_line_dress", "label": "A-line dress", "sleeves": list(pt.SLEEVES), "default_length_cm": 95},
                     {"key": "wrap_skirt", "label": "Wrap skirt", "sleeves": ["none"], "default_length_cm": 62},
                     {"key": "shirt", "label": "Shirt", "sleeves": list(pt.SLEEVES), "default_length_cm": 66}],
        "fabrics": [{"key": f.key, "label": f.label, "stretch": f.stretch, "weight_gsm": f.weight_gsm, "bending": f.bending}
                    for f in pt.FABRICS.values()],
        "sizes": pt.SIZE_ORDER[1:], "bands": list(fit.BANDS), "model_id": MODEL_ID, "disclaimer": fit.DISCLAIMER,
        "limits": {"length_cm": [30, 140], "ease_cm": [-6, 20]},
    }


def _np(o):
    if isinstance(o, dict):
        return {k: _np(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_np(v) for v in o]
    if isinstance(o, np.generic):
        return o.item()
    return o
