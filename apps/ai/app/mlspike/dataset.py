"""Consented training-data manifests (R4 spike): provenance, withdrawal tombstones, versioning, screening.

A dataset version is an immutable manifest of items. Every item carries its provenance:
  item_id · source (synthetic | catalogue) · page_id · product_id · variant_id · licence ·
  consent_record_id · consented_at · captured_at · sha256 of the pixels · labels · screening result

Rules enforced here, by code, whatever the caller sends:
  * only maker-owned catalogue images or generated synthetic images can enter; anything that looks like
    shopper data (twins, looks, wardrobe, private storage, avatars, clips) is rejected with ShopperDataError;
  * an item without page, product, consent record, licence and timestamp is rejected ("missing provenance");
  * items covered by a withdrawal tombstone (a page, or one product of a page) never enter a later
    version, and the pixel hashes of withdrawn items are remembered so the same photo re-uploaded under
    another product is still excluded;
  * images that show a person are dropped by the PII screen before they enter.
The version hash is a content hash over the sorted (item_id, sha256, labels) triples, so two builds of the
same consented set are byte-identical and any change is visible as a new hash and a diff.
"""
from __future__ import annotations

import hashlib
import re
import json
from datetime import datetime, timezone
from typing import Callable, Iterable

from PIL import Image

from .screen import SCREEN_VERSION, screen

ALLOWED_SOURCES = ("synthetic", "catalogue")
SYNTHETIC_LICENCE = "CC0-1.0 (synthetic, generated in-house)"
CATALOGUE_LICENCE = "Nyambika training-contribution consent v1 (revocable; no redistribution)"
# Storage prefixes / kinds that hold shopper data. Never valid as training input.
SHOPPER_MARKERS = ("private", "twin", "twins", "previews", "look", "looks", "wardrobe", "avatar", "avatars", "poll", "polls",
                   "custom", "orders", "motion", "partner", "video", "clip", "clips", "measurement", "measurements", "persona", "personas")
REQUIRED = ("item_id", "page_id", "product_id", "consent_record_id", "licence", "consented_at")


class ShopperDataError(ValueError):
    """Raised when shopper data (or anything that is not maker catalogue / synthetic) reaches the builder."""


def sha256_image(img: Image.Image) -> str:
    im = img.convert("RGB")
    return hashlib.sha256(im.tobytes() + f"{im.size}".encode()).hexdigest()


def assert_trainable(item: dict) -> None:
    src = item.get("source")
    if src not in ALLOWED_SOURCES:
        raise ShopperDataError(f"{item.get('item_id')}: source {src!r} is not trainable (only {ALLOWED_SOURCES})")
    ref = str(item.get("image_ref") or "").lower()
    if src == "catalogue" and (not ref.startswith("public/media/") and not ref.startswith("seed/")):
        raise ShopperDataError(f"{item.get('item_id')}: catalogue images must come from public catalogue media, got {ref!r}")
    # Token match on path segments / filename words (ids are random, substring matching would misfire).
    tokens = set(re.split(r"[/._:-]+", ref))
    if tokens & set(SHOPPER_MARKERS):
        raise ShopperDataError(f"{item.get('item_id')}: {ref!r} looks like shopper data")


def _ts(v) -> datetime | None:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def tombstoned(item: dict, tombstones: Iterable[dict]) -> dict | None:
    """The tombstone covering this item, if any. A tombstone with `at` covers contributions consented
    at or before that moment; a later re-consent covers only new contributions (old pixels stay out
    through the withdrawn-hash list)."""
    for t in tombstones:
        if t.get("page_id") != item.get("page_id"):
            continue
        at, consented = _ts(t.get("at")), _ts(item.get("consented_at"))
        if at and consented and consented > at:
            continue
        if not t.get("product_id") or t.get("product_id") == item.get("product_id"):
            return t
    return None


def content_hash(items: list[dict]) -> str:
    rows = sorted((i["item_id"], i["sha256"], json.dumps(i.get("labels", {}), sort_keys=True)) for i in items)
    return hashlib.sha256(json.dumps(rows).encode()).hexdigest()


