"""Build a synthetic Wave 0 migration bundle (no real persons or members).

Usage: apps/ai/.venv/bin/python scripts/migration/make-sample-wave.py OUT.json
"""
import base64
import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "ai" / "scripts"))
from make_seed_assets import garment  # noqa: E402
from PIL import Image  # noqa: E402

TMP = Path("/tmp") if len(sys.argv) < 3 else Path(sys.argv[2])
suffix = str(int(time.time()))[-4:]


def photo(kind, hexv, pattern):
    out = TMP / f"mig-{kind}-{hexv[1:]}-{pattern}.png"
    garment(kind, hexv, pattern, str(out))
    return base64.b64encode(out.read_bytes()).decode()


def bad_photo():
    buf = io.BytesIO()
    Image.new("RGB", (320, 240), (25, 22, 30)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


bundle = {
    "wave": f"Wave 0 · dry run {suffix}",
    "pages": [
        {
            "legacyUrl": f"https://old.nyambika.rw/shop/mukeshimana-{suffix}",
            "handle": f"mukeshimana-designs-{suffix}",
            "name": "Mukeshimana Designs",
            "memberType": "TAILOR",
            "ownerPhone": f"07887{suffix}1"[:10],
            "ownerName": "Mukeshimana Odette",
            "story": "Made-to-measure kitenge dresses from Gisozi since 2017. Bring your fabric or choose ours.",
            "district": "Gasabo",
            "sector": "Gisozi",
            "momoMerchant": f"07887{suffix}1"[:10],
            "products": [
                {
                    "legacyId": "OLD-101",
                    "title": "Gisozi wrap dress",
                    "description": "Wrap dress in wax print, sewn to your measurements.",
                    "category": "dress",
                    "priceRwf": 36000,
                    "madeToOrder": True,
                    "leadTimeDays": 3,
                    "occasions": ["wedding", "party"],
                    "styles": ["elegant"],
                    "fabric": "Cotton kitenge",
                    "colours": [
                        {"name": "Indigo", "hex": "#2B4EA2", "imageB64": photo("wrap-dress", "#2B4EA2", "diamonds")},
                        {"name": "Gold", "hex": "#D4A017", "imageB64": photo("wrap-dress", "#D4A017", "diamonds")},
                    ],
                },
                {
                    "legacyId": "OLD-102",
                    "title": "Office A-line",
                    "category": "dress",
                    "priceRwf": 30000,
                    "madeToOrder": True,
                    "leadTimeDays": 3,
                    "occasions": ["office"],
                    "colours": [{"name": "Black", "hex": "#222222", "imageB64": bad_photo()}],
                },
            ],
        },
        {
            "legacyUrl": f"/sellers/ubumwe-kitenge-{suffix}",
            "handle": f"ubumwe-kitenge-{suffix}",
            "name": "Ubumwe Kitenge Shop",
            "memberType": "SELLER",
            "ownerPhone": f"07887{suffix}2"[:10],
            "story": "Shirts",
            "district": "Nyarugenge",
            "sector": "Nyabugogo",
            "products": [
                {
                    "legacyId": "OLD-201",
                    "title": "Nyabugogo kitenge shirt",
                    "category": "shirt",
                    "priceRwf": 17000,
                    "occasions": ["casual", "office"],
                    "colours": [{"name": "Teal", "hex": "#1A8C8C", "stock": 8, "imageB64": photo("shirt", "#1A8C8C", "zigzag")}],
                }
            ],
        },
    ],
}

Path(sys.argv[1]).write_text(json.dumps(bundle))
print(f"wrote {sys.argv[1]} · {len(bundle['pages'])} pages · legacy URLs:", [p["legacyUrl"] for p in bundle["pages"]])
