"""Build seed garment media from openly licensed photos (sources.json + recipes.json).

For every recipe: crop, blur brand labels, paint out printed emblems, add a studio margin, then run the photo
through the real garment pipeline (AI gateway /v1/garment/assess: readiness checks + background removal) and
store the processed photo and its cut-out. Recolours are faithful colourways of the same photo; umushanana
images are procedural illustrations textured with fabric photos (no person-free umushanana photo exists).

Writes:
  apps/api/storage/seed/real/<key>-photo.jpg, <key>-cutout.png, index.json   (gitignored seed media)
  scripts/seed-assets/attribution.json                                       (committed credits)

  apps/ai/.venv/bin/python -I scripts/seed-assets/fetch.py      # once, downloads into .cache/ (gitignored)
  apps/ai/.venv/bin/python -I scripts/seed-assets/build.py [--out DIR] [--ai URL] [--only key1,key2]
"""
import argparse
import base64
import io
import json
import math
import os
import sys
from pathlib import Path

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = HERE / ".cache" / "originals"
STUDIO_BG = (244, 241, 236)
MAX_SIDE = 1100
CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/"


# ---------------------------------------------------------------- image helpers

def load_source(sid: str) -> Image.Image:
    files = sorted(CACHE.glob(f"{sid}.*"))
    if not files:
        raise SystemExit(f"missing {sid} in {CACHE}: run fetch.py first")
    with Image.open(files[0]) as probe:  # untrusted file: decode as an image only
        probe.verify()
    img = Image.open(files[0])
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def px_box(img: Image.Image, box) -> tuple[int, int, int, int]:
    w, h = img.size
    return (int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h))


def border_median(rgb: np.ndarray) -> np.ndarray:
    b = np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3), rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    return np.median(b, axis=0)


def blur_regions(img: Image.Image, boxes) -> Image.Image:
    for box in boxes:
        b = px_box(img, box)
        region = img.crop(b)
        r = max(6, int(max(img.size) * 0.02))
        region = region.filter(ImageFilter.GaussianBlur(r)).filter(ImageFilter.GaussianBlur(r))
        img.paste(region, b[:2])
    return img


def mask_regions(img: Image.Image, boxes) -> Image.Image:
    """Paint a printed emblem out with the fabric colour around it (soft-edged) plus a fine cloth grain."""
    rgb = np.asarray(img).astype(np.float32)
    for box in boxes:
        x0, y0, x1, y1 = px_box(img, box)
        pad = max(8, int(0.15 * max(x1 - x0, y1 - y0)))
        X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)
        ring = np.ones((Y1 - Y0, X1 - X0), bool)
        ring[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = False
        colour = np.median(rgb[Y0:Y1, X0:X1][ring], axis=0)
        fill = Image.new("RGB", img.size, tuple(int(c) for c in colour))
        m = Image.new("L", img.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((x0, y0, x1, y1), radius=pad, fill=255)
        m = m.filter(ImageFilter.GaussianBlur(pad / 2))
        grain = np.random.default_rng(7).normal(1.0, 0.025, (img.height, img.width))
        shaded = np.clip(np.asarray(fill).astype(np.float32) * grain[..., None], 0, 255)
        img = Image.composite(Image.fromarray(shaded.astype(np.uint8)), img, m)
        rgb = np.asarray(img).astype(np.float32)
    return img


def add_margin(img: Image.Image, frac: float) -> Image.Image:
    rgb = np.asarray(img)
    colour = tuple(int(c) for c in border_median(rgb))
    m = int(max(img.size) * frac)
    out = Image.new("RGB", (img.width + 2 * m, img.height + 2 * m), colour)
    out.paste(img, (m, m))
    return out


def studio_backdrop(img: Image.Image, tol: float, colour: str | None = None) -> Image.Image:
    """Even out a plain backdrop (wall, door, museum card) to studio grey: flood fill from the border through
    pixels close to the backdrop colour, feather the edge and composite the garment over a seamless backdrop."""
    small = img.copy()
    small.thumbnail((360, 360))
    rgb = np.asarray(small).astype(np.float32)
    near = np.abs(rgb - border_median(rgb)[None, None, :]).max(axis=-1) <= tol
    region = np.zeros_like(near)
    region[0, :], region[-1, :], region[:, 0], region[:, -1] = near[0, :], near[-1, :], near[:, 0], near[:, -1]
    for _ in range(2000):
        grown = region.copy()
        grown[1:] |= region[:-1]
        grown[:-1] |= region[1:]
        grown[:, 1:] |= region[:, :-1]
        grown[:, :-1] |= region[:, 1:]
        grown &= near
        if (grown == region).all():
            break
        region = grown
    m = Image.fromarray((~region).astype(np.uint8) * 255).resize(img.size, Image.BILINEAR)
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    bg = tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5)) if colour else STUDIO_BG
    return Image.composite(img, Image.new("RGB", img.size, bg), m)


