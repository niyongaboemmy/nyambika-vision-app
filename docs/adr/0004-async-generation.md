# ADR-0004: Look generation pipeline

- Status: Accepted (S2)

## Decision
- Generation follows SRS Appendix B1: `QUEUED → GENERATING → GUARDING → DELIVERED | WITHHELD | FAILED`. **Billing (usage events) happens only on DELIVERED.**
- Cache key = `sha256(twin id + version, variant, model version, tier)`. Re-views are free (plan §4.4).
- **Progressive generation:** 3 looks on intent, then +2 when the shopper reaches look n−1. There are no speculative batches.
- Guardrails: daily per-user cap (default 15, `looks.daily_cap` flag), and a global kill-switch (`ai.kill_switch` flag).
- R1 runs jobs on an in-process queue with bounded concurrency. Moving to BullMQ/Redis streams (plan §4.1) is mechanical once multiple API instances run.
