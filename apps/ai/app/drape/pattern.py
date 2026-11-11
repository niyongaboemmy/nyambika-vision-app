"""2D sewing patterns for the R4 drape spike (pattern-based garments, FR-SIZE profile -> panels).

A pattern is a set of flat panels (CCW polygons in metres, u to the right, v up, the panel's top
line at v = 0), named boundary edges, seam pairs that join two edges, a grain line per panel and
the fabric. Three seeded garment types are graded from a measurement profile (cm):

  * A-line dress: front + back bodice-to-hem panels (shift construction from the bust, flared from
    the hip line); sleeveless with a fitted armhole, or a drop-shoulder top when sleeves are asked.
  * Wrap skirt: one annular-sector panel (rolls into a cone: waist -> hips without darts) with a
    wrap overlap; it is tied on the body, so the worn waist adapts within the overlap.
  * Shirt: drop-shoulder front + back and two set-in sleeves (none / short / long).

Construction is deliberately simple (no darts, princess seams, collars, plackets or facings).
Finished measurements (the size-chart numbers) are reported per pattern so the evaluation can
compare the simulated heatmap against size-chart arithmetic.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..avatar_body import SIZE_PREFILL

PATTERN_VERSION = "pattern-grade@0.1"

# S..XXL from the shared twin prefill table; 3XL extrapolated by one more size step (cm).
SIZES: dict[str, dict] = {**SIZE_PREFILL, "3XL": {"heightCm": 168, "bustCm": 127, "waistCm": 110, "hipsCm": 134, "inseamCm": 77,
                                                   "shoulderCm": 46, "sleeveCm": 62, "neckCm": 42}}
SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "3XL"]
GARMENTS = ("a_line_dress", "wrap_skirt", "shirt")
SLEEVES = ("none", "short", "long")


@dataclass(frozen=True)
class Fabric:
    key: str
    label: str
    stretch: float  # elongation at a nominal load (0.02 = woven, 0.25 = knit)
    weight_gsm: float
    bending: float  # 0 (limp) .. 1 (crisp)
    friction: float = 0.45
    bias_stretch: float = 2.0  # woven fabrics give more on the bias (45 deg to the grain)


FABRICS: dict[str, Fabric] = {
    "cotton": Fabric("cotton", "Cotton poplin (woven)", stretch=0.02, weight_gsm=120, bending=0.35),
    "kitenge": Fabric("kitenge", "Kitenge wax print (woven, crisp)", stretch=0.015, weight_gsm=150, bending=0.75),
    "jersey": Fabric("jersey", "Jersey knit", stretch=0.25, weight_gsm=190, bending=0.08, friction=0.55, bias_stretch=1.0),
}


@dataclass
class Panel:
    name: str
    outline: np.ndarray  # (K, 2) CCW
    edges: dict[str, tuple[int, int]]  # name -> (start, end) vertex index along the outline (end may wrap to 0)
    placement: dict
    grain_deg: float = 90.0  # grain line direction in panel coordinates (90 = vertical)
    layer: int = 0

    def edge_points(self, name: str) -> np.ndarray:
        a, b = self.edges[name]
        k = len(self.outline)
        idx = [a]
        while idx[-1] != b:
            idx.append((idx[-1] + 1) % k)
        return self.outline[idx]

    def edge_length(self, name: str) -> float:
        p = self.edge_points(name)
        return float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum())

    def width_at(self, v: float) -> float:
        """Horizontal extent of the polygon at height v (sum of inside intervals)."""
        P = self.outline
        Q = np.roll(P, -1, axis=0)
        xs = []
        for (x1, y1), (x2, y2) in zip(P, Q):
            if (y1 <= v < y2) or (y2 <= v < y1):
                xs.append(x1 + (v - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        return float(sum(xs[i + 1] - xs[i] for i in range(0, len(xs) - 1, 2)))

    def area(self) -> float:
        x, y = self.outline[:, 0], self.outline[:, 1]
        return float(0.5 * (x @ np.roll(y, -1) - np.roll(x, -1) @ y))


@dataclass
class Seam:
    a: str
    edge_a: str
    b: str
    edge_b: str
    reverse: bool = False


@dataclass
class Pattern:
    garment: str
    size: str | None
    measurements: dict  # cm, what the pattern was graded from
    params: dict
    panels: list[Panel]
    seams: list[Seam]
    fabric: Fabric
    finished: dict  # finished garment measurements (cm) at named lines
    lines: dict  # drop (m, positive down from the anchor) of named lines
    anchor: str  # body landmark the panels' top line is placed at: "shoulder" | "waist"
    meta: dict = field(default_factory=dict)

    def panel(self, name: str) -> Panel:
        return next(p for p in self.panels if p.name == name)

    def summary(self) -> dict:
        return {
            "garment": self.garment, "size": self.size, "params": self.params, "fabric": self.fabric.key,
            "finished_cm": {k: round(v, 1) for k, v in self.finished.items()},
            "panels": [{"name": p.name, "area_m2": round(p.area(), 3), "edges": {k: round(p.edge_length(k), 3) for k in p.edges},
                        "grain_deg": p.grain_deg, "layer": p.layer} for p in self.panels],
            "seams": [[s.a, s.edge_a, s.b, s.edge_b] for s in self.seams],
            "version": PATTERN_VERSION,
        }


class _Outline:
    """Build a CCW polygon from consecutive named polylines (each starts where the previous ended)."""

    def __init__(self):
        self.pts: list[np.ndarray] = []
        self.edges: dict[str, tuple[int, int]] = {}

    def add(self, name: str, pts):
        pts = [np.asarray(p, dtype=np.float64) for p in pts]
        if self.pts and np.allclose(self.pts[-1], pts[0], atol=1e-9):
            pts = pts[1:]
            start = len(self.pts) - 1
        else:
            start = len(self.pts)
        self.pts.extend(pts)
        self.edges[name] = (start, len(self.pts) - 1)

    def close(self) -> tuple[np.ndarray, dict]:
        pts = np.asarray(self.pts)
        edges = dict(self.edges)
        if np.allclose(pts[-1], pts[0], atol=1e-9):
            pts = pts[:-1]
            k = len(pts)
            edges = {n: (a % k, b % k) for n, (a, b) in edges.items()}
        return pts, edges


def _bezier(p0, c, p1, n=8) -> list:
    t = np.linspace(0, 1, n)[:, None]
    p0, c, p1 = (np.asarray(x, dtype=np.float64) for x in (p0, c, p1))
    return list((1 - t) ** 2 * p0 + 2 * (1 - t) * t * c + t ** 2 * p1)


def _line(p0, p1, n=2) -> list:
    t = np.linspace(0, 1, n)[:, None]
    return list((1 - t) * np.asarray(p0, float) + t * np.asarray(p1, float))


def resolve(measurements: dict | None = None, size: str | None = None) -> dict:
    """Measurement profile (cm) for grading: profile values win, the size row fills gaps."""
    base = SIZES.get((size or "M").upper(), SIZES["M"])
    out = {k: float(v) for k, v in base.items()}
    for k, v in (measurements or {}).items():
        if k in out and isinstance(v, (int, float)) and 20 <= v <= 230:
            out[k] = float(v)
    return out


def _params(garment: str, params: dict | None) -> dict:
    p = {"length_cm": None, "ease_cm": 0.0, "sleeve": "short" if garment == "shirt" else "none", **(params or {})}
    p["ease_cm"] = float(np.clip(float(p.get("ease_cm") or 0.0), -6.0, 20.0))
    if p["sleeve"] not in SLEEVES:
        raise ValueError(f"Unknown sleeve '{p['sleeve']}'")
    if garment == "wrap_skirt":
        p["sleeve"] = "none"
    return p


def _bodice(m: dict, H: float, bust_f: float, hips_f: float, length: float, sleeved: bool, back: bool, flare: float):
    """Front or back panel: shoulders to hem, shift side seam (bust -> hips), optional A-line flare."""
    sh_half = m["shoulderCm"] / 200 - (0.0 if back else 0.005)
    slope = 0.045 * H / 1.65
    nw = m["neckCm"] / 600 + (0.012 if sleeved else 0.03)
    nd = (0.022 if back else (0.075 if not sleeved else 0.06)) * H / 1.65
    # Lines are measured from the neck point (the panel's top), which sits `slope` above the shoulder line.
    bust_drop, hip_drop = 0.096 * H + 0.012 + slope, 0.296 * H + slope
    Bq, Hq = bust_f / 400, hips_f / 400
    if sleeved:  # drop shoulder: shoulder point 4 cm past the shoulder, deeper straight armhole
        SP = (min(sh_half + 0.04, Bq - 0.012), -slope - 0.012)
        ad = 0.12 * H + 0.03 + slope * 0.5
        AP = (Bq, -ad)
        arm = _bezier(AP, (SP[0] + 0.012, -ad + 0.035), SP, 7)
    else:
        SP = (sh_half, -slope)
        ad = 0.115 * H + 0.012
        AP = (Bq, -ad)
        arm = _bezier(AP, (sh_half - 0.012, -ad + 0.02), SP, 9)
    side_pts = [(hem_q := Hq + flare, -length)]
    if length > hip_drop + 0.02:
        side_pts.append((Hq, -hip_drop))
    if -bust_drop < AP[1] - 0.01:
        side_pts.append((Bq, -bust_drop))
    side_pts.append(AP)
    if length <= hip_drop + 0.02:
        side_pts[0] = (Bq + (Hq - Bq) * min(1.0, length / hip_drop), -length)
        hem_q = side_pts[0][0]
    neck = [(nw * np.cos(t), -nd * np.sin(t)) for t in np.linspace(0, np.pi / 2, 7)]
    neck = neck + [(-x, y) for x, y in reversed(neck[:-1])]
    o = _Outline()
    o.add("hem", _line((-hem_q, -length), (hem_q, -length), 2))
    o.add("side_pos", side_pts)
    o.add("armhole_pos", arm)
    o.add("shoulder_pos", _line(SP, (nw, 0.0)))
    o.add("neck", neck)
    o.add("shoulder_neg", _line((-nw, 0.0), (-SP[0], SP[1])))
    o.add("armhole_neg", [(-x, y) for x, y in reversed(arm)])
    o.add("side_neg", [(-x, y) for x, y in reversed(side_pts)])
    pts, edges = o.close()
    # Drop-shoulder bodies are measured at the underarm (the bust line falls inside the armhole).
    return pts, edges, {"bust": max(bust_drop, ad + 0.005) if sleeved else bust_drop, "hips": hip_drop, "armpit": ad}


def _sleeve(m: dict, H: float, armhole_front: float, armhole_back: float, kind: str):
    cap_h = 0.035 * H / 1.65
    hw_t = float(np.sqrt(max(((armhole_front + armhole_back) / 2 + 0.005) ** 2 - cap_h ** 2, 0.01)))
    length = 0.2 * H / 1.65 if kind == "short" else m["sleeveCm"] / 100 - 0.05
    hw_b = hw_t * 0.88 if kind == "short" else max(0.11, m["bustCm"] / 100 * 0.135)
    cap = _bezier((hw_t, -cap_h), (hw_t * 0.45, 0.004), (0.0, 0.0), 9)
    o = _Outline()
    o.add("hem", _line((-hw_b, -length), (hw_b, -length), 2))
    o.add("underarm_pos", _line((hw_b, -length), (hw_t, -cap_h)))
    o.add("cap_pos", cap)
    o.add("cap_neg", [(-x, y) for x, y in reversed(cap)])
    o.add("underarm_neg", _line((-hw_t, -cap_h), (-hw_b, -length)))
    pts, edges = o.close()
    return pts, edges, length


def a_line_dress(measurements: dict | None = None, size: str | None = None, params: dict | None = None,
                 fabric: str = "cotton", design_ease: float = 4.0) -> Pattern:
    m = resolve(measurements, size)
    p = _params("a_line_dress", params)
    H = m["heightCm"] / 100
    ease = design_ease + p["ease_cm"]
    bust_f, hips_f = m["bustCm"] + ease, m["hipsCm"] + ease
    length = p["length_cm"] / 100 if p["length_cm"] else 0.95 * H / 1.65
    hip_drop = 0.296 * H + 0.045 * H / 1.65
    flare = 0.14 * max(0.0, length - hip_drop)
    sleeved = p["sleeve"] != "none"
    panels, seams = [], []
    lines = {}
    for name, back in (("front", False), ("back", True)):
        pts, edges, lines = _bodice(m, H, bust_f, hips_f, length, sleeved, back, flare)
        panels.append(Panel(name, pts, edges, {"kind": "wrap", "theta0": np.pi if back else 0.0}))
    seams += [Seam("front", "side_pos", "back", "side_neg", True), Seam("front", "side_neg", "back", "side_pos", True),
              Seam("front", "shoulder_pos", "back", "shoulder_neg", True), Seam("front", "shoulder_neg", "back", "shoulder_pos", True)]
    if sleeved:
        _add_sleeves(m, H, panels, seams, p["sleeve"])
    hem_f = (hips_f / 100 + 4 * flare) * 100
    return Pattern("a_line_dress", size, m, p, panels, seams, FABRICS[fabric],
                   {"bust": bust_f, "hips": hips_f, "hem": hem_f}, {**lines, "hem": length}, "shoulder",
                   {"design_ease_cm": design_ease, "taped": ["neck", "shoulder_pos", "shoulder_neg"]})


def shirt(measurements: dict | None = None, size: str | None = None, params: dict | None = None,
          fabric: str = "cotton", design_ease: float = 6.0) -> Pattern:
    m = resolve(measurements, size)
    p = _params("shirt", params)
    H = m["heightCm"] / 100
    ease = design_ease + p["ease_cm"]
    bust_f = m["bustCm"] + ease
    hips_f = max(m["hipsCm"] + 4 + p["ease_cm"], bust_f)
    length = (p["length_cm"] / 100) if p["length_cm"] else 0.66 * H / 1.65
    panels, seams = [], []
    lines = {}
    for name, back in (("front", False), ("back", True)):
        pts, edges, lines = _bodice(m, H, bust_f, hips_f, length, True, back, 0.0)
        panels.append(Panel(name, pts, edges, {"kind": "wrap", "theta0": np.pi if back else 0.0}))
    seams += [Seam("front", "side_pos", "back", "side_neg", True), Seam("front", "side_neg", "back", "side_pos", True),
              Seam("front", "shoulder_pos", "back", "shoulder_neg", True), Seam("front", "shoulder_neg", "back", "shoulder_pos", True)]
    if p["sleeve"] != "none":
        _add_sleeves(m, H, panels, seams, p["sleeve"])
    return Pattern("shirt", size, m, p, panels, seams, FABRICS[fabric], {"bust": bust_f, "hips": hips_f},
                   {**lines, "hem": length}, "shoulder", {"design_ease_cm": design_ease, "taped": ["neck", "shoulder_pos", "shoulder_neg"]})


def _add_sleeves(m, H, panels, seams, kind):
    front, back = panels[0], panels[1]
    af, ab = front.edge_length("armhole_pos"), back.edge_length("armhole_neg")
    pts, edges, length = _sleeve(m, H, af, ab, kind)
    for side in ("L", "R"):
        panels.append(Panel(f"sleeve_{side}", pts.copy(), dict(edges), {"kind": "arm", "side": side, "length": length}))
        seams.append(Seam(f"sleeve_{side}", "underarm_pos", f"sleeve_{side}", "underarm_neg", True))
    # Front +u is the body's left (x > 0); the back's -u is the body's left.
    seams += [Seam("sleeve_L", "cap_pos", "front", "armhole_pos"), Seam("sleeve_L", "cap_neg", "back", "armhole_neg"),
              Seam("sleeve_R", "cap_pos", "front", "armhole_neg", True), Seam("sleeve_R", "cap_neg", "back", "armhole_pos", True)]


def wrap_skirt(measurements: dict | None = None, size: str | None = None, params: dict | None = None,
               fabric: str = "cotton", design_ease: float = 4.0, overlap: float = 0.3) -> Pattern:
    m = resolve(measurements, size)
    p = _params("wrap_skirt", params)
    H = m["heightCm"] / 100
    waist_f = (m["waistCm"] + 1.0) / 100
    hips_f = (m["hipsCm"] + design_ease + p["ease_cm"]) / 100
    d = (0.618 - 0.522) * H  # waist -> hip line
    length = (p["length_cm"] / 100) if p["length_cm"] else 0.62 * H / 1.65
    theta = (hips_f - waist_f) / d  # sector angle of the fitted (non-overlapping) part
    r1 = waist_f / theta
    theta_tot = theta * (1 + overlap)
    ro = r1 + length

    def pt(rho, phi):
        return (rho * np.sin(phi), r1 - rho * np.cos(phi))

    phis = np.linspace(-theta_tot / 2, theta_tot / 2, 25)
    o = _Outline()
    o.add("hem", [pt(ro, f) for f in phis])
    o.add("free_pos", _line(pt(ro, theta_tot / 2), pt(r1, theta_tot / 2), 3))
    o.add("waist", [pt(r1, f) for f in phis[::-1]])
    o.add("free_neg", _line(pt(r1, -theta_tot / 2), pt(ro, -theta_tot / 2), 3))
    pts, edges = o.close()
    panel = Panel("wrap", pts, edges, {"kind": "cone", "r1": r1, "theta": theta, "theta_tot": theta_tot})
    return Pattern("wrap_skirt", size, m, p, [panel], [], FABRICS[fabric],
                   {"waist": waist_f * 100, "hips": hips_f * 100, "waist_max": waist_f * (1 + overlap) * 100 - 8.0},
                   {"waist": 0.0, "hips": d, "hem": length}, "waist", {"r1": r1, "theta": theta, "overlap": overlap,
                                                                      "design_ease_cm": design_ease,
                                                                      "taped": ["waist"]})


def wrap_worn_waist(pattern: Pattern, body_waist_cm: float) -> float:
    """The wearer ties the wrap at their waist + 1.5 cm, limited by the overlap (>= 8 cm must stay wrapped)."""
    return float(min(body_waist_cm + 1.5, pattern.finished["waist_max"]))


def finished_for_body(pattern: Pattern, body_m: dict) -> dict:
    """Finished circumference (cm) at each named line as worn on this body (wrap: tie rule)."""
    if pattern.garment != "wrap_skirt":
        return {k: v for k, v in pattern.finished.items() if k in ("bust", "hips")}
    w = wrap_worn_waist(pattern, body_m["waistCm"])
    r1, d = pattern.meta["r1"], pattern.lines["hips"]
    return {"waist": w, "hips": w * (r1 + d) / r1}


GENERATORS = {"a_line_dress": a_line_dress, "wrap_skirt": wrap_skirt, "shirt": shirt}


def generate(garment: str, measurements: dict | None = None, size: str | None = None, params: dict | None = None,
             fabric: str = "cotton") -> Pattern:
    if garment not in GENERATORS:
        raise ValueError(f"Unknown garment '{garment}'")
    if fabric not in FABRICS:
        raise ValueError(f"Unknown fabric '{fabric}'")
    return GENERATORS[garment](measurements, size, params, fabric)