def fit(img: Image.Image) -> Image.Image:
    s = MAX_SIDE / max(img.size)
    return img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS) if s < 1 else img


def garment_mask(img: Image.Image) -> np.ndarray:
    """Soft 0..1 mask of 'not background' (same idea as the gateway's cut-out), for recolours and prints."""
    rgb = np.asarray(img).astype(np.float32)
    dist = np.abs(rgb - border_median(rgb)[None, None, :]).max(axis=-1)
    m = np.clip((dist - 18) / 20, 0, 1)
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))) / 255.0


def recolour(img: Image.Image, spec: dict) -> Image.Image:
    m = garment_mask(img)[..., None]
    rgb = np.asarray(img).astype(np.float32)
    if "hue" in spec:
        hsv = np.asarray(img.convert("HSV")).copy()
        hsv[..., 0] = ((hsv[..., 0].astype(np.int32) + int(spec["hue"] / 360 * 256)) % 256).astype(np.uint8)
        new = np.asarray(Image.fromarray(hsv, "HSV").convert("RGB")).astype(np.float32)
    else:
        target = np.array([int(spec["tint"][i:i + 2], 16) for i in (1, 3, 5)], np.float32)
        lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
        ref = float(np.median(lum[m[..., 0] > 0.5])) if (m > 0.5).any() else 128.0
        new = np.clip(target[None, None, :] * (lum / max(ref, 1.0))[..., None], 0, 255)
    out = rgb * (1 - m) + new * m
    return Image.fromarray(out.astype(np.uint8))


def cover(tex: Image.Image, size) -> Image.Image:
    s = max(size[0] / tex.width, size[1] / tex.height)
    t = tex.resize((math.ceil(tex.width * s), math.ceil(tex.height * s)), Image.LANCZOS)
    return t.crop((0, 0, size[0], size[1]))


def tile(tex: Image.Image, size, width: int) -> Image.Image:
    """Repeat a fabric crop (scaled to `width` px wide, mirrored at seams) over `size`."""
    t = tex.resize((width, max(1, round(tex.height * width / tex.width))), Image.LANCZOS)
    pair = Image.new("RGB", (t.width * 2, t.height * 2))
    pair.paste(t, (0, 0))
    pair.paste(ImageOps.mirror(t), (t.width, 0))
    pair.paste(ImageOps.flip(t), (0, t.height))
    pair.paste(ImageOps.flip(ImageOps.mirror(t)), (t.width, t.height))
    out = Image.new("RGB", size)
    for y in range(0, size[1], pair.height):
        for x in range(0, size[0], pair.width):
            out.paste(pair, (x, y))
    return out


def drape(tex: Image.Image, freq: float = 26.0) -> Image.Image:
    """Soft vertical folds so a flat fabric crop reads as hanging cloth."""
    w, h = tex.size
    x = np.arange(w)[None, :]
    y = np.arange(h)[:, None]
    shade = 0.86 + 0.14 * np.sin(x / freq + y / 260.0) * np.sin(x / (freq * 2.7))
    rgb = np.asarray(tex).astype(np.float32) * shade[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def skirt(spec: dict) -> Image.Image:
    """Procedural knee-length A-line skirt (waistband + panels) textured with a fabric photo. An illustration."""
    w, h = 800, 1000
    cx = w // 2
    body = [(cx - 130, 250), (cx + 130, 250), (cx + 225, 800), (cx - 225, 800)]
    band = [(cx - 130, 250), (cx + 130, 250), (cx + 133, 292), (cx - 133, 292)]
    img = Image.new("RGB", (w, h), STUDIO_BG)
    src = load_source(spec["body"])
    tex = drape(tile(src.crop(px_box(src, spec["bodyCrop"])), (w, h), spec.get("bodyScale", 300)), 34.0)
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).polygon(body, fill=255)
    img.paste(tex, (0, 0), m.filter(ImageFilter.GaussianBlur(0.8)))
    d = ImageDraw.Draw(img)
    mean = tuple(int(c * 0.55) for c in np.asarray(tex.resize((32, 32))).reshape(-1, 3).mean(axis=0))
    d.polygon(band, fill=mean, outline=(60, 44, 36), width=3)
    d.polygon(body, outline=(60, 44, 36), width=3)
    return img


