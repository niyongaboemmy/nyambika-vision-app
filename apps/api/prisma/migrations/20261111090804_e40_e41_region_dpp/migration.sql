-- CreateTable
CREATE TABLE "RegionConfig" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "wallets" TEXT[],
    "dialCode" TEXT NOT NULL,
    "languages" TEXT[],
    "vatRateBp" INTEGER NOT NULL DEFAULT 0,
    "taxNote" TEXT NOT NULL DEFAULT '',
    "legalEntity" TEXT NOT NULL DEFAULT '',
    "storageBucket" TEXT NOT NULL,
    "dbSchema" TEXT NOT NULL,
    "launched" BOOLEAN NOT NULL DEFAULT false,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegionConfig_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PageRegion" (
    "pageId" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'RW',
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "mpesaTill" TEXT NOT NULL DEFAULT '',
    "crossBorder" BOOLEAN NOT NULL DEFAULT false,
    "exportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stripeAccountId" TEXT,
    "stripeStatus" TEXT NOT NULL DEFAULT 'NONE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageRegion_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "productId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[],
    "currency" TEXT NOT NULL,
    "feeMinor" INTEGER NOT NULL,
    "etaDays" INTEGER NOT NULL DEFAULT 7,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'USD',
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopperPrefs" (
    "userId" TEXT NOT NULL,
    "displayCurrency" TEXT NOT NULL DEFAULT 'RWF',
    "country" TEXT NOT NULL DEFAULT 'RW',
    "crossBorder" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopperPrefs_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OrderMoney" (
    "orderId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "itemsMinor" INTEGER NOT NULL,
    "deliveryMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "shippingZoneId" TEXT,
    "shipCountry" TEXT,
    "displayCurrency" TEXT,
    "displayTotalMinor" INTEGER,
    "fxRate" TEXT,
    "fxSource" TEXT,
    "fxAt" TIMESTAMP(3),
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMoney_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "RegionPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "connectedAccount" TEXT,
    "merchant" TEXT NOT NULL DEFAULT '',
    "payerPhone" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "RegionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "account" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPassport" (
    "productId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "gtin" TEXT,
    "claimsVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPassport_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ProductPassportVersion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "changed" TEXT[],
    "editorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPassportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageRegion_region_idx" ON "PageRegion"("region");

-- CreateIndex
CREATE INDEX "ShippingZone_pageId_idx" ON "ShippingZone"("pageId");

-- CreateIndex
CREATE INDEX "FxRate_quote_fetchedAt_idx" ON "FxRate"("quote", "fetchedAt");

-- CreateIndex
CREATE INDEX "OrderMoney_pageId_createdAt_idx" ON "OrderMoney"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegionPayment_providerRef_key" ON "RegionPayment"("providerRef");

-- CreateIndex
CREATE INDEX "RegionPayment_orderId_idx" ON "RegionPayment"("orderId");

-- CreateIndex
CREATE INDEX "RegionPayment_status_createdAt_idx" ON "RegionPayment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPassport_gtin_key" ON "ProductPassport"("gtin");

-- CreateIndex
CREATE INDEX "ProductPassport_pageId_idx" ON "ProductPassport"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPassportVersion_productId_version_key" ON "ProductPassportVersion"("productId", "version");

-- Reference data: EAC country configs (E41). Only Rwanda is launched; the others are prepared for
-- the launch checklist. Legal entity and tax texts are placeholders for counsel to replace.
INSERT INTO "RegionConfig" ("code","name","currency","wallets","dialCode","languages","vatRateBp","taxNote","legalEntity","storageBucket","dbSchema","launched","checklist","updatedAt") VALUES
('RW','Rwanda','RWF',ARRAY['MTN_MOMO','AIRTEL_MONEY'],'250',ARRAY['rw','en','fr'],1800,'Prices include VAT where the member is VAT-registered (RRA, 18%).','Nyambika Ltd, Kigali, Rwanda (platform operator; members sell under their own names).','nyambika-rw-kgl','public',true,'{}',NOW()),
('KE','Kenya','KES',ARRAY['MPESA','AIRTEL_MONEY'],'254',ARRAY['sw','en'],1600,'Draft: prices include VAT (KRA, 16%) where the maker is registered. Counsel to confirm.','Draft: Kenyan entity to be confirmed by counsel before launch.','nyambika-ke-nbo','region_ke',false,'{}',NOW()),
('UG','Uganda','UGX',ARRAY['MTN_MOMO','AIRTEL_MONEY'],'256',ARRAY['en','sw'],1800,'Draft: prices include VAT (URA, 18%) where the maker is registered. Counsel to confirm.','Draft: Ugandan entity to be confirmed by counsel before launch.','nyambika-ug-kla','region_ug',false,'{}',NOW()),
('TZ','Tanzania','TZS',ARRAY['MPESA','AIRTEL_MONEY'],'255',ARRAY['sw','en'],1800,'Draft: prices include VAT (TRA, 18%) where the maker is registered. Counsel to confirm.','Draft: Tanzanian entity to be confirmed by counsel before launch.','nyambika-tz-dar','region_tz',false,'{}',NOW())
ON CONFLICT DO NOTHING;
