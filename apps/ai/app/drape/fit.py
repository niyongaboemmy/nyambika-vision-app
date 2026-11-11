"""Fit heatmap for draped pattern garments (R4 spike, visual guidance only).

Per vertex, two signals:
  * stretch: girth-direction stretch of the incident triangles (deformation gradient of the flat
    pattern -> draped cloth along the circumferential direction), i.e. how much the cut fabric is
    pulled open around the body (lengthwise stretch from the garment's own weight is not "tight");
  * gap: distance from the cloth to the body surface minus the cloth thickness (ease).
Bands:
  * tight: the fabric is stretched beyond TIGHT_STRETCH while lying on the body (gap < CONTACT);
  * loose: the cloth stands off the body by more than LOOSE_GAP, or it is off the body in a
    horizontal slab whose measured girth ease (convex hull of the cloth ring minus the body ring)
    exceeds LOOSE_EASE: excess fabric hangs and folds rather than standing off evenly;
  * drape: free-hanging cloth below the crotch line that is not tight (a flared hem is a design
    choice, not "too big"; it is shown neutral and never assessed);
  * ok: everything else.
Signals are smoothed over the one-ring so single wrinkles do not flip bands. Region readings
(bust / waist / hips) are the band shares of the vertices within +/- 3 cm of that line.
"""
from __future__ import annotations

import numpy as np

from .pattern import Pattern, finished_for_body
from .solver import DrapeResult

TIGHT_STRETCH = 0.025
CONTACT = 0.012
LOOSE_GAP = 0.035
LOOSE_EASE = 0.09  # measured girth ease (m) of a horizontal slab above which off-body cloth reads loose
SLAB = 0.02
BANDS = ("tight", "ok", "loose", "drape")
# sRGB colours for the overlay (colour-blind safe-ish: magenta / teal / amber-light) and the legend.
COLOURS = {"tight": (0.86, 0.15, 0.42), "ok": (0.12, 0.66, 0.58), "loose": (0.98, 0.78, 0.33), "drape": (0.6, 0.58, 0.7)}
DISCLAIMER = "Experimental physics preview. Visual guidance only: real fabric, cut and body differ."

# Size-chart expectation bands from finished garment ease (cm) at a line.
EXPECT_TIGHT_BELOW = -1.5
EXPECT_OK_BELOW = 2.5
EXPECT_LOOSE_ABOVE = 14.0
DEAD_ZONE_LOOSE = 4.0


def girth_dirs(r: DrapeResult) -> np.ndarray:
    """Unit girth (circumferential) direction in pattern space per triangle: horizontal, or tangential on cones."""
    g = r.garment
    c = g.uv[g.tris].mean(axis=1)
    out = np.tile([1.0, 0.0], (len(c), 1))
    pid = g.panel_of[g.tris[:, 0]]
    for i, pm in enumerate(g.panels):
        if pm.panel.placement["kind"] == "cone":
            sel = pid == i
            r1 = g.pattern.meta["r1"]
            phi = np.arctan2(c[sel, 0], r1 - c[sel, 1])
            out[sel] = np.stack([np.cos(phi), np.sin(phi)], axis=1)
    return out


def principal_stretch(r: DrapeResult, girth: bool = True) -> np.ndarray:
    """Stretch of the cut fabric per triangle: along the girth direction (fit) or the largest principal stretch."""
    tris = r.garment.tris
    uv = r.garment.uv
    x = r.x
    Dm = np.stack([uv[tris[:, 1]] - uv[tris[:, 0]], uv[tris[:, 2]] - uv[tris[:, 0]]], axis=2)  # (T,2,2)
    Ds = np.stack([x[tris[:, 1]] - x[tris[:, 0]], x[tris[:, 2]] - x[tris[:, 0]]], axis=2)  # (T,3,2)
    det = np.linalg.det(Dm)
    ok = np.abs(det) > 1e-10
    inv = np.zeros_like(Dm)
    inv[ok] = np.linalg.inv(Dm[ok])
    F = Ds @ inv
    if girth:
        out = np.linalg.norm(np.einsum("tij,tj->ti", F, girth_dirs(r)), axis=1) - 1
    else:
        out = np.linalg.svd(F, compute_uv=False)[:, 0] - 1
    out[~ok] = 0
    return out


def _smooth(values: np.ndarray, edges: np.ndarray, n: int, rounds: int = 1) -> np.ndarray:
    v = values.copy()
    for _ in range(rounds):
        s = v.copy()
        c = np.ones(n)
        np.add.at(s, edges[:, 0], v[edges[:, 1]])
        np.add.at(s, edges[:, 1], v[edges[:, 0]])
        np.add.at(c, edges[:, 0], 1)
        np.add.at(c, edges[:, 1], 1)
        v = s / c
    return v


def vertex_signals(r: DrapeResult) -> tuple[np.ndarray, np.ndarray]:
    n = len(r.x)
    tri_s = principal_stretch(r)
    tris = r.garment.tris
    acc = np.zeros(n)
    cnt = np.zeros(n)
    for k in range(3):
        np.add.at(acc, tris[:, k], tri_s)
        np.add.at(cnt, tris[:, k], 1)
    stretch = _smooth(acc / np.maximum(cnt, 1), r.edges, n, 1)
    gap = _smooth(np.maximum(r.sdf - r.thickness, 0.0), r.edges, n, 2)
    return stretch, gap


def _hull_perimeter(q: np.ndarray) -> float:
    pts = sorted(map(tuple, q))
    if len(pts) < 3:
        return 0.0

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo: list = []
    hi: list = []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    h = np.asarray(lo[:-1] + hi[:-1])
    return float(np.linalg.norm(np.roll(h, -1, axis=0) - h, axis=1).sum())