def umushanana(spec: dict) -> Image.Image:
    """Procedural umushanana (draped dress + shoulder sash) textured with fabric photos. An illustration."""
    w, h = 800, 1000
    cx = w // 2
    body = [(cx - 80, 170), (cx - 115, 240), (cx - 118, 470), (cx - 215, 890), (cx + 215, 890), (cx + 118, 470),
            (cx + 115, 240), (cx + 80, 170), (cx + 30, 200), (cx - 30, 200)]
    sash = [(cx + 58, 110), (cx + 138, 142), (cx - 66, 650), (cx - 150, 612)]
    img = Image.new("RGB", (w, h), STUDIO_BG)
    b_src = load_source(spec["body"])
    btex = drape(tile(b_src.crop(px_box(b_src, spec["bodyCrop"])), (w, h), spec.get("bodyScale", 360)))
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).polygon(body, fill=255)
    img.paste(btex, (0, 0), m.filter(ImageFilter.GaussianBlur(0.8)))
    s_src = load_source(spec["sash"])
    big = tile(s_src.crop(px_box(s_src, spec["sashCrop"])), (1400, 1400), spec.get("sashScale", 160))
    big = big.rotate(-21, resample=Image.BICUBIC)
    layer = big.crop((300, 200, 300 + w, 200 + h))
    sm = Image.new("L", (w, h), 0)
    ImageDraw.Draw(sm).polygon(sash, fill=255)
    img.paste(drape(layer, 40.0), (0, 0), sm.filter(ImageFilter.GaussianBlur(0.8)))
    stex = layer
    d = ImageDraw.Draw(img)
    d.polygon(body, outline=(60, 44, 36), width=3)
    d.polygon(sash, outline=(60, 44, 36), width=3)
    # sash knot at the hip
    d.ellipse((cx - 150, 596, cx - 96, 652), fill=tuple(int(c) for c in np.asarray(stex).reshape(-1, 3).mean(axis=0)), outline=(60, 44, 36), width=3)
    return img


def print_motif(base: Image.Image, spec: dict) -> Image.Image:
    src = load_source(spec["print"])
    motif = src.crop(px_box(src, spec["printCrop"])).convert("L")
    x0, y0, x1, y1 = px_box(base, spec["box"])
    motif = ImageOps.contain(motif, (x1 - x0, y1 - y0))
    stripes = (np.asarray(motif) > 140).astype(np.float32)
    full = np.zeros((base.height, base.width), np.float32)
    ox, oy = x0 + (x1 - x0 - motif.width) // 2, y0 + (y1 - y0 - motif.height) // 2
    full[oy:oy + motif.height, ox:ox + motif.width] = stripes
    full *= garment_mask(base)
    ink = np.array([int(spec["ink"][i:i + 2], 16) for i in (1, 3, 5)], np.float32)
    rgb = np.asarray(base).astype(np.float32)
    a = (full * 0.92)[..., None]
    return Image.fromarray((rgb * (1 - a) + ink * a).astype(np.uint8))


# ---------------------------------------------------------------- licences

def derived_licence(srcs: list[dict]) -> tuple[str, str, bool]:
    sa = [s for s in srcs if s["shareAlike"]]
    if sa:
        best = max(sa, key=lambda s: s["licence"])  # BY-SA 3.0 adaptations may use BY-SA 4.0
        return best["licence"], best["licenceUrl"], True
    by = [s for s in srcs if s["licence"].startswith("CC BY")]
    if by:
        best = max(by, key=lambda s: s["licence"])
        return best["licence"], best["licenceUrl"], False
    return "CC0 1.0", CC0_URL, False


def credit_line(entry: dict) -> str:
    parts = [f"\"{s['title']}\" by {s['author']}, {s['licence']}" for s in entry["sources"]]
    mod = f"; modified ({', '.join(entry['changes'])})" if entry["changes"] else ""
    return f"{'; '.join(parts)}, via Wikimedia Commons{mod}. This image: {entry['licence']}."


# ---------------------------------------------------------------- main

