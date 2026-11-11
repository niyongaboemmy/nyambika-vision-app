"""Signed distance to the E33 parametric body (analytic, CPU) for cloth collision.

The body is the union of the shapes the mesh is lofted from: elliptical torso rings (interpolated
by height), two leg tubes, arm capsules (radius interpolated along the arm) and the head
ellipsoid. The torso and limb terms are radial distances (exact on the surface, first-order away
from it), which is what collision projection needs; the gradient is taken numerically and
normalised so the push-out direction also has a vertical component on sloped shoulders.
"""
from __future__ import annotations

import numpy as np

from ..avatar_body import Body

FAR = 10.0


class BodySDF:
    def __init__(self, body: Body):
        self.body = body
        r = np.asarray(body.rings)
        self.ry, self.ra, self.rb, self.rc = r[:, 0], r[:, 1], r[:, 2], r[:, 3]
        self.y_lo, self.y_hi = float(self.ry[0]), float(self.ry[-1])
        L = body.leg
        self.leg_x, self.leg_ys, self.leg_r = float(L["x"]), L["ys"][::-1].astype(float), L["r"][::-1].astype(float)
        m = body.m
        H = body.H
        self.arms = []
        bc = m["bustCm"] / 100
        for side in ("L", "R"):
            sh, el, wr = (body.joints[f"{j}_{side}"] for j in ("shoulder", "elbow", "wrist"))
            Larm = float(np.linalg.norm(wr - sh))
            d = (wr - sh) / Larm
            e = float(np.linalg.norm(el - sh)) / Larm
            ts = np.array([-0.03, 0.0, 0.25, 0.5, 0.75, 1.0]) * e
            tn = np.concatenate([ts, [e + f * (1 - e) for f in (0.25, 0.5, 0.8, 1.0)], [1.0 + 0.1 * H / Larm]])
            circ = np.array([0.34, 0.32, 0.31, 0.29, 0.26, 0.245, 0.26, 0.24, 0.2, 0.17, 0.12]) * bc
            self.arms.append((sh, d, Larm, tn, circ / (2 * np.pi)))
        s = H / 1.65
        ry = H / 7.6 / 2
        self.head_c = np.array([0, body.y["head_c"], 0.006])
        self.head_r = np.array([0.074 * s * 1.15, ry * 1.1, 0.092 * s * 1.1])

    def torso(self, p: np.ndarray) -> np.ndarray:
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        a = np.interp(y, self.ry, self.ra)
        b = np.interp(y, self.ry, self.rb)
        cz = np.interp(y, self.ry, self.rc)
        dz = z - cz
        r = np.hypot(x, dz)
        phi = np.arctan2(dz, x)
        rb = a * b / np.sqrt((b * np.cos(phi)) ** 2 + (a * np.sin(phi)) ** 2)
        f = r - rb
        # Outside the torso's height range: distance to the end caps.
        below = np.maximum(self.y_lo - y, 0)
        above = np.maximum(y - self.y_hi, 0)
        return np.where((below > 0) | (above > 0), np.hypot(np.maximum(f, 0), below + above), f)

    def legs(self, p: np.ndarray) -> np.ndarray:
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        r = np.interp(y, self.leg_ys, self.leg_r)
        top = self.leg_ys[-1]
        out = np.full(len(p), FAR)
        for sx in (1, -1):
            f = np.hypot(x - sx * self.leg_x, z / 0.96) - r
            f = np.where(y > top, np.hypot(np.maximum(f, 0), y - top), f)
            out = np.minimum(out, f)
        return np.minimum(out, y)  # floor (half-space y < 0)

    def arm(self, p: np.ndarray) -> np.ndarray:
        out = np.full(len(p), FAR)
        for sh, d, L, tn, rr in self.arms:
            t = np.clip(((p - sh) @ d) / L, tn[0], tn[-1])
            c = sh + np.outer(t * L, d)
            out = np.minimum(out, np.linalg.norm(p - c, axis=1) - np.interp(t, tn, rr))
        return out

    def head(self, p: np.ndarray) -> np.ndarray:
        q = (p - self.head_c) / self.head_r
        return (np.linalg.norm(q, axis=1) - 1) * self.head_r.min()

    def __call__(self, p: np.ndarray, arms: bool = True) -> np.ndarray:
        f = np.minimum(np.minimum(self.torso(p), self.legs(p)), self.head(p))
        return np.minimum(f, self.arm(p)) if arms else f

    def gradient(self, p: np.ndarray, eps: float = 0.002) -> np.ndarray:
        g = np.empty_like(p)
        for k in range(3):
            dp = np.zeros(3)
            dp[k] = eps
            g[:, k] = (self(p + dp) - self(p - dp)) / (2 * eps)
        return g

    def project(self, p: np.ndarray, thickness: np.ndarray, margin: float = 0.02):
        """Push points closer than `thickness` out along the normalised gradient. Returns (p, contact mask, sdf)."""
        f = self(p)
        near = f < thickness + margin
        contact = np.zeros(len(p), dtype=bool)
        if not near.any():
            return p, contact, f
        idx = np.nonzero(near)[0]
        g = self.gradient(p[idx])
        gl = np.linalg.norm(g, axis=1)
        ok = gl > 1e-6
        n = np.where(ok[:, None], g / np.maximum(gl, 1e-6)[:, None], np.array([0, 1.0, 0]))
        dist = f[idx] / np.where(ok, gl, 1.0)
        pen = thickness[idx] - dist
        hit = pen > 0
        p = p.copy()
        p[idx[hit]] += n[hit] * pen[hit, None]
        contact[idx[hit]] = True
        return p, contact, f
