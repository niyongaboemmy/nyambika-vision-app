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
    from .inference import get_router, routing_enabled

    if not suggestions or not (llm.enabled() or routing_enabled()):
        return {"texts": suggestions, "writer": "rules"}
    try:
        user = (
            f"Language: {LANG.get(locale, 'Kinyarwanda')}.\n"
            f"Aggregated page facts (last 30 days): {facts}\n"
            "Suggestions to rewrite:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(suggestions))
        )
        if routing_enabled():
            # E42: open LLM on the self-hosted pool, or Claude (hosted), chosen by the routing policy.
            out, info = get_router().call("llm", {"system": SYSTEM, "user": user, "schema": SCHEMA, "max_tokens": 800})
            writer = f"llm:{info.backend}"
        else:
            out, writer = llm.generate_json(SYSTEM, user, SCHEMA, max_tokens=800), "llm"
        texts = [str(t).strip() for t in out.get("texts", [])]
        if len(texts) != len(suggestions) or not all(texts):
            return {"texts": suggestions, "writer": "rules"}
        return {"texts": texts, "writer": writer}
    except Exception:  # noqa: BLE001 - refusal, network, schema, no backend: rules stand
        return {"texts": suggestions, "writer": "rules"}
