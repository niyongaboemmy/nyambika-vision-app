"""Parametric, animatable body (E33 dev adapter for FR-AVA-01..06).

Builds a stylised, skinned body mesh whose proportions come from the shopper's measurement
profile (or the photo twin's size estimate): lofted elliptical torso cross-sections whose
circumferences match bust/waist/hips, tapered limb tubes, a stylised head with hair (never a
likeness), an 18-joint skeleton, linear-blend skin weights and three animation clips
(Idle, Walk, Turn). Metre scale, y up, facing +z, feet on y = 0.

This is NOT 3D Gaussian splatting on SMPL-X: it is the CPU stand-in behind the same provider
interface (see avatar_providers.py). Everything a real provider must return (GLB with a skin,
joints, clips; skin tone and body-shape fidelity numbers) is produced and evaluated here.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .gltf import GltfBuilder, linear_to_srgb, quat_axis_angle, srgb_to_linear

MODEL_VERSION = "parametric-body@1.0"
MAX_TRIANGLES = 25_000

# Same table as packages/contracts TWIN_SIZE_PREFILL (cm). Used when the profile lacks a field.
SIZE_PREFILL = {
    "XS": {"heightCm": 158, "bustCm": 78, "waistCm": 61, "hipsCm": 86, "inseamCm": 74, "shoulderCm": 35, "sleeveCm": 56, "neckCm": 32},
    "S": {"heightCm": 162, "bustCm": 83, "waistCm": 66, "hipsCm": 90, "inseamCm": 75, "shoulderCm": 37, "sleeveCm": 57, "neckCm": 33},
    "M": {"heightCm": 165, "bustCm": 90, "waistCm": 72, "hipsCm": 97, "inseamCm": 76, "shoulderCm": 38, "sleeveCm": 58, "neckCm": 34},
    "L": {"heightCm": 167, "bustCm": 97, "waistCm": 80, "hipsCm": 104, "inseamCm": 77, "shoulderCm": 40, "sleeveCm": 59, "neckCm": 36},
    "XL": {"heightCm": 168, "bustCm": 106, "waistCm": 89, "hipsCm": 113, "inseamCm": 77, "shoulderCm": 42, "sleeveCm": 60, "neckCm": 38},
    "XXL": {"heightCm": 168, "bustCm": 116, "waistCm": 99, "hipsCm": 123, "inseamCm": 77, "shoulderCm": 44, "sleeveCm": 61, "neckCm": 40},
}
SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "3XL"]
LIMITS = {"heightCm": (90, 220), "bustCm": (50, 180), "waistCm": (40, 180), "hipsCm": (50, 200), "inseamCm": (40, 110),
          "shoulderCm": (25, 65), "sleeveCm": (30, 90), "neckCm": (25, 60)}

BODYSUIT = (0.165, 0.153, 0.2)  # neutral studio base layer (sRGB)
HAIR = (0.118, 0.086, 0.07)
SHOES = (0.12, 0.1, 0.1)
EYES = (0.06, 0.045, 0.04)

JOINTS = ["root", "hips", "spine", "chest", "neck", "head",
          "shoulder_L", "elbow_L", "wrist_L", "shoulder_R", "elbow_R", "wrist_R",
          "upleg_L", "knee_L", "ankle_L", "upleg_R", "knee_R", "ankle_R"]
PARENT = {"hips": "root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck",
          "shoulder_L": "chest", "elbow_L": "shoulder_L", "wrist_L": "elbow_L",
          "shoulder_R": "chest", "elbow_R": "shoulder_R", "wrist_R": "elbow_R",
          "upleg_L": "hips", "knee_L": "upleg_L", "ankle_L": "knee_L",
          "upleg_R": "hips", "knee_R": "upleg_R", "ankle_R": "knee_R"}
J = {n: i for i, n in enumerate(JOINTS)}
A_POSE_DEG = 24.0
TORSO_SEG, LIMB_SEG = 48, 24


def ellipse_perimeter(a: float, b: float) -> float:
    """Ramanujan's second approximation (error < 1e-5 relative for body-like ratios)."""
    h = ((a - b) / (a + b)) ** 2
    return float(np.pi * (a + b) * (1 + 3 * h / (10 + np.sqrt(4 - 3 * h))))


def axes_for(circ_m: float, depth_ratio: float) -> tuple[float, float]:
    a = circ_m / ellipse_perimeter(1.0, depth_ratio)
    return a, a * depth_ratio


