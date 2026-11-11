"""Optional Claude path for the Muse and the listing writer (off unless MUSE_LLM=1).

Uses structured outputs (output_config.format) for schema-valid JSON; forced tool_choice is
rejected on current models. Server-side refusal fallbacks are on. Callers fall back to the
deterministic rules on any exception, so the gateway never depends on the LLM being reachable.
"""
import json

from . import config


class LLMRefusal(RuntimeError):
    pass


def enabled() -> bool:
    return config.MUSE_LLM


def generate_json(system: str, user: str, schema: dict, max_tokens: int = 1024) -> dict:
    import anthropic  # optional dependency, only imported when the LLM path is on

    # Credentials resolve from the environment (ANTHROPIC_API_KEY, auth token or `ant auth login` profile).
    client = anthropic.Anthropic()
    response = client.beta.messages.create(
        model=config.MUSE_LLM_MODEL,
        max_tokens=max_tokens,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if response.stop_reason == "refusal":
        raise LLMRefusal(getattr(response.stop_details, "category", None) or "refused")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text)
