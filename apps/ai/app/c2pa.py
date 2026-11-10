"""C2PA-style content credentials (AI-TR-01).

c2patool is not available offline, so we build a C2PA-shaped manifest, bind it to
the pixels with a SHA-256 hash, sign it with HMAC-SHA256 (dev key; KMS in prod)
and embed {manifest, signature} in a PNG iTXt chunk named "c2pa".
"""
import hashlib
import hmac
import io
import json
from datetime import datetime, timezone

from PIL import Image, PngImagePlugin

from . import config

CLAIM_GENERATOR = "Nyambika AI Gateway/0.1"
TRAINED_ALGORITHMIC = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"


def pixel_hash(img: Image.Image) -> str:
    rgb = img.convert("RGB")
    h = hashlib.sha256(f"{rgb.width}x{rgb.height}:RGB:".encode())
    h.update(rgb.tobytes())
    return h.hexdigest()


def _canonical(manifest: dict) -> bytes:
    return json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()


def sign(img: Image.Image, model_version: str, request_id: str) -> tuple[bytes, dict]:
    """Return (png_bytes_with_manifest, {manifest, signature, sha256})."""
    digest = pixel_hash(img)
    manifest = {
        "claim_generator": CLAIM_GENERATOR,
        "title": f"look-{request_id}.png",
        "format": "image/png",
        "assertions": [
            {"label": "c2pa.actions", "data": {"actions": [
                {"action": "c2pa.created", "digitalSourceType": TRAINED_ALGORITHMIC,
                 "softwareAgent": model_version}]}},
            {"label": "nyambika.generation", "data": {"model_version": model_version, "request_id": request_id}},
            {"label": "c2pa.hash.data", "data": {"alg": "sha256", "hash": digest, "scope": "pixels-rgb"}},
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    signature = hmac.new(config.C2PA_SIGNING_KEY, _canonical(manifest), hashlib.sha256).hexdigest()
    info = PngImagePlugin.PngInfo()
    info.add_itxt("c2pa", json.dumps({"manifest": manifest, "signature": signature, "alg": "HS256"}))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG", pnginfo=info)
    return buf.getvalue(), {"manifest": manifest, "signature": signature, "sha256": digest}


def verify(png: bytes) -> bool:
    img = Image.open(io.BytesIO(png))
    img.load()
    raw = img.info.get("c2pa")
    if not raw:
        return False
    payload = json.loads(raw)
    manifest = payload["manifest"]
    expected = hmac.new(config.C2PA_SIGNING_KEY, _canonical(manifest), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload["signature"]):
        return False
    hash_assertion = next(a for a in manifest["assertions"] if a["label"] == "c2pa.hash.data")
    return hash_assertion["data"]["hash"] == pixel_hash(img)
