"""Garment photo readiness checks, background removal and category mapping (FR-CAT-03/04/05)."""
import re

import numpy as np
from PIL import Image, ImageFilter

from .embed import embed_image
from .imaging import (
    background_stats,
    bbox,
    border_connected,
    colour_distance,
    downsample_mask,
    luminance,
)

UNSUPPORTED_CATEGORIES = {"shoes", "bag", "bags", "jewellery", "accessories", "hat"}
MIN_SHORT_SIDE = 400

# ---- Category mapping -------------------------------------------------------------------------------------
# Catalogue categories are free text (RW/EN/FR). The compositor and guard work with three classes.
# The head noun wins ("dress shirt" -> top, "shirt dress" -> dress); fabric/style words (kitenge, wrap, ...)
# say nothing about the cut, so those and unknown words are guessed from the cut-out's shape.
CLASS_WORDS = {
    "dress": {"dress", "gown", "umushanana", "mushanana", "bridal", "kaftan", "caftan", "abaya", "boubou",
              "kanzu", "ikanzu", "frock", "sundress", "shirtdress", "jumpsuit", "robe", "maxi"},
    "skirt": {"skirt", "jupe", "ijipo", "sarong", "pagne", "midi", "mini"},
    "top": {"shirt", "tshirt", "tee", "polo", "top", "blouse", "jacket", "blazer", "cardigan", "sweater",
            "jumper", "hoodie", "sweatshirt", "tunic", "vest", "tank", "camisole", "cami", "dashiki", "henley",
            "jersey", "coat", "kimono", "chemise", "chemisier", "haut", "veste", "ishati", "ishaati", "crop"},
}
AMBIGUOUS_WORDS = {"kitenge", "chitenge", "igitenge", "wrap", "wax", "ankara", "kikoi", "other", "garment",
                   "clothing", "outfit", "set", "umwenda", "piece"}
GARMENT_CLASSES = ("top", "skirt", "dress")


def _tokens(text: str) -> list[str]:
    t = re.sub(r"\bt[\s_-]?shirts?\b", "tshirt", text.lower())
    out = []
    for w in re.findall(r"[a-z]+", t):
        for c in (w, w[:-1] if w.endswith("s") else None, w[:-2] if w.endswith("es") else None):
            if c and (c in AMBIGUOUS_WORDS or any(c in v for v in CLASS_WORDS.values())):
                out.append(c)
                break
        else:
            out.append(w)
    return out


def canonical_category(category: str | None) -> str | None:
    """Map a catalogue category to "top" | "skirt" | "dress", or None when the words don't say."""
    if not category:
        return None
    if category.lower() in GARMENT_CLASSES:
        return category.lower()
    found = None
    for tok in _tokens(category):
        for cls, words in CLASS_WORDS.items():
            if tok in words:
                found = cls  # last garment noun wins (English head-final compounds)
    return found


def _row_widths(alpha: np.ndarray) -> np.ndarray:
    m = alpha > 127
    left = np.where(m.any(axis=1), np.argmax(m, axis=1), 0)
    right = np.where(m.any(axis=1), m.shape[1] - np.argmax(m[:, ::-1], axis=1), 0)
    return (right - left).astype(np.float32)


