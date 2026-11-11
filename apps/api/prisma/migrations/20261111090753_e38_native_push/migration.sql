-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DEVICE',
    "token" TEXT NOT NULL,
    "p256dh" TEXT,
    "auth" TEXT,
    "orderId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "appVersion" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "orders" BOOLEAN NOT NULL DEFAULT true,
    "looks" BOOLEAN NOT NULL DEFAULT true,
    "circle" BOOLEAN NOT NULL DEFAULT true,
    "custom" BOOLEAN NOT NULL DEFAULT true,
    "wardrobe" BOOLEAN NOT NULL DEFAULT true,
    "liveActivity" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- CreateIndex
CREATE INDEX "PushDevice_userId_revokedAt_idx" ON "PushDevice"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "PushDevice_installationId_idx" ON "PushDevice"("installationId");
