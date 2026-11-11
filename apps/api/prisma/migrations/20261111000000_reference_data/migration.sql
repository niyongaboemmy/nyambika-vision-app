-- Reference data the application requires on every environment (plans per feasibility §10.2, flags).
INSERT INTO "Plan" ("code", "name", "priceRwf", "maxProducts", "tryOnAllowance", "staffSeats") VALUES
  ('BASIC', 'Basic', 0, 20, 20, 1),
  ('PRO', 'Pro', 15000, 200, 200, 3),
  ('BUSINESS', 'Business', 35000, 1000, 600, 10),
  ('COOPERATIVE', 'Cooperative', 25000, 500, 400, 25)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description") VALUES
  ('muse.voice_beta', false, 100, 'Kinyarwanda/English voice Muse (beta). OFF by default for the pilot (plan §7.6).'),
  ('looks.daily_cap', false, 15, 'Override daily per-user generation cap (rollout = cap).'),
  ('ai.kill_switch', false, 100, 'Stop all new look generation (budget kill-switch, NFR-CST-02).'),
  ('looks.hd_on_hold', true, 100, 'Render HD tier only on save/share/hold (preview first).')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "ModelVersion" ("id", "provider", "name", "version", "tier", "status", "costRwf") VALUES
  ('local-compositor@1.0-preview', 'local', 'local-compositor', '1.0', 'PREVIEW', 'ACTIVE', 40),
  ('local-compositor@1.0-hd', 'local', 'local-compositor', '1.0', 'HD', 'ACTIVE', 110)
ON CONFLICT ("id") DO NOTHING;
