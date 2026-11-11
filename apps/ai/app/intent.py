"""Muse intent parsing (FR-AST-01/04): free text in RW/EN/FR -> structured Intent.

The rules parser is the default and always available. When MUSE_LLM=1 and an
Anthropic key is configured, an LLM tool call is tried first and the rules
parser is the fallback on any error.
"""
import json
import re
import unicodedata
from datetime import date, timedelta

from . import config, llm

OCCASIONS = {
    "wedding": ["wedding", "bukwe", "ubukwe", "mariage", "noces"],
    "traditional-ceremony": ["gusaba", "kwiyakira", "gukwa", "introduction", "dot", "traditional ceremony"],
    "office": ["office", "work", "akazi", "biro", "bureau", "travail"],
    "church": ["church", "urusengero", "misa", "eglise", "messe"],
    "party": ["party", "ibirori", "fete", "soiree"],
    "graduation": ["graduation", "kurangiza", "diplome", "remise des diplomes"],
    "casual": ["everyday", "weekend", "buri munsi", "tous les jours", "quotidien"],
}
STYLES = {
    "elegant": ["elegant", "classy", "chic", "keza", "cyiza"],
    "modern": ["modern", "moderne", "kigezweho", "trendy"],
    "traditional": ["traditional", "traditionnel", "gakondo", "kinyarwanda"],
    "casual": ["casual", "decontracte", "relaxed"],
    "bold": ["bold", "vibrant", "audacieux", "flashy"],
    "minimal": ["minimal", "simple", "sobre", "plain"],
}
COLOURS = {
    "red": ["red", "rouge", "umutuku"],
    "orange": ["orange", "terracotta", "icunga"],
    "yellow": ["yellow", "jaune", "umuhondo"],
    "green": ["green", "vert", "icyatsi"],
    "blue": ["blue", "bleu", "ubururu"],
    "indigo": ["indigo"],
    "purple": ["purple", "violet", "mauve", "isine"],
    "pink": ["pink", "rose", "iroza"],
    "gold": ["gold", "golden", "dore", "zahabu"],
    "black": ["black", "noir", "umukara"],
    "white": ["white", "blanc", "blanche", "umweru"],
    "brown": ["brown", "marron", "ikigina"],
}
CATEGORIES = {
    "umushanana": ["umushanana", "imishanana", "mushanana"],
    "kitenge": ["kitenge", "ikitenge", "ibitenge", "pagne", "wax"],
    "dress": ["dress", "robe", "ikanzu", "gown"],
    "shirt": ["shirt", "chemise", "ishati"],
    "suit": ["suit", "costume", "ikoti", "blazer"],
    "skirt": ["skirt", "jupe", "ijipo"],
    "top": ["top", "blouse", "haut"],
    "kids": ["kids", "children", "enfant", "enfants", "abana", "umwana"],
}
LOCATIONS = ["kigali", "kimihurura", "nyamirambo", "remera", "kicukiro", "gasabo", "nyarugenge", "kacyiru",
             "kimironko", "gikondo", "musanze", "huye", "rubavu", "muhanga"]

WEEKDAYS = {  # Monday = 0
    0: ["monday", "lundi", "kuwa mbere", "ku wa mbere"],
    1: ["tuesday", "mardi", "kuwa kabiri", "ku wa kabiri"],
    2: ["wednesday", "mercredi", "kuwa gatatu", "ku wa gatatu"],
    3: ["thursday", "jeudi", "kuwa kane", "ku wa kane"],
    4: ["friday", "vendredi", "kuwa gatanu", "ku wa gatanu"],
    5: ["saturday", "samedi", "kuwa gatandatu", "ku wa gatandatu"],
    6: ["sunday", "dimanche", "ku cyumweru", "kucyumweru"],
}
RELATIVE_DAYS = {0: ["today", "aujourd'hui", "uyu munsi"], 1: ["tomorrow", "demain", "ejo"]}

LANG_HINTS = {
    "rw": ["ndashaka", "imyenda", "kwambara", "itarenze", "ibihumbi", "igihumbi", "bukwe", "ubukwe", "ku wa",
           "kuwa", "yo", "mu", "na", "ndi", "nkeneye", "amafaranga", "frw", "cyane", "umushanana", "gutaha"],
    "fr": ["je", "une", "pour", "moins", "de", "le", "la", "mariage", "robe", "veux", "cherche", "francs",
           "samedi", "tenue", "besoin", "mille"],
    "en": ["i", "need", "a", "for", "under", "outfit", "the", "want", "looking", "wedding", "dress", "below",
           "budget", "something", "my"],
}

SIZE_RE = re.compile(r"\b(?:size|taille|ingano|saizi)\s*(xxs|xs|s|m|l|xl|xxl|\d{2})\b")
NUMBER = r"(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?)"
K_RE = re.compile(NUMBER + r"\s*k\b")
THOUSAND_WORD_RE = re.compile(r"\b(?:ibihumbi|igihumbi)\s+" + NUMBER)
MILLE_RE = re.compile(NUMBER + r"\s*mille\b")
PLAIN_RE = re.compile(NUMBER)
BUDGET_CUES = ["under", "below", "max", "maximum", "less than", "budget", "itarenze", "munsi ya", "moins de",
               "jusqu'a", "pas plus de", "up to"]


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", text).strip()


