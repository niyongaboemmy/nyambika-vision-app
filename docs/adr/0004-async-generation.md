# ADR-0004: Look generation pipeline

- Status: Accepted (S2)

## Decision
- Generation follows SRS Appendix B1: `QUEUED → GENERATING → GUARDING → DELIVERED | WITHHELD | FAILED`. **Billing (usage events) happens only on DELIVERED.**
- Cache key = `sha256(twin id + version, variant, model version, tier)`. Re-views are free (plan §4.4).
- **Progressive generation:** 3 looks on intent, then +2 when the shopper reaches look n−1. There are no speculative batches.
- Guardrails: daily per-user cap (default 15, `looks.daily_cap` flag), and a global kill-switch (`ai.kill_switch` flag).
- Jobs run on a **BullMQ queue in Redis** (`look-generation`), job id = generation id (idempotent enqueue), worker concurrency `GENERATION_CONCURRENCY` (default 2). `GENERATION_WORKER=0` runs an API instance without a worker, so web and worker processes can scale separately.
- E27/E28 reuse the same queue under their own job names: `asset3d` (3D garment, billed `ASSET_3D` on READY) and `motion` (motion preview, billed `VIDEO` on DELIVERED). `GenerationService.handle(name, fn)` registers a handler and `enqueue(name, data, jobId)` adds a job; `render` stays the look job and an unknown job name fails instead of being run as a look.
