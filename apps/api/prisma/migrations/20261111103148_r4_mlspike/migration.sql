-- CreateTable
CREATE TABLE "TrainingDataset" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "parentHash" TEXT,
    "items" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingTombstone" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "productId" TEXT,
    "consentRecordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'withdrawn',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSignal" (
    "id" TEXT NOT NULL,
    "week" DATE NOT NULL,
    "region" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT,
    "colour" TEXT,
    "pattern" TEXT,
    "occasion" TEXT,
    "priceBand" TEXT,
    "pseudoId" TEXT NOT NULL,
    "pageId" TEXT,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingDataset_version_key" ON "TrainingDataset"("version");

-- CreateIndex
CREATE INDEX "TrainingTombstone_pageId_idx" ON "TrainingTombstone"("pageId");

-- CreateIndex
CREATE INDEX "TrendSignal_week_idx" ON "TrendSignal"("week");

-- R4 spike reference data. Both flags start OFF: the spike is not committed.
INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description") VALUES
  ('ml.local_attr_spike', false, 100, 'R4 spike: auto-fill suggestions (category, pattern family, colour) in the studio product editor from the local attribute model via the E42 router. Needs an ACTIVE ATTR_SUGGEST model (passing ATTR_SPIKE eval).'),
  ('insights.trends_spike', false, 100, 'R4 spike: k-anonymous market trend card (k >= 10) for members on the studio home: rising colours/patterns/occasions, demand vs supply gaps, price-band hints.')
ON CONFLICT DO NOTHING;

-- The trend aggregation is registered like a model so its privacy/stability evals sit next to the other ModelEval records.
INSERT INTO "ModelVersion" ("id", "provider", "name", "version", "tier", "status", "nlbScore", "costRwf") VALUES
  ('trends-spike@1', 'rules', 'Trend insights spike (k-anonymous aggregation, k=10, maker dominance rule)', '1', 'TRENDS_INSIGHT', 'INACTIVE', NULL, 0)
ON CONFLICT DO NOTHING;
