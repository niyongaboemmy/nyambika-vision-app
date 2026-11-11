"""Live morph garment transforms (E23, FR-TRY-16, CR-08).

Works on the try-on cut-out (RGBA, cropped to the garment) so the result can go straight back
into the normal try-on path:

- recolour: rotate every hue so the garment's dominant hue lands on the requested one while keeping
  saturation and value, so the kitenge print (motifs, outlines, light/dark structure) survives;
- length: mini / knee / midi / maxi. Shorter cuts the skirt and draws a new hem; longer continues the
  flare and tiles the print downwards from the rows above;
- sleeves: sleeveless / short / elbow / long. Sleeve lobes are found from the alpha width profile;
  longer sleeves are grown from the bottom of the lobe along the arm, filled with print sampled from
  the bodice at the same height.

The output keeps the input canvas (padded at the bottom when the garment gets longer) and returns a
`frame`: the rectangle that corresponds to the original garment. The compositor maps that frame
onto its default placement box, so a mini really ends higher on the body and a maxi lower.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from .imaging import bbox

LENGTHS = ("mini", "knee", "midi", "maxi")
SLEEVES = ("sleeveless", "short", "elbow", "long")

# Hem position relative to the top of the garment, in units of the default (knee) dress box.
# Derived from the compositor's dress placement (0.19..0.72 of the subject height) and body
# landmarks: mini mid-thigh 0.62, knee 0.72, midi mid-calf 0.82, maxi ankle 0.95.
HEM = {"mini": 0.81, "knee": 1.0, "midi": 1.19, "maxi": 1.43}
# Sleeve end below the garment top, same units: elbow 0.40 and wrist 0.64 of the dress box.
SLEEVE_END = {"elbow": 0.40, "long": 0.64}
LONG_CATEGORIES = {"dress", "umushanana", "kitenge", "gown", "bridal", "wrap", "skirt"}
OUTLINE_MIX = 0.45


# ── colour ────────────────────────────────────────────────────────────────────

def _rgb_to_hsv(rgb: np.ndarray) -> np.ndarray:
    """Vectorised RGB→HSV on floats in 0..1 (H in 0..1)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=-1)
    mn = rgb.min(axis=-1)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-9
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / d[rm]) % 6
    h[gm] = (b[gm] - r[gm]) / d[gm] + 2
    h[bm] = (r[bm] - g[bm]) / d[bm] + 4
    h = h / 6.0
    s = np.where(mx > 1e-9, d / np.maximum(mx, 1e-9), 0)
    return np.stack([h, s, mx], axis=-1)


def _hsv_to_rgb(hsv: np.ndarray) -> np.ndarray:
    h, s, v = hsv[..., 0] * 6.0, hsv[..., 1], hsv[..., 2]
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    choices = [
        np.stack([v, t, p], -1), np.stack([q, v, p], -1), np.stack([p, v, t], -1),
        np.stack([p, q, v], -1), np.stack([t, p, v], -1), np.stack([v, p, q], -1),
    ]
    out = np.zeros(hsv.shape, dtype=np.float64)
    for k, c in enumerate(choices):
        out[i == k] = c[i == k]
    return out


def dominant_hue(img: Image.Image) -> float | None:
    """Saturation-weighted circular mean hue of opaque pixels, in degrees (None if greyscale)."""
    a = np.asarray(img.convert("RGBA")).astype(np.float64) / 255
    m = a[..., 3] > 0.5
    if not m.any():
        return None
    hsv = _rgb_to_hsv(a[..., :3][m])
    w = hsv[:, 1] * hsv[:, 2]
    if w.sum() < 1e-6 * len(w):
        return None
    ang = hsv[:, 0] * 2 * np.pi
    x, y = (np.cos(ang) * w).sum(), (np.sin(ang) * w).sum()
    if abs(x) + abs(y) < 1e-9:
        return None
    return float(np.degrees(np.arctan2(y, x)) % 360)


def recolour(img: Image.Image, hue_deg: float) -> Image.Image:
    """Rotate hues so the dominant hue becomes `hue_deg`. S, V and alpha are unchanged."""
    rgba = np.asarray(img.convert("RGBA"))
    base = dominant_hue(img)
    rgb = rgba[..., :3].astype(np.float64) / 255
    hsv = _rgb_to_hsv(rgb)
    if base is None:
        # Greyscale garment: there is no hue to rotate, so tint gently while keeping value.
        hsv[..., 0] = hue_deg / 360
        hsv[..., 1] = np.maximum(hsv[..., 1], 0.35)
    else:
        hsv[..., 0] = (hsv[..., 0] + (hue_deg - base) / 360) % 1.0
    out = np.clip(np.rint(_hsv_to_rgb(hsv) * 255), 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([out, rgba[..., 3]]), "RGBA")


# ── geometry helpers ──────────────────────────────────────────────────────────

