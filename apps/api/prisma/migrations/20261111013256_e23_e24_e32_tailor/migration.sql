-- CreateTable
CREATE TABLE "MeasurementProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "consentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "customOrderId" TEXT,
    "consentId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeasurementShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MorphTemplate" (
    "productId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MorphTemplate_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "GarmentMorph" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "specKey" TEXT NOT NULL,
    "cutoutPath" TEXT NOT NULL,
    "frame" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GarmentMorph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TailorService" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startingPriceRwf" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "requiredMeasurements" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TailorService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "shopperId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "serviceId" TEXT,
    "spec" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "estimateRwf" INTEGER NOT NULL DEFAULT 0,
    "size" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "previewPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "quotePriceRwf" INTEGER,
    "depositPct" INTEGER,
    "leadTimeDays" INTEGER,
    "quoteNote" TEXT,
    "quotedAt" TIMESTAMP(3),
    "depositRwf" INTEGER,
    "balanceRwf" INTEGER,
    "orderId" TEXT,
    "readyBy" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomOrderEvent" (
    "id" TEXT NOT NULL,
    "customOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomOrderPayment" (
    "id" TEXT NOT NULL,
    "customOrderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "amountRwf" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomOrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentSlot" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT NOT NULL DEFAULT '',
    "bookedById" TEXT,
    "customOrderId" TEXT,
    "bookedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementProfile_userId_key" ON "MeasurementProfile"("userId");

-- CreateIndex
CREATE INDEX "MeasurementShare_userId_createdAt_idx" ON "MeasurementShare"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MeasurementShare_pageId_expiresAt_idx" ON "MeasurementShare"("pageId", "expiresAt");

-- CreateIndex
CREATE INDEX "MorphTemplate_pageId_idx" ON "MorphTemplate"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "GarmentMorph_variantId_specKey_key" ON "GarmentMorph"("variantId", "specKey");

-- CreateIndex
CREATE INDEX "TailorService_pageId_active_idx" ON "TailorService"("pageId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CustomOrder_code_key" ON "CustomOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomOrder_orderId_key" ON "CustomOrder"("orderId");

-- CreateIndex
CREATE INDEX "CustomOrder_pageId_createdAt_idx" ON "CustomOrder"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomOrder_shopperId_createdAt_idx" ON "CustomOrder"("shopperId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomOrderPayment_paymentId_key" ON "CustomOrderPayment"("paymentId");

-- CreateIndex
CREATE INDEX "AppointmentSlot_pageId_startsAt_idx" ON "AppointmentSlot"("pageId", "startsAt");

-- CreateIndex
CREATE INDEX "AppointmentSlot_bookedById_idx" ON "AppointmentSlot"("bookedById");

-- AddForeignKey
ALTER TABLE "CustomOrderEvent" ADD CONSTRAINT "CustomOrderEvent_customOrderId_fkey" FOREIGN KEY ("customOrderId") REFERENCES "CustomOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomOrderPayment" ADD CONSTRAINT "CustomOrderPayment_customOrderId_fkey" FOREIGN KEY ("customOrderId") REFERENCES "CustomOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- E23/E24/E32 synthetic demo data (seeded makers only; idempotent). Also run by prisma/seed.ts on fresh databases.

-- Size charts: extend the standard women's chart with waist and hip ranges (cm) and link products to it.
UPDATE "SizeChart" SET "rows" = '[{"size":"S","bustCm":[80,86],"waistCm":[62,68],"hipsCm":[86,92]},{"size":"M","bustCm":[87,93],"waistCm":[69,75],"hipsCm":[93,99]},{"size":"L","bustCm":[94,101],"waistCm":[76,83],"hipsCm":[100,107]},{"size":"XL","bustCm":[102,110],"waistCm":[84,92],"hipsCm":[108,116]}]'::jsonb
WHERE "name" = 'Standard women''s (RW)' AND NOT ("rows"::text LIKE '%waistCm%');

UPDATE "Product" p SET "sizeChartId" = c."id"
FROM "SizeChart" c
WHERE c."pageId" = p."pageId" AND c."name" = 'Standard women''s (RW)' AND p."sizeChartId" IS NULL
  AND p."category" IN ('dress', 'umushanana', 'kitenge', 'shirt', 'skirt', 'top');

-- Customizable products (live morph templates) for Uwase Couture and Inzozi Atelier.
INSERT INTO "MorphTemplate" ("productId", "pageId", "options", "updatedAt")
SELECT p."id", p."pageId", t.options::jsonb, CURRENT_TIMESTAMP
FROM "Product" p
JOIN "Page" g ON g."id" = p."pageId"
JOIN (VALUES
  ('uwase-couture', 'Uruziga a-line dress', '{"enabled":true,"colourEnabled":true,"colourDeltaRwf":3000,"baseLength":"knee","baseSleeve":"short","lengths":{"mini":0,"knee":0,"midi":2000,"maxi":5000},"sleeves":{"sleeveless":0,"short":0,"elbow":1500,"long":3000},"leadTimeDays":4}'),
  ('uwase-couture', 'Inyenyeri wrap dress', '{"enabled":true,"colourEnabled":true,"colourDeltaRwf":3000,"baseLength":"knee","baseSleeve":"short","lengths":{"knee":0,"midi":2500,"maxi":6000},"sleeves":{"short":0,"elbow":2000,"long":3500},"leadTimeDays":5}'),
  ('inzozi-atelier', 'Umuraba a-line dress', '{"enabled":true,"colourEnabled":true,"colourDeltaRwf":2500,"baseLength":"knee","baseSleeve":"short","lengths":{"mini":0,"knee":0,"midi":2000,"maxi":4500},"sleeves":{"sleeveless":0,"short":0,"elbow":1500,"long":2500},"leadTimeDays":6}')
) AS t(handle, title, options) ON t.handle = g."handle" AND t.title = p."title"
ON CONFLICT ("productId") DO NOTHING;

-- One service per tailor on the Maker Space (FR-CAT-07).
INSERT INTO "TailorService" ("id", "pageId", "title", "description", "startingPriceRwf", "leadTimeDays", "requiredMeasurements", "active", "createdAt")
SELECT s.id, g."id", s.title, s.description, s.price, s.days, s.req::text[], true, CURRENT_TIMESTAMP
FROM "Page" g
JOIN (VALUES
  ('svc-uwase-own-fabric', 'uwase-couture', 'Custom dress from your fabric', 'Bring your kitenge (3–4 m). I cut and sew a dress to your measurements, with one fitting.', 25000, 7, '{bustCm,waistCm,hipsCm,heightCm}'),
  ('svc-inzozi-umushanana', 'inzozi-atelier', 'Umushanana for your ceremony', 'Hand-finished umushanana for gusaba and weddings, sash and lining included. Two fittings.', 45000, 14, '{bustCm,waistCm,hipsCm,heightCm,shoulderCm}')
) AS s(id, handle, title, description, price, days, req) ON s.handle = g."handle"
ON CONFLICT ("id") DO NOTHING;

-- Fitting slots for the next 10 days (10:00 and 15:00 Kigali, UTC+2).
INSERT INTO "AppointmentSlot" ("id", "pageId", "startsAt", "durationMin", "location", "createdAt")
SELECT 'slot-' || g."handle" || '-' || d || '-' || hh, g."id",
       date_trunc('day', CURRENT_TIMESTAMP) + (d || ' days')::interval + (hh || ' hours')::interval,
       45, g."sector" || ' studio', CURRENT_TIMESTAMP
FROM "Page" g, generate_series(1, 10) AS d, (VALUES (8), (13)) AS h(hh)
WHERE g."handle" IN ('uwase-couture', 'inzozi-atelier')
ON CONFLICT ("id") DO NOTHING;
