"""CPU cloth drape for pattern garments (R4 spike): position-based dynamics, numpy only.

Pipeline (the same order a pattern-CAD tool uses):
  1. arrange: wrap each flat panel around the body near its final place (front/back on an
     ellipse around the torso, sleeves around the arm axis, the wrap skirt rolled into a cone);
  2. sew (no gravity): seam stitches shrink to zero length while collisions keep the cloth outside
     the body, so seams close around it;
  3. drape (gravity): the cloth settles on shoulders / waist / hips.

Constraints are solved with graph-coloured Gauss-Seidel PBD (each colour is one vectorised batch):
  * stretch: every mesh edge keeps its flat 2D length, stiff in tension (less on the bias of
    woven fabrics), soft in compression so it can buckle;
  * bending: distance between the opposite vertices of adjacent triangles, compression only;
  * stitches: seam vertex pairs (rest length 0 once sewn; ties keep a layer gap);
  * girth loop: a tied waistband cannot grow beyond its worn length (hoop tension is a global mode
    that a few PBD iterations cannot hold);
  * collision: projection out of the analytic body SDF (+ cloth thickness, + layer offset) with
    simple friction on contact.
No self-collision (layers are separated by per-vertex thickness instead).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from ..avatar_body import Body, ellipse_perimeter
from . import mesh as meshmod
from .collide import BodySDF
from .pattern import Pattern, wrap_worn_waist

SOLVER_VERSION = "drape-pbd-cpu@0.1"
THICKNESS = 0.004
LAYER_GAP = 0.009
ARRANGE_GAP = 0.03
G = np.array([0.0, -9.81, 0.0])


@dataclass
class SolverConfig:
    h: float = 0.025
    dt: float = 1 / 60
    sew_steps: int = 30
    drape_steps: int = 60
    substeps: int = 10
    iterations: int = 1


@dataclass
class DrapeResult:
    garment: meshmod.GarmentMesh
    x: np.ndarray
    x0: np.ndarray
    edges: np.ndarray
    rest: np.ndarray
    thickness: np.ndarray
    sdf: np.ndarray
    contact: np.ndarray
    stitch_rest: np.ndarray
    metrics: dict = field(default_factory=dict)


def _ellipse_at(body: Body, y: np.ndarray):
    a = np.empty_like(y)
    b = np.empty_like(y)
    c = np.empty_like(y)
    ytop = body.y["shoulder"]
    for i, yy in enumerate(y):
        aa, bb, cc = body.envelope(float(min(yy, ytop)))
        a[i], b[i], c[i] = aa, bb, cc
    return a, b, c


def _arrange_wrap(pm: meshmod.PanelMesh, body: Body, y0: float) -> np.ndarray:
    uv = pm.uv
    y = y0 + uv[:, 1]
    # Unique rows (the grid makes v values repeat) keep the per-height envelope cheap.
    rows, inv = np.unique(np.round(y, 4), return_inverse=True)
    a, b, cz = _ellipse_at(body, rows)
    A, B = a + ARRANGE_GAP, b + ARRANGE_GAP
    # Half-width of the panel in each row: if wider than half the ellipse, grow the ellipse.
    half = np.zeros(len(rows))
    np.maximum.at(half, inv, np.abs(uv[:, 0]))
    P = np.array([ellipse_perimeter(aa, bb) for aa, bb in zip(A, B)])
    grow = np.maximum(1.0, half / (P / 2 * 0.97))
    A, B, P = A * grow, B * grow, P * grow
    R = P / (2 * np.pi)
    th = pm.panel.placement["theta0"] + uv[:, 0] / R[inv]
    return np.stack([A[inv] * np.sin(th), y, cz[inv] + B[inv] * np.cos(th)], axis=1)


def _arrange_arm(pm: meshmod.PanelMesh, body: Body, sdf: BodySDF) -> np.ndarray:
    side = pm.panel.placement["side"]
    sh, d, L, tn, rr = sdf.arms[0 if side == "L" else 1]
    Y = np.array([0, 1.0, 0])
    up = Y - (Y @ d) * d
    up /= np.linalg.norm(up)
    fwd = np.array([0, 0, 1.0])
    uv = pm.uv
    hw_t = np.abs(uv[:, 0]).max()
    R = max(hw_t / np.pi, float(rr.max()) + 0.02)
    s = 0.09 - uv[:, 1]
    psi = uv[:, 0] / R
    return sh + np.outer(s, d) + R * (np.cos(psi)[:, None] * up + np.sin(psi)[:, None] * fwd)


def _arrange_cone(pm: meshmod.PanelMesh, body: Body, pattern: Pattern, w_eff: float):
    uv = pm.uv
    r1 = pattern.meta["r1"]
    rho = np.hypot(uv[:, 0], r1 - uv[:, 1])
    phi = np.arctan2(uv[:, 0], r1 - uv[:, 1])
    s = phi * r1
    w_tot = pattern.panels[0].placement["theta_tot"] * r1
    sin_a = np.clip(w_eff / (2 * np.pi * r1), 0.05, 0.95)
    y = body.y["waist"] + 0.015 - (rho - r1) * np.sqrt(1 - sin_a ** 2)
    th = np.pi + s * 2 * np.pi / w_eff
    ov = max(w_tot - w_eff, 0.0)
    layer = ((np.abs(s) > w_eff / 2 - ov / 2) & (phi > 0)).astype(np.float64)
    R = rho * sin_a + ARRANGE_GAP + layer * LAYER_GAP
    rows, inv = np.unique(np.round(y, 4), return_inverse=True)
    a, b, cz = _ellipse_at(body, rows)
    a, b, cz = a[inv], b[inv], cz[inv]
    renv = a * b / np.sqrt((b * np.cos(th - np.pi / 2)) ** 2 + (a * np.sin(th - np.pi / 2)) ** 2)
    R = np.maximum(R, renv + ARRANGE_GAP + layer * LAYER_GAP)
    pos = np.stack([R * np.sin(th), y, cz + R * np.cos(th)], axis=1)
    ties = []
    tt = pattern.panels[0].placement["theta_tot"] / 2
    for sign in (1, -1):
        # The last 5 cm of each flap's waistband lies flat on the layer under it (spreads the tie load).
        for dl in (0.0, 0.025, 0.05):
            for dr in (0.0, 0.03):
                fa = sign * (tt - dl / r1)
                pa = np.array([(r1 + dr) * np.sin(fa), r1 - (r1 + dr) * np.cos(fa)])
                f = sign * ((w_tot / 2 - w_eff) - dl) / r1
                pb = np.array([(r1 + dr) * np.sin(f), r1 - (r1 + dr) * np.cos(f)])
                ties.append((pa, pb))
    return pos, layer, ties


def _orient(pos: np.ndarray, tris: np.ndarray, centre_fn) -> np.ndarray:
    """Flip a panel's winding if its normals point into the body."""
    v0, v1, v2 = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    n = np.cross(v1 - v0, v2 - v0)
    c = (v0 + v1 + v2) / 3
    out = c - centre_fn(c)
    return tris if (n * out).sum() >= 0 else tris[:, ::-1].copy()


