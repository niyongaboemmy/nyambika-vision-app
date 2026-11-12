"""Offline VTON stand-in: places the garment cut-out on the twin (numpy/PIL, CPU).

Not a generative model. It exists so the whole Mirror -> Looks -> Hold loop runs locally, and so the guard
and C2PA pipeline have real images to check and sign. Pipeline (quality pass, Nov 2026):

1. Body landmarks from the silhouette (`app.landmarks`): neck base, shoulders, torso width, waist, hips.
2. Category -> class (top / skirt / dress) from the catalogue words, else from the cut-out's shape.
3. Uniform scale: the garment's flat chest (or waistband) width is matched to the twin's torso
   (eased, bounded by the shoulders) divided by the wrap factor, so length follows the garment's own
   aspect. The collar is anchored at the neck base (skirts: waistband at the waist). The hem is clamped
   per class with at most +-20% vertical correction.
4. Mesh warp (PIL MESH): a cylindrical wrap across the torso (prints stay true in the centre and
   compress toward the sides, as on a body), sleeves hang outward nearly unscaled, and each torso row is
   nudged toward the twin's silhouette.
5. Shading: the garment's own luminance is kept; sides and edges are darkened (cylinder + edge falloff).
6. Underlying clothing: the twin's upper garment is segmented (near-uniform region connected to the
   chest) and every part the new garment leaves exposed is filled with skin (arms, neck, midriff:
   tone from the twin's own visible skin) or background (outside the body). The identity region
   (head, top 16% of the subject) is never modified.
"""
import numpy as np
from PIL import Image, ImageFilter

from ..config import TIER_HEIGHT
from ..garment import resolve_category, shape_profile
from ..imaging import background_stats, bbox, dilate, erode
from ..landmarks import Body, landmarks, run_at
from ..twin import subject
from .base import VTONProvider, VTONResult

WRAP = 0.78        # worn (front-projected) width / flat-lay width of a garment around a torso
EASE = 1.18        # worn chest width / body torso width
SLEEVE_K = 0.9     # horizontal scale of the parts outside the torso (sleeves, flare)
HEM_BAND = {"top": (0.49, 0.64), "dress": (0.62, 0.86), "skirt": (0.58, 0.86)}
MAX_FY = 0.2       # vertical correction allowed by the hem clamp
MAX_HEM = 0.98     # nothing ends below the ankles


def _grow(seed: np.ndarray, cand: np.ndarray, steps: int = 400) -> np.ndarray:
    """Geodesic fill of `cand` from `seed` (4-connected), on small masks."""
    cur = seed & cand
    for _ in range(steps):
        nxt = cur.copy()
        nxt[1:] |= cur[:-1]
        nxt[:-1] |= cur[1:]
        nxt[:, 1:] |= cur[:, :-1]
        nxt[:, :-1] |= cur[:, 1:]
        nxt &= cand
        if (nxt == cur).all():
            break
        cur = nxt
    return cur


def _resize_mask(m: np.ndarray, size: tuple[int, int], resample=Image.NEAREST) -> np.ndarray:
    return np.asarray(Image.fromarray(m.astype(np.uint8) * 255).resize(size, resample)) > 127


