"""VTON provider adapter interface (AI-GW). Real providers implement the same contract."""
from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass
class VTONResult:
    image: Image.Image
    # Masks in output coordinates, used by the guard. Remote providers that do not
    # return masks can leave these None and the guard re-derives them.
    garment_alpha: np.ndarray | None
    subject_box: tuple[int, int, int, int] | None
    twin_resized: Image.Image
    model_version: str
    # Optional (local compositor): the twin with its old upper garment hidden where the new one leaves it
    # exposed, the mask of those edits, and the garment class used (top/skirt/dress).
    base_image: Image.Image | None = None
    edit_mask: np.ndarray | None = None
    garment_class: str | None = None


class VTONProvider(ABC):
    name: str

    @abstractmethod
    def models(self) -> list[dict]: ...

    @abstractmethod
    def model_version(self, tier: str) -> str: ...

    @abstractmethod
    def generate(self, twin: Image.Image, garment: Image.Image, category: str, tier: str,
                 frame: tuple[int, int, int, int] | None = None, region: str | None = None) -> VTONResult:
        """`region` is the shopper's data-residency region; providers that run in one place may ignore it."""
