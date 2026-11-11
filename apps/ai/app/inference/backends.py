"""Backends per route: `pool` (self-hosted GPU pool over HTTP) and `hosted` (the contracted provider).

In this repository the `hosted` backends are the existing in-process adapters standing in for the
hosted providers (local compositor, dev-scripted STT, Claude when MUSE_LLM=1, parametric avatar,
the licensed hosted video slot). The `pool` backends speak the wire protocols in pool.py.
"""
from __future__ import annotations

import os
from typing import Any

from PIL import Image

from .pool import PoolClient
from .router import Router


def _resize_to(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return img if img.size == size else img.resize(size, Image.LANCZOS)


def register_defaults(router: Router, pool: PoolClient | None) -> Router:
    from .. import llm
    from ..providers.base import VTONResult

    # ── tryon ────────────────────────────────────────────────────────────────
    def hosted_tryon(p: dict[str, Any]):
        from ..providers import get_provider

        return get_provider(os.environ.get("HOSTED_VTON_PROVIDER", "local-compositor")).generate(
            p["twin"], p["garment"], p["category"], p["tier"], p.get("frame"))

    router.register("tryon", "hosted", hosted_tryon)

    # ── stt ──────────────────────────────────────────────────────────────────
    def hosted_stt(p: dict[str, Any]):
        from .. import stt

        return stt.hosted_adapter().transcribe(p["audio"], p.get("language"))

    router.register("stt", "hosted", hosted_stt)

    # ── llm (Claude when enabled; otherwise there is no hosted LLM to fall back to) ──
    if llm.enabled():
        router.register("llm", "hosted", lambda p: llm.generate_json(p["system"], p["user"], p["schema"], p.get("max_tokens", 800)))

    # ── avatar (probe only: the avatar build path still calls avatar_providers directly) ──
    router.register("avatar", "hosted", lambda p: {"ok": True, "provider": "parametric-cpu", "echo": p.get("ping")})

    # ── video (licensed hosted slot, only when configured) ────────────────────
    def hosted_video(p: dict[str, Any]):
        from ..video_tryon import PROVIDERS

        return PROVIDERS["hosted-rest"].frames(p["request"], p.get("progress") or (lambda _: None))

    if os.environ.get("VIDEO_TRYON_HOSTED_URL"):
        router.register("video", "hosted", hosted_video)

    # ── attr (R4 spike): the local attribute model runs in-process as the self-hosted `pool` backend ──
    from ..mlspike.api import pool_backend as attr_pool

    router.register("attr", "pool", attr_pool)

    if pool is None:
        return router

    def pool_tryon(p: dict[str, Any]):
        from ..config import TIER_HEIGHT

        twin = p["twin"].convert("RGB")
        h = TIER_HEIGHT.get(p["tier"], 512)
        twin = twin.resize((round(twin.width * h / twin.height), h), Image.LANCZOS)
        img, meta = pool.vton(twin, p["garment"].convert("RGBA"),
                              {"category": p["category"], "tier": p["tier"], "frame": list(p["frame"]) if p.get("frame") else None})
        img = _resize_to(img.convert("RGB"), twin.size)
        box = tuple(meta["subject_box"]) if meta.get("subject_box") else None
        return VTONResult(image=img, garment_alpha=None, subject_box=box, twin_resized=twin,
                          model_version=str(meta.get("model_version", "pool")))

    def pool_stt(p: dict[str, Any]):
        from ..stt import OpenAICompatibleAdapter

        t = OpenAICompatibleAdapter(f"{pool.base}/v1", pool.key, os.environ.get("INFERENCE_POOL_STT_MODEL", "whisper"),
                                    transport=pool.transport).transcribe(p["audio"], p.get("language"))
        t.provider = "pool:whisper"
        return t

    router.register("tryon", "pool", pool_tryon)
    router.register("stt", "pool", pool_stt)
    router.register("llm", "pool", lambda p: pool.chat_json(p["system"], p["user"], p["schema"], p.get("max_tokens", 800)))
    router.register("avatar", "pool", lambda p: pool.avatar_probe({"ping": p.get("ping")}))
    router.register("video", "pool", lambda p: pool.video(p["request"].frames_in(), p["request"].garment,
                                                          {"category": p["request"].category, "fps": p["request"].fps}))
    return router
