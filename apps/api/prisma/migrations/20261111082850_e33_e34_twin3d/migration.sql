-- CreateTable
CREATE TABLE "Avatar3d" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "persona" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "framesPath" TEXT,
    "framesIv" TEXT,
    "framesTag" TEXT,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "paramsSealed" TEXT,
    "glbPath" TEXT,
    "glbIv" TEXT,
    "glbTag" TEXT,
    "posterPath" TEXT,
    "posterIv" TEXT,
    "posterTag" TEXT,
    "bytes" INTEGER,
    "triangles" INTEGER,
    "joints" INTEGER,
    "checks" JSONB,
    "eval" JSONB,
    "provider" TEXT NOT NULL DEFAULT 'parametric-cpu',
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "gatewayJob" TEXT,
    "consentId" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Avatar3d_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarFit3d" (
    "id" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "glbPath" TEXT,
    "glbIv" TEXT,
    "glbTag" TEXT,
    "posterPath" TEXT,
    "posterIv" TEXT,
    "posterTag" TEXT,
    "bytes" INTEGER,
    "triangles" INTEGER,
    "fit" JSONB,
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvatarFit3d_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Avatar3d_userId_createdAt_idx" ON "Avatar3d"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AvatarFit3d_userId_idx" ON "AvatarFit3d"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarFit3d_avatarId_variantId_size_key" ON "AvatarFit3d"("avatarId", "variantId", "size");

-- Reference data (every environment): AR mirror pilot flag (off by default) and the avatar model-registry records.
-- nlbScore for parametric-body@1.0 = apps/ai `python -m app.avatar_eval` (30/30 subgroups pass; stylised, no likeness).
INSERT INTO "FeatureFlag" ("key", "enabled", "rollout", "description") VALUES
  ('ar.mirror_pilot', false, 100, 'AR mirror pilot (E34, FR-AR-06): live camera garment overlay with on-device pose tracking. Off by default.')
ON CONFLICT DO NOTHING;

INSERT INTO "ModelVersion" ("id", "provider", "name", "version", "tier", "status", "nlbScore", "costRwf") VALUES
  ('parametric-body@1.0', 'parametric-cpu', 'Parametric body avatar (stylised, CPU dev adapter)', '1.0', 'AVATAR', 'ACTIVE', 1.0, 25),
  ('wrap-fit@1.0', 'parametric-cpu', 'Garment wrap fit on the 3D twin', '1.0', 'TRYON_3D', 'ACTIVE', NULL, 10),
  ('3dgs-smplx@unconfigured', 'gaussian-splat', '3D Gaussian splatting on SMPL-X (adapter slot, not configured)', '0', 'AVATAR', 'INACTIVE', NULL, 300)
ON CONFLICT DO NOTHING;
