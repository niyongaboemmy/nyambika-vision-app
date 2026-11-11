-- Hardening pass 1 (platform): the API's routing list now includes the R4 `attr` route. `routes` is validated as an
-- exhaustive record, so complete every stored policy that predates the route with the gateway's defaults
-- (apps/ai/app/inference/policy.py). Same version: the gateway already runs these defaults. The API also upgrades
-- policies on read (`upgradePolicy`), so rows written by an older API during a rolling deploy stay valid too.
UPDATE "InferencePolicy"
SET "policy" = jsonb_set(
  "policy"::jsonb,
  '{routes,attr}',
  '{"strategy":"pool-only","latency_slo_ms":2000,"residency":"in-region","fallback":true,"pool":{"enabled":true,"cost_rwf":0.2},"hosted":{"enabled":true,"cost_rwf":0}}'::jsonb
)
WHERE NOT ("policy"::jsonb -> 'routes' ? 'attr');