def build_version(candidates: list[dict], load_image: Callable[[dict], Image.Image], *, tombstones: list[dict] | None = None,
                  previous: dict | None = None, now: datetime | None = None, run_screen: bool = True) -> dict:
    """Build the next manifest. `load_image(item)` returns the pixels (regenerated for synthetic items)."""
    tombstones = list(tombstones or [])
    prev_items = {i["item_id"] for i in (previous or {}).get("items", [])}
    withdrawn_hashes = set((previous or {}).get("withdrawn_hashes", []))
    items: list[dict] = []
    dropped: list[dict] = []
    removed_by_withdrawal: list[str] = []
    seen_hashes: set[str] = set()
    # Pass 1: validate, hash, and collect every withdrawn image first, so the same pixels under another
    # product or page are excluded regardless of candidate order.
    staged: list[tuple[dict, Image.Image, str]] = []
    for c in candidates:
        assert_trainable(c)  # hard error: shopper data must never be silently "dropped" and forgotten
        missing = [k for k in REQUIRED if not c.get(k)]
        if missing:
            dropped.append({"item_id": c.get("item_id"), "reason": "missing provenance: " + ", ".join(missing)})
            continue
        img = load_image(c)
        digest = sha256_image(img)
        t = tombstoned(c, tombstones)
        if t:
            withdrawn_hashes.add(digest)
            removed_by_withdrawal.append(c["item_id"])
            dropped.append({"item_id": c["item_id"], "reason": "withdrawn", "tombstone": t.get("id")})
            continue
        staged.append((c, img, digest))
    for c, img, digest in staged:
        if digest in withdrawn_hashes:
            removed_by_withdrawal.append(c["item_id"])
            dropped.append({"item_id": c["item_id"], "reason": "withdrawn image re-submitted"})
            continue
        if digest in seen_hashes:
            dropped.append({"item_id": c["item_id"], "reason": "duplicate image"})
            continue
        sc = screen(img) if run_screen else {"has_person": False, "score": 0.0, "reasons": [], "version": "skipped"}
        if sc["has_person"]:
            dropped.append({"item_id": c["item_id"], "reason": "person detected (PII screen)", "screen": sc})
            continue
        seen_hashes.add(digest)
        items.append({**{k: c.get(k) for k in ("item_id", "source", "page_id", "product_id", "variant_id", "licence",
                                                "consent_record_id", "consented_at", "image_ref", "seed", "gen")},
                      "captured_at": c.get("captured_at") or c.get("consented_at"), "sha256": digest,
                      "labels": c.get("labels", {}), "screen": {"score": sc["score"], "version": sc["version"]}})
    items.sort(key=lambda i: i["item_id"])
    h = content_hash(items)
    ids = {i["item_id"] for i in items}
    version = int((previous or {}).get("version", 0)) + 1
    return {
        "version": version,
        "hash": h,
        "parent_hash": (previous or {}).get("hash"),
        "created_at": (now or datetime.now(timezone.utc)).isoformat(),
        "screen_version": SCREEN_VERSION,
        "items": items,
        "dropped": dropped,
        "withdrawn_hashes": sorted(withdrawn_hashes),
        "tombstones": [t.get("id") for t in tombstones],
        "diff": {"added": sorted(ids - prev_items), "removed": sorted(prev_items - ids), "removed_by_withdrawal": sorted(set(removed_by_withdrawal) & prev_items)},
        "stats": stats(items, dropped),
    }


def stats(items: list[dict], dropped: list[dict] | None = None) -> dict:
    def count(key):
        out: dict[str, int] = {}
        for i in items:
            v = i.get("labels", {}).get(key) or "unknown"
            out[v] = out.get(v, 0) + 1
        return dict(sorted(out.items()))

    by_source: dict[str, int] = {}
    pages: set[str] = set()
    for i in items:
        by_source[i["source"]] = by_source.get(i["source"], 0) + 1
        pages.add(i["page_id"])
    reasons: dict[str, int] = {}
    for d in dropped or []:
        key = d["reason"].split(":")[0]
        reasons[key] = reasons.get(key, 0) + 1
    return {"items": len(items), "pages": len(pages), "by_source": by_source, "category": count("category"),
            "pattern": count("pattern"), "colour": count("colour"), "quality": count("quality"), "dropped": reasons}


def synthetic_candidates(specs: list[dict], contributors: list[dict], consented_at: str) -> list[dict]:
    """Attribute synthetic specs round-robin to synthetic contributor pages (seeded makers that opted in),
    so withdrawal and provenance work exactly as for catalogue items."""
    out = []
    for n, s in enumerate(specs):
        c = contributors[n % len(contributors)]
        out.append({"item_id": f"syn-{s['seed']}", "source": "synthetic", "page_id": c["page_id"],
                    "product_id": f"syn-product-{c['page_id'][-6:]}-{n // len(contributors) % 12}", "variant_id": None,
                    "licence": SYNTHETIC_LICENCE, "consent_record_id": c["consent_record_id"], "consented_at": c.get("consented_at") or consented_at,
                    "image_ref": f"synthetic://{s['seed']}", "seed": s["seed"], "gen": s.get("gen", 1), "labels": s["labels"]})
    return out
