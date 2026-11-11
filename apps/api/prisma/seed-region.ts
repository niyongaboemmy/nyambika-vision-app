/**
 * E40/E41 demo data (synthetic only): one Kenyan maker page selling in KES with an M-Pesa till and a
 * mock Stripe Connect account, export settings on a Rwandan page, and a two-version product passport.
 * Idempotent. Run: `pnpm db:seed:region` (also called at the end of `pnpm db:seed`).
 */
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { convertMinor, PassportData } from "@nyambika/contracts";
import { DEV_FIXED_RATES } from "../src/modules/region/fx";

const KE_HANDLE = "nairobi-kikoi-studio";

export async function seedRegion(prisma: PrismaClient) {
  // ---- Kenyan page (synthetic maker, reuses seeded catalogue photos)
  let ke = await prisma.page.findUnique({ where: { handle: KE_HANDLE } });
  if (!ke) {
    const source = await prisma.page.findUnique({
      where: { handle: "kigali-kitenge-house" },
      include: { products: { where: { status: "PUBLISHED", readiness: "READY" }, take: 3, orderBy: { createdAt: "asc" }, include: { variants: true } } },
    });
    if (!source?.products.length) {
      console.log("• region seed: base catalogue missing, run the main seed first");
      return;
    }
    const owner = await prisma.user.upsert({ where: { phone: "+254711000001" }, update: {}, create: { phone: "+254711000001", name: "Wanjiru Kamau (synthetic)" } });
    ke = await prisma.page.create({
      data: {
        handle: KE_HANDLE,
        name: "Nairobi Kikoi Studio",
        memberType: "SELLER",
        status: "PUBLISHED",
        verified: true,
        story: "Kikoi and kitenge pieces cut and sewn in Kariokor, Nairobi. Synthetic demo maker for the Kenya pilot.",
        district: "Nairobi",
        sector: "Kariokor",
        theme: "indigo",
        rating: 4.6,
        reviewCount: 18,
        whatsapp: "+254711000001",
        roles: { create: [{ userId: owner.id, role: "PAGE_OWNER" }] },
        subscription: { create: { planCode: "BASIC", monthlyCap: 200 } },
      },
    });
    const kes = [380_000, 450_000, 520_000]; // KES 3,800 / 4,500 / 5,200 in minor units
    for (const [i, sp] of source.products.entries()) {
      const amountMinor = kes[i % kes.length];
      const p = await prisma.product.create({
        data: {
          pageId: ke.id,
          title: ["Kikoi wrap dress", "Kitenge safari shirt", "Pwani maxi skirt"][i] ?? sp.title,
          description: `${sp.description} Sewn in Kariokor, Nairobi.`,
          category: sp.category,
          priceRwf: convertMinor(amountMinor, "KES", "RWF", DEV_FIXED_RATES), // reporting only
          styles: sp.styles,
          occasions: sp.occasions,
          fabric: "Cotton kikoi",
          status: "PUBLISHED",
          readiness: sp.readiness,
          qualityScore: sp.qualityScore,
          featured: i === 0,
          submittedById: owner.id,
          variants: { create: sp.variants.map((v) => ({ colourName: v.colourName, colourHex: v.colourHex, sizes: v.sizes, stock: 20, imagePath: v.imagePath, cutoutPath: v.cutoutPath })) },
        },
      });
      await prisma.productPrice.create({ data: { productId: p.id, pageId: ke.id, currency: "KES", amountMinor } });
    }
    console.log("✓ Nairobi Kikoi Studio (KE, KES)");
  }
  await prisma.pageRegion.upsert({
    where: { pageId: ke.id },
    create: { pageId: ke.id, region: "KE", currency: "KES", mpesaTill: "5123456", crossBorder: true, exportEnabled: true, stripeAccountId: "acct_mock_ke0001", stripeStatus: "ACTIVE" },
    update: {},
  });
  if (!(await prisma.shippingZone.count({ where: { pageId: ke.id } }))) {
    await prisma.shippingZone.createMany({
      data: [
        { pageId: ke.id, name: "East Africa", countries: ["RW", "UG", "TZ"], currency: "KES", feeMinor: 120_000, etaDays: 4 },
        { pageId: ke.id, name: "Europe & UK", countries: ["GB", "DE", "FR", "NL", "BE", "IE", "IT", "ES", "SE"], currency: "KES", feeMinor: 450_000, etaDays: 8 },
        { pageId: ke.id, name: "Rest of world", countries: ["*"], currency: "KES", feeMinor: 600_000, etaDays: 12 },
      ],
    });
  }

  // ---- Rwandan export settings: Kigali Kitenge House sells to the diaspora by card (Stripe mock account)
  const kkh = await prisma.page.findUnique({ where: { handle: "kigali-kitenge-house" } });
  if (kkh) {
    await prisma.pageRegion.upsert({
      where: { pageId: kkh.id },
      create: { pageId: kkh.id, region: "RW", currency: "RWF", crossBorder: true, exportEnabled: true, stripeAccountId: "acct_mock_rw0001", stripeStatus: "ACTIVE" },
      update: {},
    });
    if (!(await prisma.shippingZone.count({ where: { pageId: kkh.id } }))) {
      await prisma.shippingZone.createMany({
        data: [
          { pageId: kkh.id, name: "East Africa", countries: ["KE", "UG", "TZ", "BI"], currency: "RWF", feeMinor: 12_000, etaDays: 4 },
          { pageId: kkh.id, name: "Europe & North America", countries: ["GB", "DE", "FR", "BE", "NL", "US", "CA"], currency: "RWF", feeMinor: 45_000, etaDays: 9 },
        ],
      });
    }
  }

  // ---- A product passport with two versions (cooperative piece, maker attribution)
  const coop = await prisma.page.findUnique({ where: { handle: "abahizi-coop" }, include: { products: { where: { status: "PUBLISHED" }, take: 1, orderBy: { createdAt: "asc" }, include: { makers: { include: { coopMember: true } } } } } });
  const prod = coop?.products[0];
  const editor = await prisma.user.findUnique({ where: { phone: "+250788100002" } });
  if (coop && prod && editor && !(await prisma.productPassport.findUnique({ where: { productId: prod.id } }))) {
    const makers = prod.makers.filter((m) => m.coopMember.attributionConsent).map((m) => m.coopMember.name);
    const v1 = PassportData.parse({
      materials: [{ fibre: "Cotton", percent: 100, origin: "Tanzania" }],
      fabric: { type: "Wax-print kitenge", origin: "Dar es Salaam, Tanzania" },
      origin: { country: "RW", district: coop.district, cooperative: coop.name, makers, handmade: true },
      production: { date: "2026-10", batch: "ABZ-2610-A" },
      process: [
        { step: "Fabric sourced", by: coop.name, place: "Kigali" },
        { step: "Cut by hand", by: makers[0] ?? coop.name, place: coop.sector },
        { step: "Sewn and finished", by: makers[0] ?? coop.name, place: coop.sector },
      ],
      care: ["Hand wash cold, inside out", "Dry in shade", "Iron on medium"],
      repair: { offered: true, services: ["Hem and fit alterations", "Seam repair"], contact: coop.whatsapp },
      claims: { madeIn: "Made in Rwanda", impactStory: "Sewn by a women-led cooperative in Nyamirambo; members are paid per piece into their own Mobile Money." },
    });
    const v2 = { ...v1, certifications: [{ name: "Made in Rwanda (MINICOM brand)", issuer: "Rwanda Ministry of Trade and Industry", reference: "synthetic-demo" }] };
    await prisma.productPassportVersion.createMany({
      data: [
        { productId: prod.id, version: 1, data: v1, note: "First passport", changed: ["first version"], editorId: editor.id },
        { productId: prod.id, version: 2, data: v2, note: "Added certification", changed: ["certifications"], editorId: editor.id },
      ],
    });
    await prisma.productPassport.create({ data: { productId: prod.id, pageId: coop.id, version: 2, data: v2 } });
    console.log(`✓ passport for "${prod.title}" (v2)`);
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedRegion(prisma)
    .finally(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
