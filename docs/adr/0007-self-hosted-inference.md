# ADR-0007: Self-hosted inference and video try-on gating

- Status: Accepted (R3, E39/E42). Production seams only: no GPU was available, nothing here ran on a GPU.

## Context
AI-GW-07 asks for a self-hosted GPU backend for permissively licensed models, for cost (NFR-CST-01) and data
residency (AI-GW-04). FR-VID-03 asks for direct video try-on once a commercially licensed provider passes the NLB.
CON-02 / AI-BM-05 block non-commercial licences in production.

## Decision
- **Router in the gateway** (`apps/ai/app/inference/`). Routes `tryon`, `stt`, `llm`, `avatar`, `video`; backends
  `pool` (self-hosted, KServe v2 / OpenAI-compatible HTTP) and `hosted` (the contracted provider; in this repo the
  existing in-process adapters stand in). Per call: enabled → configured → residency (`in-region` = backend region
  must equal the request region; no compliant backend = 503, never a silent transfer abroad) → strategy (`cost` =
  cheapest whose observed p95 meets the SLO, `latency`, `pool-first`, `hosted-only`, `pool-only`) → skip OPEN
  circuits and pools whose last health check is DOWN → call, falling back on failure. The request region is the
  E41 region code (ADR-0006): for video the shopper's `ShopperPrefs.country`, else the page's `PageRegion.region`,
  else RW; backend regions come from `INFERENCE_POOL_REGION` / `INFERENCE_HOSTED_REGION`.
- **Circuit breaker** per (route, backend): 3 consecutive failures open it, 15 s cool-down, then one half-open trial.
  Pool health is polled separately (`/v2/models/{name}/ready`) so a dead pool is skipped before any call times out.
- **Video never falls back silently** (`fallback: false`, enforced by the API): each backend that may serve shoppers
  needs its own NLB pass, and the API discards a result whose `model_version` is not the activated model.
- **Policy is owned by the API** (`InferencePolicy`, versioned, audited, edited in Admin → Flags & models → Inference)
  and pushed to the gateway; the API re-pushes when the gateway reports an older version (restart).
- **Cost accounting**: the router counts calls, failures, fallbacks, cost (policy cost per call) and latency per
  (route, backend); the API turns the cumulative counters into Prometheus `nyambika_ai_inference_cost_rwf_total` and
  `nyambika_ai_inference_calls_total{outcome}` (provider cost; billed spend stays in `nyambika_ai_spend_rwf_total`).
- **NLB gate in the model registry** (E39): `PATCH /admin/models/:id {status: ACTIVE}` on a `VIDEO_TRYON` model is
  refused (409 `NLB_GATE`, audited) unless the latest `ModelEval` (`NLB_VIDEO`) is for that exact version, passed,
  is ≤ 92 days old and the licence allows commercial use. The eval (`apps/ai/app/video_eval.py`) covers skin tone
  (MST 6–10) × body size (S/M/XL) with identity similarity per frame, identity stability across frames, skin-tone ΔE,
  garment fidelity and AI-BM-03 parity.

## Model licences (permissive only)
| Use | Model | Licence | Status |
|---|---|---|---|
| LLM phrasing | Mistral-7B-Instruct-v0.3 | Apache-2.0 | default in the chart; Kinyarwanda quality unmeasured |
| LLM (alternative) | Qwen2.5-7B-Instruct | Apache-2.0 | candidate |
| Speech-to-text | openai/whisper-large-v3-turbo | MIT | default; Kinyarwanda WER unmeasured (target ≤ 12 %) |
| LLM / STT server | vLLM | Apache-2.0 | serving software |
| Model server | KServe | Apache-2.0 | serving software |
| Photo VTON | in-house compositor (`apps/ai/app/providers`) | Nyambika source | placeholder |
| Video base model | Wan2.1 (T2V/I2V) | Apache-2.0 | candidate base only; no try-on fine-tune exists, would need our own consented data + NLB |

**Rejected** (non-commercial or unclear): IDM-VTON, OOTDiffusion, CatVTON, StableVITON (CC BY-NC-SA 4.0); models
trained on VITON-HD / DressCode (research-only datasets) even where the code is MIT; SMPL-X body model (non-commercial
unless licensed from Meshcapade), which keeps the `avatar` pool slot disabled. Licence statements are from our
knowledge at writing time and must be re-checked against each model card before deployment.

## Consequences
- Locally, routing, breaker and fallback are demonstrable with the fake pool; GPU throughput, real cost per call and
  model quality are not measured. Nothing is routed to the pool unless `INFERENCE_ROUTING=1` and a pool URL is set.
- The avatar route is probe-only (the 3D twin build still calls its provider directly); `llm` routing is wired into
  insights phrasing; `tryon` (`VTON_PROVIDER=routed`) and `stt` (`STT_PROVIDER=routed`) are fully routed.
- The licensed hosted video slot (`hosted-rest`) is a mock-tested contract only; its field mapping is adapted per
  vendor at contracting, and it must pass the NLB like any other provider.
