"""Download the seed garment and swatch photos listed in sources.json into a gitignored cache.

Wikimedia Commons robot policy: a descriptive User-Agent with a contact URL, one request at a time, a pause
between requests, and resized thumbnails (960 px) rather than multi-megabyte originals. Files already in the
cache are never fetched again. Downloaded files are untrusted data: they are only ever decoded as images.

  apps/ai/.venv/bin/python -I scripts/seed-assets/fetch.py            # all items
  apps/ai/.venv/bin/python -I scripts/seed-assets/fetch.py g07 g19    # selected ids
"""
import hashlib
import json
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "originals"
UA = "NyambikaVisionSeedAssets/1.0 (https://github.com/niyongaboemmy/nyambika-vision-app; seed-data pipeline) httpx"
THUMB_W = 960


def source_url(item: dict) -> str:
    w = int(item["size"].split("x")[0]) if item.get("size") else 99999
    return item["file"] if w <= THUMB_W else item["thumb"]


def main(ids: list[str]) -> int:
    items = json.loads((HERE / "sources.json").read_text())
    CACHE.mkdir(parents=True, exist_ok=True)
    todo = [it for it in items if not ids or it["id"] in ids]
    failed = 0
    with httpx.Client(headers={"User-Agent": UA}, timeout=60, follow_redirects=True) as client:
        for it in todo:
            ext = Path(source_url(it)).suffix.lower() or ".jpg"
            out = CACHE / f"{it['id']}{ext}"
            if out.exists() and out.stat().st_size > 0:
                continue
            url = source_url(it)
            r = None
            for attempt in range(5):
                try:
                    r = client.get(url)
                except httpx.TransportError:
                    r = None
                if r is None or r.status_code == 429 or r.status_code >= 500:
                    time.sleep(5 * (attempt + 1))
                    continue
                break
            if r is None or r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
                print(f"✗ {it["id"]} {r.status_code if r else "network"} {url}", file=sys.stderr)
                failed += 1
                continue
            out.write_bytes(r.content)
            print(f"✓ {it['id']} {len(r.content) // 1024} KB sha256:{hashlib.sha256(r.content).hexdigest()[:12]}")
            time.sleep(1.5)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
