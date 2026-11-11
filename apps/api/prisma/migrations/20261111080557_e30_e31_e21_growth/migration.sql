-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "productId" TEXT,
    "minSpendRwf" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "perShopper" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fundedBy" TEXT NOT NULL DEFAULT 'MAKER',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRedemption" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastOptIn" (
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastOptIn_pkey" PRIMARY KEY ("userId","pageId")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NEW_COLLECTION',
    "message" TEXT NOT NULL,
    "productIds" TEXT[],
    "link" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MakerAccess" (
    "coopMemberId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "voiceMode" BOOLEAN NOT NULL DEFAULT false,
    "smsMode" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'rw',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MakerAccess_pkey" PRIMARY KEY ("coopMemberId")
);

-- CreateTable
CREATE TABLE "AssistGrant" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "coopMemberId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "codeHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "consentText" TEXT NOT NULL,
    "consentId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "grantedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRun" (
    "waveId" TEXT NOT NULL,
    "concurrency" INTEGER NOT NULL DEFAULT 4,
    "total" INTEGER NOT NULL,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "bundlePath" TEXT NOT NULL,
    "cadenceDays" INTEGER[] DEFAULT ARRAY[2, 5, 9]::INTEGER[],
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "maxRunning" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("waveId")
);

-- CreateTable
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "itemId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationOutreach" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationOutreach_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscountCode_pageId_active_idx" ON "DiscountCode"("pageId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_pageId_code_key" ON "DiscountCode"("pageId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRedemption_orderId_key" ON "DiscountRedemption"("orderId");

-- CreateIndex
CREATE INDEX "DiscountRedemption_discountId_shopperId_idx" ON "DiscountRedemption"("discountId", "shopperId");

-- CreateIndex
CREATE INDEX "BroadcastOptIn_pageId_optedIn_idx" ON "BroadcastOptIn"("pageId", "optedIn");

-- CreateIndex
CREATE INDEX "Broadcast_pageId_createdAt_idx" ON "Broadcast"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistGrant_coopMemberId_status_idx" ON "AssistGrant"("coopMemberId", "status");

-- CreateIndex
CREATE INDEX "MigrationJob_waveId_status_idx" ON "MigrationJob"("waveId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationJob_waveId_index_key" ON "MigrationJob"("waveId", "index");

-- CreateIndex
CREATE INDEX "MigrationOutreach_itemId_idx" ON "MigrationOutreach"("itemId");

-- CreateIndex
CREATE INDEX "MigrationOutreach_waveId_kind_idx" ON "MigrationOutreach"("waveId", "kind");
