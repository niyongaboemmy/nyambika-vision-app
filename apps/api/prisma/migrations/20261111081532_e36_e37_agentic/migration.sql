-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "webhookSecretSealed" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "env" TEXT NOT NULL DEFAULT 'LIVE',
    "scopes" TEXT[],
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 120,
    "monthlyQuota" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCall" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "keyId" TEXT,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "tool" TEXT,
    "status" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChannelSetting" (
    "pageId" TEXT NOT NULL,
    "agentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "marketplacesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChannelSetting_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "AgentCheckout" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "items" JSONB NOT NULL,
    "itemsHash" TEXT NOT NULL,
    "subtotalRwf" INTEGER NOT NULL,
    "payoutLabel" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "mandateNonce" TEXT NOT NULL,
    "mandateExpiresAt" TIMESTAMP(3) NOT NULL,
    "mandateUsedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "orderId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'REST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerContract" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "monthlyQuota" INTEGER NOT NULL DEFAULT 1000,
    "monthlyFeeRwf" INTEGER NOT NULL DEFAULT 0,
    "overagePriceRwf" INTEGER NOT NULL DEFAULT 150,
    "hardCap" BOOLEAN NOT NULL DEFAULT false,
    "sandboxDailyCap" INTEGER NOT NULL DEFAULT 50,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerTryonJob" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "modelId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "garmentPath" TEXT NOT NULL,
    "outputPath" TEXT,
    "guard" JSONB,
    "c2pa" JSONB,
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "clientReference" TEXT,
    "webhookUrl" TEXT,
    "webhookStatus" TEXT NOT NULL DEFAULT 'NONE',
    "webhookAttempts" INTEGER NOT NULL DEFAULT 0,
    "webhookLastAt" TIMESTAMP(3),
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "overage" BOOLEAN NOT NULL DEFAULT false,
    "priceRwf" INTEGER NOT NULL DEFAULT 0,
    "costRwf" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "error" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "PartnerTryonJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiClient_kind_status_idx" ON "ApiClient"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ApiKey_clientId_idx" ON "ApiKey"("clientId");

-- CreateIndex
CREATE INDEX "AgentCall_clientId_createdAt_idx" ON "AgentCall"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCall_createdAt_idx" ON "AgentCall"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCheckout_mandateNonce_key" ON "AgentCheckout"("mandateNonce");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCheckout_orderId_key" ON "AgentCheckout"("orderId");

-- CreateIndex
CREATE INDEX "AgentCheckout_createdAt_idx" ON "AgentCheckout"("createdAt");

-- CreateIndex
CREATE INDEX "AgentCheckout_pageId_idx" ON "AgentCheckout"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCheckout_clientId_idempotencyKey_key" ON "AgentCheckout"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerContract_clientId_key" ON "PartnerContract"("clientId");

-- CreateIndex
CREATE INDEX "PartnerTryonJob_clientId_createdAt_idx" ON "PartnerTryonJob"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerTryonJob_clientId_idempotencyKey_key" ON "PartnerTryonJob"("clientId", "idempotencyKey");

-- Reference data: host kill-switches for the agent channel and the partner try-on API (off = channel open).
INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description") VALUES
  ('agents.kill_switch', false, 100, 'Pause every external agent channel (public API, MCP, agent checkout)'),
  ('partners.kill_switch', false, 100, 'Pause the B2B try-on API (jobs are refused with 503)')
ON CONFLICT ("key") DO NOTHING;