def nearest_size(m: dict) -> str:
    """Size label whose prefill bust/waist/hips is closest (used for ease and as a fallback)."""
    def d(s):
        p = SIZE_PREFILL[s]
        return sum((m.get(k, p[k]) - p[k]) ** 2 for k in ("bustCm", "waistCm", "hipsCm"))
    return min(SIZE_PREFILL, key=d)


def resolve_measurements(measurements: dict | None, size_estimate: str | None) -> tuple[dict, list[str]]:
    """Profile values win; missing fields come from the size estimate's prefill. Returns (cm dict, sources)."""
    base = SIZE_PREFILL.get((size_estimate or "M").upper(), SIZE_PREFILL["M"])
    out, from_profile = {}, []
    for k, v in base.items():
        given = (measurements or {}).get(k)
        if isinstance(given, (int, float)) and LIMITS[k][0] <= given <= LIMITS[k][1]:
            out[k] = float(given)
            from_profile.append(k)
        else:
            out[k] = float(v)
    # Keep the torso physically plausible: waist cannot exceed hips/bust by much, inseam < 52% height.
    out["inseamCm"] = min(out["inseamCm"], out["heightCm"] * 0.5)
    return out, from_profile


def _smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


@dataclass
class Part:
    name: str
    start: int
    end: int


@dataclass
class Body:
    m: dict
    skin_srgb: tuple[float, float, float]
    H: float = 0.0
    y: dict = field(default_factory=dict)
    rings: list = field(default_factory=list)  # torso (y, a, b, cz)
    leg: dict = field(default_factory=dict)
    joints: dict = field(default_factory=dict)
    positions: np.ndarray | None = None
    weights_j: np.ndarray | None = None
    weights_w: np.ndarray | None = None
    groups: dict = field(default_factory=dict)  # material -> list of tris
    parts: list = field(default_factory=list)
    landmark_rings: dict = field(default_factory=dict)  # name -> (start index, count)

    # ── analytic surface (used by the garment fitter) ─────────────────────
    def torso_axes(self, y: float) -> tuple[float, float, float]:
        ys = np.array([r[0] for r in self.rings])
        a = float(np.interp(y, ys, [r[1] for r in self.rings]))
        b = float(np.interp(y, ys, [r[2] for r in self.rings]))
        cz = float(np.interp(y, ys, [r[3] for r in self.rings]))
        return a, b, cz

    def leg_radius(self, y: float) -> float:
        L = self.leg
        return float(np.interp(y, L["ys"][::-1], L["r"][::-1]))

    def envelope(self, y: float) -> tuple[float, float, float]:
        """Ellipse (a, b, cz) that encloses the body cross-section at height y (torso or both legs)."""
        if y >= self.y["crotch"]:
            return self.torso_axes(y)
        r = self.leg_radius(y)
        a = self.leg["x"] + r
        # Smallest b (for this a) whose ellipse contains both leg circles: max z / sqrt(1 - (x/a)^2).
        phi = np.linspace(0, np.pi, 91)
        x = self.leg["x"] + r * np.cos(phi)
        z = r * np.sin(phi)
        inside = np.clip(1 - (x / a) ** 2, 1e-6, 1)
        return a, float(max(r, (z / np.sqrt(inside)).max())), 0.0