def _grain_stretch(uv: np.ndarray, edges: np.ndarray, grain_deg: np.ndarray, fabric) -> np.ndarray:
    d = uv[edges[:, 1]] - uv[edges[:, 0]]
    ang = np.arctan2(d[:, 1], d[:, 0]) - np.radians(grain_deg)
    on_grain = np.abs(np.cos(2 * ang))  # 1 along grain / cross grain, 0 on the bias
    return fabric.stretch * (1 + (fabric.bias_stretch - 1) * (1 - on_grain))


def _colour(I: np.ndarray, J: np.ndarray, n: int) -> list[np.ndarray]:
    """Greedy constraint colouring: no two constraints of one colour share a vertex (Gauss-Seidel batches)."""
    used: list[set] = [set() for _ in range(n)]
    col = np.empty(len(I), dtype=np.int64)
    for k, (i, j) in enumerate(zip(I.tolist(), J.tolist())):
        taken = used[i] | used[j]
        c = 0
        while c in taken:
            c += 1
        col[k] = c
        used[i].add(c)
        used[j].add(c)
    return [np.nonzero(col == c)[0] for c in range(col.max() + 1)]


def _gauss_seidel(p, groups, I, J, rest, kt, kc):
    for g in groups:
        i, j = I[g], J[g]
        d = p[j] - p[i]
        L = np.linalg.norm(d, axis=1)
        C = L - rest[g]
        k = np.where(C > 0, kt[g], kc[g])
        s = (0.5 * k * C / np.maximum(L, 1e-9))[:, None] * d
        p[i] += s
        p[j] -= s
    return p


