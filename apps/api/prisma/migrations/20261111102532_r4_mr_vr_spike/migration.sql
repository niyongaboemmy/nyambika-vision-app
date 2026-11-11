-- R4 spike (not committed): mixed-reality fitting mirror + multi-user VR presence. No schema change; two
-- experimental flags, both off by default (presence reports land in ModerationItem kind VR_PRESENCE_REPORT).
INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description") VALUES
  ('mr.mirror_spike', false, 100, 'R4 spike: mixed-reality fitting mirror (WebXR immersive-ar, hit-test plinth, own twin or synthetic body). Experimental, off by default.'),
  ('vr.multiuser_spike', false, 100, 'R4 spike: shared presence in the VR showroom / fashion show (synthetic avatars, WebSocket gateway, host controls). Experimental, off by default.')
ON CONFLICT ("key") DO NOTHING;
