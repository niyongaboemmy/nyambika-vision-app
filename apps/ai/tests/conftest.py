import base64
import io
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import make_seed_assets as seeds  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture(scope="session")
def assets(tmp_path_factory):
    out = tmp_path_factory.mktemp("assets")
    for i, (skin, wf) in enumerate(seeds.PERSONAS, start=1):
        seeds.persona(skin, wf, out / f"persona-{i}.png")
    seeds.garment("a-line-dress", "#C8553D", "circles", out / "dress-terracotta-circles.png")
    seeds.garment("skirt", "#C8553D", "circles", out / "skirt-terracotta-circles.png")
    seeds.garment("a-line-dress", "#2F3E9E", "zigzag", out / "dress-indigo-zigzag.png")
    seeds.garment("shirt", "#12857F", "waves", out / "shirt-teal-waves.png")
    return out


def b64(path) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


def b64_image(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
