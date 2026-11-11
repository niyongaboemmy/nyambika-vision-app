"""Insights v2 suggestions (E30, FR-ANL-03): the API computes rule-based suggestions from aggregates;
with MUSE_LLM=1 Claude rephrases them warmly in RW/EN/FR. Facts are aggregates only (no shopper data).
Any LLM failure keeps the rule text, so the studio never depends on the LLM.
"""
from . import llm

SCHEMA = {
    "type": "object",
    "properties": {"texts": {"type": "array", "items": {"type": "string"}}},
    "required": ["texts"],
    "additionalProperties": False,
}

LANG = {"rw": "Kinyarwanda", "en": "English", "fr": "French"}

SYSTEM = (
    "You coach small Rwandan tailors, cooperatives and sellers on the Nyambika platform. "
    "Rewrite each suggestion so it is short (max 30 words), warm, concrete and in plain words. "
    "Keep every number, product name and the action exactly. Do not invent facts, prices or promises. "
    "Return the same number of suggestions in the same order."
)


def phrase(locale: str, facts: dict, suggestions: list[str]) -> dict:
    if not suggestions or not llm.enabled():
        return {"texts": suggestions, "writer": "rules"}
    try:
        user = (
            f"Language: {LANG.get(locale, 'Kinyarwanda')}.\n"
            f"Aggregated page facts (last 30 days): {facts}\n"
            "Suggestions to rewrite:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(suggestions))
        )
        out = llm.generate_json(SYSTEM, user, SCHEMA, max_tokens=800)
        texts = [str(t).strip() for t in out.get("texts", [])]
        if len(texts) != len(suggestions) or not all(texts):
            return {"texts": suggestions, "writer": "rules"}
        return {"texts": texts, "writer": "llm"}
    except Exception:  # noqa: BLE001 - refusal, network, schema: rules stand
        return {"texts": suggestions, "writer": "rules"}