def shape_profile(cut: Image.Image) -> dict:
    """Silhouette measurements of a cut-out (cropped to its alpha box): aspect, shoulder, body and hem widths."""
    a = np.asarray(cut.convert("RGBA"))[..., 3]
    box = bbox(a > 127)
    if box is None:
        return {"aspect": 1.0, "top_w": 1.0, "mid_w": 1.0, "bot_w": 1.0, "max_w": 1.0, "sleeve_end": 0.0}
    a = a[box[1]:box[3], box[0]:box[2]]
    w = _row_widths(a)
    h = len(w)
    band = lambda f0, f1: float(np.median(w[int(f0 * h): max(int(f0 * h) + 1, int(f1 * h))]))  # noqa: E731
    top_w, mid_w, bot_w = band(0.08, 0.30), band(0.45, 0.62), band(0.86, 0.96)
    # Sleeve end: last row in the top half that is clearly wider than the body below it.
    body_w = band(0.45, 0.62)
    wide = np.flatnonzero(w[: h // 2] > 1.25 * body_w)
    return {"aspect": h / max(1, a.shape[1]), "top_w": top_w, "mid_w": mid_w, "bot_w": bot_w,
            "max_w": float(w.max()), "sleeve_end": float(wide[-1] / h) if len(wide) else 0.0}


def guess_category(cut: Image.Image) -> str:
    """Garment class from the silhouette alone: flare, sleeves and length."""
    p = shape_profile(cut)
    flare = p["bot_w"] / max(1.0, p["mid_w"])
    sleeves = p["top_w"] / max(1.0, p["mid_w"])
    # Skirt: narrowest at the waistband and widening all the way down, no sleeves, not long.
    if p["aspect"] < 1.6 and sleeves < 0.92 and p["bot_w"] >= 1.3 * p["top_w"]:
        return "skirt"
    if flare >= 1.35 or p["aspect"] >= 1.8:
        return "dress"
    return "top"


def resolve_category(category: str | None, cut: Image.Image | None = None) -> tuple[str, str]:
    """(class, source): source is "catalogue" when the words decided, "shape" when the cut-out did."""
    cls = canonical_category(category)
    if cls:
        return cls, "catalogue"
    if cut is not None:
        return guess_category(cut), "shape"
    return "dress", "default"


def cutout(img: Image.Image) -> Image.Image:
    """Remove a uniform studio background: border flood fill + soft threshold + feather."""
    rgb = np.asarray(img.convert("RGB"))
    bg, spread = background_stats(rgb)
    t0 = max(12.0, 2 * spread + 6)
    t1 = t0 + 22
    dist = colour_distance(rgb, bg)
    small, _ = downsample_mask(dist <= t1, 400)
    region = border_connected(small)
    region = np.asarray(
        Image.fromarray(region.astype(np.uint8) * 255).resize((rgb.shape[1], rgb.shape[0]), Image.BILINEAR)
    ) > 127
    soft = np.clip((dist - t0) / (t1 - t0), 0, 1)
    alpha = np.where(region, soft, 1.0)
    alpha_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = img.convert("RGB").convert("RGBA")
    out.putalpha(alpha_img)
    return out


# Exposure is judged on clipping, histogram spread and detail inside the garment, never on mean brightness:
# a dark fabric on a white sheet is a correctly exposed photo. Thresholds calibrated on the seeded garments,
# the procedural tees (dark/brown/mid/light) and synthetic under/over-exposed versions of them (tests).
EXPO_MIN_HIGHLIGHT = 100   # p99 luminance: a lit scene always has something bright (sheet, wall, highlight)
EXPO_MAX_CLIPPED = 0.35    # share of garment pixels crushed to black or blown to white
EXPO_MIN_SPREAD = 40       # p98 - p2 of the whole frame
EXPO_MIN_DETAIL = 0.5      # mean |lum - blur(lum)| inside a very dark / very bright garment


def exposure_stats(rgb: np.ndarray, garment_mask: np.ndarray | None = None) -> dict:
    lum = luminance(rgb.astype(np.float32))
    g = garment_mask if garment_mask is not None and garment_mask.sum() > 500 else None
    if g is not None:
        ge = np.asarray(Image.fromarray(g.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(9))) > 127
        g = ge if ge.sum() > 500 else g
    gl = lum[g] if g is not None else lum.ravel()
    blur = np.asarray(Image.fromarray(np.clip(lum, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)),
                      dtype=np.float32)
    detail = float(np.abs(lum - blur)[g].mean()) if g is not None else float(np.abs(lum - blur).mean())
    p2, p98, p99 = (float(v) for v in np.percentile(lum, [2, 98, 99]))
    stats = {
        "highlight": round(p99, 1), "spread": round(p98 - p2, 1), "garment_median": round(float(np.median(gl)), 1),
        "clipped_dark": round(float((gl <= 6).mean()), 3), "clipped_bright": round(float((gl >= 250).mean()), 3),
        "detail": round(detail, 2),
    }
    if p99 < EXPO_MIN_HIGHLIGHT or stats["clipped_dark"] > EXPO_MAX_CLIPPED or (
            stats["garment_median"] < 35 and detail < EXPO_MIN_DETAIL):
        verdict = "under"
    elif stats["clipped_bright"] > EXPO_MAX_CLIPPED or (stats["garment_median"] > 230 and detail < EXPO_MIN_DETAIL):
        verdict = "over"
    elif stats["spread"] < EXPO_MIN_SPREAD:
        verdict = "flat"
    else:
        verdict = "ok"
    return {**stats, "verdict": verdict}


def assess(img: Image.Image, category: str | None = None) -> dict:
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[:2]
    notes: list[str] = []
    checks: dict[str, bool] = {}

    checks["resolution"] = min(w, h) >= MIN_SHORT_SIDE
    if not checks["resolution"]:
        notes.append(f"Photo is too small ({w}x{h}); use at least {MIN_SHORT_SIDE}px on the short side.")

    cut = cutout(img)
    alpha = np.asarray(cut)[..., 3] > 127

    exposure = exposure_stats(rgb, alpha)
    checks["exposure"] = exposure["verdict"] == "ok"
    if exposure["verdict"] == "under":
        notes.append("Photo is too dark; shoot in soft daylight or turn on more light.")
    elif exposure["verdict"] == "over":
        notes.append("Photo is overexposed; the fabric detail is washed out. Avoid direct sun or flash.")
    elif exposure["verdict"] == "flat":
        notes.append("Photo looks washed out (low contrast); shoot in soft daylight.")

    _, spread = background_stats(rgb)
    checks["background"] = bool(spread < 18)
    if not checks["background"]:
        notes.append("Background is busy; place the garment on a plain wall or sheet.")
    coverage = float(alpha.mean())
    edge = np.concatenate([alpha[:3].ravel(), alpha[-3:].ravel(), alpha[:, :3].ravel(), alpha[:, -3:].ravel()])
    checks["in_frame"] = bool(edge.mean() < 0.02 and 0.08 <= coverage <= 0.9)
    if not checks["in_frame"]:
        notes.append("Show the whole garment with some space around it.")

    if category and category.lower() in UNSUPPORTED_CATEGORIES:
        readiness = "NOT_SUPPORTED"
        notes.append(f"Try-on does not support '{category}' yet.")
    elif all(checks.values()):
        readiness = "READY"
    else:
        readiness = "NEEDS_BETTER_PHOTO"

    box = bbox(alpha)
    if box:
        cut = cut.crop(box)
    tryon_class, class_source = resolve_category(category, cut if box else None)
    embedding, colours = embed_image(cut)
    return {
        "readiness": readiness,
        "quality_score": round(sum(checks.values()) / len(checks), 3),
        "checks": checks,
        "notes": notes,
        "cutout": cut,
        "width": w,
        "height": h,
        "dominant_colours": colours,
        "embedding": embedding,
        "exposure": exposure,
        "tryon_class": tryon_class,
        "tryon_class_source": class_source,
    }