def build_body(measurements: dict, skin_srgb, a_pose_deg: float = A_POSE_DEG) -> Body:
    """a_pose_deg: arm abduction; the R4 drape spike uses a wider A-pose so cloth fits between arm and torso."""
    m = measurements
    b = Body(m=m, skin_srgb=tuple(float(c) for c in skin_srgb))
    H = m["heightCm"] / 100
    b.H = H
    s = H / 1.65
    head_h = H / 7.6
    y_sh = 0.818 * H
    y = {
        "shoulder": y_sh, "bust": 0.722 * H, "waist": 0.618 * H, "hips": 0.522 * H,
        "crotch": min(m["inseamCm"] / 100, 0.505 * H), "knee": 0.285 * H, "ankle": 0.045 * H,
        "neck": y_sh + 0.042 * s,
    }
    y["crotch"] = min(y["crotch"], y["hips"] - 0.045 * s)
    y["armpit"] = (y["bust"] + y_sh) / 2 + 0.01 * s
    hair_ry = 1.12
    ry = head_h / 2
    y["head_c"] = H - 0.03 * s - hair_ry * ry
    y["chin"] = y["head_c"] - ry * 0.92
    b.y = y

    ah, bh = axes_for(m["hipsCm"] / 100, 0.78)
    aw, bw = axes_for(m["waistCm"] / 100, 0.74)
    ab, bb = axes_for(m["bustCm"] / 100, 0.70)
    an, bn = axes_for(m["neckCm"] / 100, 0.92)
    sh_a = m["shoulderCm"] / 200 * 1.06
    # Torso landmark rings bottom → top: (name, y, a, b, cz)
    marks = [
        ("base", y["crotch"] + 0.012 * s, ah * 0.9, bh * 0.92, -0.004),
        ("lowhip", (y["crotch"] + y["hips"]) / 2, ah * 0.985, bh * 0.99, -0.008),
        ("hips", y["hips"], ah, bh, -0.01),
        ("abdomen", (y["hips"] + y["waist"]) / 2, (ah + aw) / 2 * 0.985, (bh + bw) / 2, -0.004),
        ("waist", y["waist"], aw, bw, 0.0),
        ("underbust", (y["waist"] + y["bust"]) / 2 + 0.01 * s, (aw + ab) / 2, (bw + bb) / 2 * 0.98, 0.004),
        ("bust", y["bust"], ab, bb, 0.012),
        ("armpit", y["armpit"], max(ab * 1.0, sh_a * 0.84), bb * 0.92, 0.006),
        ("shoulder", y_sh - 0.008 * s, sh_a, bb * 0.72, -0.004),
        ("trap", y_sh + 0.02 * s, sh_a * 0.58, bb * 0.6, -0.008),
        ("neck", y["neck"], an, bn, -0.006),
        ("neck_top", y["chin"] + 0.01 * s, an * 0.94, bn * 0.94, -0.004),
    ]
    # Densify between landmarks (smooth interpolation keeps the exact landmark rings).
    rings = []
    landmark_idx = {}
    for i, (name, yy, a, bb_, cz) in enumerate(marks):
        landmark_idx[name] = len(rings)
        rings.append((yy, a, bb_, cz))
        if i + 1 < len(marks):
            _, y2, a2, b2, c2 = marks[i + 1]
            steps = 2 if name not in ("shoulder", "trap", "neck") else 1
            for k in range(1, steps + 1):
                t = k / (steps + 1)
                ts = _smooth(t) * 0.5 + t * 0.5
                rings.append((yy + (y2 - yy) * t, a + (a2 - a) * ts, bb_ + (b2 - bb_) * ts, cz + (c2 - cz) * ts))
    b.rings = rings

    leg_x = ah * 0.47
    leg_ys = np.array([y["crotch"] + 0.06 * s, y["crotch"], (y["crotch"] + y["knee"]) / 2, y["knee"] + 0.03 * s, y["knee"],
                       (y["knee"] + y["ankle"]) / 2 + 0.04 * s, y["ankle"] + 0.03 * s, y["ankle"]])
    hc = m["hipsCm"] / 100
    leg_c = np.array([0.6, 0.58, 0.5, 0.4, 0.37, 0.36, 0.24, 0.22]) * hc
    b.leg = {"x": leg_x, "ys": leg_ys, "r": leg_c / (2 * np.pi)}

    alpha = np.radians(a_pose_deg)
    upper, fore, hand = 0.186 * H, 0.146 * H, 0.1 * H
    sh_y = y_sh - 0.03 * s
    joints = {
        "root": np.zeros(3), "hips": np.array([0, y["hips"], 0]), "spine": np.array([0, y["waist"], 0]),
        "chest": np.array([0, y["bust"], 0]), "neck": np.array([0, y["neck"], 0]), "head": np.array([0, y["chin"] + 0.02 * s, 0]),
    }
    for side, sx in (("L", 1), ("R", -1)):
        d = np.array([sx * np.sin(alpha), -np.cos(alpha), 0.0])
        sh = np.array([sx * (sh_a - 0.04 * s), sh_y, -0.005])
        joints[f"shoulder_{side}"] = sh
        joints[f"elbow_{side}"] = sh + d * upper
        joints[f"wrist_{side}"] = sh + d * (upper + fore)
        joints[f"upleg_{side}"] = np.array([sx * leg_x, y["crotch"] + 0.03 * s, 0])
        joints[f"knee_{side}"] = np.array([sx * leg_x, y["knee"], 0])
        joints[f"ankle_{side}"] = np.array([sx * leg_x, y["ankle"], 0])
    b.joints = joints

    P: list[np.ndarray] = []
    WJ: list[np.ndarray] = []
    WW: list[np.ndarray] = []
    groups: dict[str, list] = {"skin": [], "suit": [], "hair": [], "eyes": [], "shoes": []}
    count = [0]

    def add(pos: np.ndarray, wj: np.ndarray, ww: np.ndarray, name: str) -> int:
        start = count[0]
        P.append(pos)
        WJ.append(wj)
        WW.append(ww)
        count[0] += len(pos)
        b.parts.append(Part(name, start, count[0]))
        return start

    def weights(n, pairs):
        """pairs: list of (joint index array (n,), weight array (n,)) → top-4 normalised."""
        wj = np.zeros((n, 4), dtype=np.uint8)
        ww = np.zeros((n, 4), dtype=np.float32)
        for k, (ji, wi) in enumerate(pairs[:4]):
            wj[:, k] = ji
            ww[:, k] = wi
        ww /= np.maximum(ww.sum(axis=1, keepdims=True), 1e-9)
        return wj, ww

    def tube_tris(start, n_rings, seg, group, cap_bottom=None, cap_top=None):
        tris = []
        for r in range(n_rings - 1):
            for c in range(seg):
                a0 = start + r * seg + c
                a1 = start + r * seg + (c + 1) % seg
                b0, b1 = a0 + seg, a1 + seg
                tris.append((a0, a1, b0))
                tris.append((a1, b1, b0))
        groups[group].extend(tris)
        return tris

    # ── torso ──
    th = np.linspace(0, 2 * np.pi, TORSO_SEG, endpoint=False)
    # Ring vertex c at angle θ: x = a cos θ, z = cz + b sin θ. Rings bottom → top (y increasing).
    tpos = np.concatenate([np.stack([a * np.cos(th), np.full(TORSO_SEG, yy), cz + bb_ * np.sin(th)], axis=1) for yy, a, bb_, cz in rings])
    ty = tpos[:, 1]
    chain = [("hips", y["hips"]), ("spine", y["waist"]), ("chest", y["bust"]), ("neck", y["neck"])]
    cy = np.array([c[1] for c in chain])
    ci = np.array([J[c[0]] for c in chain])
    seg_i = np.clip(np.searchsorted(cy, ty) - 1, 0, len(cy) - 2)
    tt = np.clip((ty - cy[seg_i]) / (cy[seg_i + 1] - cy[seg_i]), 0, 1)
    w_up = _smooth(tt)
    ws_sh = _smooth((np.abs(tpos[:, 0]) / sh_a - 0.62) / 0.38) * _smooth((ty - y["armpit"]) / (y_sh - y["armpit"])) * 0.55
    sh_j = np.where(tpos[:, 0] > 0, J["shoulder_L"], J["shoulder_R"])
    ws_leg = _smooth((y["crotch"] + 0.09 * s - ty) / (0.09 * s)) * 0.45 * _smooth(np.abs(tpos[:, 0]) / (ah * 0.5))
    leg_j = np.where(tpos[:, 0] > 0, J["upleg_L"], J["upleg_R"])
    rest = 1 - ws_sh - ws_leg
    wj, ww = weights(len(tpos), [(ci[seg_i], rest * (1 - w_up)), (ci[seg_i + 1], rest * w_up), (sh_j, ws_sh), (leg_j, ws_leg)])
    t0 = add(tpos, wj, ww, "torso")
    n_r = len(rings)
    for r in range(n_r - 1):
        grp = "skin" if r >= landmark_idx["trap"] + 1 else "suit"
        for c in range(TORSO_SEG):
            a0 = t0 + r * TORSO_SEG + c
            a1 = t0 + r * TORSO_SEG + (c + 1) % TORSO_SEG
            b0, b1 = a0 + TORSO_SEG, a1 + TORSO_SEG
            groups[grp].extend([(a0, b0, a1), (a1, b0, b1)])
    # Bottom cap (fan) so the inside never shows between the legs.
    bc = add(np.array([[0, rings[0][0] - 0.01 * s, rings[0][3]]]), *weights(1, [(np.array([J["hips"]]), np.ones(1))]), "torso_cap")
    for c in range(TORSO_SEG):
        groups["suit"].append((bc, t0 + c, t0 + (c + 1) % TORSO_SEG))
    b.landmark_rings = {k: (t0 + v * TORSO_SEG, TORSO_SEG) for k, v in landmark_idx.items()}

    # ── legs ──
    lth = np.linspace(0, 2 * np.pi, LIMB_SEG, endpoint=False)
    knee_y, ankle_y = y["knee"], y["ankle"]
    for side, sx in (("L", 1), ("R", -1)):
        ys = b.leg["ys"]
        rr = b.leg["r"]
        pos = np.concatenate([np.stack([sx * leg_x + r * np.cos(lth), np.full(LIMB_SEG, yy), r * 0.96 * np.sin(lth)], axis=1) for yy, r in zip(ys, rr)])
        py = pos[:, 1]
        w_knee = _smooth((knee_y + 0.05 * s - py) / (0.1 * s))
        w_ankle = _smooth((ankle_y + 0.035 * s - py) / (0.05 * s))
        w_hip = _smooth((py - (y["crotch"] - 0.02 * s)) / (0.08 * s)) * 0.5
        up = (1 - w_knee) * (1 - w_hip)
        wj, ww = weights(len(pos), [(np.full(len(pos), J[f"upleg_{side}"]), up), (np.full(len(pos), J[f"knee_{side}"]), w_knee * (1 - w_ankle)),
                                    (np.full(len(pos), J[f"ankle_{side}"]), w_ankle), (np.full(len(pos), J["hips"]), (1 - w_knee) * w_hip)])
        st = add(pos, wj, ww, f"leg_{side}")
        suit_rings = 3  # shorts to mid-thigh
        for r in range(len(ys) - 1):
            grp = "suit" if r < suit_rings - 1 else "skin"
            for c in range(LIMB_SEG):
                a0 = st + r * LIMB_SEG + c
                a1 = st + r * LIMB_SEG + (c + 1) % LIMB_SEG
                b0, b1 = a0 + LIMB_SEG, a1 + LIMB_SEG
                # Rings run top → bottom here, so winding is reversed relative to the torso.
                groups[grp].extend([(a0, a1, b0), (a1, b1, b0)])
        # Foot (shoe): ellipsoid forward of the ankle.
        fpos, ftris = ellipsoid(np.array([sx * leg_x, 0.032 * s, 0.04 * s]), np.array([0.04 * s, 0.032 * s, 0.11 * s]), 10, 16)
        fpos[:, 1] = np.maximum(fpos[:, 1], 0.0)
        fs = add(fpos, *weights(len(fpos), [(np.full(len(fpos), J[f"ankle_{side}"]), np.ones(len(fpos)))]), f"foot_{side}")
        groups["shoes"].extend([(fs + a, fs + bq, fs + c) for a, bq, c in ftris])

    # ── arms ──
    for side, sx in (("L", 1), ("R", -1)):
        sh, el, wr = joints[f"shoulder_{side}"], joints[f"elbow_{side}"], joints[f"wrist_{side}"]
        d = (wr - sh) / np.linalg.norm(wr - sh)
        u = np.array([-d[1], d[0], 0.0]) * sx  # in the frontal plane, perpendicular to the arm
        u /= np.linalg.norm(u)
        w = np.array([0.0, 0.0, 1.0])
        bc_ = m["bustCm"] / 100
        L = np.linalg.norm(wr - sh)
        ts = np.array([-0.03, 0.0, 0.25, 0.5, 0.75, 1.0])
        tn = np.concatenate([ts * (np.linalg.norm(el - sh) / L), [np.linalg.norm(el - sh) / L + f * (1 - np.linalg.norm(el - sh) / L) for f in (0.25, 0.5, 0.8, 1.0)]])
        circ = np.array([0.34, 0.32, 0.31, 0.29, 0.26, 0.245, 0.26, 0.24, 0.2, 0.17]) * bc_
        rr = circ / (2 * np.pi)
        pos = np.concatenate([sh + d * (t * L) + r * (np.cos(lth)[:, None] * u + 0.92 * np.sin(lth)[:, None] * w) for t, r in zip(tn, rr)])
        proj = (pos - sh) @ d / L
        e = np.linalg.norm(el - sh) / L
        w_el = _smooth((proj - (e - 0.06)) / 0.12)
        w_wr = _smooth((proj - 0.94) / 0.06)
        w_ch = _smooth((0.06 - proj) / 0.1) * 0.35
        wj, ww = weights(len(pos), [(np.full(len(pos), J[f"shoulder_{side}"]), (1 - w_el) * (1 - w_ch)), (np.full(len(pos), J[f"elbow_{side}"]), w_el * (1 - w_wr)),
                                    (np.full(len(pos), J[f"wrist_{side}"]), w_wr), (np.full(len(pos), J["chest"]), (1 - w_el) * w_ch)])
        st = add(pos, wj, ww, f"arm_{side}")
        for r in range(len(tn) - 1):
            for c in range(LIMB_SEG):
                a0 = st + r * LIMB_SEG + c
                a1 = st + r * LIMB_SEG + (c + 1) % LIMB_SEG
                b0, b1 = a0 + LIMB_SEG, a1 + LIMB_SEG
                tri = [(a0, a1, b0), (a1, b1, b0)] if sx > 0 else [(a0, b0, a1), (a1, b0, b1)]
                groups["skin"].extend(tri)
        # Hand: flattened ellipsoid along the arm direction.
        hc_ = wr + d * (hand * 0.45)
        hpos, htris = ellipsoid(np.zeros(3), np.array([0.038 * s, hand * 0.5, 0.017 * s]), 8, 12)
        rot = np.stack([u * sx, -d, w], axis=1)  # right-handed frame, local y along -d (down the arm)
        hpos = hpos @ rot.T + hc_
        hs = add(hpos, *weights(len(hpos), [(np.full(len(hpos), J[f"wrist_{side}"]), np.ones(len(hpos)))]), f"hand_{side}")
        groups["skin"].extend([(hs + a, hs + bq, hs + c) for a, bq, c in htris])

    # ── head, hair, eyes (stylised, not a likeness) ──
    rx, rz = 0.074 * s, 0.092 * s
    hcen = np.array([0, y["head_c"], 0.006])
    hpos, htris = ellipsoid(hcen, np.array([rx, ry, rz]), 18, 28)
    head_w = weights(len(hpos), [(np.full(len(hpos), J["head"]), np.ones(len(hpos)))])
    hs = add(hpos, *head_w, "head")
    groups["skin"].extend([(hs + a, hs + bq, hs + c) for a, bq, c in htris])
    hair_c = hcen + np.array([0, 0.03 * s, -0.022 * s])
    gpos, gtris = hair_cap(hair_c, np.array([rx * 1.42, ry * hair_ry, rz * 1.26]))
    keep = gtris
    gs = add(gpos, *weights(len(gpos), [(np.full(len(gpos), J["head"]), np.ones(len(gpos)))]), "hair")
    groups["hair"].extend([(gs + a, gs + bq, gs + c) for a, bq, c in keep])
    for sx in (1, -1):
        epos, etris = ellipsoid(hcen + np.array([sx * 0.027 * s, 0.006 * s, rz * 0.9]), np.array([0.0085, 0.0065, 0.004]) * s, 6, 8)
        es = add(epos, *weights(len(epos), [(np.full(len(epos), J["head"]), np.ones(len(epos)))]), "eye")
        groups["eyes"].extend([(es + a, es + bq, es + c) for a, bq, c in etris])

    b.positions = np.concatenate(P).astype(np.float32)
    b.weights_j = np.concatenate(WJ)
    b.weights_w = np.concatenate(WW).astype(np.float32)
    b.groups = {k: np.asarray(v, dtype=np.uint32) for k, v in groups.items() if v}
    return b


