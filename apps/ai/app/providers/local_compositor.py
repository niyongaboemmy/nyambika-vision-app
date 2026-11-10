"""Offline VTON stand-in: places the garment cut-out over the twin's torso.

Not a generative model. It exists so the whole Mirror -> Looks -> Hold loop runs
locally, and so the guard and C2PA pipeline have real images to check and sign.
"""
import numpy as np
from PIL import Image, ImageFilter

from ..config import TIER_HEIGHT
from ..imaging import bbox
from ..twin import subject, torso_run
from .base import VTONProvider, VTONResult

LONG = {"dress", "umushanana", "kitenge", "gown", "bridal", "wrap"}
SHORT = {"shirt", "top", "blouse", "jacket"}
SKIRT = {"skirt"}


class LocalCompositor(VTONProvider):
    name = "local-compositor"
    version = "1.0"

    def models(self) -> list[dict]:
        return [
            {"id": f"{self.name}@{self.version}-preview", "provider": self.name, "name": "Local compositor (preview)",
             "version": self.version, "tier": "PREVIEW", "cost_rwf": 40, "nlb_score": None},
            {"id": f"{self.name}@{self.version}-hd", "provider": self.name, "name": "Local compositor (HD)",
             "version": self.version, "tier": "HD", "cost_rwf": 110, "nlb_score": None},
        ]

    def model_version(self, tier: str) -> str:
        return f"{self.name}@{self.version}-{tier.lower()}"

    @staticmethod
    def _placement(category: str, box, torso: tuple[int, int]):
        x0, y0, x1, y1 = box
        h = y1 - y0
        cat = (category or "dress").lower()
        # Cut-outs include sleeves/skirt flare, so the box is wider than the torso itself.
        torso_w = torso[1] - torso[0]
        cx = (torso[0] + torso[1]) / 2
        if cat in SHORT:
            top, bottom, factor = 0.19, 0.50, 1.9
        elif cat in SKIRT:
            top, bottom, factor = 0.44, 0.72, 1.45
        else:
            top, bottom, factor = 0.19, 0.72, 1.8
        gw = int(torso_w * factor)
        return int(cx - gw / 2), int(y0 + top * h), gw, int((bottom - top) * h)

    def generate(self, twin: Image.Image, garment: Image.Image, category: str, tier: str) -> VTONResult:
        target_h = TIER_HEIGHT.get(tier, 512)
        twin = twin.convert("RGB")
        twin = twin.resize((round(twin.width * target_h / twin.height), target_h), Image.LANCZOS)
        mask, box = subject(twin)
        if box is None:
            raise ValueError("No subject found on twin")
        gx, gy, gw, gh = self._placement(category, box, torso_run(mask, box))

        garment = garment.convert("RGBA")
        gbox = bbox(np.asarray(garment)[..., 3] > 10)
        if gbox:
            garment = garment.crop(gbox)
        garment = garment.resize((max(1, gw), max(1, gh)), Image.LANCZOS)

        canvas = twin.convert("RGBA")
        shadow_alpha = garment.getchannel("A").point(lambda a: int(a * 0.45))
        shadow = Image.new("RGBA", garment.size, (0, 0, 0, 0))
        shadow.putalpha(shadow_alpha)
        shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        shadow_layer.paste(shadow, (gx + 3, gy + 6))
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(6))
        canvas = Image.alpha_composite(canvas, shadow_layer)
        garment_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        garment_layer.paste(garment, (gx, gy), garment)
        canvas = Image.alpha_composite(canvas, garment_layer)

        alpha = np.asarray(garment_layer)[..., 3].astype(np.float32) / 255
        return VTONResult(
            image=canvas.convert("RGB"),
            garment_alpha=alpha,
            subject_box=box,
            twin_resized=twin,
            model_version=self.model_version(tier),
        )
