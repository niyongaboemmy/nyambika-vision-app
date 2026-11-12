-- CreateTable
CREATE TABLE "MediaCredit" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "sourceIds" TEXT[],
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "licenceUrl" TEXT NOT NULL,
    "shareAlike" BOOLEAN NOT NULL DEFAULT false,
    "changes" TEXT[],
    "illustration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCopy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaCredit_path_key" ON "MediaCredit"("path");

-- CreateIndex
CREATE INDEX "MediaCredit_assetKey_idx" ON "MediaCredit"("assetKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCopy_productId_locale_key" ON "ProductCopy"("productId", "locale");