def hair_cap(center: np.ndarray, radii: np.ndarray, n_rings: int = 14, n_lon: int = 36):
    """Open ellipsoidal cap whose lower edge rises smoothly from the nape (back) to the hairline (front)."""
    th = 2 * np.pi * np.arange(n_lon) / n_lon  # 0 = facing +z
    w = ((1 + np.cos(th)) / 2) ** 0.7
    phi_max = 0.8 * np.pi + (0.36 * np.pi - 0.8 * np.pi) * w
    pos = [center + np.array([0, radii[1], 0])]
    for i in range(1, n_rings + 1):
        phi = phi_max * i / n_rings
        pos.extend(center + radii * np.stack([np.sin(phi) * np.sin(th), np.cos(phi), np.sin(phi) * np.cos(th)], axis=1))
    tris = [(0, 1 + j, 1 + (j + 1) % n_lon) for j in range(n_lon)]
    for i in range(n_rings - 1):
        for j in range(n_lon):
            a = 1 + i * n_lon + j
            b = 1 + i * n_lon + (j + 1) % n_lon
            tris.append((a, a + n_lon, b))
            tris.append((b, a + n_lon, b + n_lon))
    return np.asarray(pos), tris


def ellipsoid(center: np.ndarray, radii: np.ndarray, n_lat: int, n_lon: int):
    """UV sphere scaled to radii; returns (positions, tris) with outward winding."""
    pos = [center + np.array([0, radii[1], 0])]
    for i in range(1, n_lat):
        phi = np.pi * i / n_lat
        for j in range(n_lon):
            th = 2 * np.pi * j / n_lon
            pos.append(center + radii * np.array([np.sin(phi) * np.sin(th), np.cos(phi), np.sin(phi) * np.cos(th)]))
    pos.append(center - np.array([0, radii[1], 0]))
    pos = np.asarray(pos)
    tris = []
    for j in range(n_lon):
        tris.append((0, 1 + j, 1 + (j + 1) % n_lon))
    for i in range(n_lat - 2):
        for j in range(n_lon):
            a = 1 + i * n_lon + j
            b = 1 + i * n_lon + (j + 1) % n_lon
            c, d = a + n_lon, b + n_lon
            tris.append((a, c, b))
            tris.append((b, c, d))
    last = len(pos) - 1
    base = 1 + (n_lat - 2) * n_lon
    for j in range(n_lon):
        tris.append((base + j, last, base + (j + 1) % n_lon))
    return pos, tris


