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
