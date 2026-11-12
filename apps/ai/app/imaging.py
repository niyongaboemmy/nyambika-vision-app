"""Shared image helpers: base64 codecs, background estimation and segmentation."""
import base64
import io
from collections import deque

import numpy as np
from PIL import Image


def decode_b64(data: str) -> Image.Image:
    if "," in data[:80] and data.startswith("data:"):
        data = data.split(",", 1)[1]
    img = Image.open(io.BytesIO(base64.b64decode(data)))
    img.load()
    return img


def encode_png_b64(img: Image.Image, pnginfo=None) -> str:
    return base64.b64encode(png_bytes(img, pnginfo)).decode()


def png_bytes(img: Image.Image, pnginfo=None) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=pnginfo)
    return buf.getvalue()


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def border_pixels(rgb: np.ndarray, width: int = 4) -> np.ndarray:
    return np.concatenate(
        [
            rgb[:width].reshape(-1, 3),
            rgb[-width:].reshape(-1, 3),
            rgb[:, :width].reshape(-1, 3),
            rgb[:, -width:].reshape(-1, 3),
        ]
    )


def background_stats(rgb: np.ndarray) -> tuple[np.ndarray, float]:
    """Median border colour and its spread (mean per-channel std)."""
    border = border_pixels(rgb).astype(np.float32)
    return np.median(border, axis=0), float(border.std(axis=0).mean())


def colour_distance(rgb: np.ndarray, colour: np.ndarray) -> np.ndarray:
    """Max per-channel absolute difference, robust and cheap."""
    return np.abs(rgb.astype(np.float32) - colour[None, None, :]).max(axis=-1)


def _dilate(mask: np.ndarray) -> np.ndarray:
    out = mask.copy()
    out[1:] |= mask[:-1]
    out[:-1] |= mask[1:]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def border_connected(candidate: np.ndarray) -> np.ndarray:
    """Region of `candidate` reachable from the image border (geodesic flood fill)."""
    seed = np.zeros_like(candidate)
    seed[0, :] = candidate[0, :]
    seed[-1, :] = candidate[-1, :]
    seed[:, 0] = candidate[:, 0]
    seed[:, -1] = candidate[:, -1]
    while True:
        grown = _dilate(seed) & candidate
        if (grown == seed).all():
            return seed
        seed = grown


def downsample_mask(mask: np.ndarray, max_side: int = 160) -> tuple[np.ndarray, float]:
    h, w = mask.shape
    scale = min(1.0, max_side / max(h, w))
    if scale == 1.0:
        return mask, 1.0
    small = Image.fromarray(mask.astype(np.uint8) * 255).resize(
        (max(1, int(w * scale)), max(1, int(h * scale))), Image.NEAREST
    )
    return np.asarray(small) > 127, scale


def component_areas(mask: np.ndarray) -> list[int]:
    """4-connected component areas, largest first. Use on small masks only."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    areas = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not seen[y, x]:
                area = 0
                q = deque([(y, x)])
                seen[y, x] = True
                while q:
                    cy, cx = q.popleft()
                    area += 1
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
                areas.append(area)
    return sorted(areas, reverse=True)


def foreground_mask(img: Image.Image) -> np.ndarray:
    """Foreground = alpha if present, else pixels unlike the border-connected background."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = np.asarray(img.convert("RGBA"))[..., 3]
        if (alpha < 250).any():
            return alpha > 127
    rgb = np.asarray(img.convert("RGB"))
    bg, spread = background_stats(rgb)
    threshold = max(14.0, 3 * spread + 10)
    bg_like = colour_distance(rgb, bg) <= threshold
    small, _ = downsample_mask(bg_like, 320)
    region = border_connected(small)
    region_full = np.asarray(
        Image.fromarray(region.astype(np.uint8) * 255).resize((rgb.shape[1], rgb.shape[0]), Image.NEAREST)
    ) > 127
    return ~(region_full & bg_like)


def bbox(mask: np.ndarray):
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def dominant_colours(rgb: np.ndarray, mask: np.ndarray, k: int = 3) -> list[str]:
    px = rgb[mask]
    if len(px) == 0:
        return []
    q = (px // 32).astype(np.int32)
    keys = q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]
    counts = np.bincount(keys, minlength=512)
    out: list[np.ndarray] = []
    for key in np.argsort(counts)[::-1]:
        if counts[key] < 0.04 * len(px) or len(out) >= k:
            break
        mean = px[keys == key].mean(axis=0)
        if all(np.abs(mean - o).max() > 40 for o in out):
            out.append(mean)
    return ["#%02x%02x%02x" % tuple(int(v) for v in c) for c in out]


def _box_any(m: np.ndarray, r: int, axis: int) -> np.ndarray:
    """1-D binary dilation by radius r along an axis (sliding-window OR via cumulative sums)."""
    if r <= 0:
        return m
    n = m.shape[axis]
    cs = np.cumsum(m.astype(np.int32), axis=axis)
    cs = np.concatenate([np.zeros_like(np.take(cs, [0], axis=axis)), cs], axis=axis)
    i = np.arange(n)
    hi = np.take(cs, np.minimum(n, i + r + 1), axis=axis)
    lo = np.take(cs, np.maximum(0, i - r), axis=axis)
    return (hi - lo) > 0


def dilate(m: np.ndarray, r: int) -> np.ndarray:
    """Square binary dilation of radius r (side 2r+1)."""
    return _box_any(_box_any(m, r, 0), r, 1)


def erode(m: np.ndarray, r: int) -> np.ndarray:
    return ~dilate(~m, r)