def normals(positions: np.ndarray, tris: np.ndarray) -> np.ndarray:
    v0, v1, v2 = (positions[tris[:, i]] for i in range(3))
    face = np.cross(v1 - v0, v2 - v0)
    n = np.zeros_like(positions, dtype=np.float64)
    for i in range(3):
        np.add.at(n, tris[:, i], face)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    ln[ln == 0] = 1
    return (n / ln).astype(np.float32)


# ── skeleton, skin and clips ───────────────────────────────────────────────
def add_skeleton(g: GltfBuilder, body: Body) -> tuple[list[int], int]:
    """Joint nodes (bind pose = no rotation), returns (joint node ids in JOINTS order, skin id)."""
    node_of: dict[str, int] = {}
    for name in JOINTS:
        parent = PARENT.get(name)
        t = body.joints[name] - (body.joints[parent] if parent else 0)
        node_of[name] = g.node(name=name, translation=[float(x) for x in t])
    for name in JOINTS:
        kids = [node_of[c] for c, p in PARENT.items() if p == name]
        if kids:
            g.gltf["nodes"][node_of[name]]["children"] = kids
    g.root(node_of["root"])
    ibm = np.stack([_inv_translation(body.joints[n]) for n in JOINTS])
    ids = [node_of[n] for n in JOINTS]
    return ids, g.skin(ids, ibm, node_of["root"])


