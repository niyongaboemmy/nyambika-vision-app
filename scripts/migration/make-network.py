"""Build a synthetic full legacy network (E21) for the network wave runner. No real persons or members.

Usage: apps/ai/.venv/bin/python scripts/migration/make-network.py OUT.json [PAGES=200] [TMPDIR]

The mix is deliberately messy so the dashboard has something to show: ~70% clean pages with photos,
some unreachable photos, dark photos, pages without products, missing MoMo numbers, short stories,
two duplicate handles and one invalid record (these fail the import on purpose).
Photos come from a small library and are reused (base64), so 200 pages stay around 6 MB.
"""
import base64
import io
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "ai" / "scripts"))
from make_seed_assets import garment  # noqa: E402
from PIL import Image  # noqa: E402

OUT = Path(sys.argv[1])
N = int(sys.argv[2]) if len(sys.argv) > 2 else 200
TMP = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("/tmp")
rng = random.Random(21)
suffix = str(int(time.time()))[-5:]

KIND = {"a-line-dress": "dress", "wrap-dress": "dress", "umushanana": "umushanana", "shirt": "shirt", "skirt": "skirt"}
COLOURS = [("Indigo", "#2B4EA2"), ("Gold", "#D4A017"), ("Crimson", "#B3261E"), ("Teal", "#1A8C8C"), ("Forest", "#1F7A4D"), ("Terracotta", "#C45A2C")]
PATTERNS = ["circles", "crosses", "diamonds", "zigzag", "waves"]
DISTRICTS = [("Gasabo", "Kimironko"), ("Nyarugenge", "Nyamirambo"), ("Kicukiro", "Kagarama"), ("Musanze", "Muhoza"), ("Huye", "Ngoma"), ("Rubavu", "Gisenyi")]
FIRST = ["Mukeshimana", "Uwase", "Ingabire", "Niyonsaba", "Mutoni", "Uwimana", "Iradukunda", "Habimana", "Nshimiyimana", "Umutoni", "Kayitesi", "Mugisha"]
WORD = ["Designs", "Couture", "Kitenge", "Threads", "Atelier", "Styles", "Fashion House", "Sewing Coop", "Boutique"]
TITLES = {"dress": ["wrap dress", "A-line dress", "party dress", "office dress"], "umushanana": ["umushanana", "ceremony umushanana"],
          "shirt": ["kitenge shirt", "office shirt"], "skirt": ["pencil skirt", "flare skirt"]}

library = []
for i, kind in enumerate(KIND):
    for j in range(2):
        name, hexv = COLOURS[(i * 2 + j) % len(COLOURS)]
        pat = PATTERNS[(i + j) % len(PATTERNS)]
        out = TMP / f"net-{kind}-{hexv[1:]}-{pat}.png"
        garment(kind, hexv, pat, str(out))
        library.append({"kind": kind, "name": name, "hex": hexv, "b64": base64.b64encode(out.read_bytes()).decode()})

buf = io.BytesIO()
Image.new("RGB", (320, 240), (25, 22, 30)).save(buf, "PNG")
DARK = base64.b64encode(buf.getvalue()).decode()

pages = []
for i in range(N):
    first = FIRST[i % len(FIRST)]
    word = WORD[(i // len(FIRST)) % len(WORD)]
    member = "COOPERATIVE" if "Coop" in word else rng.choice(["TAILOR", "TAILOR", "SELLER"])
    handle = f"{first.lower()}-{word.lower().replace(' ', '-')}-{suffix}-{i:03d}"
    district, sector = DISTRICTS[i % len(DISTRICTS)]
    phone = f"0786{suffix[-2:]}{i:04d}"
    roll = rng.random()
    products = []
    if roll > 0.05:
        for p in range(rng.choice([1, 1, 2])):
            lib = library[(i + p) % len(library)]
            cat = KIND[lib["kind"]]
            colour = {"name": lib["name"], "hex": lib["hex"], "sizes": ["S", "M", "L", "XL"], "stock": rng.choice([0, 3, 8])}
            if roll < 0.18:
                colour["imageUrl"] = "http://127.0.0.1:9/legacy-photo.jpg"  # unreachable legacy CDN
            elif roll < 0.23:
                colour["imageB64"] = DARK
            else:
                colour["imageB64"] = lib["b64"]
            products.append({
                "legacyId": f"OLD-{i:03d}-{p}",
                "title": f"{sector} {rng.choice(TITLES[cat])}",
                "description": f"Sewn in {sector} by {first}.",
                "category": cat,
                "priceRwf": rng.choice([12000, 15000, 18000, 24000, 30000, 36000, 45000]),
                "madeToOrder": member != "SELLER",
                "leadTimeDays": 0 if member == "SELLER" else rng.choice([2, 3, 5]),
                "occasions": rng.sample(["wedding", "office", "church", "party", "casual"], 2),
                "styles": ["elegant"] if cat == "dress" else ["classic"],
                "fabric": "Cotton kitenge",
                "colours": [colour],
            })
    pages.append({
        "legacyUrl": f"https://old.nyambika.rw/shop/{handle}",
        "handle": handle,
        "name": f"{first} {word}",
        "memberType": member,
        "ownerPhone": phone,
        "ownerName": f"{first} (synthetic)",
        "story": "Shop" if rng.random() < 0.25 else f"{first} {word} has sewn kitenge and umushanana in {sector} for years. Bring your fabric or choose ours.",
        "district": district,
        "sector": sector,
        "momoMerchant": "" if rng.random() < 0.3 else phone,
        "products": products,
    })

# Deliberate failures: two duplicate handles and one invalid record.
pages.append(dict(pages[0], legacyUrl=pages[0]["legacyUrl"] + "-dup"))
pages.append(dict(pages[1], legacyUrl=pages[1]["legacyUrl"] + "-dup"))
pages.append({"legacyUrl": f"https://old.nyambika.rw/shop/BROKEN-{suffix}", "handle": f"Broken Handle {suffix}", "name": "X", "memberType": "TAILOR", "ownerPhone": "07"})

bundle = {"wave": f"Network wave · {len(pages)} pages · {suffix}", "pages": pages}
OUT.write_text(json.dumps(bundle))
print(f"wrote {OUT} · {len(pages)} pages · {OUT.stat().st_size / 1e6:.1f} MB · first legacy URL {pages[0]['legacyUrl']}")
