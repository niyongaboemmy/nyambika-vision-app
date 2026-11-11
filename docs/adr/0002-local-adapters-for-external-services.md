# ADR-0002: Adapters with local implementations for external services

- Status: Accepted (Phase 0)

## Context
R1 depends on services that need contracts, credentials or an NLB decision: VTON providers (OD-02), MTN MoMo / Airtel (OD-05), WhatsApp Cloud API, SMS gateway, an ASR vendor (OD-03) and C2PA signing keys in KMS. None are available to the dev team yet, and no real personal images may be used outside production (plan §4.6).

## Decision
Every external dependency sits behind an adapter interface. Each one ships with a **local implementation** that behaves like the real service, so the full R1 loop runs offline and in CI:

| Capability | Interface | Local implementation | Production replacement |
|---|---|---|---|
| Virtual try-on | `apps/ai/app/providers` | Deterministic compositor (garment cut-out placed on the twin's torso) | Licensed VTON provider chosen after the NLB |
| Runtime guard | `apps/ai/app/guard.py` | Real pixel metrics: identity region similarity, skin-tone delta, garment fidelity | Same checks, plus calibrated ML models |
| C2PA | `apps/ai/app/c2pa.py` | HMAC-signed C2PA-style manifest embedded in a PNG `iTXt` chunk | `c2patool` / c2pa-rs with KMS keys |
| Muse intent | `apps/ai/app/intent.py` | RW/EN/FR rules parser; optional Claude tool-use when `MUSE_LLM=1` | LLM tool-calling with evals (plan §15.2) |
| Visual search | `apps/ai/app/embed.py` + pgvector | 64-d colour + texture embedding | Image embedding model |
| Voice (E22) | `apps/ai/app/stt.py` (`POST /v1/stt`, `STT_PROVIDER`) | `dev-scripted`: real container/duration/silence checks, deterministic scripted Muse phrases (`simulated: true`, not speech recognition); spoken replies via browser `speechSynthesis`; Web Speech as client fallback | `openai-compatible` adapter (written, contract-tested with a mock transport, not exercised against a live service) pointed at a Kinyarwanda-capable ASR (OD-03), e.g. a fine-tuned Whisper behind a faster-whisper server; WER ≤ 12% gate (plan §9.3) |
| Payments | `apps/api/src/modules/payments` | Mock MoMo: request-to-pay, simulated handset with PIN, HMAC-signed webhook | MTN MoMo Collections / Airtel / aggregator |
| Messaging | `MessagingService` | Outbox table + log | WhatsApp Cloud API, SMS gateway, Web Push |
| Object storage | `StorageService` | Local filesystem; twins AES-256-GCM encrypted; signed URLs (5 min) | S3-compatible store with SSE-KMS |

## Consequences
- The local compositor is **not** a generative try-on model. Quality KPIs (NLB) can only be measured once a real provider is plugged in.
- Swapping a provider is a configuration and adapter change, not a product change.