def assess(client: httpx.Client, ai: str, img: Image.Image, category: str) -> dict:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    r = client.post(f"{ai}/v1/garment/assess", json={"image_b64": base64.b64encode(buf.getvalue()).decode(), "category": category})
    r.raise_for_status()
    return r.json()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=str(ROOT / "apps/api/storage/seed/real"))
    p.add_argument("--ai", default=os.environ.get("AI_GATEWAY_URL", "http://localhost:8100"))
    p.add_argument("--only", default="")
    args = p.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sources = {s["id"]: s for s in json.loads((HERE / "sources.json").read_text())}
    recipes = json.loads((HERE / "recipes.json").read_text())["assets"]
    only = set(filter(None, args.only.split(",")))
    index_path = out / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() and only else {}
    attribution = []

    with httpx.Client(timeout=120) as client:
        for rc in recipes:
            kind = rc.get("kind", "photo")
            changes: list[str] = []
            if kind == "umushanana":
                sids = [rc["body"], rc["sash"]]
                changes = ["procedural illustration: umushanana silhouette textured with cropped fabric photos"]
            elif kind == "skirt":
                sids = [rc["body"]]
                changes = ["procedural illustration: A-line skirt silhouette textured with a cropped fabric photo"]
            elif kind == "print":
                sids = [rc["base"], rc["print"]]
                changes = ["imigongo motif printed on the garment (illustration)"]
            else:
                sids = [rc["source"]]
            if "crop" in rc or kind in ("umushanana", "print", "skirt"):
                changes.append("cropped")
            if rc.get("blur"):
                changes.append("brand label blurred")
            if rc.get("mask"):
                changes.append("printed emblem removed")
            if rc.get("pad"):
                changes.append("studio margin added")
            if kind in ("photo", "print") and rc.get("studio", 36):
                changes.append("backdrop evened to studio grey")
            changes.append("resized")
            if kind != "fabric":
                changes.append("background removed (cut-out)")
            srcs = [sources[s] for s in sids]
            lic, lic_url, sa = derived_licence(srcs)
            if lic == "CC0 1.0" and any(s["licence"] == "Public domain" for s in srcs):
                lic = "Public domain"
                lic_url = "https://creativecommons.org/publicdomain/mark/1.0/"
            variants = [(rc["key"], None)] + [(r["key"], r) for r in rc.get("recolours", [])]
            for key, rspec in variants:
                ch = changes + ([f"recoloured ({'hue rotated' if 'hue' in rspec else 'tinted'})"] if rspec else [])
                entry = {
                    "key": key,
                    "of": rc["key"] if rspec else None,
                    "sources": [{k: s[k] for k in ("id", "title", "author", "licence", "licenceUrl", "page")} for s in srcs],
                    "licence": lic, "licenceUrl": lic_url, "shareAlike": sa,
                    "changes": ch, "illustration": kind in ("umushanana", "print", "skirt"),
                }
                entry["credit"] = credit_line(entry)
                attribution.append(entry)
            if only and rc["key"] not in only:
                continue

            # --- build the base image
            if kind == "umushanana":
                base = umushanana(rc)
            elif kind == "skirt":
                base = skirt(rc)
            else:
                base = load_source(rc["base"] if kind == "print" else rc["source"])
                if "crop" in rc:
                    base = base.crop(px_box(base, rc["crop"]))
                if rc.get("blur"):
                    base = blur_regions(base, rc["blur"])
                if rc.get("mask"):
                    base = mask_regions(base, rc["mask"])
                if rc.get("pad"):
                    base = add_margin(base, rc["pad"])
                base = fit(base)
                if rc.get("studio", 36):
                    base = studio_backdrop(base, rc.get("studio", 36), rc.get("backdrop"))
                if kind == "print":
                    base = print_motif(base, rc)
            for key, rspec in variants:
                img = recolour(base, rspec) if rspec else base
                img.save(out / f"{key}-photo.jpg", quality=90)
                rec = {"photo": f"{key}-photo.jpg", "cutout": None, "category": rc["category"], "of": rc["key"] if rspec else None,
                       "colourName": rspec["name"] if rspec else None, "readiness": "NOT_SUPPORTED", "quality": None, "notes": [], "hex": None}
                if kind == "fabric":
                    px = np.asarray(img.resize((64, 64))).reshape(-1, 3).mean(axis=0)
                    rec.update(hex="#%02x%02x%02x" % tuple(int(v) for v in px), notes=["Fabric by the metre: no try-on."])
                else:
                    a = assess(client, args.ai, img, rc["category"])
                    (out / f"{key}-cutout.png").write_bytes(base64.b64decode(a["cutout_b64"]))
                    rec.update(cutout=f"{key}-cutout.png", readiness=a["readiness"], quality=a["quality_score"], notes=a["notes"],
                               hex=(a.get("dominant_colours") or ["#888888"])[0], checks=a.get("checks"))
                index[key] = rec
                print(f"{'✓' if rec['readiness'] == 'READY' else '·'} {key:22} {rec['readiness']:18} {rec['hex']} {'; '.join(rec['notes'])}")

    index_path.write_text(json.dumps(index, indent=1))
    (HERE / "attribution.json").write_text(json.dumps(attribution, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(index)} images → {out}; {len(attribution)} credits → scripts/seed-assets/attribution.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