def _girth(p: np.ndarray, ring: np.ndarray, length: float):
    """Waistband: a closed loop that cannot grow beyond its length (scaled towards its centre in xz)."""
    q = p[ring]
    per = np.linalg.norm(np.diff(q, axis=0), axis=1).sum() + np.linalg.norm(q[0] - q[-1])
    if per > length * 1.005:
        c = q.mean(axis=0)
        k = 1 - 0.35 * (1 - length / per)  # compliant: collisions win when the band is smaller than the body
        p[ring, 0] = c[0] + (q[:, 0] - c[0]) * k
        p[ring, 2] = c[2] + (q[:, 2] - c[2]) * k


def drape(pattern: Pattern, body: Body, cfg: SolverConfig | None = None) -> DrapeResult:
    cfg = cfg or SolverConfig()
    t0 = time.perf_counter()
    g = meshmod.build(pattern, cfg.h)
    sdf = BodySDF(body)
    fabric = pattern.fabric
    n = len(g.uv)
    x = np.zeros((n, 3))
    layer = np.zeros(n)
    tris_out = []
    loops: list[tuple[np.ndarray, float, float]] = []
    s_ = body.H / 1.65
    for pm, off in zip(g.panels, g.offsets):
        kind = pm.panel.placement["kind"]
        sl = slice(off, off + len(pm.uv))
        if kind == "wrap":
            x[sl] = _arrange_wrap(pm, body, body.y["shoulder"] + 0.045 * s_ + 0.004)
            centre = lambda c: np.stack([np.zeros(len(c)), c[:, 1], np.zeros(len(c))], axis=1)  # noqa: E731
        elif kind == "arm":
            x[sl] = _arrange_arm(pm, body, sdf)
            sh, d, L, _, _ = sdf.arms[0 if pm.panel.placement["side"] == "L" else 1]
            centre = lambda c, sh=sh, d=d: sh + np.outer((c - sh) @ d, d)  # noqa: E731
        else:
            w_eff = wrap_worn_waist(pattern, body.m["waistCm"]) / 100 + 2 * np.pi * THICKNESS
            x[sl], layer[sl], ties = _arrange_cone(pm, body, pattern, w_eff)
            meshmod.add_ties(g, ties)
            wid, wt = pm.boundary["waist"]
            w_tot = pm.panel.placement["theta_tot"] * pattern.meta["r1"]
            ring = wid[wt <= w_eff / w_tot + 1e-6] + off
            q = x[ring]
            loops.append((ring, w_eff, float(np.linalg.norm(np.diff(q, axis=0), axis=1).sum() + np.linalg.norm(q[0] - q[-1]))))
            centre = lambda c: np.stack([np.zeros(len(c)), c[:, 1], np.zeros(len(c))], axis=1)  # noqa: E731
        tris_out.append(_orient(x, pm.tris + off, centre))
    g.tris = np.concatenate(tris_out)
    x0 = x.copy()
    thickness = THICKNESS + layer * LAYER_GAP

    edges = meshmod.edges_of(g.tris)
    rest_e = np.linalg.norm(g.uv[edges[:, 1]] - g.uv[edges[:, 0]], axis=1)
    grain = np.array([pm.panel.grain_deg for pm in g.panels])[g.panel_of[edges[:, 0]]]
    st_e = _grain_stretch(g.uv, edges, grain, fabric)
    # `stretch` is elongation under a hand pull; self-weight loads are far lower, so map it gently.
    kt_e = np.clip(1 - 1.6 * st_e, 0.5, 0.98)
    # Stay-taped edges (waistband, neckline, shoulder seams) do not stretch.
    taped = np.zeros(n, dtype=bool)
    for pm, off in zip(g.panels, g.offsets):
        for name in pattern.meta.get("taped", []):
            if name in pm.boundary:
                taped[pm.boundary[name][0] + off] = True
    tape = taped[edges[:, 0]] & taped[edges[:, 1]]
    kt_e[tape] = 0.98
    kc_e = kt_e * 0.08
    kc_e[tape] = 0.9  # a stay tape / waistband neither stretches nor bunches
    bend = meshmod.bending_pairs(g.tris)
    rest_b = np.linalg.norm(g.uv[bend[:, 1]] - g.uv[bend[:, 0]], axis=1)
    kb = 0.01 + 0.25 * fabric.bending ** 1.5
    st = g.stitches
    tie = g.seam_of < 0
    st_final = np.where(tie, LAYER_GAP * 0.8, 0.0)
    st_gap0 = np.linalg.norm(x[st[:, 1]] - x[st[:, 0]], axis=1)

    I = np.concatenate([edges[:, 0], bend[:, 0], st[:, 0]])
    J = np.concatenate([edges[:, 1], bend[:, 1], st[:, 1]])
    ne, nb = len(edges), len(bend)
    kt = np.concatenate([kt_e, np.zeros(nb), np.ones(len(st))])
    kc = np.concatenate([kc_e, np.full(nb, kb), np.ones(len(st))])
    groups = _colour(I, J, n)
    rest = np.concatenate([rest_e, rest_b, st_gap0])
    friction = fabric.friction
    drag = float(np.clip(0.03 * 150 / fabric.weight_gsm, 0.015, 0.05))

    v = np.zeros_like(x)
    contact = np.zeros(n, dtype=bool)
    f = np.zeros(n)
    steps = cfg.sew_steps + cfg.drape_steps
    exploded = False
    a = 1.0
    for step in range(steps):
        sewing = step < cfg.sew_steps
        if sewing:
            a = min(1.0, (step + 1) / (cfg.sew_steps * 0.75))
            rest[ne + nb:] = st_gap0 * (1 - a) + st_final * a
        h_dt = cfg.dt / cfg.substeps
        for _ in range(cfg.substeps):
            if sewing:
                v *= 0.9
            else:
                v += G * h_dt
                v *= 1 - drag / cfg.substeps
            p = x + v * h_dt
            for _it in range(cfg.iterations):
                p = _gauss_seidel(p, groups, I, J, rest, kt, kc)
            for ring, length, per0 in loops:
                _girth(p, ring, per0 * (1 - a) + length * a if sewing else length)
            p, contact, f = sdf.project(p, thickness)
            v = (p - x) / h_dt
            v[contact] *= 1 - friction
            x = p
        if not np.isfinite(x).all() or np.abs(x).max() > 3.0:
            exploded = True
            break
    runtime = time.perf_counter() - t0

    f_final = sdf(x) if np.isfinite(x).all() else np.full(n, -1.0)
    L = np.linalg.norm(x[edges[:, 1]] - x[edges[:, 0]], axis=1)
    strain = L / np.maximum(rest_e, 1e-9) - 1
    gaps = np.linalg.norm(x[st[:, 1]] - x[st[:, 0]], axis=1) - st_final
    seam_gaps = gaps[~tie] if (~tie).any() else np.zeros(1)
    metrics = {
        "vertices": int(n), "triangles": int(len(g.tris)), "stitches": int(len(st)),
        "runtime_s": round(runtime, 3), "frames": steps, "substeps": cfg.substeps, "iterations": cfg.iterations,
        "exploded": bool(exploded or not np.isfinite(strain).all() or np.quantile(strain, 0.99) > 0.25),
        "strain_p99": round(float(np.quantile(strain, 0.99)), 4),
        "max_penetration_m": round(float(max(0.0, -f_final.min())), 5),
        "p99_penetration_m": round(float(max(0.0, -np.quantile(f_final, 0.01))), 5),
        "seam_gap_p95_m": round(float(np.quantile(seam_gaps, 0.95)), 5),
        "seam_gap_max_m": round(float(seam_gaps.max()), 5),
        "strain_p95": round(float(np.quantile(strain, 0.95)), 4), "strain_max": round(float(strain.max()), 4),
        "max_speed_m_s": round(float(np.linalg.norm(v, axis=1).max()), 3),
        "solver": SOLVER_VERSION,
    }
    return DrapeResult(g, x, x0, edges, rest_e, thickness, f_final, contact, st_final, metrics)
