"""Synthetic garment corpus for the R4 local-model spike (no real people, no real designs).

Every image is drawn procedurally from a seed, so a dataset manifest only has to store the seed and the
labels: the exact pixels can be regenerated for training, audits and drift checks.

Axes (the evaluation subgroups):
  garment type   dress · umushanana · shirt · skirt · trousers
  pattern family imigongo (bold angular chevrons/diamonds) · kitenge (large organic motifs) ·
                 wax (dense small repeated motifs) · solid
  photo quality  good · low_light · blurry_noisy
plus a dominant colour from an 8-colour palette (the base cloth covers most of the garment).

The pattern families are *stylised stand-ins* drawn from public geometric vocabularies, not copies of any
maker's designs. `person_image()` draws a synthetic figure with a face, used only to test the PII screen.
"""
from __future__ import annotations

import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

GARMENTS = ("dress", "umushanana", "shirt", "skirt", "trousers")
PATTERNS = ("imigongo", "kitenge", "wax", "solid")
QUALITIES = ("good", "low_light", "blurry_noisy")
COLOURS: dict[str, str] = {
    "terracotta": "#C8553D",
    "indigo": "#2F3E9E",
    "gold": "#D9A21B",
    "teal": "#12857F",
    "crimson": "#B0213A",
    "forest-green": "#2E6B3A",
    "royal-purple": "#6A3FA0",
    "black": "#1E1B1A",
}
# Synthetic skin tones across the Monk Skin Tone scale (MST 3..10) for the screening set.
SKIN_TONES = {"mst3": "#E7C9A9", "mst5": "#D7A47F", "mst6": "#A8735A", "mst7": "#8D5A3E", "mst8": "#6B4430",
              "mst9": "#4A2F22", "mst10": "#2E211B"}

W, H = 120, 150
GENERATOR_VERSION = "synth-garments/1"  # default; v2 (domain-randomised silhouettes) is kept for the comparison in the report
DEFAULT_GEN = 1


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _mix(a, b, t):
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def _contrast(base: tuple[int, int, int]) -> tuple[int, int, int]:
    lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2]
    return (245, 240, 228) if lum < 110 else (24, 20, 18)