def _has(text: str, term: str) -> bool:
    return re.search(r"(?<![a-z])" + re.escape(term) + r"(?![a-z])", text) is not None


def _match_all(text: str, lexicon: dict[str, list[str]]) -> list[str]:
    return [key for key, terms in lexicon.items() if any(_has(text, t) for t in terms)]


def _to_int(num: str) -> int:
    if re.fullmatch(r"\d{1,3}(?:[ ,.]\d{3})+", num):
        return int(re.sub(r"[ ,.]", "", num))
    return int(float(num.replace(",", ".")))


def _budget(text: str) -> int | None:
    for regex in (K_RE, THOUSAND_WORD_RE, MILLE_RE):
        m = regex.search(text)
        if m:
            return int(float(m.group(1).replace(" ", "").replace(",", ".")) * 1000)
    candidates = []
    for m in PLAIN_RE.finditer(text):
        value = _to_int(m.group(1))
        if value >= 1000:
            before = text[max(0, m.start() - 25): m.start()]
            candidates.append((any(c in before for c in BUDGET_CUES), value))
    if not candidates:
        return None
    candidates.sort(key=lambda c: not c[0])
    return candidates[0][1]


def _date(text: str, today: date) -> str | None:
    for offset, terms in RELATIVE_DAYS.items():
        if any(_has(text, t) for t in terms):
            return (today + timedelta(days=offset)).isoformat()
    for weekday, terms in WEEKDAYS.items():
        if any(_has(text, t) for t in terms):
            ahead = (weekday - today.weekday()) % 7 or 7
            return (today + timedelta(days=ahead)).isoformat()
    return None


def _language(text: str, hint: str | None) -> str:
    words = set(re.findall(r"[a-z']+", text))
    scores = {lang: sum(1 for h in hints if (h in words if " " not in h else h in text))
              for lang, hints in LANG_HINTS.items()}
    best = max(scores.values())
    if best == 0:
        return hint or "en"
    leaders = [lang for lang, s in scores.items() if s == best]
    return hint if hint in leaders else leaders[0]


def parse_rules(text: str, locale: str | None = None, source: str = "text", today: date | None = None) -> dict:
    today = today or date.today()
    norm = _normalise(text)
    size_match = SIZE_RE.search(norm)
    location = next((loc.title() for loc in LOCATIONS if _has(norm, loc)), None)
    occasions = _match_all(norm, OCCASIONS)
    return {
        "occasion": occasions[0] if occasions else None,
        "date": _date(norm, today),
        "budgetMax": _budget(norm),
        "styles": _match_all(norm, STYLES),
        "colours": _match_all(norm, COLOURS),
        "categories": _match_all(norm, CATEGORIES),
        "size": size_match.group(1).upper() if size_match else None,
        "location": location,
        "language": _language(norm, locale),
        "source": source,
        "parser": "rules",
    }


INTENT_TOOL = {
    "name": "record_intent",
    "description": "Record the shopper's fashion intent using the canonical English vocabulary.",
    "input_schema": {
        "type": "object",
        "properties": {
            "occasion": {"type": ["string", "null"], "enum": list(OCCASIONS) + [None]},
            "date": {"type": ["string", "null"], "description": "ISO date yyyy-mm-dd"},
            "budgetMax": {"type": ["integer", "null"], "description": "Maximum budget in RWF"},
            "styles": {"type": "array", "items": {"type": "string", "enum": list(STYLES)}},
            "colours": {"type": "array", "items": {"type": "string", "enum": list(COLOURS)}},
            "categories": {"type": "array", "items": {"type": "string", "enum": list(CATEGORIES)}},
            "size": {"type": ["string", "null"]},
            "location": {"type": ["string", "null"]},
            "language": {"type": "string", "enum": ["rw", "en", "fr"]},
        },
        "required": ["occasion", "date", "budgetMax", "styles", "colours", "categories", "size", "location",
                     "language"],
    },
}


def _parse_llm(text: str, locale: str | None, source: str, today: date) -> dict:
    schema = {**INTENT_TOOL["input_schema"], "additionalProperties": False}
    data = llm.generate_json(
        system=(f"Today is {today.isoformat()} ({today.strftime('%A')}). The shopper writes in Kinyarwanda, "
                "English or French. Extract their fashion intent using the canonical English vocabulary in the "
                "schema. Budgets are in Rwandan francs. Use null when something isn't said."),
        user=text,
        schema=schema,
        max_tokens=1024,
    )
    data.setdefault("language", locale or "en")
    for key in ("styles", "colours", "categories"):
        data[key] = list(data.get(key) or [])
    data.update(source=source, parser="llm")
    return data


def parse(text: str, locale: str | None = None, source: str = "text", today: date | None = None) -> dict:
    today = today or date.today()
    if llm.enabled():
        try:
            return _parse_llm(text, locale, source, today)
        except Exception:  # noqa: BLE001 - any LLM failure falls back to rules
            pass
    return parse_rules(text, locale, source, today)
