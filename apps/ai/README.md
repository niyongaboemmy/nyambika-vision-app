# Nyambika AI Gateway (`apps/ai`)

FastAPI service for garment readiness, photo-twin checks, try-on with guard and
C2PA, image embeddings (Snap) and Muse intent parsing. Everything runs offline:
each capability sits behind an adapter so real providers can be plugged in via env.

```bash
/opt/homebrew/bin/python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
pnpm dev     # uvicorn on :8100   (or: .venv/bin/uvicorn app.main:app --port 8100 --reload)
pnpm test    # pytest
.venv/bin/python scripts/make_seed_assets.py OUTDIR --catalogue --personas > manifest.json
```

| Endpoint | Purpose |
|---|---|
| `GET /health`, `GET /v1/models` | Liveness, model registry |
| `POST /v1/garment/assess` | Quality checks, background removal, readiness, embedding |
| `POST /v1/twin/check` | Capture checks (resolution, light, portrait, one person, full body), size estimate |
| `POST /v1/tryon` | Render look → guard (identity, skin tone, garment fidelity) → C2PA sign. Guard failures are `WITHHELD` |
| `POST /v1/embed/image` | 64-d L2-normalised colour + texture embedding for pgvector |
| `POST /v1/intent/parse` | RW/EN/FR text → Intent (rules; optional Claude structured output with `MUSE_LLM=1`) |

Env: `VTON_PROVIDER` (default `local-compositor`), `C2PA_SIGNING_KEY`, `GUARD_MIN_IDENTITY`,
`GUARD_MAX_SKIN_DELTA`, `GUARD_MIN_FIDELITY`, `MUSE_LLM`, `ANTHROPIC_API_KEY`, `MUSE_LLM_MODEL`.

**Honest limits:** the local compositor is not a generative VTON model, and the
C2PA manifest is HMAC-signed JSON in a PNG iTXt chunk (not a COSE-signed JUMBF
store). Swap in a licensed provider and `c2patool` with KMS keys before the pilot.