def _inv_translation(p) -> np.ndarray:
    m = np.eye(4, dtype=np.float32)
    m[:3, 3] = -np.asarray(p, dtype=np.float32)
    return m.T.reshape(-1)  # column-major


def add_clips(g: GltfBuilder, ids: list[int], body: Body):
    n = {name: ids[i] for i, name in enumerate(JOINTS)}
    X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)

    def rot(axis, degs):
        return np.stack([quat_axis_angle(axis, d) for d in degs])

    # Idle: 4 s breathing sway.
    t = np.linspace(0, 4, 9)
    ph = t / 4 * 2 * np.pi
    g.animation("Idle", [
        (n["chest"], "rotation", t, rot(X, 1.6 * np.sin(ph))),
        (n["hips"], "rotation", t, rot(Z, 1.4 * np.sin(ph))),
        (n["head"], "rotation", t, rot(Y, 4 * np.sin(ph + 0.6))),
        (n["shoulder_L"], "rotation", t, rot(Z, 2.5 * np.sin(ph))),
        (n["shoulder_R"], "rotation", t, rot(Z, -2.5 * np.sin(ph))),
    ])
    # Walk in place: 1.1 s loop.
    t = np.linspace(0, 1.1, 13)
    ph = t / 1.1 * 2 * np.pi

    def knee(p):
        return 6 + 36 * np.maximum(0, np.cos(p)) ** 2

    root_y = 0.012 * np.abs(np.cos(ph))
    g.animation("Walk", [
        (n["upleg_L"], "rotation", t, rot(X, -24 * np.sin(ph))),
        (n["upleg_R"], "rotation", t, rot(X, 24 * np.sin(ph))),
        (n["knee_L"], "rotation", t, rot(X, knee(ph))),
        (n["knee_R"], "rotation", t, rot(X, knee(ph + np.pi))),
        (n["shoulder_L"], "rotation", t, rot(X, 17 * np.sin(ph))),
        (n["shoulder_R"], "rotation", t, rot(X, -17 * np.sin(ph))),
        (n["elbow_L"], "rotation", t, rot(X, -12 - 8 * np.sin(ph))),
        (n["elbow_R"], "rotation", t, rot(X, -12 + 8 * np.sin(ph))),
        (n["hips"], "rotation", t, rot(Y, 5 * np.sin(ph))),
        (n["chest"], "rotation", t, rot(Y, -6 * np.sin(ph))),
        (n["root"], "translation", t, np.stack([np.zeros_like(t), root_y, np.zeros_like(t)], axis=1)),
    ])
    # Turn: one slow 360° turn on the spot (6 s), 45° keys so LINEAR slerp stays on the shortest arc.
    t = np.linspace(0, 6, 9)
    g.animation("Turn", [(n["root"], "rotation", t, rot(Y, np.linspace(0, 360, 9)))])


