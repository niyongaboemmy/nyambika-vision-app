"""Triangulate pattern panels and build seam stitches (R4 drape spike).

Each panel is meshed on a regular grid (spacing h): cells whose centre is inside the polygon are
kept, the boundary vertices of the kept region are snapped onto the polygon outline (corners
exactly), and every boundary vertex is tagged with the named edge it lies on and its arc-length
parameter along that edge. Seams pair vertices of two edges by parameter (both directions, so
mismatched vertex counts ease in rather than leave holes). Rest lengths come from the flat 2D
pattern, so strain is measured against the cut fabric, not against the arrangement.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .pattern import Panel, Pattern


@dataclass
class PanelMesh:
    panel: Panel
    uv: np.ndarray  # (n, 2) flat pattern coordinates (m)
    tris: np.ndarray  # (t, 3) CCW in pattern space
    boundary: dict  # edge name -> (vertex ids sorted by t, t values)


def _inside(pts: np.ndarray, poly: np.ndarray) -> np.ndarray:
    x, y = pts[:, 0][:, None], pts[:, 1][:, None]
    x1, y1 = poly[:, 0][None], poly[:, 1][None]
    x2, y2 = np.roll(poly[:, 0], -1)[None], np.roll(poly[:, 1], -1)[None]
    cond = (y1 > y) != (y2 > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
    return ((cond & (x < xi)).sum(axis=1) % 2) == 1


def _closest_on_polygon(pts: np.ndarray, poly: np.ndarray):
    """(closest point, segment index, segment fraction) for each point."""
    a = poly[None]
    b = np.roll(poly, -1, axis=0)[None]
    ab = b - a
    t = np.clip(((pts[:, None] - a) * ab).sum(-1) / np.maximum((ab ** 2).sum(-1), 1e-12), 0, 1)
    c = a + t[..., None] * ab
    d = np.linalg.norm(pts[:, None] - c, axis=-1)
    seg = d.argmin(axis=1)
    r = np.arange(len(pts))
    return c[r, seg], seg, t[r, seg]


def mesh_panel(panel: Panel, h: float) -> PanelMesh:
    poly = panel.outline
    lo, hi = poly.min(axis=0) - h, poly.max(axis=0) + h
    nx, ny = int(np.ceil((hi[0] - lo[0]) / h)) + 1, int(np.ceil((hi[1] - lo[1]) / h)) + 1
    gx, gy = np.meshgrid(lo[0] + np.arange(nx) * h, lo[1] + np.arange(ny) * h)
    grid = np.stack([gx.ravel(), gy.ravel()], axis=1)
    centres = grid.reshape(ny, nx, 2)[:-1, :-1] + h / 2
    active = _inside(centres.reshape(-1, 2), poly).reshape(ny - 1, nx - 1)
    jj, ii = np.nonzero(active)
    v00 = jj * nx + ii
    v10, v01, v11 = v00 + 1, v00 + nx, v00 + nx + 1
    alt = (ii + jj) % 2 == 0
    t1 = np.where(alt[:, None], np.stack([v00, v10, v11], 1), np.stack([v00, v10, v01], 1))
    t2 = np.where(alt[:, None], np.stack([v00, v11, v01], 1), np.stack([v10, v11, v01], 1))
    tris = np.concatenate([t1, t2])
    used = np.unique(tris)
    remap = -np.ones(len(grid), dtype=np.int64)
    remap[used] = np.arange(len(used))
    uv = grid[used].copy()
    tris = remap[tris]

    # Boundary of the kept region -> snap onto the outline.
    e = np.sort(np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]), axis=1)
    ue, cnt = np.unique(e, axis=0, return_counts=True)
    bverts = np.unique(ue[cnt == 1])
    snapped, seg, frac = _closest_on_polygon(uv[bverts], poly)
    uv[bverts] = snapped
    # Corners (turn > 25 deg) get the nearest boundary vertex exactly.
    k = len(poly)
    d_in = poly - np.roll(poly, 1, axis=0)
    d_out = np.roll(poly, -1, axis=0) - poly
    cosang = (d_in * d_out).sum(1) / np.maximum(np.linalg.norm(d_in, axis=1) * np.linalg.norm(d_out, axis=1), 1e-12)
    for c in np.nonzero(cosang < np.cos(np.radians(25)))[0]:
        j = int(np.argmin(np.linalg.norm(uv[bverts] - poly[c], axis=1)))
        uv[bverts[j]] = poly[c]
        seg[j], frac[j] = c, 0.0
    # Drop triangles that snapping folded or squashed, then orphan vertices.
    a, b, c3 = uv[tris[:, 0]], uv[tris[:, 1]], uv[tris[:, 2]]
    area = 0.5 * ((b - a)[:, 0] * (c3 - a)[:, 1] - (b - a)[:, 1] * (c3 - a)[:, 0])
    tris = tris[area > 0.08 * h * h]
    used = np.unique(tris)
    remap = -np.ones(len(uv), dtype=np.int64)
    remap[used] = np.arange(len(used))
    uv, tris = uv[used], remap[tris]
    keep_b = remap[bverts] >= 0
    bverts, seg, frac = remap[bverts][keep_b], seg[keep_b], frac[keep_b]

    # Tag boundary vertices with (edge, t along the edge by arc length).
    seglen = np.linalg.norm(np.roll(poly, -1, axis=0) - poly, axis=1)
    boundary = {}
    for name, (s0, s1) in panel.edges.items():
        segs = []
        s = s0
        while s != s1:
            segs.append(s)
            s = (s + 1) % k
        if not segs:
            continue
        L = seglen[segs]
        cum = np.concatenate([[0], np.cumsum(L)])
        pos = {sg: i for i, sg in enumerate(segs)}
        ids, ts = [], []
        for v, sg, fr in zip(bverts, seg, frac):
            if sg in pos:
                i = pos[sg]
                ids.append(v)
                ts.append((cum[i] + fr * L[i]) / cum[-1])
            elif sg == s1 and fr == 0.0:  # vertex exactly on the edge's end corner
                ids.append(v)
                ts.append(1.0)
        if ids:
            o = np.argsort(ts)
            boundary[name] = (np.asarray(ids)[o], np.asarray(ts)[o])
    return PanelMesh(panel, uv, tris, boundary)


@dataclass
class GarmentMesh:
    pattern: Pattern
    panels: list[PanelMesh]
    offsets: list[int]
    uv: np.ndarray  # (N, 2) pattern coordinates
    tris: np.ndarray  # (T, 3)
    panel_of: np.ndarray  # (N,)
    stitches: np.ndarray  # (S, 2)
    seam_of: np.ndarray  # (S,) seam index (-1 = tie)

    def vid(self, panel: str, local: np.ndarray) -> np.ndarray:
        i = next(k for k, pm in enumerate(self.panels) if pm.panel.name == panel)
        return np.asarray(local) + self.offsets[i]


def _pair(ids_a, ts_a, ids_b, ts_b, reverse) -> list[tuple[int, int]]:
    tb = 1 - ts_b if reverse else ts_b
    out = set()
    for v, t in zip(ids_a, ts_a):
        out.add((int(v), int(ids_b[np.argmin(np.abs(tb - t))])))
    for v, t in zip(ids_b, tb):
        out.add((int(ids_a[np.argmin(np.abs(ts_a - t))]), int(v)))
    return sorted(out)


def build(pattern: Pattern, h: float = 0.025) -> GarmentMesh:
    pms = [mesh_panel(p, h) for p in pattern.panels]
    offsets = list(np.cumsum([0] + [len(pm.uv) for pm in pms[:-1]]))
    uv = np.concatenate([pm.uv for pm in pms])
    tris = np.concatenate([pm.tris + o for pm, o in zip(pms, offsets)])
    panel_of = np.concatenate([np.full(len(pm.uv), i) for i, pm in enumerate(pms)])
    by_name = {pm.panel.name: (pm, o) for pm, o in zip(pms, offsets)}
    st, sid = [], []
    for si, s in enumerate(pattern.seams):
        pa, oa = by_name[s.a]
        pb, ob = by_name[s.b]
        if s.edge_a not in pa.boundary or s.edge_b not in pb.boundary:
            raise ValueError(f"Seam {s.a}.{s.edge_a} <-> {s.b}.{s.edge_b} has no vertices (mesh too coarse)")
        ia, ta = pa.boundary[s.edge_a]
        ib, tb = pb.boundary[s.edge_b]
        for a, b in _pair(ia + oa, ta, ib + ob, tb, s.reverse):
            if a != b:
                st.append((a, b))
                sid.append(si)
    stitches = np.asarray(st, dtype=np.int64).reshape(-1, 2)
    return GarmentMesh(pattern, pms, offsets, uv, tris, panel_of, stitches, np.asarray(sid, dtype=np.int64))


def add_ties(g: GarmentMesh, pairs: list[tuple[np.ndarray, np.ndarray]]):
    """Extra stitches between two points of the pattern (wrap ties): nearest vertices to each 2D point."""
    extra = []
    for pa, pb in pairs:
        a = int(np.argmin(np.linalg.norm(g.uv - pa, axis=1)))
        b = int(np.argmin(np.linalg.norm(g.uv - pb, axis=1)))
        if a != b:
            extra.append((a, b))
    if extra:
        g.stitches = np.concatenate([g.stitches, np.asarray(extra, dtype=np.int64)])
        g.seam_of = np.concatenate([g.seam_of, np.full(len(extra), -1)])


def edges_of(tris: np.ndarray) -> np.ndarray:
    e = np.sort(np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]), axis=1)
    return np.unique(e, axis=0)


def bending_pairs(tris: np.ndarray) -> np.ndarray:
    """Opposite vertices of the two triangles sharing each interior edge."""
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    opp = np.concatenate([tris[:, 2], tris[:, 0], tris[:, 1]])
    key = np.sort(e, axis=1)
    order = np.lexsort((key[:, 1], key[:, 0]))
    ks, op = key[order], opp[order]
    same = np.all(ks[1:] == ks[:-1], axis=1)
    i = np.nonzero(same)[0]
    return np.stack([op[i], op[i + 1]], axis=1)
