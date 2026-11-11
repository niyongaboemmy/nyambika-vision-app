"""PII / person screening for training data (R4 spike): drop any image that shows a person.

Training contributions are *garment* photos. A photo with a person (face, skin, a model wearing the piece)
is personal data of someone who never consented to training, so it is dropped before it enters a dataset
version. This CPU heuristic looks for a compact, roughly elliptical skin-coloured blob with darker
"holes" (eyes/mouth) above it — a face — and, separately, for exposed-skin limbs next to a garment.

It is deliberately conservative (prefers dropping a garment to keeping a person) and is evaluated per
skin tone (MST 3..10) because skin-colour heuristics are known to under-detect darker skin. Production
would use a permissively licensed face/person detector (see docs/spikes/r4-local-model-trends.md).
"""
from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image

SCREEN_VERSION = "pii-screen/1"


def _skin_mask(rgb: np.ndarray) -> np.ndarray:
    """Skin-like pixels in YCbCr, widened for darker tones (low Y, Cr only slightly above Cb)."""
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    light = (cb >= 77) & (cb <= 127) & (cr >= 133) & (cr <= 173) & (y > 60)
    dark = (y >= 22) & (y <= 90) & (cr - cb >= 3) & (cr - cb <= 40) & (cr >= 129) & (r > g) & (g >= b - 4)
    return light | dark


def _components(mask: np.ndarray) -> list[tuple[int, tuple[int, int, int, int], np.ndarray]]:
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            q = deque([(y0, x0)])
            seen[y0, x0] = True
            pts = []
            while q:
                cy, cx = q.popleft()
                pts.append((cy, cx))
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            arr = np.array(pts)
            ys, xs = arr[:, 0], arr[:, 1]
            comp = np.zeros_like(mask, dtype=bool)
            comp[ys, xs] = True
            out.append((len(pts), (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1), comp))
    return out


def screen(img: Image.Image) -> dict:
    """{"has_person": bool, "score": 0..1, "reasons": [...], "version": SCREEN_VERSION}."""
    im = img.convert("RGB")
    im.thumbnail((90, 112))
    rgb = np.asarray(im)
    h, w = rgb.shape[:2]
    lum = rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    skin = _skin_mask(rgb)
    reasons: list[str] = []
    score = 0.0
    total = h * w
    comps = _components(skin)
    for area, (x0, y0, x1, y1), comp in comps:
        if area < 0.006 * total or area > 0.12 * total:
            continue
        bw, bh = x1 - x0, y1 - y0
        aspect = bh / max(1, bw)
        fill = area / max(1, bw * bh)
        if not (0.8 <= aspect <= 1.9 and fill >= 0.5):
            continue
        # Dark features (eyes, mouth) enclosed by the blob in its upper 75%: pixels clearly darker than the
        # blob (anti-aliased eyes can themselves fall inside the dark-skin range, so membership is ignored).
        box = (slice(y0, y0 + max(1, int(bh * 0.75))), slice(x0, x1))
        rows = comp[box]
        enclosed = (np.cumsum(rows, axis=1) > 0) & (np.cumsum(rows[:, ::-1], axis=1)[:, ::-1] > 0)
        blob_lum = float(np.median(lum[comp]))
        dark = enclosed & (lum[box] < blob_lum * 0.72)
        n_dark = int(dark.sum())
        # Two eyes: dark features on both sides of the centre line and few on it (a flower motif with a
        # dark centre is one central hole, not a face).
        lo, hi = int(bw * 0.4), max(int(bw * 0.4) + 1, int(np.ceil(bw * 0.6)))
        left, right, centre = int(dark[:, :lo].sum()), int(dark[:, hi:].sum()), int(dark[:, lo:hi].sum())
        if n_dark >= 2 and left >= 1 and right >= 1 and centre <= 0.35 * n_dark:
            score = max(score, min(1.0, 0.6 + 0.05 * n_dark))
            reasons.append(f"face-like skin region at ({x0},{y0}) with {n_dark} dark features")
    # Exposed arms: a pair of tall skin strips side by side at the same height (a garment worn on a body,
    # even with the face cropped out). One strip alone is not enough (prints and blur create those).
    strips = [(x0, y0, x1, y1) for area, (x0, y0, x1, y1), _c in comps
              if area >= 0.004 * total and (y1 - y0) >= 2.2 * (x1 - x0) and (y1 - y0) >= 0.2 * h]
    for i, (ax0, ay0, ax1, ay1) in enumerate(strips):
        for bx0, by0, bx1, by1 in strips[i + 1:]:
            ha, hb = ay1 - ay0, by1 - by0
            if abs(ay0 - by0) <= 0.08 * h and min(ha, hb) >= 0.7 * max(ha, hb) and abs((ax0 + ax1) - (bx0 + bx1)) / 2 >= 0.25 * w:
                score = max(score, 0.55)
                reasons.append(f"pair of arm-like skin strips at y={min(ay0, by0)}")
    return {"has_person": score >= 0.5, "score": round(score, 3), "reasons": reasons[:4], "version": SCREEN_VERSION}