def skin_material_rgba(skin_srgb) -> list[float]:
    lin = srgb_to_linear(np.asarray(skin_srgb))
    return [*lin.tolist(), 1.0]


def add_body_mesh(g: GltfBuilder, body: Body, skin_id: int) -> dict:
    pos = body.positions
    all_tris = np.concatenate(list(body.groups.values()))
    nrm = normals(pos, all_tris)
    a_pos = g.accessor(pos, minmax=True)
    a_nrm = g.accessor(nrm)
    a_j = g.accessor(body.weights_j, 5121)
    a_w = g.accessor(body.weights_w)
    mats = {
        "skin": g.material("skin", skin_material_rgba(body.skin_srgb), roughness=0.62),
        "suit": g.material("bodysuit", [*srgb_to_linear(np.array(BODYSUIT)).tolist(), 1], roughness=0.8, sheen=(0.25, 0.24, 0.3)),
        "hair": g.material("hair", [*srgb_to_linear(np.array(HAIR)).tolist(), 1], roughness=0.95, double_sided=True),
        "eyes": g.material("eyes", [*srgb_to_linear(np.array(EYES)).tolist(), 1], roughness=0.3),
        "shoes": g.material("shoes", [*srgb_to_linear(np.array(SHOES)).tolist(), 1], roughness=0.55),
    }
    prims = [{"attributes": {"POSITION": a_pos, "NORMAL": a_nrm, "JOINTS_0": a_j, "WEIGHTS_0": a_w},
              "indices": g.indices(tris), "material": mats[k], "mode": 4} for k, tris in body.groups.items()]
    mesh = g.mesh("body", prims)
    node = g.node(name="body", mesh=mesh, skin=skin_id)
    g.root(node)
    return {"triangles": int(len(all_tris)), "vertices": int(len(pos))}


