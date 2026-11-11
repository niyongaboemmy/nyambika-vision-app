-- CreateTable
CREATE TABLE "MigrationWave" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationWave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationItem" (
    "id" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "legacyUrl" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "defects" JSONB NOT NULL,
    "reviewToken" TEXT NOT NULL,
    "ownerNote" TEXT NOT NULL DEFAULT '',
    "signedOffAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redirect" (
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Redirect_pkey" PRIMARY KEY ("fromPath")
);

-- CreateTable
CREATE TABLE "NotFoundHit" (
    "path" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotFoundHit_pkey" PRIMARY KEY ("path")
);

-- CreateIndex
CREATE UNIQUE INDEX "MigrationItem_pageId_key" ON "MigrationItem"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationItem_reviewToken_key" ON "MigrationItem"("reviewToken");

-- AddForeignKey
ALTER TABLE "MigrationItem" ADD CONSTRAINT "MigrationItem_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "MigrationWave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
