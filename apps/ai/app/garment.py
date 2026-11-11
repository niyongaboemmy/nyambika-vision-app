"""Garment photo readiness checks and background removal (FR-CAT-03/04/05)."""
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


def assess(img: Image.Image, category: str | None = None) -> dict:
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[:2]
    notes: list[str] = []
    checks: dict[str, bool] = {}

    checks["resolution"] = min(w, h) >= MIN_SHORT_SIDE
    if not checks["resolution"]:
        notes.append(f"Photo is too small ({w}x{h}); use at least {MIN_SHORT_SIDE}px on the short side.")

    lum = luminance(rgb.astype(np.float32))
    mean_lum = float(lum.mean())
    clipped = float(((lum < 8) | (lum > 250)).mean())
    checks["exposure"] = bool(60 <= mean_lum <= 240 and clipped < 0.35)
    if not checks["exposure"]:
        notes.append("Lighting is too dark or too bright; shoot in soft daylight.")

    _, spread = background_stats(rgb)
    checks["background"] = bool(spread < 18)
    if not checks["background"]:
        notes.append("Background is busy; place the garment on a plain wall or sheet.")

    cut = cutout(img)
    alpha = np.asarray(cut)[..., 3] > 127
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
    }