def body_glb(body: Body, extras: dict, garment=None) -> tuple[bytes, dict]:
    """GLB with body (+ optional fitted garment, see avatar_dress) on one skeleton with clips."""
    g = GltfBuilder(f"Nyambika AI Gateway {MODEL_VERSION}", extras)
    ids, skin = add_skeleton(g, body)
    stats = add_body_mesh(g, body, skin)
    if garment is not None:
        stats["garment_triangles"] = garment.add_to(g, skin)
        stats["triangles"] += stats["garment_triangles"]
    add_clips(g, ids, body)
    return g.build(), {**stats, "joints": len(JOINTS), "animations": ["Idle", "Walk", "Turn"]}


def measured(body: Body) -> dict:
    """Body-shape fidelity read back from the mesh: height and landmark ring perimeters (cm)."""
    pos = body.positions
    out = {"heightCm": float((pos[:, 1].max() - pos[:, 1].min()) * 100)}
    for k, name in (("bustCm", "bust"), ("waistCm", "waist"), ("hipsCm", "hips")):
        start, n = body.landmark_rings[name]
        ring = pos[start:start + n][:, [0, 2]].astype(np.float64)
        out[k] = float(np.linalg.norm(np.roll(ring, -1, axis=0) - ring, axis=1).sum() * 100)
    return out


def proportion_error(body: Body) -> float:
    got = measured(body)
    return float(np.mean([abs(got[k] - body.m[k]) / body.m[k] for k in got]))


def skin_from_material(rgba) -> np.ndarray:
    return linear_to_srgb(np.asarray(rgba[:3]))
