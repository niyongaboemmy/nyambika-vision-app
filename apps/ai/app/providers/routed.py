"""E42: try-on through the inference router (self-hosted VTON server on the GPU pool, or hosted).

Set VTON_PROVIDER=routed (and INFERENCE_ROUTING=1) to use it. The hosted side is
HOSTED_VTON_PROVIDER (default local-compositor). Both serve the same model version, so the
generation record keeps one model id; the result carries `routing` (backend, region, cost, fallback).
"""
from PIL import Image

from .base import VTONProvider, VTONResult


class RoutedVTON(VTONProvider):
    name = "routed"

    def models(self) -> list[dict]:
        return []

    def model_version(self, tier: str) -> str:
        return f"routed-{tier.lower()}"

    def generate(self, twin: Image.Image, garment: Image.Image, category: str, tier: str,
                 frame: tuple[int, int, int, int] | None = None, region: str | None = None) -> VTONResult:
        from ..inference import get_router

        result, info = get_router().call("tryon", {"twin": twin, "garment": garment, "category": category, "tier": tier,
                                                   "frame": frame}, region)
        result.routing = info.view()  # type: ignore[attr-defined]
        return result