def _pattern(size: tuple[int, int], base_hex: str, family: str, rng: random.Random) -> Image.Image:
    base = hex_rgb(base_hex)
    tile = Image.new("RGB", size, base)
    d = ImageDraw.Draw(tile)
    w, h = size
    ink = _contrast(base)
    accent = _mix(base, ink, 0.55)
    if family == "imigongo":
        # Bold angular chevrons + nested diamonds in thick lines (high-contrast, geometric).
        step = rng.randint(22, 28)
        lw = max(3, step // 6)
        for y in range(-step, h + step, step):
            pts = []
            for x in range(-step, w + step, step // 2):
                pts.append((x, y + (step // 2 if (x // (step // 2)) % 2 else 0)))
            d.line(pts, fill=ink, width=lw)
        for cy in range(step // 2, h, step * 2):
            for cx in range(step // 2 + (step if (cy // step) % 2 else 0), w, step * 2):
                r = step // 3
                d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], outline=ink, width=max(2, lw - 1))
    elif family == "kitenge":
        # Large organic motifs: big flowers/ellipses in 2 colours, sparse.
        n = rng.randint(4, 6)
        for _ in range(n):
            cx, cy = rng.randint(0, w), rng.randint(0, h)
            r = rng.randint(14, 22)
            col = accent if rng.random() < 0.5 else _mix(base, (250, 210, 90), 0.6)
            for k in range(6):
                a = k * math.pi / 3
                px, py = cx + int(r * 0.7 * math.cos(a)), cy + int(r * 0.7 * math.sin(a))
                d.ellipse((px - r // 2, py - r // 2, px + r // 2, py + r // 2), fill=col)
            d.ellipse((cx - r // 3, cy - r // 3, cx + r // 3, cy + r // 3), fill=ink)
    elif family == "wax":
        # Dense, small repeated motifs (dots + rings on a tight grid) with a crackle speckle.
        step = rng.randint(8, 10)
        for y in range(0, h, step):
            off = step // 2 if (y // step) % 2 else 0
            for x in range(off, w, step):
                if (x // step + y // step) % 3 == 0:
                    d.ellipse((x - 3, y - 3, x + 3, y + 3), outline=ink, width=1)
                else:
                    d.ellipse((x - 1, y - 1, x + 1, y + 1), fill=accent)
        arr = np.asarray(tile).astype(np.int16)
        g = np.random.default_rng(rng.randint(0, 2**31))
        arr += (g.normal(0, 7, arr.shape[:2])[..., None]).astype(np.int16)
        tile = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    else:  # solid: plain cloth with a faint weave
        arr = np.asarray(tile).astype(np.int16)
        weave = ((np.indices((h, w)).sum(axis=0) % 4) == 0) * 6
        arr = arr - weave[..., None]
        tile = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return tile


def _silhouette_v1(kind: str, rng: random.Random) -> Image.Image:
    """Generator v1 (default): one polygon per garment type, jitter in scale and position."""
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    s = rng.uniform(0.86, 1.0)
    ox, oy = rng.randint(-4, 4), rng.randint(-4, 4)
    cx = W / 2 + ox

    def P(pts):
        return [(cx + x * s, H / 2 + oy + y * s) for x, y in pts]

    if kind == "dress":  # fitted bodice, A-line skirt, sleeveless
        d.polygon(P([(-16, -62), (-24, -56), (-20, -20), (-44, 62), (44, 62), (20, -20), (24, -56), (16, -62), (8, -56), (-8, -56)]), fill=255)
    elif kind == "umushanana":  # long wide drape with a diagonal shoulder sash
        d.polygon(P([(-30, -60), (-36, -10), (-48, 66), (48, 66), (40, -14), (34, -50), (10, -64)]), fill=255)
        d.polygon(P([(10, -64), (30, -68), (50, -30), (40, -14)]), fill=255)
    elif kind == "shirt":  # T shape with sleeves, short body
        d.polygon(P([(-18, -44), (-50, -30), (-42, -10), (-28, -18), (-28, 40), (28, 40), (28, -18), (42, -10), (50, -30), (18, -44), (6, -38), (-6, -38)]), fill=255)
    elif kind == "skirt":  # trapezoid, mid canvas
        d.polygon(P([(-22, -34), (22, -34), (40, 36), (-40, 36)]), fill=255)
    else:  # trousers: waistband + two legs
        d.polygon(P([(-26, -60), (26, -60), (30, 64), (6, 64), (0, -14), (-6, 64), (-30, 64)]), fill=255)
    return m


def _silhouette_v2(kind: str, rng: random.Random) -> Image.Image:
    """Garment mask (L). Generator v2 = domain randomisation: style variants per garment type (sleeves,
    sash side, hem shape), scale 0.62–1.0, horizontal stretch 0.8–1.25 and per-vertex jitter, because v1's
    single fixed polygon per type did not transfer to garments drawn any other way (see the spike report)."""
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    s = rng.uniform(0.62, 1.0)
    sx = s * rng.uniform(0.8, 1.25)
    ox, oy = rng.randint(-5, 5), rng.randint(-5, 5)
    cx = W / 2 + ox
    j = 3.0

    def P(pts, jitter=True):
        return [(cx + (x + (rng.uniform(-j, j) if jitter else 0)) * sx, H / 2 + oy + (y + (rng.uniform(-j, j) if jitter else 0)) * s) for x, y in pts]

    v = rng.random()
    if kind == "dress":  # bodice + flared skirt; sleeveless, cap or long sleeves; knee to ankle length
        hem = rng.uniform(46, 66)
        flare = rng.uniform(32, 48)
        body = [(-16, -62), (-24, -56), (-20, -20), (-flare, hem), (flare, hem), (20, -20), (24, -56), (16, -62), (8, -56), (-8, -56)]
        d.polygon(P(body), fill=255)
        if v < 0.66:
            ln = 14 if v < 0.33 else 40
            for sgn in (-1, 1):
                d.polygon(P([(sgn * 20, -60), (sgn * 38, -50 + ln * 0.2), (sgn * (30 + ln * 0.3), -50 + ln), (sgn * 20, -44 + ln * 0.5)]), fill=255)
    elif kind == "umushanana":  # long column skirt to the floor + sash across the body over one shoulder
        side = 1 if v < 0.5 else -1
        d.polygon(P([(-26, -44), (-28, 10), (-rng.uniform(36, 46), 66), (rng.uniform(36, 46), 66), (28, 10), (26, -44)]), fill=255)
        d.polygon(P([(side * 14, -70), (side * 34, -62), (-side * 22, 22), (-side * 38, 12)]), fill=255)
    elif kind == "shirt":  # T shape, short or long sleeves, hip length
        hem = rng.uniform(34, 50)
        long = v < 0.5
        sl = [(-50, -30), (-42, -10)] if not long else [(-56, -26), (-50, 34), (-38, 34), (-36, -12)]
        sr = [(-x, y) for x, y in reversed(sl)]
        d.polygon(P([(-18, -46), *sl, (-28, -18), (-28, hem), (28, hem), (28, -18), *sr, (18, -46), (6, -40), (-6, -40)]), fill=255)
    elif kind == "skirt":  # A-line, straight or flared; mini to midi
        top, hem = -rng.uniform(26, 40), rng.uniform(26, 50)
        flare = [30, 40, 50][int(v * 3)]
        d.polygon(P([(-22, top), (22, top), (flare, hem), (-flare, hem)]), fill=255)
    else:  # trousers: straight or wide legs
        wide = 6 if v < 0.5 else 14
        d.polygon(P([(-26, -60), (26, -60), (26 + wide, 64), (6, 64), (0, -10), (-6, 64), (-26 - wide, 64)]), fill=255)
    return m


def garment_image(kind: str, family: str, colour: str, quality: str, seed: int, gen: int = DEFAULT_GEN) -> Image.Image:
    rng = random.Random(seed)
    bg = _mix((244, 241, 236), (226, 222, 214), rng.random())
    canvas = Image.new("RGB", (W, H), bg)
    cloth = _pattern((W, H), COLOURS[colour], family, rng)
    mask = (_silhouette_v2 if gen == 2 else _silhouette_v1)(kind, rng)
    canvas.paste(cloth, (0, 0), mask)
    if quality == "low_light":
        arr = np.asarray(canvas).astype(np.float32)
        arr = arr * rng.uniform(0.42, 0.55) + np.array([10, 4, -6])
        canvas = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    elif quality == "blurry_noisy":
        canvas = canvas.filter(ImageFilter.GaussianBlur(rng.uniform(1.2, 1.8)))
        arr = np.asarray(canvas).astype(np.float32)
        g = np.random.default_rng(seed)
        arr += g.normal(0, 12, arr.shape)
        canvas = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    return canvas


def person_image(skin: str, seed: int, garment: str = "dress") -> Image.Image:
    """Synthetic figure (head with eyes + body wearing a garment): exists only to test the PII screen."""
    rng = random.Random(seed)
    bg = _mix((244, 241, 236), (226, 222, 214), rng.random())
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    tone = hex_rgb(SKIN_TONES[skin])
    cx = W // 2 + rng.randint(-6, 6)
    r = rng.randint(11, 14)
    top = rng.randint(6, 12)
    d.ellipse((cx - r - 3, top - 3, cx + r + 3, top + 2 * r - 4), fill=(40, 28, 22))  # hair
    d.ellipse((cx - r, top + 2, cx + r, top + 2 * r + 4), fill=tone)  # face
    ey = top + r
    for s in (-1, 1):
        d.ellipse((cx + s * r // 2 - 2, ey - 2, cx + s * r // 2 + 2, ey + 2), fill=(20, 14, 12))
    d.arc((cx - r // 2, ey + 3, cx + r // 2, ey + r // 2 + 5), 20, 160, fill=(60, 30, 24), width=1)
    d.rectangle((cx - 4, top + 2 * r + 2, cx + 4, top + 2 * r + 9), fill=tone)  # neck
    body = garment_image(garment, rng.choice(PATTERNS), rng.choice(list(COLOURS)), "good", seed + 7)
    m = _silhouette_v1(garment, rng).resize((int(W * 0.8), int(H * 0.8)))
    img.paste(body.resize(m.size), (W // 2 - m.width // 2, top + 2 * r + 6), m)
    for s in (-1, 1):  # arms
        d.rectangle((cx + s * 26 - 3, top + 2 * r + 14, cx + s * 26 + 3, top + 2 * r + 60), fill=tone)
    return img


def corpus(per_cell: int, seed: int = 7, colours: tuple[str, ...] | None = None, gen: int = DEFAULT_GEN) -> list[dict]:
    """Balanced synthetic specs: `per_cell` items in every garment × pattern × quality cell, colours cycled."""
    pal = list(colours or COLOURS)
    rng = random.Random(seed)
    out = []
    i = 0
    for g in GARMENTS:
        for p in PATTERNS:
            for q in QUALITIES:
                start = rng.randrange(len(pal))
                for k in range(per_cell):
                    out.append({"seed": seed * 1_000_003 + i, "gen": gen, "labels": {"category": g, "pattern": p, "colour": pal[(start + k) % len(pal)], "quality": q}})
                    i += 1
    return out


def render(spec: dict) -> Image.Image:
    lb = spec["labels"]
    return garment_image(lb["category"], lb["pattern"], lb["colour"], lb["quality"], spec["seed"], spec.get("gen") or DEFAULT_GEN)
