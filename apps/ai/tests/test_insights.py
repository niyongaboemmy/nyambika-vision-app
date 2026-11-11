from app import insights


def test_rules_pass_through_when_llm_off(client):
    r = client.post("/v1/insights/phrase", json={"locale": "rw", "facts": {"visits": 3}, "suggestions": ["A", "B"]})
    assert r.status_code == 200
    assert r.json() == {"texts": ["A", "B"], "writer": "rules"}


def test_llm_rephrases_same_count(monkeypatch):
    monkeypatch.setattr(insights.llm, "enabled", lambda: True)
    monkeypatch.setattr(insights.llm, "generate_json", lambda *a, **k: {"texts": ["one", "two"]})
    assert insights.phrase("en", {}, ["a", "b"]) == {"texts": ["one", "two"], "writer": "llm"}


def test_llm_wrong_count_or_failure_falls_back(monkeypatch):
    monkeypatch.setattr(insights.llm, "enabled", lambda: True)
    monkeypatch.setattr(insights.llm, "generate_json", lambda *a, **k: {"texts": ["only one"]})
    assert insights.phrase("fr", {}, ["a", "b"])["writer"] == "rules"

    def boom(*_a, **_k):
        raise RuntimeError("offline")

    monkeypatch.setattr(insights.llm, "generate_json", boom)
    assert insights.phrase("fr", {}, ["a", "b"]) == {"texts": ["a", "b"], "writer": "rules"}
