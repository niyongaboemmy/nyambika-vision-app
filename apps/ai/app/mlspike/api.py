"""Gateway routes for the R4 local-model spike. Called by the API only.

POST /v1/ml/screen              PII / person screen of one image
POST /v1/ml/dataset/build       next consented dataset version (manifest, tombstones applied, screened)
POST /v1/ml/attr/train-eval     train the tiny attribute model on a manifest and run the NLB-style eval
POST /v1/ml/attr/suggest        attribute suggestions for one product photo, through the E42 router
                                (route `attr`, backend `pool` = the self-hosted model; rules if no backend)
"""
from __future__ import annotations

import time

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..imaging import decode_b64, dominant_colours, foreground_mask
from ..inference import NoBackend, get_router
from . import dataset, pipeline, synth
from .screen import screen

router = APIRouter()


def _img(b64: str):
    try:
        return decode_b64(b64)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Invalid image: {exc}") from exc


class ScreenIn(BaseModel):
    image_b64: str


@router.post("/v1/ml/screen")
def screen_one(body: ScreenIn):
    return screen(_img(body.image_b64))


class Contributor(BaseModel):
    page_id: str
    consent_record_id: str
    consented_at: str


class CatalogueItem(BaseModel):
    item_id: str
    source: str = "catalogue"
    page_id: str
    product_id: str
    variant_id: str | None = None
    consent_record_id: str
    consented_at: str
    licence: str = dataset.CATALOGUE_LICENCE
    image_ref: str
    image_b64: str
    labels: dict[str, str | None] = Field(default_factory=dict)


class BuildIn(BaseModel):
    contributors: list[Contributor] = Field(default_factory=list)
    catalogue: list[CatalogueItem] = Field(default_factory=list)
    tombstones: list[dict] = Field(default_factory=list)
    previous: dict | None = None
    per_cell: int = Field(default=10, ge=1, le=40)
    seed: int = 7
    generator: int = Field(default=synth.DEFAULT_GEN, ge=1, le=2)
    consented_at: str = "2026-11-01T00:00:00+00:00"


@router.post("/v1/ml/dataset/build")
def build(body: BuildIn):
    t0 = time.time()
    specs = synth.corpus(body.per_cell, seed=body.seed, gen=body.generator) if body.contributors else []
    cands = dataset.synthetic_candidates(specs, [c.model_dump() for c in body.contributors], body.consented_at) if specs else []
    images = {}
    for c in body.catalogue:
        images[c.item_id] = _img(c.image_b64)
        cands.append({k: v for k, v in c.model_dump().items() if k != "image_b64"})
    try:
        manifest = dataset.build_version(cands, pipeline.image_loader(images), tombstones=body.tombstones, previous=body.previous)
    except dataset.ShopperDataError as exc:
        raise HTTPException(422, f"Refused: {exc}") from exc
    manifest["generator"] = f"synth-garments/{body.generator}"
    manifest["build_ms"] = int((time.time() - t0) * 1000)
    return manifest


class TrainIn(BaseModel):
    manifest: dict
    previous: dict | None = None
    catalogue_images: dict[str, str] = Field(default_factory=dict)
    screen_eval: bool = True


@router.post("/v1/ml/attr/train-eval")
def train_eval(body: TrainIn):
    t0 = time.time()
    images = {k: _img(v) for k, v in body.catalogue_images.items()}
    for it in body.manifest.get("items", []):
        try:
            dataset.assert_trainable(it)
        except dataset.ShopperDataError as exc:
            raise HTTPException(422, f"Refused: {exc}") from exc
    try:
        out = pipeline.train_and_evaluate(body.manifest, images, body.previous, screen_eval=body.screen_eval)
    except KeyError as exc:
        raise HTTPException(422, str(exc)) from exc
    out["train_eval_ms"] = int((time.time() - t0) * 1000)
    return out


class SuggestIn(BaseModel):
    image_b64: str
    model_version: str
    region: str | None = None


def _rules(img) -> dict:
    """Fallback when no backend may serve: dominant colour only, no category / pattern guess."""
    rgb = np.asarray(img.convert("RGB"))
    hexes = dominant_colours(rgb, foreground_mask(img.convert("RGB")))
    best = None
    if hexes:
        h = hexes[0].lstrip("#")
        c = np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)])
        dist = {n: float(np.linalg.norm(c - np.array(synth.hex_rgb(v)))) for n, v in synth.COLOURS.items()}
        best = min(dist, key=dist.get)
    return {"model_version": "rules", "heads": {"colour": [{"label": best, "p": 0.5}] if best else []}, "threshold": 0.6}


@router.post("/v1/ml/attr/suggest")
def suggest(body: SuggestIn):
    img = _img(body.image_b64)
    try:
        out, info = get_router().call("attr", {"image": img, "model_version": body.model_version}, body.region)
        return {**out, "served_by": info.backend, "route": info.view()}
    except NoBackend as exc:
        return {**_rules(img), "served_by": "rules", "route": {"error": exc.detail}}


def pool_backend(payload: dict) -> dict:
    """The `pool` backend of route `attr`: the self-hosted spike model, in-process on CPU here."""
    model = pipeline.get_model(payload["model_version"])
    if model is None:
        raise RuntimeError(f"model {payload['model_version']} is not present on this inference node")
    return pipeline.suggest(model, payload["image"])