def _rows(alpha: np.ndarray):
    """Left/right opaque column per row (-1 when empty)."""
    h, w = alpha.shape
    has = alpha.any(axis=1)
    left = np.where(has, alpha.argmax(axis=1), -1)
    right = np.where(has, w - 1 - alpha[:, ::-1].argmax(axis=1), -1)
    return left, right, has


def _profile(alpha: np.ndarray):
    """Centre, torso half-width and the sleeve zone of a garment cut-out (cropped canvas)."""
    h, w = alpha.shape
    left, right, has = _rows(alpha)
    ys = np.where(has)[0]
    top, bottom = int(ys[0]), int(ys[-1])
    gh = bottom - top + 1
    cx = (left[has].min() + right[has].max()) / 2
    half = np.where(has, np.maximum(cx - left, right - cx), 0)
    lo, hi = top + int(0.22 * gh), top + int(0.5 * gh)
    torso = float(np.min(half[lo:hi])) if hi > lo else float(half[has].min())
    # Sleeve rows: in the upper part, rows noticeably wider than the torso.
    # Sleeve rows: the first run of rows near the top that are clearly wider than the torso
    # (stops before the skirt flare, which is also wider than the torso further down).
    zone_end = top
    seen = False
    for y in range(top, top + int(0.45 * gh)):
        if half[y] > torso + 6:
            zone_end, seen = y, True
        elif seen:
            break
    return {"top": top, "bottom": bottom, "height": gh, "cx": cx, "torso": torso, "sleeve_end": zone_end,
            "has_sleeves": zone_end > top}


def _outline(rgba: np.ndarray, mask: np.ndarray, width: int = 4) -> None:
    """Darken a band just inside `mask`'s edge, like the stitched outline of the original photo."""
    inner = mask.copy()
    for _ in range(width):
        m = inner.copy()
        m[1:] &= inner[:-1]
        m[:-1] &= inner[1:]
        m[:, 1:] &= inner[:, :-1]
        m[:, :-1] &= inner[:, 1:]
        inner = m
    edge = mask & ~inner
    rgb = rgba[..., :3].astype(np.float64)
    rgb[edge] = rgb[edge] * (1 - OUTLINE_MIX)
    rgba[..., :3] = rgb.astype(np.uint8)


# ── length ────────────────────────────────────────────────────────────────────