def slab_ease(r: DrapeResult, body) -> tuple[np.ndarray, dict]:
    """Measured girth ease per vertex's 2 cm slab (torso panels above the crotch), and a lookup by height."""
    from ..avatar_body import ellipse_perimeter
    g = r.garment
    torso = np.array([pm.panel.placement["kind"] != "arm" for pm in g.panels])[g.panel_of]
    y = r.x[:, 1]
    sel = torso & (y >= body.y["crotch"])
    out = np.full(len(y), np.nan)
    table = {}
    if not sel.any():
        return out, table
    k = np.floor((y - body.y["crotch"]) / SLAB).astype(np.int64)
    for s in np.unique(k[sel]):
        m = sel & (k == s)
        if m.sum() < 8:
            continue
        yc = body.y["crotch"] + (s + 0.5) * SLAB
        a, b, _ = body.torso_axes(yc)
        e = _hull_perimeter(r.x[m][:, [0, 2]]) - ellipse_perimeter(a, b) - 2 * np.pi * float(np.median(r.thickness[m]))
        out[m] = e
        table[int(s)] = (yc, e)
    return out, table


def bands(stretch: np.ndarray, gap: np.ndarray, y: np.ndarray | None = None, crotch_y: float | None = None,
          ease: np.ndarray | None = None) -> np.ndarray:
    """0 = tight, 1 = ok, 2 = loose, 3 = drape (below the crotch line and not tight)."""
    b = np.ones(len(stretch), dtype=np.int64)
    b[gap > LOOSE_GAP] = 2
    if ease is not None:
        b[(np.nan_to_num(ease) > LOOSE_EASE) & (gap > CONTACT)] = 2
    if y is not None and crotch_y is not None:
        b[y < crotch_y] = 3
    b[(stretch > TIGHT_STRETCH) & (gap < CONTACT)] = 0
    return b


def colours(band: np.ndarray, stretch: np.ndarray, gap: np.ndarray) -> np.ndarray:
    """Per-vertex sRGB: band colour, slightly deeper with intensity (stretch for tight, gap for loose)."""
    base = np.array([COLOURS[k] for k in BANDS])[band]
    base = base.copy()
    t_int = np.clip((stretch - TIGHT_STRETCH) / 0.06, 0, 1)
    l_int = np.clip((gap - LOOSE_GAP) / 0.08, 0, 1)
    k = np.where(band == 0, 1 - 0.25 * t_int, np.where(band == 2, 1 - 0.2 * l_int, 1.0))
    return np.clip(base * k[:, None], 0, 1)


def region_readings(r: DrapeResult, band: np.ndarray, body, table: dict | None = None) -> dict:
    out = {}
    table = table or {}
    lines = {"bust": body.y["bust"], "waist": body.y["waist"], "hips": body.y["hips"]}
    for name, y in lines.items():
        sel = np.abs(r.x[:, 1] - y) < 0.03
        if sel.sum() < 8:
            continue
        share = {k: round(float((band[sel] == i).mean()), 3) for i, k in enumerate(BANDS[:3])}
        near = [e for yc, e in table.values() if abs(yc - y) <= SLAB]
        ease = float(np.mean(near)) if near else None
        # A line reads tight when a meaningful share (>= 25%) of its ring is tight, loose when its measured
        # girth ease exceeds LOOSE_EASE (or most of it stands off the body), otherwise ok.
        if share["tight"] >= 0.25:
            reading = "tight"
        elif (ease is not None and ease > LOOSE_EASE) or share["loose"] > 0.5:
            reading = "loose"
        else:
            reading = "ok"
        out[name] = {"reading": reading, "share": share, "measured_ease_cm": None if ease is None else round(ease * 100, 1)}
    return out


def expected_band(ease_cm: float) -> set[str]:
    if ease_cm < EXPECT_TIGHT_BELOW:
        return {"tight"}
    if ease_cm < EXPECT_OK_BELOW:
        return {"tight", "ok"}
    if ease_cm < EXPECT_LOOSE_ABOVE - DEAD_ZONE_LOOSE:
        return {"ok"}
    if ease_cm < EXPECT_LOOSE_ABOVE + DEAD_ZONE_LOOSE:
        return {"ok", "loose"}
    return {"loose"}


def size_chart_agreement(pattern: Pattern, body_m: dict, readings: dict) -> dict:
    """Compare readings with size-chart arithmetic (finished garment - body) at the pattern's named lines."""
    finished = finished_for_body(pattern, body_m)
    rows = {}
    for line, f in finished.items():
        key = {"bust": "bustCm", "hips": "hipsCm", "waist": "waistCm"}[line]
        ease = f - body_m[key]
        exp = expected_band(ease)
        got = readings.get(line, {}).get("reading")
        rows[line] = {"ease_cm": round(ease, 1), "expected": sorted(exp), "reading": got, "agree": got in exp,
                      "measured_ease_cm": readings.get(line, {}).get("measured_ease_cm")}
    return rows


def analyse(r: DrapeResult, pattern: Pattern, body) -> dict:
    stretch, gap = vertex_signals(r)
    ease, table = slab_ease(r, body)
    band = bands(stretch, gap, r.x[:, 1], body.y["crotch"], ease)
    readings = region_readings(r, band, body, table)
    agree = size_chart_agreement(pattern, body.m, readings)
    return {
        "band": band, "stretch": stretch, "gap": gap,
        "summary": {
            "share": {k: round(float((band == i).mean()), 3) for i, k in enumerate(BANDS)},
            "regions": readings, "size_chart": agree,
            "thresholds": {"tight_stretch": TIGHT_STRETCH, "contact_m": CONTACT, "loose_gap_m": LOOSE_GAP, "loose_ease_m": LOOSE_EASE},
            "disclaimer": DISCLAIMER,
        },
    }
