-- CreateTable
CREATE TABLE "GarmentAsset3d" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "glbPath" TEXT,
    "posterPath" TEXT,
    "bytes" INTEGER,
    "triangles" INTEGER,
    "widthM" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,
    "depthM" DOUBLE PRECISION,
    "size" TEXT NOT NULL DEFAULT 'M',
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "sha256" TEXT,
    "costRwf" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "GarmentAsset3d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotionClip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lookId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "webpPath" TEXT,
    "mp4Path" TEXT,
    "posterPath" TEXT,
    "frames" INTEGER,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "guard" JSONB,
    "c2pa" JSONB,
    "source" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "costRwf" INTEGER NOT NULL DEFAULT 0,
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "MotionClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GarmentAsset3d_variantId_key" ON "GarmentAsset3d"("variantId");

-- CreateIndex
CREATE INDEX "GarmentAsset3d_productId_idx" ON "GarmentAsset3d"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MotionClip_generationId_key" ON "MotionClip"("generationId");

-- CreateIndex
CREATE INDEX "MotionClip_userId_createdAt_idx" ON "MotionClip"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MotionClip_lookId_idx" ON "MotionClip"("lookId");
