-- CreateTable
CREATE TABLE "ShowroomBooth" (
    "pageId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "banner" TEXT NOT NULL DEFAULT '',
    "featured" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowroomBooth_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "FashionShow" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "walkSec" INTEGER NOT NULL DEFAULT 14,
    "coverPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "runwayStatus" TEXT NOT NULL DEFAULT 'QUEUED',
    "modelSkin" TEXT NOT NULL DEFAULT '#825C43',
    "modelSize" TEXT NOT NULL DEFAULT 'M',
    "createdById" TEXT NOT NULL,
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FashionShow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FashionShowItem" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "glbPath" TEXT,
    "posterPath" TEXT,
    "bytes" INTEGER,
    "error" TEXT,

    CONSTRAINT "FashionShowItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FashionShowRsvp" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FashionShowRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FashionShowReaction" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "offsetMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FashionShowReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FashionShow_pageId_startsAt_idx" ON "FashionShow"("pageId", "startsAt");

-- CreateIndex
CREATE INDEX "FashionShow_status_startsAt_idx" ON "FashionShow"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "FashionShowItem_showId_position_key" ON "FashionShowItem"("showId", "position");

-- CreateIndex
CREATE INDEX "FashionShowRsvp_userId_idx" ON "FashionShowRsvp"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FashionShowRsvp_showId_userId_key" ON "FashionShowRsvp"("showId", "userId");

-- CreateIndex
CREATE INDEX "FashionShowReaction_showId_offsetMs_idx" ON "FashionShowReaction"("showId", "offsetMs");

-- AddForeignKey
ALTER TABLE "FashionShowItem" ADD CONSTRAINT "FashionShowItem_showId_fkey" FOREIGN KEY ("showId") REFERENCES "FashionShow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
