"""Hardening: /v1/tryon passes the shopper's region to the provider, so the E42 in-region policy applies to looks."""
from app import main
from app.inference import Router, default_policy
from app.providers import get_provider
from app.providers.routed import RoutedVTON

from .conftest import b64


def _body(client, assets, **extra):
    garment = client.post("/v1/garment/assess", json={"image_b64": b64(assets / "dress-terracotta-circles.png")}).json()["cutout_b64"]
    return {"twin_b64": b64(assets / "persona-2.png"), "garment_b64": garment, "garment_category": "dress", **extra}


def test_region_reaches_the_provider_and_is_optional(client, assets, monkeypatch):
    seen: list = []
    local = get_provider("local-compositor")

    class Recording(type(local)):
        def generate(self, *a, region=None, **k):
            seen.append(region)
            return local.generate(*a, region=region, **k)

    monkeypatch.setattr(main, "get_provider", lambda name: Recording())
    assert client.post("/v1/tryon", json=_body(client, assets, region="KE")).json()["status"] == "DELIVERED"
    assert client.post("/v1/tryon", json=_body(client, assets)).json()["status"] == "DELIVERED"
    assert seen == ["KE", None]  # no region: same call as before (default behaviour unchanged)
    assert client.post("/v1/tryon", json=_body(client, assets, region="X" * 9)).status_code == 422


def test_routed_tryon_keeps_an_in_region_look_in_the_country(client, assets, monkeypatch):
    local = get_provider("local-compositor")
    served: list[str] = []

    def backend(name):
        def run(p):
            served.append(name)
            return local.generate(p["twin"], p["garment"], p["category"], p["tier"], p.get("frame"))
        return run

    r = Router(default_policy(), regions={"pool": "rw", "hosted": "eu"})
    r.register("tryon", "pool", backend("pool"))
    r.register("tryon", "hosted", backend("hosted"))
    r.policy.routes["tryon"].residency = "in-region"
    r.policy.routes["tryon"].strategy = "hosted-only"  # would leave the country if the region were ignored
    import app.inference as inference

    monkeypatch.setattr(inference, "get_router", lambda: r)
    monkeypatch.setattr(main, "get_provider", lambda name: RoutedVTON())
    refused = client.post("/v1/tryon", json=_body(client, assets, region="RW"))
    assert refused.status_code == 503 and "residency: eu is outside rw" in refused.json()["detail"]
    assert r.plan("tryon", "KE")[1][-1]["reason"] == "residency: eu is outside ke"  # the region decides, not a default
    assert served == []  # never sent to the EU-hosted backend
    r.policy.routes["tryon"].strategy = "cost"
    out = client.post("/v1/tryon", json=_body(client, assets, region="RW")).json()
    assert out["status"] == "DELIVERED"
    assert out["routing"]["backend"] == "pool" and served == ["pool"]
