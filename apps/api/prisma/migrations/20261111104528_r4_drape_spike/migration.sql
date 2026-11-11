-- R4 spike (not committed): physics drape + fit heatmap + tailor pattern-to-3D.
-- No schema change. Reference data only: the flag (off by default) and the model-registry entry that
-- DRAPE_SPIKE eval records (ModelEval) refer to. Tier SPIKE never serves production traffic.
INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description")
VALUES ('fit.heatmap_spike', false, 100, 'R4 spike: physics drape + fit heatmap on the 3D twin and tailor pattern-to-3D preview (experimental, visual guidance only)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "ModelVersion" ("id", "provider", "name", "version", "tier", "status", "costRwf")
VALUES ('drape-pbd-cpu@0.1', 'nyambika', 'Pattern drape PBD (CPU, numpy) - R4 spike', '0.1', 'SPIKE', 'SPIKE', 0)
ON CONFLICT ("id") DO NOTHING;
