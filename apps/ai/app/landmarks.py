"""Body landmarks from a subject silhouette (no ML): neck base, shoulders, chest, waist, hips, knees, calves.

Used by the local compositor (placement), the guard (placement plausibility) and the try-on quality
evaluation. Vertical positions come from the silhouette where it has a clear signature (the neck is the
narrowest run under the head, the shoulders are where it widens again) and from standard figure
proportions (fractions of the head-to-feet height) elsewhere.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

HEAD_FRAC = 0.16  # identity region: top 16% of the subject (same as the guard)
WAIST_FRAC, HIP_FRAC, KNEE_FRAC, CALF_FRAC = 0.40, 0.52, 0.72, 0.84


@dataclass(frozen=True)
class Body:
    box: tuple[int, int, int, int]
    top: int
    height: int
    cx: float
    head_y1: int
    neck_y: int  # neck base: where the collar of a top sits
    neck_w: int
    shoulder_w: int
    chest_y: int
    chest_w: int
    waist_y: int
    waist_w: int
    hip_y: int
    hip_w: int
    knee_y: int
    calf_y: int

    def frac(self, y: float) -> float:
        return (y - self.top) / max(1, self.height)


def run_at(mask: np.ndarray, y: int, cx: float) -> tuple[int, int]:
    """[left, right) of the foreground run through (or nearest to) column cx on row y."""
    y = int(min(max(y, 0), mask.shape[0] - 1))
    row = mask[y]
    c = int(round(cx))
    if not row[c]:
        xs = np.flatnonzero(row)
        if len(xs) == 0:
            return c, c
        c = int(xs[np.argmin(np.abs(xs - c))])
    gaps = np.flatnonzero(~row)
    left_gaps = gaps[gaps < c]
    right_gaps = gaps[gaps > c]
    left = int(left_gaps[-1]) + 1 if len(left_gaps) else 0
    right = int(right_gaps[0]) if len(right_gaps) else len(row)
    return left, right


def landmarks(mask: np.ndarray, box) -> Body:
    x0, y0, x1, y1 = box
    hgt = max(1, y1 - y0)
    # Body centre: median column of the silhouette in the torso band (robust to one raised arm).
    band = mask[y0 + int(0.25 * hgt): y0 + int(0.5 * hgt), x0:x1]
    cols = np.nonzero(band)[1]
    cx = float(x0 + np.median(cols)) if len(cols) else (x0 + x1) / 2

    def width(y: int) -> int:
        lft, rgt = run_at(mask, y, cx)
        return rgt - lft

    # Neck: narrowest run between the chin and the shoulders, then the first row that widens past it.
    ys = np.arange(y0 + int(0.12 * hgt), y0 + int(0.27 * hgt))
    widths = np.array([width(int(y)) for y in ys])
    neck_y, neck_w = y0 + int(0.19 * hgt), max(1, int(0.045 * hgt))
    if len(widths):
        i = int(np.argmin(widths))
        neck_w = max(1, int(widths[i]))
        below = np.flatnonzero(widths[i:] > max(1.8 * neck_w, 0.09 * hgt))
        if len(below):
            neck_y = int(ys[i + below[0]])
    neck_y = int(np.clip(neck_y, y0 + 0.15 * hgt, y0 + 0.25 * hgt))

    sh_rows = range(neck_y, min(y1, neck_y + int(0.07 * hgt)))
    shoulder_w = max((width(y) for y in sh_rows), default=int(0.25 * hgt))
    shoulder_w = int(np.clip(shoulder_w, 0.17 * hgt, 0.36 * hgt))
    chest_y = neck_y + int(0.10 * hgt)
    waist_y, hip_y = y0 + int(WAIST_FRAC * hgt), y0 + int(HIP_FRAC * hgt)
    # Torso width: the narrowest run between chest and waist, so arms hanging close to the body are excluded
    # wherever there is any gap between them and the torso.
    trunk = [width(y) for y in range(chest_y - int(0.02 * hgt), waist_y + 1, max(1, hgt // 200))]
    chest_w = int(np.clip(min(trunk) if trunk else 0.15 * hgt, 0.10 * hgt, shoulder_w))
    return Body(
        box=(x0, y0, x1, y1), top=y0, height=hgt, cx=cx, head_y1=y0 + int(HEAD_FRAC * hgt),
        neck_y=neck_y, neck_w=neck_w, shoulder_w=shoulder_w,
        chest_y=chest_y, chest_w=chest_w,
        waist_y=waist_y, waist_w=int(np.clip(width(waist_y), 0.09 * hgt, shoulder_w)),
        hip_y=hip_y, hip_w=int(np.clip(width(hip_y), 0.10 * hgt, 1.2 * shoulder_w)),
        knee_y=y0 + int(KNEE_FRAC * hgt), calf_y=y0 + int(CALF_FRAC * hgt),
    )


# Where each canonical garment class should sit, as fractions of body height measured from the top of the head.
# collar: top edge of the garment; hem: allowed band for its lower edge. Used by the guard and the eval.
PLACEMENT = {
    "top": {"anchor": "neck", "hem": (0.40, 0.66)},
    "dress": {"anchor": "neck", "hem": (0.55, 1.02)},
    "skirt": {"anchor": "waist", "hem": (0.55, 1.02)},
}
HEM_TARGET = {"top": HIP_FRAC + 0.03, "dress": CALF_FRAC, "skirt": KNEE_FRAC}
