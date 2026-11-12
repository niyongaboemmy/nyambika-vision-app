"""Generate synthetic seed assets: kitenge-style garment photos and twin personas.

No real persons: personas are flat illustrations. Usage:
  python scripts/make_seed_assets.py OUTDIR --catalogue      # ~40 garments + manifest JSON on stdout
  python scripts/make_seed_assets.py OUTDIR --personas       # persona-1..5.png
  python scripts/make_seed_assets.py OUTDIR --garment KIND HEX PATTERN NAME
  python scripts/make_seed_assets.py OUTDIR --tee HEX NAME      # plain unbranded tee product photo
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

STUDIO_BG = (244, 241, 236)
TWIN_BG = (20, 18, 24)
KINDS = ["a-line-dress", "wrap-dress", "umushanana", "shirt", "skirt"]
PATTERNS = ["circles", "crosses", "diamonds", "zigzag", "waves"]
COLOURWAYS = [
    ("terracotta", "#C8553D"),
    ("indigo", "#2F3E9E"),
    ("forest-green", "#2E7D4F"),
    ("royal-purple", "#6B3FA0"),
    ("gold", "#D4A017"),
    ("crimson", "#B0182B"),
    ("black-white", "#1C1C1C"),
    ("teal", "#12857F"),
]
# Category used by the API/catalogue for each garment kind.
KIND_CATEGORY = {"a-line-dress": "dress", "wrap-dress": "dress", "umushanana": "umushanana",
                 "shirt": "shirt", "skirt": "skirt"}

# Monk Skin Tone scale 6-10 (approximate sRGB).
PERSONAS = [
    ("#A07E56", 0.85), ("#825C43", 0.95), ("#604134", 1.05), ("#3A312A", 1.15), ("#292420", 1.25),
]


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t: float):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def pattern_fill(size, base_hex: str, pattern: str) -> Image.Image:
    base = hex_rgb(base_hex)
    motif = (240, 236, 228) if sum(base) < 120 else mix(base, (250, 226, 170), 0.62)
    accent = mix(base, (0, 0, 0), 0.35)
    img = Image.new("RGB", size, base)
    d = ImageDraw.Draw(img)
    t = 64
    for row, y in enumerate(range(-t, size[1] + t, t)):
        for x in range(-t, size[0] + t, t):
            cx, cy = x + t // 2 + (t // 2 if row % 2 and pattern in ("circles", "diamonds") else 0), y + t // 2
            if pattern == "circles":
                d.ellipse((cx - 20, cy - 20, cx + 20, cy + 20), outline=motif, width=6)
                d.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), fill=accent)
            elif pattern == "crosses":
                d.line((cx - 18, cy - 18, cx + 18, cy + 18), fill=motif, width=7)
                d.line((cx - 18, cy + 18, cx + 18, cy - 18), fill=motif, width=7)
                d.ellipse((x - 8, y - 8, x + 8, y + 8), outline=accent, width=4)
            elif pattern == "diamonds":
                d.polygon([(cx, cy - 24), (cx + 18, cy), (cx, cy + 24), (cx - 18, cy)], outline=motif, width=6)
                d.polygon([(cx, cy - 8), (cx + 6, cy), (cx, cy + 8), (cx - 6, cy)], fill=accent)
    if pattern == "zigzag":
        for y in range(0, size[1] + t, t // 2):
            pts = [(x, y + (12 if (x // 32) % 2 else -12)) for x in range(0, size[0] + 32, 32)]
            d.line(pts, fill=motif if (y // (t // 2)) % 2 else accent, width=7)
    elif pattern == "waves":
        for y in range(0, size[1] + t, t // 2):
            pts = [(x, y + 12 * math.sin(x / 22)) for x in range(0, size[0] + 4, 4)]
            d.line(pts, fill=motif if (y // (t // 2)) % 2 else accent, width=6)
    return img


def garment_polygons(kind: str, w: int, h: int) -> tuple[list, list | None]:
    cx = w // 2
    if kind == "a-line-dress":
        return [(cx - 95, 130), (cx - 175, 210), (cx - 140, 280), (cx - 110, 260), (cx - 120, 460),
                (cx - 240, 880), (cx + 240, 880), (cx + 120, 460), (cx + 110, 260), (cx + 140, 280),
                (cx + 175, 210), (cx + 95, 130), (cx + 40, 160), (cx - 40, 160)], None
    if kind == "wrap-dress":
        return [(cx - 90, 130), (cx - 210, 260), (cx - 170, 320), (cx - 115, 280), (cx - 110, 470),
                (cx - 200, 880), (cx + 200, 880), (cx + 110, 470), (cx + 115, 280), (cx + 170, 320),
                (cx + 210, 260), (cx + 90, 130), (cx, 300)], [(cx - 110, 460), (cx + 110, 420),
                                                              (cx + 112, 470), (cx - 108, 510)]
    if kind == "umushanana":
        return [(cx - 80, 170), (cx - 115, 240), (cx - 115, 470), (cx - 210, 890), (cx + 210, 890),
                (cx + 115, 470), (cx + 115, 240), (cx + 80, 170)], [(cx + 60, 110), (cx + 135, 140),
                                                                   (cx - 70, 640), (cx - 145, 600)]
    if kind == "shirt":
        return [(cx - 80, 160), (cx - 230, 260), (cx - 195, 400), (cx - 140, 360), (cx - 140, 800),
                (cx + 140, 800), (cx + 140, 360), (cx + 195, 400), (cx + 230, 260), (cx + 80, 160),
                (cx + 30, 210), (cx - 30, 210)], [(cx - 6, 210), (cx + 6, 210), (cx + 6, 800), (cx - 6, 800)]
    if kind == "skirt":
        return [(cx - 130, 260), (cx + 130, 260), (cx + 230, 800), (cx - 230, 800)], \
            [(cx - 130, 260), (cx + 130, 260), (cx + 132, 300), (cx - 132, 300)]
    raise ValueError(f"unknown kind {kind}")


def garment(kind: str, base_hex: str, pattern: str, out_path: str | Path, size=(800, 1000)) -> Path:
    w, h = size
    body, extra = garment_polygons(kind, w, h)
    img = Image.new("RGB", size, STUDIO_BG)
    fill = pattern_fill(size, base_hex, pattern)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(body, fill=255)
    img.paste(fill, (0, 0), mask)
    d = ImageDraw.Draw(img)
    outline = mix(hex_rgb(base_hex), (0, 0, 0), 0.45)
    if extra:
        trim = mix(hex_rgb(base_hex), (250, 226, 170), 0.35) if kind == "umushanana" else outline
        d.polygon(extra, fill=trim, outline=outline, width=4)
    d.polygon(body, outline=outline, width=5)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


# Plain unbranded crew-neck T-shirt, drawn procedurally (no photo, no logo, no person). Licence: same as this
# repository (in-house generated asset). Proportions follow a men's M tee: chest 52 cm, length 72 cm, sleeve 20 cm.
TEE_SOURCE = "procedural (apps/ai/scripts/make_seed_assets.py:tee), in-house generated, no third-party content"


def _smooth_noise(rng, shape, cells: tuple[int, int], amp: float) -> np.ndarray:
    small = rng.standard_normal((cells[1], cells[0])).astype(np.float32)
    img = Image.fromarray(((small - small.min()) / (np.ptp(small) + 1e-6) * 255).astype(np.uint8))
    big = np.asarray(img.resize((shape[1], shape[0]), Image.BICUBIC), dtype=np.float32) / 255 - 0.5
    return big * 2 * amp


def tee(base_hex: str, out_path: str | Path, size=(800, 800), seed: int = 7) -> Path:
    """Studio photo of a plain tee: soft folds, jersey grain, rib collar, twin-needle hems, drop shadow."""
    w, h = size
    cx = w // 2
    rng = np.random.default_rng(seed)
    body = [(cx - 64, 112), (cx - 160, 138), (cx - 300, 236), (cx - 258, 306), (cx - 176, 258),
            (cx - 180, 600), (cx - 120, 610), (cx, 614), (cx + 120, 610), (cx + 180, 600), (cx + 176, 258),
            (cx + 258, 306), (cx + 300, 236), (cx + 160, 138), (cx + 64, 112)]
    neck_front = [(cx - 64, 112)] + [(cx + 64 * math.cos(math.pi - t * math.pi / 16), 112 + 50 * math.sin(t * math.pi / 16))
                                     for t in range(1, 16)] + [(cx + 64, 112)]
    inner_back = [(cx - 60, 114), (cx - 30, 104), (cx, 102), (cx + 30, 104), (cx + 60, 114)] + neck_front[::-1][1:-1]

    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(body, fill=255)
    m = np.asarray(mask, dtype=np.float32) / 255
    base = np.array(hex_rgb(base_hex), dtype=np.float32)
    shade = 1.0 + _smooth_noise(rng, (h, w), (5, 9), 0.07)            # soft folds
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    shade += 0.035 * np.sin((xs - cx) / 23 + 3 * np.sin(ys / 90)) * np.clip((ys - 380) / 220, 0, 1)  # hem ripples
    shade += _smooth_noise(rng, (h, w), (w // 3, h // 3), 0.018)       # jersey grain
    edge = np.asarray(mask.filter(ImageFilter.GaussianBlur(14)), dtype=np.float32) / 255
    shade *= 0.86 + 0.14 * np.clip((edge - 0.5) / 0.5, 0, 1) ** 0.7     # cylindrical falloff at the sides
    fabric = np.clip(base[None, None, :] * shade[..., None], 0, 255)

    bg = np.array(STUDIO_BG, dtype=np.float32)
    shadow = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18)), dtype=np.float32) / 255
    shadow = np.roll(np.roll(shadow, 10, axis=0), 6, axis=1)
    canvas = bg[None, None, :] * (1 - 0.16 * shadow[..., None])
    backdrop = Image.fromarray(canvas.astype(np.uint8))
    canvas = canvas * (1 - m[..., None]) + fabric * m[..., None]
    img = Image.fromarray(canvas.astype(np.uint8))

    d = ImageDraw.Draw(img)
    dark = tuple(int(v) for v in np.clip(base * 0.62, 0, 255))
    stitch = tuple(int(v) for v in np.clip(base * 0.78, 0, 255))
    rib = tuple(int(v) for v in np.clip(base * 0.92, 0, 255))
    d.polygon(inner_back, fill=dark)                                   # inside of the back neck
    d.line(neck_front, fill=rib, width=14, joint="curve")              # rib collar band
    d.line([(x, y + 9) for x, y in neck_front], fill=stitch, width=2, joint="curve")
    for off in (14, 20):                                               # twin-needle hems
        d.line([(cx - 178, 600 - off), (cx - 120, 610 - off), (cx, 614 - off), (cx + 120, 610 - off),
                (cx + 178, 600 - off)], fill=stitch, width=2, joint="curve")
        for s in (-1, 1):
            d.line([(cx + s * (300 - off * 0.86), 236 - off * 0.51), (cx + s * (258 - off * 0.86), 306 - off * 0.51)],
                   fill=stitch, width=2)  # parallel to the sleeve hem, inset toward the body
    for s in (-1, 1):                                                  # shoulder seams
        d.line([(cx + s * 64, 112), (cx + s * 160, 138)], fill=stitch, width=2)
    ImageDraw.Draw(mask).polygon(inner_back, fill=255)
    img = Image.composite(img, backdrop, mask)  # details never spill outside the garment
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


def persona(skin_hex: str, width_factor: float, out_path: str | Path, size=(720, 1280)) -> Path:
    w, h = size
    cx = w // 2
    skin = hex_rgb(skin_hex)
    tw = int(80 * width_factor)
    img = Image.new("RGB", size, TWIN_BG)
    d = ImageDraw.Draw(img)
    hair = (64, 40, 26)
    tee = (236, 232, 226)
    jeans = (61, 90, 138)
    shoes = (92, 60, 42)
    # hair, head, neck
    d.ellipse((cx - 96, 112, cx + 96, 296), fill=hair)
    d.ellipse((cx - 62, 160, cx + 62, 306), fill=skin)
    d.rectangle((cx - 22, 286, cx + 22, 342), fill=skin)
    d.ellipse((cx - 30, 215, cx - 18, 227), fill=(24, 16, 14))
    d.ellipse((cx + 18, 215, cx + 30, 227), fill=(24, 16, 14))
    d.arc((cx - 24, 238, cx + 24, 272), 20, 160, fill=(40, 22, 18), width=4)
    # arms (behind sleeves), angled out so there is a gap at the waist
    for s in (-1, 1):
        d.polygon([(cx + s * (tw + 8), 430), (cx + s * (tw + 54), 430), (cx + s * (tw + 78), 705),
                   (cx + s * (tw + 40), 705)], fill=skin)
        d.ellipse((cx + s * (tw + 59) - 20, 690, cx + s * (tw + 59) + 20, 735), fill=skin)
    # jeans: hips + legs
    d.rectangle((cx - tw + 4, 620, cx + tw - 4, 770), fill=jeans)
    d.rectangle((cx - tw + 4, 760, cx - 8, 1190), fill=jeans)
    d.rectangle((cx + 8, 760, cx + tw - 4, 1190), fill=jeans)
    d.ellipse((cx - tw - 6, 1172, cx - 2, 1212), fill=shoes)
    d.ellipse((cx + 2, 1172, cx + tw + 6, 1212), fill=shoes)
    # tee: torso + sleeves
    d.rectangle((cx - tw, 330, cx + tw, 640), fill=tee)
    for s in (-1, 1):
        d.polygon([(cx + s * (tw - 6), 332), (cx + s * (tw + 48), 350), (cx + s * (tw + 62), 452),
                   (cx + s * (tw + 4), 452)], fill=tee)
    d.ellipse((cx - 34, 318, cx + 34, 352), fill=skin)
    d.rectangle((cx - 34, 318, cx + 34, 334), fill=skin)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    return out_path


def catalogue_manifest() -> list[dict]:
    items = []
    for ci, (colour, hx) in enumerate(COLOURWAYS):
        for ki, kind in enumerate(KINDS):
            pattern = PATTERNS[(ci + ki) % len(PATTERNS)]
            items.append({"slug": f"{kind}-{colour}-{pattern}", "kind": kind, "category": KIND_CATEGORY[kind],
                          "pattern": pattern, "colour": colour, "hex": hx})
    return items


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("outdir")
    p.add_argument("--catalogue", action="store_true")
    p.add_argument("--personas", action="store_true")
    p.add_argument("--garment", nargs=4, metavar=("KIND", "HEX", "PATTERN", "NAME"))
    p.add_argument("--tee", nargs=2, metavar=("HEX", "NAME"))
    args = p.parse_args(argv)
    out = Path(args.outdir)
    if args.garment:
        kind, hx, pattern, name = args.garment
        print(garment(kind, hx, pattern, out / f"{name}.png"))
    if args.tee:
        print(tee(args.tee[0], out / f"{args.tee[1]}.png"))
    if args.personas:
        for i, (skin, wf) in enumerate(PERSONAS, start=1):
            persona(skin, wf, out / f"persona-{i}.png")
    if args.catalogue:
        manifest = catalogue_manifest()
        for item in manifest:
            garment(item["kind"], item["hex"], item["pattern"], out / f"{item['slug']}.png")
        json.dump(manifest, sys.stdout, indent=2)
        print()
    if not (args.garment or args.tee or args.personas or args.catalogue):
        p.error("choose --catalogue, --personas, --garment and/or --tee")


if __name__ == "__main__":
    main()
