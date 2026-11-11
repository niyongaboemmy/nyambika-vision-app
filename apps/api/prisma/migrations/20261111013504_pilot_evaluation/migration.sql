-- CreateTable
CREATE TABLE "Experiment" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "variants" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "primaryMetric" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ExperimentExposure" (
    "id" TEXT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentExposure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pseudoId" TEXT NOT NULL,
    "authed" BOOLEAN NOT NULL DEFAULT false,
    "props" JSONB NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "helped" BOOLEAN,
    "nps" INTEGER,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotCohort" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotMember" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ADMIN',
    "inviteCode" TEXT,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotInvite" (
    "code" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotInvite_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PilotIncident" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExperimentExposure_experimentKey_variant_idx" ON "ExperimentExposure"("experimentKey", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentExposure_experimentKey_userId_key" ON "ExperimentExposure"("experimentKey", "userId");

-- CreateIndex
CREATE INDEX "Event_name_occurredAt_idx" ON "Event"("name", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_pseudoId_name_idx" ON "Event"("pseudoId", "name");

-- CreateIndex
CREATE INDEX "SurveyResponse_trigger_createdAt_idx" ON "SurveyResponse"("trigger", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_userId_trigger_key" ON "SurveyResponse"("userId", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "PilotCohort_key_key" ON "PilotCohort"("key");

-- CreateIndex
CREATE INDEX "PilotMember_kind_subjectId_idx" ON "PilotMember"("kind", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PilotMember_cohortId_kind_subjectId_key" ON "PilotMember"("cohortId", "kind", "subjectId");

-- CreateIndex
CREATE INDEX "PilotIncident_kind_createdAt_idx" ON "PilotIncident"("kind", "createdAt");

-- Reference data for the Phase 2 pilot (plan §8.1). Experiments ship as DRAFT (no assignment until a host starts them).
INSERT INTO "Experiment" ("key", "name", "description", "variants", "status", "primaryMetric", "updatedAt") VALUES
  ('looks.initial_count', 'Progressive generation: 3 vs 2 initial looks', 'How many looks render before the first swipe. Lower cost per order vs time-to-delight.', '[{"key":"3","weight":50},{"key":"2","weight":50}]', 'DRAFT', 'hold_started', CURRENT_TIMESTAMP),
  ('twin.nudge', 'Twin vs no-twin nudge', 'Control: strong twin prompt before looks. Arm model_first: AI-model looks first with a softer twin prompt in the stream.', '[{"key":"twin_first","weight":50},{"key":"model_first","weight":50}]', 'DRAFT', 'twin_created', CURRENT_TIMESTAMP),
  ('muse.voice', 'Voice vs text Muse', 'Per-user override of muse.voice_beta. Voice beta for 25% of the cohort (plan §8.1).', '[{"key":"text","weight":75},{"key":"voice","weight":25}]', 'DRAFT', 'hold_started', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description") VALUES
  ('pilot.allowlist', false, 100, 'Closed pilot: limit Muse/Looks to cohort shoppers and ranking to cohort pages (plan §8.1).')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "PilotCohort" ("id", "key", "name", "startsAt", "endsAt") VALUES
  ('pilot-kigali-2027', 'pilot-kigali-2027', 'Kigali pilot (Gate 2 → Gate 3)', '2027-03-01T00:00:00Z', '2027-03-27T00:00:00Z')
ON CONFLICT ("key") DO NOTHING;
