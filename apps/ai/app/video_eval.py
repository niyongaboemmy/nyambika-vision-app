"""NLB video extension: the release gate for a video try-on provider (E39, AI-BM-01..05, FR-VID-03).

Subgroups: skin tone (the synthetic personas, Monk Skin Tone 6-10) x body size (S, M, XL, made by
re-proportioning each persona's silhouette horizontally). Each subgroup gets a short synthetic clip
(a ±30° turn) with a patterned garment, rendered by the provider, then every frame is guarded:

  identity_similarity  head region of each output frame vs its own input frame (≥ GUARD_MIN_IDENTITY)
  identity_stability   1 - spread of identity similarity across the frames (≥ 0.98): no flicker,
                       no frame where the face drifts while the others hold
  skin_tone_delta      visible body skin outside the garment (≤ GUARD_MAX_SKIN_DELTA)
  garment_fidelity     HSV histogram intersection with the cut-out (≥ GUARD_MIN_FIDELITY)
  acceptability        share of frames passing all per-frame checks

Pass: every subgroup passes, no subgroup's acceptability is more than 10 points below the overall
(AI-BM-03 parity), and the provider's licence allows commercial use (AI-BM-05). The API stores the
report in the model registry; `activate` is refused without a passing record for that exact version.

This is the automated half of the NLB. The human panel (≥ 5 raters, AI-BM-02) and the real-subject
set (≥ 30 consenting subjects, AI-BM-01) are outside this repository; synthetic personas only here.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from . import config
from .twin import subject
from .video_tryon import MIN_STABILITY, VideoRequest, VideoTryOnProvider, assess, normalise, turn_frames

SIZES = {"S": 0.88, "M": 1.0, "XL": 1.18}
PARITY_POINTS = 0.10


def resize_body(persona: Image.Image, factor: float) -> Image.Image:
    """Re-proportion the subject horizontally (body size subgroup) on the persona's own background."""
    img = normalise(persona)
    if abs(factor - 1.0) < 1e-3:
        return img
    rgb = np.asarray(img)
    mask, box = subject(img)
    if box is None:
        raise ValueError("Persona has no subject")
    x0, y0, x1, y1 = box
    bg = tuple(int(v) for v in np.median(np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3)]), axis=0))
    cut = img.crop((x0, y0, x1, y1)).convert("RGBA")
    cut.putalpha(Image.fromarray((mask[y0:y1, x0:x1] * 255).astype(np.uint8)))
    w = max(4, int(round(cut.width * factor)))
    cut = cut.resize((w, cut.height), Image.LANCZOS)
    canvas_w = max(img.width, w + 40)
    canvas_w += canvas_w % 2
    out = Image.new("RGB", (canvas_w, img.height), bg)
    out.paste(cut, (int(round(canvas_w / 2 - w / 2)), y0), cut)
    return out


def run(provider: VideoTryOnProvider, personas: list[Image.Image], garments: list[tuple[Image.Image, str]],
        frames: int = 8) -> dict:
    started = time.perf_counter()
    rows, error = [], None
    if not provider.configured():
        error = f"provider '{provider.name}' is not configured"
    else:
        try:
            for i, persona in enumerate(personas, start=1):
                for j, (size, factor) in enumerate(SIZES.items()):
                    garment, category = garments[(i + j) % len(garments)]
                    clip = turn_frames(resize_body(persona, factor), n=frames)
                    req = VideoRequest("CLIP", garment, category, f"nlb-{i}-{size}", 8, frames=clip)
                    vf = provider.frames(req, lambda _p: None)
                    v = assess(vf, garment, samples=frames)
                    acc = v["frames_passed"] / max(1, len(v["sampled_frames"]))
                    rows.append({
                        "monk_skin_tone": 5 + i, "size": size, "garment": category,
                        "identity_similarity": v["identity_similarity"], "identity_stability": v["identity_stability"],
                        "skin_tone_delta": v["skin_tone_delta"], "garment_fidelity": v["garment_fidelity"],
                        "acceptability": round(acc, 4), "reasons": v["reasons"], "passed": v["passed"],
                    })
        except Exception as exc:  # noqa: BLE001 - a provider that cannot run the set fails the gate
            error = f"{exc.__class__.__name__}: {str(exc)[:200]}"
    overall = float(np.mean([r["acceptability"] for r in rows])) if rows else 0.0
    for r in rows:
        r["parity_ok"] = r["acceptability"] >= overall - PARITY_POINTS
    failing = [f"MST{r['monk_skin_tone']}×{r['size']}" for r in rows if not (r["passed"] and r["parity_ok"])]
    passed = bool(rows) and error is None and not failing and provider.commercial_use
    info = provider.info()
    return {
        "kind": "NLB_VIDEO",
        "provider": provider.name,
        "model_version": provider.model_version,
        "licence": info["licence"],
        "commercial_use": info["commercial_use"],
        "passed": passed,
        "error": error,
        "subgroups": len(rows),
        "subgroups_passed": len(rows) - len(failing),
        "failing_subgroups": failing,
        "overall_acceptability": round(overall, 4),
        "worst_identity_stability": min((r["identity_stability"] for r in rows), default=0.0),
        "worst_garment_fidelity": min((r["garment_fidelity"] for r in rows), default=0.0),
        "worst_skin_tone_delta": max((r["skin_tone_delta"] for r in rows), default=1.0),
        "thresholds": {"identity": config.GUARD_MIN_IDENTITY, "identity_stability": MIN_STABILITY,
                       "skin_tone_delta": config.GUARD_MAX_SKIN_DELTA, "garment_fidelity": config.GUARD_MIN_FIDELITY,
                       "parity_points": PARITY_POINTS},
        "frames_per_clip": frames,
        "dataset": "synthetic personas MST 6-10 x S/M/XL (automated metrics only; human panel pending)",
        "rows": rows,
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
