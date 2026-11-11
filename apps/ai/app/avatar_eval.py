"""NLB avatar extension: evaluation harness entry for the 3D twin (FR-AVA-05, plan §15 NLB).

Subgroups: the five synthetic personas (Monk Skin Tone 6-10, the tones most under-served by
off-the-shelf avatar tech) x body sizes XS..XXL. Per subgroup it measures:

  skin_tone_delta   |sampled skin - ground-truth persona skin| (mean abs, 0..1) after the full
                    turnaround → sample → material → sRGB round trip
  proportion_error  mean relative error of height, bust, waist, hips read back from the mesh
  identity_likeness not applicable to the stylised adapter (likeness is deliberately NOT
                    reproduced); a photoreal 3DGS provider must add it here before release

Pass rule per subgroup: skin_tone_delta <= GUARD_MAX_SKIN_DELTA and proportion_error <= 3%.
nlb_score = share of subgroups passing; release needs 1.0 and no subgroup worse than 2x the
best (parity). Usage: python -m app.avatar_eval PERSONA_DIR [--json OUT]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from . import avatar_body as ab
from . import avatar_capture as cap
from . import config

PERSONA_SKIN = ["#A07E56", "#825C43", "#604134", "#3A312A", "#292420"]  # make_seed_assets.PERSONAS
SIZES = ["XS", "S", "M", "L", "XL", "XXL"]


def _hex(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)]) / 255


def run(persona_dir: str | Path) -> dict:
    persona_dir = Path(persona_dir)
    rows = []
    for i, truth in enumerate(PERSONA_SKIN, start=1):
        frames, yaws = cap.turnaround(Image.open(persona_dir / f"persona-{i}.png"), 24)
        sample = cap.sample_skin(frames, yaws)
        rendered = ab.skin_from_material(ab.skin_material_rgba(sample["rgb"]))
        delta = float(np.abs(rendered - _hex(truth)).mean())
        for size in SIZES:
            m, _ = ab.resolve_measurements({}, size)
            body = ab.build_body(m, sample["rgb"])
            perr = ab.proportion_error(body)
            rows.append({
                "persona": i, "monk_skin_tone": 5 + i, "size": size,
                "skin_tone_delta": round(delta, 4), "proportion_error": round(perr, 5),
                "passed": delta <= config.GUARD_MAX_SKIN_DELTA and perr <= 0.03,
            })
    by_tone = {}
    for r in rows:
        by_tone.setdefault(r["monk_skin_tone"], []).append(r["skin_tone_delta"])
    worst = max(max(v) for v in by_tone.values())
    best = min(min(v) for v in by_tone.values())
    score = sum(r["passed"] for r in rows) / len(rows)
    return {
        "model_version": ab.MODEL_VERSION,
        "subgroups": len(rows),
        "nlb_score": round(score, 4),
        "worst_skin_tone_delta": round(worst, 4),
        "max_proportion_error": round(max(r["proportion_error"] for r in rows), 5),
        "parity_ok": worst <= max(2 * best, 0.01),
        "identity_likeness": "n/a (stylised, no likeness by design)",
        "rows": rows,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("persona_dir")
    p.add_argument("--json")
    a = p.parse_args(argv)
    report = run(a.persona_dir)
    text = json.dumps(report, indent=2)
    if a.json:
        Path(a.json).write_text(text)
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2))
    return 0 if report["nlb_score"] == 1.0 else 1


if __name__ == "__main__":
    sys.exit(main())
