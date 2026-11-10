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


class VTONProvider(ABC):
    name: str

    @abstractmethod
    def models(self) -> list[dict]: ...

    @abstractmethod
    def model_version(self, tier: str) -> str: ...

    @abstractmethod
    def generate(self, twin: Image.Image, garment: Image.Image, category: str, tier: str) -> VTONResult: ...