def set_length(img: Image.Image, target: str, base: str = "knee") -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Return the re-hemmed cut-out and the frame of the original garment inside it."""
    rgba = np.asarray(img.convert("RGBA")).copy()
    h, w = rgba.shape[:2]
    frame = (0, 0, w, h)
    if target == base:
        return Image.fromarray(rgba, "RGBA"), frame
    alpha = rgba[..., 3] > 127
    p = _profile(alpha)
    top, bottom, gh = p["top"], p["bottom"], p["height"]
    new_bottom = top + int(round(gh * HEM[target] / HEM[base])) - 1
    if new_bottom < bottom:
        # Never cut above the waist band (half way down).
        new_bottom = max(new_bottom, top + int(0.55 * gh))
        rgba[new_bottom + 1:, :, 3] = 0
        band = np.zeros(alpha.shape, dtype=bool)
        band[new_bottom - 4:new_bottom + 1] = rgba[new_bottom - 4:new_bottom + 1, :, 3] > 127
        rgb = rgba[..., :3].astype(np.float64)
        rgb[band] *= 1 - OUTLINE_MIX
        rgba[..., :3] = rgb.astype(np.uint8)
        return Image.fromarray(rgba, "RGBA"), frame

    # Longer: pad the canvas (down and sideways), continue the flare and tile the print downwards
    # with the print's own vertical period so motifs line up (no stretching).
    left, right, has = _rows(alpha)
    fit_lo = top + int(0.7 * gh)
    ys = np.arange(fit_lo, bottom - 6)
    ys = ys[has[ys]]
    kl = np.polyfit(ys, left[ys], 1)
    kr = np.polyfit(ys, right[ys], 1)
    pad = int(max(0, -np.polyval(kl, new_bottom), np.polyval(kr, new_bottom) - (w - 1))) + 2
    extra = new_bottom - bottom
    W = w + 2 * pad
    out = np.zeros((h + extra + 2, W, 4), dtype=np.uint8)
    out[:h, pad:pad + w] = rgba
    frame = (pad, 0, pad + w, h)
    seam = bottom - 10  # overwrite the old hem outline
    cx = p["cx"] + pad
    # 2-D block (rows × columns), so staggered prints (motif rows offset sideways) resolve to the
    # true repeat instead of half of it.
    centre = rgba[:, int(p["cx"] - 0.5 * p["torso"]):int(p["cx"] + 0.5 * p["torso"]), :3].astype(np.float64).mean(axis=2)
    period = _period(centre[top + int(0.45 * gh):seam], 12, int(0.35 * gh)) or max(24, int(0.2 * gh))
    for y in range(seam, new_bottom + 1):
        lt = int(round(np.polyval(kl, y))) + pad
        rt = int(round(np.polyval(kr, y))) + pad
        src_y = y - period
        while src_y >= seam:
            src_y -= period
        sl, sr = left[src_y] + pad + 6, right[src_y] + pad - 6
        if rt <= lt or sr <= sl:
            continue
        xs = np.arange(lt, rt + 1)
        # Same pixel scale as the source row; reflect at the source row's edges.
        span = sr - sl
        rel = (xs - sl) % (2 * span)
        sx = np.where(rel <= span, sl + rel, sl + 2 * span - rel).astype(int)
        row = out[src_y, sx].copy()
        row[:, 3] = 255
        out[y] = 0
        out[y, xs] = row
    garment = out[..., 3] > 127
    band = np.zeros(garment.shape, dtype=bool)
    band[new_bottom - 4:new_bottom + 1] = garment[new_bottom - 4:new_bottom + 1]
    side = np.zeros(garment.shape, dtype=bool)
    for y in range(seam, new_bottom + 1):
        xs = np.where(garment[y])[0]
        if len(xs):
            side[y, xs[0]:xs[0] + 4] = True
            side[y, xs[-1] - 3:xs[-1] + 1] = True
    rgb = out[..., :3].astype(np.float64)
    rgb[band | side] *= 1 - OUTLINE_MIX
    out[..., :3] = rgb.astype(np.uint8)
    del cx
    return Image.fromarray(out, "RGBA"), frame


def _period(signal: np.ndarray, lo: int, hi: int) -> int | None:
    """Dominant repeat length along axis 0 (autocorrelation peak), or None if there is none.

    Accepts a 1-D signal or a 2-D block; for a block, whole rows are compared pixel by pixel.
    The shortest lag within 95% of the best correlation wins, so multiples of the period lose.
    """
    x = np.asarray(signal, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    if len(x) < 2 * lo + 4:
        return None
    x = x - x.mean()
    hi = min(hi, len(x) // 2)
    scores = []
    for lag in range(lo, hi + 1):
        a, b = x[:-lag], x[lag:]
        denom = float(np.sqrt((a * a).sum() * (b * b).sum()))
        scores.append(float((a * b).sum()) / denom if denom > 1e-6 else 0.0)
    if not scores or max(scores) < 0.3:
        return None
    best = max(scores)
    for i, c in enumerate(scores):
        if c >= 0.95 * best and (i == 0 or c >= scores[i - 1]) and (i + 1 == len(scores) or c >= scores[i + 1]):
            return lo + i
    return lo + int(np.argmax(scores))


# ── sleeves ───────────────────────────────────────────────────────────────────

def set_sleeves(img: Image.Image, target: str, base: str = "short") -> Image.Image:
    rgba = np.asarray(img.convert("RGBA")).copy()
    if target == base:
        return Image.fromarray(rgba, "RGBA")
    h, w = rgba.shape[:2]
    alpha = rgba[..., 3] > 127
    p = _profile(alpha)
    top, gh, cx, torso = p["top"], p["height"], p["cx"], p["torso"]
    xs = np.arange(w)
    outside = np.abs(xs - cx) > torso + 1

    if not p["has_sleeves"] and target != "sleeveless":
        # Sleeveless base: grow a short cap sleeve at the shoulder first.
        cap = Image.new("L", (w, h), 0)
        d = ImageDraw.Draw(cap)
        y0, y1 = top + int(0.03 * gh), top + int(0.19 * gh)
        for s in (-1, 1):
            xi = cx + s * (torso - 2)
            xo = cx + s * (torso + 0.55 * torso)
            d.polygon([(xi, y0), (xo, y0 + 0.4 * (y1 - y0)), (xo - s * 0.12 * torso, y1), (xi, y1)], fill=255)
        capm = (np.asarray(cap) > 127) & ~alpha
        _fill_from_bodice(rgba, capm, cx, torso)
        rgba[capm, 3] = 255
        _outline(rgba, capm | (rgba[..., 3] > 127) & outside[None, :] & (np.arange(h)[:, None] < y1 + 1), 3)
        alpha = rgba[..., 3] > 127
        p = _profile(alpha)

    zone = np.zeros(alpha.shape, dtype=bool)
    zone[top:p["sleeve_end"] + 1] = outside[None, :]
    sleeve = alpha & zone
    if target == "sleeveless":
        rgba[sleeve, 3] = 0
        # Re-draw the armhole edge on the bodice.
        arm = np.zeros(alpha.shape, dtype=bool)
        for y in range(top, p["sleeve_end"] + 1):
            for s in (-1, 1):
                x = int(round(cx + s * torso))
                lo, hi = sorted((x, x - s * 4))
                arm[y, max(0, lo):min(w, hi + 1)] = True
        arm &= rgba[..., 3] > 127
        rgb = rgba[..., :3].astype(np.float64)
        rgb[arm] *= 1 - OUTLINE_MIX
        rgba[..., :3] = rgb.astype(np.uint8)
        return Image.fromarray(rgba, "RGBA")
    if target == "short":
        return Image.fromarray(rgba, "RGBA")

    # elbow / long: grow each sleeve from the widest row of its lobe down along the arm.
    end_y = min(h - 2, top + int(SLEEVE_END[target] * gh))
    grow = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(grow)
    for s in (-1, 1):
        side = sleeve & ((xs - cx) * s > 0)[None, :]
        rows = np.where(side.any(axis=1))[0]
        if not len(rows):
            continue
        extent = np.array([np.abs(np.where(side[y])[0] - cx).max() for y in rows])
        y_w = int(rows[int(extent.argmax())])
        x_far = cx + s * float(extent.max())
        x_in = cx + s * (torso + 2)
        width = abs(x_far - x_in)
        dy = max(1, end_y - y_w)
        drift = 0.12 * dy
        d.polygon(
            [
                (x_in, y_w), (x_far, y_w),
                (x_far + s * drift, end_y), (x_far + s * drift - s * 0.7 * width, end_y),
                (x_in + s * 0.25 * drift, y_w + 0.3 * dy),
            ],
            fill=255,
        )
    growm = np.asarray(grow) > 127
    newpx = growm & ~alpha  # never paint over the bodice, skirt or the existing sleeve
    _fill_from_bodice(rgba, newpx, cx, torso)
    rgba[newpx, 3] = 255
    full = rgba[..., 3] > 127
    inner = full.copy()
    for _ in range(4):
        m = inner.copy()
        m[1:] &= inner[:-1]
        m[:-1] &= inner[1:]
        m[:, 1:] &= inner[:, :-1]
        m[:, :-1] &= inner[:, 1:]
        inner = m
    edge = full & ~inner & newpx
    rgb = rgba[..., :3].astype(np.float64)
    rgb[edge] *= 1 - OUTLINE_MIX
    rgba[..., :3] = rgb.astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def _fill_from_bodice(rgba: np.ndarray, mask: np.ndarray, cx: float, torso: float) -> None:
    """Fill `mask` with print copied from the bodice at the same height.

    Pixels are translated by whole multiples of the print's horizontal period, so motifs continue
    without warping; rows with no bodice fall back to a lower row.
    """
    h, w = mask.shape
    ys, xs = np.where(mask)
    if not len(ys):
        return
    opaque = rgba[..., 3] > 127
    rows = np.where(opaque[:, int(cx)])[0]
    band = rows[len(rows) // 4: len(rows) // 2] if len(rows) > 8 else rows
    lo, hi = int(cx - 0.8 * torso), int(cx + 0.8 * torso)
    sig = rgba[band, lo:hi, :3].astype(np.float64).mean(axis=(0, 2)) if len(band) else np.zeros(1)
    period = _period(sig, 8, int(0.8 * torso)) or max(8, int(0.5 * torso))
    s = np.sign(xs - cx)
    k = np.ceil(np.maximum(0, np.abs(xs - cx) - 0.6 * torso) / period)
    src_x = np.clip(np.rint(xs - s * k * period).astype(int), 0, w - 1)
    src_y = ys.copy()
    ok = opaque[src_y, src_x]
    src_y = np.where(ok, src_y, np.minimum(h - 1, src_y + int(0.1 * h)))
    rgba[ys, xs, :3] = rgba[src_y, src_x, :3]


# ── entry point ───────────────────────────────────────────────────────────────

def morph(img: Image.Image, category: str = "dress", hue: float | None = None, length: str | None = None,
          sleeve: str | None = None, base_length: str = "knee", base_sleeve: str = "short") -> dict:
    """Apply sleeve → length → colour. Returns the new cut-out, the frame and what was applied."""
    out = img.convert("RGBA")
    box = bbox(np.asarray(out)[..., 3] > 10)
    if box:
        out = out.crop(box)
    applied: dict[str, object] = {}
    if sleeve and sleeve != base_sleeve:
        out = set_sleeves(out, sleeve, base_sleeve)
        applied["sleeve"] = sleeve
    frame = (0, 0, out.width, out.height)
    if length and length != base_length and (category or "dress").lower() in LONG_CATEGORIES:
        out, frame = set_length(out, length, base_length)
        applied["length"] = length
    if hue is not None:
        out = recolour(out, float(hue) % 360)
        applied["hue"] = round(float(hue) % 360, 1)
    return {"cutout": out, "frame": list(frame), "applied": applied, "base_hue": dominant_hue(img)}
