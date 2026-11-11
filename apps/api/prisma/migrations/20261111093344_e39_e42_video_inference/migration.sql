-- CreateTable
CREATE TABLE "ModelEval" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "licence" TEXT NOT NULL DEFAULT '',
    "commercialUse" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelEval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoTryOn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lookId" TEXT NOT NULL,
    "generationId" TEXT,
    "variantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "modelId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "clipPath" TEXT,
    "clipIv" TEXT,
    "clipTag" TEXT,
    "clipFrames" INTEGER NOT NULL DEFAULT 0,
    "clipDeletedAt" TIMESTAMP(3),
    "consentId" TEXT,
    "gatewayJob" TEXT,
    "webpPath" TEXT,
    "mp4Path" TEXT,
    "posterPath" TEXT,
    "frames" INTEGER,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "guard" JSONB,
    "c2pa" JSONB,
    "routing" JSONB,
    "billing" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "costRwf" INTEGER NOT NULL DEFAULT 0,
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "VideoTryOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InferencePolicy" (
    "id" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InferencePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelEval_modelId_createdAt_idx" ON "ModelEval"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoTryOn_userId_createdAt_idx" ON "VideoTryOn"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoTryOn_lookId_idx" ON "VideoTryOn"("lookId");

-- E39 reference data: video try-on providers start INACTIVE; activation needs a passing NLB_VIDEO eval.
INSERT INTO "ModelVersion" ("id", "provider", "name", "version", "tier", "status", "nlbScore", "costRwf") VALUES
  ('motion-compose@1.0', 'motion-compose', 'Video try-on dev adapter (still VTON per frame, E28 guard/label/C2PA)', '1.0', 'VIDEO_TRYON', 'INACTIVE', NULL, 300),
  ('hosted-video@unconfigured', 'hosted-rest', 'Licensed hosted video try-on (adapter slot, not configured)', '0', 'VIDEO_TRYON', 'INACTIVE', NULL, 900),
  ('pool-video-vton@1.0', 'pool', 'Self-hosted video VTON on the GPU pool (E42 slot)', '1.0', 'VIDEO_TRYON', 'INACTIVE', NULL, 350)
ON CONFLICT DO NOTHING;

INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description") VALUES
  ('video.tryon', true, 100, 'See it on video (E39, FR-VID-03). Shown only while a VIDEO_TRYON model is ACTIVE in the registry (activation needs a passing NLB video eval). Off = kill switch.')
ON CONFLICT DO NOTHING;