def _fill_field(rgb: np.ndarray, valid: np.ndarray, sigma: float) -> np.ndarray:
    """Normalised convolution: a smooth estimate of the colour of `valid` pixels everywhere."""
    h, w = valid.shape
    f = max(1, int(round(sigma / 3)))
    sw, sh = max(1, w // f), max(1, h // f)
    small_rgb = np.asarray(Image.fromarray(rgb.astype(np.uint8)).resize((sw, sh), Image.BOX), dtype=np.float32)
    small_v = np.asarray(Image.fromarray(valid.astype(np.uint8) * 255).resize((sw, sh), Image.BOX), dtype=np.float32) / 255
    r = max(1.0, sigma / f)
    num = np.stack([np.asarray(Image.fromarray(np.clip(small_rgb[..., c] * small_v, 0, 255).astype(np.uint8))
                               .filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) for c in range(3)], -1)
    den = np.asarray(Image.fromarray((small_v * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)),
                     dtype=np.float32)[..., None] / 255
    est = num / np.maximum(den, 1e-3)
    fallback = rgb[valid].mean(axis=0) if valid.any() else rgb.reshape(-1, 3).mean(axis=0)
    est = np.where(den > 0.02, est, fallback)
    return np.asarray(Image.fromarray(np.clip(est, 0, 255).astype(np.uint8)).resize((w, h), Image.BILINEAR),
                      dtype=np.float32)


def _decontaminate(g: Image.Image, r: int) -> Image.Image:
    """Replace the colour of the cut-out's soft rim (it still carries the studio background) with nearby fabric."""
    arr = np.asarray(g.convert("RGBA")).copy()
    interior = erode(arr[..., 3] >= 250, r)
    rim = (arr[..., 3] > 0) & ~interior
    if interior.any() and rim.any():
        field = _fill_field(arr[..., :3].astype(np.float32), interior, max(2.0, 1.5 * r))
        arr[..., :3] = np.where(rim[..., None], field, arr[..., :3]).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def clothing_region(rgb: np.ndarray, mask: np.ndarray, body: Body) -> tuple[np.ndarray, np.ndarray]:
    """(upper clothing mask, skin mask) of the twin, below the identity region.

    Clothing = near-uniform colour region connected to the chest, distinct from the skin tone (sampled at
    the neck). Works for the flat persona tees and, approximately, for plain clothing in real photos.
    """
    h, w = mask.shape
    hgt = body.height
    rows = np.arange(h)[:, None]
    ny0, ny1 = max(body.head_y1, body.neck_y - int(0.045 * hgt)), max(body.head_y1 + 1, body.neck_y - int(0.01 * hgt))
    nx0, nx1 = int(body.cx - 0.3 * body.neck_w), int(body.cx + 0.3 * body.neck_w) + 1
    neck_px = rgb[ny0:ny1, nx0:nx1].reshape(-1, 3)
    skin = np.median(neck_px, axis=0) if len(neck_px) else None
    cy0, cy1 = body.chest_y - int(0.03 * hgt), body.chest_y + int(0.03 * hgt)
    cx0, cx1 = int(body.cx - 0.22 * body.chest_w), int(body.cx + 0.22 * body.chest_w) + 1
    chest_px = rgb[cy0:cy1, cx0:cx1].reshape(-1, 3)
    cloth = np.median(chest_px, axis=0)
    below_head = rows >= body.head_y1
    skin_mask = np.zeros_like(mask)
    if skin is not None:
        skin_tol = max(16.0, float(np.abs(neck_px - skin).max(axis=-1).mean() * 2.5))
        skin_mask = mask & below_head & (np.abs(rgb - skin).max(axis=-1) <= skin_tol)
        if np.abs(cloth - skin).max() < 30:  # bare torso: nothing to hide
            return np.zeros_like(mask), skin_mask
    spread = float(np.abs(chest_px - cloth).max(axis=-1).mean())
    tol = float(np.clip(2.5 * spread + 18, 24, 48))
    band = below_head & (rows <= body.hip_y + int(0.05 * hgt))
    cand = mask & band & (np.abs(rgb - cloth).max(axis=-1) <= tol)
    if skin is not None:
        cand &= np.abs(rgb - skin).max(axis=-1) > np.abs(rgb - cloth).max(axis=-1)
    # Connected to the chest seed (downsampled for speed).
    f = max(1, h // 256)
    small = cand[::f, ::f]
    seed = np.zeros_like(small)
    seed[cy0 // f: cy1 // f + 1, cx0 // f: cx1 // f + 1] = True
    grown = _grow(seed, small)
    up = np.repeat(np.repeat(grown, f, 0), f, 1)[:h, :w]
    up = np.pad(up, ((0, h - up.shape[0]), (0, w - up.shape[1])))
    dil = lambda m, n: dilate(m, n // 2)  # noqa: E731
    region = dil(up, 2 * f + 1) & cand  # recover thin parts lost by the downsampled fill
    # Include the anti-aliased / resampling-ringing rim between clothing and background/skin.
    near = np.abs(rgb - cloth).max(axis=-1) <= 2 * tol
    rim = dil(region, 7 if h >= 700 else 3)
    rim2 = dil(region, 9 if h >= 700 else 5) & near
    region = (region | ((rim | rim2) & mask & ~skin_mask)) & band
    return region, skin_mask


def _arm_capsules(skin: np.ndarray, cloth: np.ndarray, body: Body) -> np.ndarray:
    """Where the upper arms continue under the old sleeves: capsules from the shoulder to the visible arm."""
    h, w = skin.shape
    out = np.zeros_like(skin)
    if not cloth.any():
        return out
    yy, xx = np.mgrid[0:h, 0:w]
    half = body.chest_w / 2
    for side in (-1, 1):
        cols = (xx - body.cx) * side > half * 0.9
        side_cloth = cloth & cols
        ys = np.flatnonzero(side_cloth.any(axis=1))
        if not len(ys):
            continue
        y_arm = min(h - 1, int(ys.max()) + max(2, body.height // 120))
        run = np.flatnonzero(skin[y_arm] & cols[y_arm])
        if len(run) < 2:
            continue
        ax, aw = float(run.mean()), float(run.max() - run.min() + 1)
        sx = body.cx + side * max(half - aw / 2, half * 0.6)
        sy = body.neck_y + 0.03 * body.height
        # distance from each pixel to the segment (sx,sy)-(ax,y_arm)
        dx, dy = ax - sx, y_arm - sy
        t = np.clip(((xx - sx) * dx + (yy - sy) * dy) / max(1.0, dx * dx + dy * dy), 0, 1)
        d = np.hypot(xx - (sx + t * dx), yy - (sy + t * dy))
        out |= d <= aw * 0.6
    return out


class LocalCompositor(VTONProvider):
    name = "local-compositor"
    version = "1.0"  # registry id unchanged (reference migration); quality pass Nov 2026 is in-place

    def models(self) -> list[dict]:
        return [
            {"id": f"{self.name}@{self.version}-preview", "provider": self.name, "name": "Local compositor (preview)",
             "version": self.version, "tier": "PREVIEW", "cost_rwf": 40, "nlb_score": None},
            {"id": f"{self.name}@{self.version}-hd", "provider": self.name, "name": "Local compositor (HD)",
             "version": self.version, "tier": "HD", "cost_rwf": 110, "nlb_score": None},
        ]

    def model_version(self, tier: str) -> str:
        return f"{self.name}@{self.version}-{tier.lower()}"

    # ---- placement -----------------------------------------------------------------------------------------
    @staticmethod
    def _measure(ref: Image.Image, cls: str) -> tuple[float, float, float]:
        """(reference flat width, its height in the cut-out, centre column of the top rows) of the garment."""
        a = np.asarray(ref)[..., 3] > 127
        h = a.shape[0]
        widths = a.sum(axis=1).astype(np.float32)
        prof = shape_profile(ref)
        if cls == "skirt":
            band = widths[int(0.01 * h): max(int(0.01 * h) + 1, int(0.06 * h))]
        else:
            s0 = prof["sleeve_end"] + 0.03 if prof["sleeve_end"] > 0 else 0.15
            band = widths[int(s0 * h): max(int(s0 * h) + 1, int((s0 + 0.12) * h))]
        ref_w = float(np.median(band)) if len(band) else float(widths.max())
        cols = np.nonzero(a[: max(1, int(0.2 * h))])[1]
        cx = float(cols.mean()) if len(cols) else a.shape[1] / 2
        return max(1.0, ref_w), float(h), cx

    @staticmethod
    def _target_width(body: Body, cls: str) -> float:
        if cls == "skirt":
            return float(np.clip(body.waist_w * 1.12, 0.10 * body.height, body.shoulder_w))
        return float(np.clip(body.chest_w * EASE, 0.6 * body.shoulder_w, 0.95 * body.shoulder_w))

    @staticmethod
    def _wrap_fns(c: float, R: float, k_side: float):
        """Forward f (flat offset -> worn offset) and inverse, symmetric about 0."""
        fc = R * np.sin(c / R)

        def inv(u):
            au = np.abs(u)
            inner = R * np.arcsin(np.clip(au / R, 0, 1))
            outer = c + (au - fc) / k_side
            return np.sign(u) * np.where(au <= fc, inner, outer)

        def fwd(x):
            ax = np.abs(x)
            return np.sign(x) * np.where(ax <= c, R * np.sin(np.minimum(ax, c) / R), fc + (ax - c) * k_side)

        return fwd, inv

    def _place(self, g: Image.Image, ref_box, cls: str, body: Body, free_length: bool, mask: np.ndarray):
        """Scale + warp + shade the garment canvas `g` (RGBA). Returns (layer, x, y) in twin coordinates."""
        rx0, ry0, rx1, ry1 = ref_box
        ref = g.crop(ref_box)
        ref_w, ref_h, ref_cx = self._measure(ref, cls)
        target = self._target_width(body, cls)
        s = target / WRAP / ref_w
        top_y = (body.waist_y - 0.01 * body.height) if cls == "skirt" else (body.neck_y - 0.012 * body.height)
        # Hem clamp per class: vertical correction within +-MAX_FY, the rest is left to the guard.
        lo, hi = HEM_BAND[cls]
        hem = body.frac(top_y + ref_h * s)
        fy = 1.0
        if hem > hi:
            need = (body.top + hi * body.height - top_y) / (ref_h * s)
            fy = max(1 - MAX_FY, need)
            if need < fy:  # still too long: shrink uniformly a little too (keeps most of the chest cover)
                s *= max(0.88, need / fy)
        elif hem < lo and not free_length:
            fy = min(1 + MAX_FY, (body.top + lo * body.height - top_y) / (ref_h * s))
        if free_length:
            # Morphed (re-hemmed) canvas: the whole garment, not just the original frame, must end above the feet.
            full = bbox(np.asarray(g)[..., 3] > 127)
            if full:
                full_h = (full[3] - ry0) * s
                if body.frac(top_y + full_h * fy) > MAX_HEM:
                    fy = max(0.7, (body.top + MAX_HEM * body.height - top_y) / full_h)
        sx, sy = s, s * fy
        W, H = max(1, round(g.width * sx)), max(1, round(g.height * sy))
        scaled = _decontaminate(g, 3).resize((W, H), Image.LANCZOS)
        cx_s = (rx0 + ref_cx) * sx  # garment centre in scaled coords
        half_flat = ref_w * s / 2   # torso half-width (flat) in scaled coords
        c = half_flat
        # Cylinder radius so that the flat half-width c lands at target/2 after wrapping.
        theta = 1.2
        for _ in range(30):  # solve sin(t)/t = WRAP
            theta -= (np.sin(theta) / theta - WRAP) / ((theta * np.cos(theta) - np.sin(theta)) / theta ** 2)
        R = c / theta
        fwd, inv = self._wrap_fns(c, R, SLEEVE_K)
        left_w, right_w = float(fwd(np.array(-cx_s))), float(fwd(np.array(W - cx_s)))
        out_w = int(np.ceil(right_w - left_w)) + 2
        # Per-row nudge toward the twin silhouette within the torso rows (+-6%).
        top_px = top_y - ry0 * sy
        n_rows = 24
        ys = np.linspace(0, H, n_rows + 1)
        k = np.ones(n_rows + 1)
        a = np.asarray(scaled)[..., 3] > 127
        if cls != "skirt":
            for i, yv in enumerate(ys):
                yb = int(round(top_px + yv))
                if body.chest_y <= yb <= body.hip_y:
                    lft, rgt = run_at(mask, yb, body.cx)
                    want = (rgt - lft) * 1.06
                    row = a[min(H - 1, int(yv))]
                    xs = np.flatnonzero(row)
                    if len(xs) and want > 0:
                        worn = float(fwd(np.array(xs.max() - cx_s)) - fwd(np.array(xs.min() - cx_s)))
                        if worn < 1.25 * target:  # torso rows only (not sleeves)
                            k[i] = float(np.clip(want / max(1.0, worn), 0.94, 1.06))
            k = np.convolve(np.pad(k, 2, mode="edge"), np.ones(5) / 5, mode="valid")
        # Mesh: output strips -> source quads.
        n_cols = 28
        xs_out = np.linspace(0, out_w, n_cols + 1)
        mesh = []
        for j in range(n_rows):
            y0o, y1o = ys[j], ys[j + 1]
            for i in range(n_cols):
                x0o, x1o = xs_out[i], xs_out[i + 1]
                def src(xo, row):  # noqa: E306
                    u = (xo + left_w) / k[row]
                    return float(inv(np.array(u)) + cx_s)
                quad = (src(x0o, j), y0o, src(x0o, j + 1), y1o, src(x1o, j + 1), y1o, src(x1o, j), y0o)
                mesh.append(((int(round(x0o)), int(round(y0o)), int(round(x1o)), int(round(y1o))), quad))
        warped = scaled.transform((out_w, H), Image.MESH, mesh, Image.BILINEAR)
        # Shading: cylinder falloff across the torso + edge darkening; garment luminance otherwise kept.
        xo = np.arange(out_w, dtype=np.float32) + left_w
        u = np.clip(np.abs(xo) / max(1.0, R), 0, 1)
        cyl = 0.9 + 0.1 * np.sqrt(1 - u ** 2)
        al = warped.getchannel("A")
        edge = np.asarray(al.filter(ImageFilter.GaussianBlur(max(1.5, body.height * 0.008))), dtype=np.float32) / 255
        shade = cyl[None, :] * (0.88 + 0.12 * np.clip((edge - 0.5) / 0.5, 0, 1) ** 0.6)
        arr = np.asarray(warped, dtype=np.float32).copy()
        # Edge decontamination: the cut-out's soft rim still carries the studio background colour (a white
        # halo on dark fabric). Replace rim colours with the nearby interior fabric colour.
        interior = erode(np.asarray(al) >= 250, 2)
        rim = (arr[..., 3] > 0) & ~interior
        if interior.any() and rim.any():
            arr[..., :3] = np.where(rim[..., None], _fill_field(arr[..., :3], interior, 4.0), arr[..., :3])
        arr[..., :3] *= shade[..., None]
        warped = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
        ox = int(round(body.cx + left_w))
        oy = int(round(top_px))
        return warped, ox, oy

    def generate(self, twin: Image.Image, garment: Image.Image, category: str, tier: str,
                 frame: tuple[int, int, int, int] | None = None, region: str | None = None) -> VTONResult:
        # Runs in this process wherever the gateway runs: `region` does not change anything here.
        target_h = TIER_HEIGHT.get(tier, 512)
        twin = twin.convert("RGB")
        twin = twin.resize((round(twin.width * target_h / twin.height), target_h), Image.LANCZOS)
        mask, box = subject(twin)
        if box is None:
            raise ValueError("No subject found on twin")
        body = landmarks(mask, box)

        garment = garment.convert("RGBA")
        if frame:
            # Morphed cut-out (E23): `frame` is where the original garment sits in this canvas; measure on it
            # and let a re-hemmed garment end higher/lower at the same scale.
            ref_box = tuple(int(v) for v in frame)
            free_length = True
        else:
            gbox = bbox(np.asarray(garment)[..., 3] > 10)
            if gbox:
                garment = garment.crop(gbox)
            ref_box = (0, 0, garment.width, garment.height)
            free_length = False
        rb = bbox(np.asarray(garment.crop(ref_box))[..., 3] > 127)
        if rb:
            ref_box = (ref_box[0] + rb[0], ref_box[1] + rb[1], ref_box[0] + rb[2], ref_box[1] + rb[3])
        cls, _ = resolve_category(category, garment.crop(ref_box))
        layer_img, gx, gy = self._place(garment, ref_box, cls, body, free_length, mask)

        garment_layer = Image.new("RGBA", twin.size, (0, 0, 0, 0))
        garment_layer.paste(layer_img, (gx, gy), layer_img)
        g_arr = np.asarray(garment_layer).copy()
        g_arr[: body.head_y1, :, 3] = 0  # identity region stays pixel-identical
        alpha = g_arr[..., 3].astype(np.float32) / 255

        rgb = np.asarray(twin, dtype=np.float32)
        base = rgb.copy()
        edit = np.zeros(mask.shape, dtype=bool)
        if cls in ("top", "dress"):
            cloth, skin = clothing_region(rgb, mask, body)
            covered = alpha > 0.6
            exposed = cloth & ~covered
            if exposed.any():
                arms = _arm_capsules(skin, cloth, body)
                hgt = body.height
                yy, xx = np.mgrid[0:mask.shape[0], 0:mask.shape[1]]
                trunk = (np.abs(xx - body.cx) <= body.chest_w / 2) & (yy >= body.neck_y + 0.06 * hgt)  # below the shoulder line
                neck = (np.abs(xx - body.cx) <= body.neck_w * 0.5) & (yy < body.neck_y + 0.04 * hgt)
                # Necklines (V, scoop): old clothing framed by the new garment on both sides of the row is chest skin.
                g_rows = covered.any(axis=1)
                g_left = np.where(g_rows, np.argmax(covered, axis=1), mask.shape[1])
                g_right = np.where(g_rows, mask.shape[1] - np.argmax(covered[:, ::-1], axis=1), 0)
                framed = (xx > g_left[:, None]) & (xx < g_right[:, None]) & (np.abs(xx - body.cx) <= body.chest_w / 2)
                to_skin = exposed & (trunk | arms | neck | framed)
                skin_est = _fill_field(rgb, skin if skin.any() else mask, 0.05 * hgt)
                clean_bg = erode(~mask, 3)
                bg_col, bg_spread = background_stats(rgb.astype(np.uint8))
                if bg_spread < 6:  # plain backdrop: exact colour, no smoothing drift
                    bg_est = np.broadcast_to(bg_col.astype(np.float32), rgb.shape)
                else:
                    bg_est = _fill_field(rgb, clean_bg if clean_bg.any() else ~mask, 0.06 * hgt)
                fill = np.where(to_skin[..., None], skin_est, bg_est)
                soft = np.asarray(Image.fromarray(exposed.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(0.8)),
                                  dtype=np.float32)[..., None] / 255
                soft = np.maximum(soft, exposed[..., None].astype(np.float32))
                soft[: body.head_y1] = 0
                base = base * (1 - soft) + fill * soft
                edit = (soft[..., 0] > 0.02) & ~covered
        base_img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

        # Soft contact shadow under the garment edges (never over the identity region).
        sh = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(max(2, body.height * 0.008))), dtype=np.float32) / 255
        sh = np.roll(np.roll(sh, max(1, body.height // 220), 0), max(1, body.height // 400), 1) * 0.35
        sh[: body.head_y1] = 0
        out = base * (1 - sh[..., None]) * (1 - alpha[..., None]) + g_arr[..., :3].astype(np.float32) * alpha[..., None]
        image = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        return VTONResult(
            image=image,
            garment_alpha=alpha,
            subject_box=box,
            twin_resized=twin,
            model_version=self.model_version(tier),
            base_image=base_img,
            edit_mask=edit,
            garment_class=cls,
        )
