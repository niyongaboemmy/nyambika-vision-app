"""Run the R4 drape-spike evaluation harness and write the report JSON + figures.

usage: python scripts/drape_eval.py [--quick] [--out ../../docs/spikes/r4-drape-eval.json] [--figures ../../docs/spikes/img]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.drape import evaluate, export, fit, render, service  # noqa: E402
from app.drape import pattern as pt  # noqa: E402
from app.drape.solver import drape  # noqa: E402


def figures(out: Path):
    """Contact sheets used in the spike report: garments on M, sizing on L, fabrics."""
    out.mkdir(parents=True, exist_ok=True)

    def pair(body_size, garment, size, fabric, params=None):
        body = service.body_for(None, body_size)
        p = pt.generate(garment, size=size, fabric=fabric, params=params)
        r = drape(p, body, service.QUALITY["standard"])
        a = fit.analyse(r, p, body)
        rgb = fit.colours(a["band"], a["stretch"], a["gap"])
        tile = export.print_tile()
        b = export._inset_body(body)
        imgs = [render.render(b, [(r.x, r.garment.tris, export.face_colours_from_tile(r, tile))], yaw=-18, size=(240, 440)),
                render.render(b, [(r.x, r.garment.tris, rgb[r.garment.tris].mean(axis=1))], yaw=-18, size=(240, 440))]
        return imgs, a["summary"]

    sheets = {
        "garments-M": [("M", g, "M", "cotton") for g in pt.GARMENTS],
        "sizing-dress-on-L": [("L", "a_line_dress", s, "cotton") for s in ("M", "L", "XXL")],
        "sizing-shirt-on-L": [("L", "shirt", s, "cotton") for s in ("M", "L", "XXL")],
        "fabrics-dress-M": [("M", "a_line_dress", "M", f) for f in pt.FABRICS],
    }
    for name, rows in sheets.items():
        imgs = []
        for row in rows:
            ii, _ = pair(*row)
            imgs += ii
        render.sheet(imgs).save(out / f"r4-{name}.png", optimize=True)
        print("figure", name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--out", default=str(ROOT.parents[1] / "docs" / "spikes" / "r4-drape-eval.json"))
    ap.add_argument("--figures", default=None)
    a = ap.parse_args()
    t = time.time()
    kw = {"bodies": ["S", "L", "3XL"], "fabrics": ["cotton", "jersey"]} if a.quick else {}
    rep = evaluate.run(progress=lambda p: print(f"\r{p * 100:5.1f}%", end="", flush=True), **kw)
    rep["scope"] = "quick" if a.quick else "full"
    print()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(service._np(rep), indent=1))
    print(json.dumps(rep["summary"], indent=1), "\ngate", rep["gate"], "passed", rep["passed"], f"{time.time() - t:.0f}s")
    for d in rep["disagreements"]:
        print("disagree", d)
    if a.figures:
        figures(Path(a.figures))


if __name__ == "__main__":
    main()
