from app import listing


def test_product_listing_in_three_languages():
    f = {"category": "dress", "colours": ["Indigo", "Gold"], "occasions": ["wedding"], "fabric": "cotton kitenge",
         "madeToOrder": True, "leadTimeDays": 4, "makerName": "Umurage Wear"}
    en = listing.write("product", f, "en")
    assert "Indigo" in en["title"] and "weddings" in en["description"] and "4 days" in en["description"]
    fr = listing.write("product", f, "fr")
    assert "mariages" in fr["description"] and "sur mesure" in fr["description"]
    rw = listing.write("product", f, "rw")
    assert "ubukwe" in rw["description"] and rw["writer"] == "rules"


def test_page_story():
    s = listing.write("story", {"name": "Urudodo", "memberType": "COOPERATIVE", "sector": "Nyamirambo", "since": 2015}, "en")
    assert s["story"].startswith("Urudodo is a sewing cooperative in Nyamirambo since 2015")


def test_llm_failure_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(listing.llm, "enabled", lambda: True)
    def boom(**_):
        raise RuntimeError("offline")
    monkeypatch.setattr(listing.llm, "generate_json", boom)
    assert listing.write("product", {"category": "shirt"}, "en")["writer"] == "rules"
