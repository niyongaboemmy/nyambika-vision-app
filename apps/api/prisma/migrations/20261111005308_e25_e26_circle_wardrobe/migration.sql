-- CreateTable
CREATE TABLE "CirclePoll" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "occasion" TEXT,
    "consentId" TEXT NOT NULL,
    "ogPath" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CirclePoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "lookId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,

    CONSTRAINT "CircleOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "name" TEXT,
    "comment" TEXT,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CircleVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WardrobeEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "budgetMax" INTEGER,
    "intentSessionId" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WardrobeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WardrobeOutfit" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "reasons" TEXT[],
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "newCostRwf" INTEGER NOT NULL DEFAULT 0,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "outputPath" TEXT,
    "guard" JSONB,
    "c2pa" JSONB,
    "costRwf" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WardrobeOutfit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CirclePoll_token_key" ON "CirclePoll"("token");

-- CreateIndex
CREATE INDEX "CirclePoll_ownerId_createdAt_idx" ON "CirclePoll"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CirclePoll_expiresAt_idx" ON "CirclePoll"("expiresAt");

-- CreateIndex
CREATE INDEX "CircleVote_pollId_createdAt_idx" ON "CircleVote"("pollId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CircleVote_pollId_deviceHash_key" ON "CircleVote"("pollId", "deviceHash");

-- CreateIndex
CREATE INDEX "WardrobeEvent_userId_date_idx" ON "WardrobeEvent"("userId", "date");

-- CreateIndex
CREATE INDEX "WardrobeOutfit_userId_createdAt_idx" ON "WardrobeOutfit"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CircleOption" ADD CONSTRAINT "CircleOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "CirclePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleVote" ADD CONSTRAINT "CircleVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "CirclePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleVote" ADD CONSTRAINT "CircleVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "CircleOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WardrobeOutfit" ADD CONSTRAINT "WardrobeOutfit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WardrobeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
