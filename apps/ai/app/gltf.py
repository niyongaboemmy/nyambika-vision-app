"""Minimal glTF 2.0 binary (GLB) builder with skins and animations (E33/E34).

Extends the hand-written container from `garment3d.build_glb` (single static mesh) to what an
animatable avatar needs: a node hierarchy (skeleton), several meshes/primitives sharing accessors,
factor or texture materials, one skin (JOINTS_0/WEIGHTS_0 + inverse bind matrices) and keyframe
animations on joint rotations/translations. No third-party 3D library (spec: glTF 2.0 §3, §4.4).
"""
from __future__ import annotations

import json
import struct

import numpy as np

FLOAT, U8, U16, U32 = 5126, 5121, 5123, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
TYPES = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4", 16: "MAT4"}


def _pad(b: bytes, fill: bytes = b"\x00") -> bytes:
    return b + fill * ((4 - len(b) % 4) % 4)


def srgb_to_linear(c: np.ndarray | float) -> np.ndarray:
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray | float) -> np.ndarray:
    c = np.clip(np.asarray(c, dtype=np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


class GltfBuilder:
    def __init__(self, generator: str, extras: dict | None = None):
        self.blobs: list[bytes] = []
        self.views: list[dict] = []
        self.accessors: list[dict] = []
        self.gltf: dict = {
            "asset": {"version": "2.0", "generator": generator, "extras": extras or {}},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "materials": [],
        }

    # ── buffers ────────────────────────────────────────────────────────────
    def _view(self, data: bytes, target: int | None = None) -> int:
        offset = sum(len(b) for b in self.blobs)
        self.blobs.append(_pad(data))
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        self.views.append(view)
        return len(self.views) - 1

    def accessor(self, arr: np.ndarray, component: int = FLOAT, target: int | None = ARRAY_BUFFER, minmax: bool = False,
                 normalized: bool = False) -> int:
        dtype = {FLOAT: np.float32, U8: np.uint8, U16: np.uint16, U32: np.uint32}[component]
        a = np.ascontiguousarray(arr, dtype=dtype)
        width = 1 if a.ndim == 1 else int(np.prod(a.shape[1:]))
        acc = {"bufferView": self._view(a.tobytes(), target), "componentType": component, "count": int(a.shape[0]), "type": TYPES[width]}
        if normalized:
            acc["normalized"] = True
        if minmax:
            flat = a.reshape(a.shape[0], -1)
            acc["min"] = flat.min(axis=0).astype(float).tolist()
            acc["max"] = flat.max(axis=0).astype(float).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def indices(self, idx: np.ndarray) -> int:
        flat = np.asarray(idx).reshape(-1)
        comp = U16 if flat.max(initial=0) < 65535 else U32
        return self.accessor(flat, comp, ELEMENT_ARRAY_BUFFER)

    # ── scene objects ──────────────────────────────────────────────────────
    def node(self, **kw) -> int:
        self.gltf["nodes"].append({k: v for k, v in kw.items() if v is not None})
        return len(self.gltf["nodes"]) - 1

    def root(self, node: int):
        self.gltf["scenes"][0]["nodes"].append(node)

    def material(self, name: str, base_rgba=(1, 1, 1, 1), roughness=0.8, metallic=0.0, texture: bytes | None = None,
                 alpha_mask: bool = False, double_sided: bool = False, sheen: tuple | None = None) -> int:
        pbr: dict = {"baseColorFactor": [float(x) for x in base_rgba], "metallicFactor": metallic, "roughnessFactor": roughness}
        mat: dict = {"name": name, "pbrMetallicRoughness": pbr}
        if texture is not None:
            self.gltf.setdefault("images", []).append({"bufferView": self._view(texture), "mimeType": "image/png"})
            self.gltf.setdefault("samplers", [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}])
            self.gltf.setdefault("textures", []).append({"source": len(self.gltf["images"]) - 1, "sampler": 0})
            pbr["baseColorTexture"] = {"index": len(self.gltf["textures"]) - 1}
        if alpha_mask:
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.5
        if double_sided:
            mat["doubleSided"] = True
        if sheen:
            self.gltf.setdefault("extensionsUsed", [])
            if "KHR_materials_sheen" not in self.gltf["extensionsUsed"]:
                self.gltf["extensionsUsed"].append("KHR_materials_sheen")
            mat["extensions"] = {"KHR_materials_sheen": {"sheenColorFactor": list(sheen), "sheenRoughnessFactor": 0.55}}
        self.gltf["materials"].append(mat)
        return len(self.gltf["materials"]) - 1

    def mesh(self, name: str, primitives: list[dict]) -> int:
        self.gltf["meshes"].append({"name": name, "primitives": primitives})
        return len(self.gltf["meshes"]) - 1

    def skin(self, joints: list[int], inverse_bind: np.ndarray, skeleton: int, name: str = "skeleton") -> int:
        acc = self.accessor(inverse_bind.reshape(len(joints), 16), FLOAT, None)
        self.gltf.setdefault("skins", []).append({"name": name, "joints": joints, "inverseBindMatrices": acc, "skeleton": skeleton})
        return len(self.gltf["skins"]) - 1

    def animation(self, name: str, tracks: list[tuple[int, str, np.ndarray, np.ndarray]]):
        """tracks: (node, path in {rotation, translation}, times (K,), values (K, 4|3)). Shared time accessor per length."""
        samplers, channels, time_cache = [], [], {}
        for node, path, times, values in tracks:
            key = tuple(np.round(times, 5))
            if key not in time_cache:
                time_cache[key] = self.accessor(np.asarray(times, dtype=np.float32), FLOAT, None, minmax=True)
            out = self.accessor(np.asarray(values, dtype=np.float32), FLOAT, None)
            samplers.append({"input": time_cache[key], "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})
        self.gltf.setdefault("animations", []).append({"name": name, "samplers": samplers, "channels": channels})

    def build(self) -> bytes:
        g = dict(self.gltf)
        g["accessors"] = self.accessors
        g["bufferViews"] = self.views
        g["buffers"] = [{"byteLength": sum(len(b) for b in self.blobs)}]
        json_chunk = _pad(json.dumps(g, separators=(",", ":")).encode(), b" ")
        bin_chunk = b"".join(self.blobs)
        total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
        return b"".join([
            struct.pack("<III", 0x46546C67, 2, total),
            struct.pack("<II", len(json_chunk), 0x4E4F534A), json_chunk,
            struct.pack("<II", len(bin_chunk), 0x004E4942), bin_chunk,
        ])


COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
DTYPES = {FLOAT: np.float32, U8: np.uint8, U16: np.uint16, U32: np.uint32}


def read_accessor(gltf: dict, binary: bytes, i: int) -> np.ndarray:
    """Read an accessor back from a parsed GLB (tests, evaluation harness)."""
    acc = gltf["accessors"][i]
    view = gltf["bufferViews"][acc["bufferView"]]
    n = acc["count"] * COMPONENTS[acc["type"]]
    data = np.frombuffer(binary, dtype=DTYPES[acc["componentType"]], count=n, offset=view["byteOffset"] + acc.get("byteOffset", 0))
    return data.reshape(acc["count"], -1) if COMPONENTS[acc["type"]] > 1 else data


def quat_axis_angle(axis, deg: float) -> np.ndarray:
    a = np.asarray(axis, dtype=np.float64)
    a = a / np.linalg.norm(a)
    h = np.radians(deg) / 2
    return np.array([*(a * np.sin(h)), np.cos(h)])  # glTF order: x, y, z, w
