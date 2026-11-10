from datetime import date

from app.intent import parse_rules

TODAY = date(2026, 11, 11)  # a Wednesday


def test_kinyarwanda_wedding_budget_saturday():
    r = parse_rules("Ndashaka imyenda yo kwambara mu bukwe ku wa gatandatu, itarenze 50,000", today=TODAY)
    assert r["occasion"] == "wedding"
    assert r["date"] == "2026-11-14"
    assert r["budgetMax"] == 50000
    assert r["language"] == "rw"
    assert r["parser"] == "rules"


def test_kinyarwanda_thousand_words_colour_location():
    r = parse_rules("Nkeneye umushanana w'ubururu i Kimihurura, ibihumbi 80", today=TODAY)
    assert r["categories"] == ["umushanana"]
    assert r["colours"] == ["blue"]
    assert r["location"] == "Kimihurura"
    assert r["budgetMax"] == 80000
    assert r["language"] == "rw"


def test_english():
    r = parse_rules("wedding outfit for Saturday under 50k, elegant kitenge, size M", today=TODAY)
    assert r["occasion"] == "wedding"
    assert r["date"] == "2026-11-14"
    assert r["budgetMax"] == 50000
    assert "elegant" in r["styles"]
    assert "kitenge" in r["categories"]
    assert r["size"] == "M"
    assert r["language"] == "en"


def test_french():
    r = parse_rules("Je cherche une robe pour un mariage samedi, moins de 50 000 francs", today=TODAY)
    assert r["occasion"] == "wedding"
    assert r["categories"] == ["dress"]
    assert r["budgetMax"] == 50000
    assert r["date"] == "2026-11-14"
    assert r["language"] == "fr"


def test_french_mille_and_office():
    r = parse_rules("une chemise pour le bureau, 30 mille", today=TODAY)
    assert r["occasion"] == "office"
    assert r["categories"] == ["shirt"]
    assert r["budgetMax"] == 30000


def test_endpoint_shape(client):
    r = client.post("/v1/intent/parse", json={"text": "church dress, red, tomorrow", "source": "voice"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"occasion", "date", "budgetMax", "styles", "colours", "categories", "size", "location",
                         "language", "source", "parser"}
    assert body["source"] == "voice"
    assert body["occasion"] == "church" and body["colours"] == ["red"]
