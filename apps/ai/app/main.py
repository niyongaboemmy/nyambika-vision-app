"""Nyambika AI Gateway: garment readiness, twin checks, try-on + guard + C2PA, embeddings, Muse intent."""
import base64
import time
import uuid
from typing import Literal

from fastapi import FastAPI, HTTPException
from PIL import Image, ImageDraw
from pydantic import BaseModel, Field

from . import c2pa, config, garment, guard, intent, listing, twin
from .embed import embed_image
from .imaging import decode_b64, encode_png_b64
from .providers import get_provider, registry

app = FastAPI(title="Nyambika AI Gateway", version="0.1.0")


class ImageIn(BaseModel):
    image_b64: str


class GarmentIn(ImageIn):
    category: str | None = None


class TryOnIn(BaseModel):
    twin_b64: str
    garment_b64: str
    garment_category: str = "dress"
    tier: Literal["PREVIEW", "HD"] = "PREVIEW"
    request_id: str = Field(default_factory=lambda: uuid.uuid4().hex)


class IntentIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    locale: Literal["rw", "en", "fr"] | None = None
    source: Literal["text", "voice"] = "text"


def _image(data: str) -> Image.Image:
    try:
        return decode_b64(data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Invalid image: {exc}") from exc


@app.get("/health")
def health():
    return {"status": "ok", "models": [m["id"] for m in registry()]}


@app.get("/v1/models")
def models():
    return registry()


@app.post("/v1/garment/assess")
def garment_assess(body: GarmentIn):
    result = garment.assess(_image(body.image_b64), body.category)
    result["cutout_b64"] = encode_png_b64(result.pop("cutout"))
    return result


@app.post("/v1/twin/check")
def twin_check(body: ImageIn):
    return twin.check(_image(body.image_b64))


def _label(img: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Visible AI label, bottom-left (AI-TR-02)."""
    img = img.convert("RGBA")
    scale = img.height / 512
    w, h = int(78 * scale), int(18 * scale)
    x0, y0 = int(8 * scale), img.height - h - int(8 * scale)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle((x0, y0, x0 + w, y0 + h), radius=int(6 * scale), fill=(0, 0, 0, 140))
    d.text((x0 + int(7 * scale), y0 + int(3 * scale)), "AI preview", fill=(255, 255, 255, 230),
           font_size=max(10, int(11 * scale)))
    return Image.alpha_composite(img, overlay).convert("RGB"), (x0, y0, x0 + w, y0 + h)


@app.post("/v1/tryon")
def tryon(body: TryOnIn):
    started = time.perf_counter()
    provider = get_provider(config.VTON_PROVIDER)
    garment_img = _image(body.garment_b64).convert("RGBA")
    try:
        result = provider.generate(_image(body.twin_b64), garment_img, body.garment_category, body.tier)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    labelled, label_box = _label(result.image)
    verdict = guard.evaluate(result.twin_resized, labelled, garment_img, result.garment_alpha,
                             result.subject_box, exclude_box=label_box)
    latency = int((time.perf_counter() - started) * 1000)
    if not verdict["passed"]:
        return {"status": "WITHHELD", "image_b64": None, "guard": verdict, "c2pa": None,
                "model_version": result.model_version, "latency_ms": latency}
    png, credentials = c2pa.sign(labelled, result.model_version, body.request_id)
    return {
        "status": "DELIVERED",
        "image_b64": base64.b64encode(png).decode(),
        "guard": verdict,
        "c2pa": credentials,
        "model_version": result.model_version,
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


@app.post("/v1/embed/image")
def embed(body: ImageIn):
    embedding, colours = embed_image(_image(body.image_b64))
    return {"embedding": embedding, "dominant_colours": colours}


@app.post("/v1/intent/parse")
def parse_intent(body: IntentIn):
    return intent.parse(body.text, body.locale, body.source)


class ListingIn(BaseModel):
    kind: Literal["product", "story"] = "product"
    locale: Literal["rw", "en", "fr"] = "en"
    fields: dict = Field(default_factory=dict)


@app.post("/v1/listing/write")
def listing_write(body: ListingIn):
    """AI listing writer: product title/description or page story in RW/EN/FR."""
    return listing.write(body.kind, body.fields, body.locale)
