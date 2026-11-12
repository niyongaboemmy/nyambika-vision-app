/**
 * Default seed (docs/seed-data.md). Fictional makers and products on openly licensed real garment photos; no real
 * persons (plan §16.1). Every garment image goes through the real readiness / cut-out / embedding pipeline and
 * carries its credit (MediaCredit). Pilot shoppers are NOT created here: run `pnpm db:seed:pilot` for those.
 *
 *   pnpm db:seed           (needs the AI gateway; downloads + builds the seed photos on first run)
 */
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import "dotenv/config";
import { MAKERS, MEN_CHART, PRODUCTS, WOMEN_CHART, describe, sizesFor } from "./seed-catalogue";
import { seedPersonas } from "./seed-personas";
import { seedTailor } from "./seed-tailor";
import { seed3d } from "./seed-3d";
import { seedVr } from "./seed-vr";
import { seedRegion } from "./seed-region";

const prisma = new PrismaClient();
const AI = process.env.AI_GATEWAY_URL ?? "http://localhost:8100";
const STORAGE = resolve(process.env.STORAGE_DIR ?? "./storage");
const REAL_DIR = join(STORAGE, "seed", "real");
const AI_PY = resolve(__dirname, "../../ai/.venv/bin/python");
const ASSETS = resolve(__dirname, "../../../scripts/seed-assets");
const NO_TRYON = new Set(["fabric", "accessories"]);

interface IndexItem {
  photo: string;
  cutout: string | null;
  readiness: string;
  hex: string | null;
}
interface Credit {
  key: string;
  sources: { id: string; title: string; author: string; licence: string; licenceUrl: string; page: string }[];
  licence: string;
  licenceUrl: string;
  shareAlike: boolean;
  changes: string[];
  illustration: boolean;
}

async function ai<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${AI}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Seed photos: download (cached) + build through the garment pipeline once; reused afterwards. */
function ensureRealAssets(): Record<string, IndexItem> {
  const index = join(REAL_DIR, "index.json");
  if (!existsSync(index)) {
    console.log("• building seed photos (scripts/seed-assets: fetch + build)…");
    execFileSync(AI_PY, ["-I", join(ASSETS, "fetch.py")], { stdio: "inherit" });
    execFileSync(AI_PY, ["-I", join(ASSETS, "build.py"), "--out", REAL_DIR, "--ai", AI], { stdio: "inherit" });
  }
  return JSON.parse(readFileSync(index, "utf8"));
}

async function seedCredit(path: string, credit: Credit, extraChanges: string[] = []) {
  const s = credit.sources;
  const data = {
    assetKey: credit.key,
    sourceIds: s.map((x) => x.id),
    title: s.map((x) => x.title.replace(/\.(jpe?g|png)$/i, "")).join(" + "),
    author: [...new Set(s.map((x) => x.author))].join(", "),
    sourceUrl: s[0].page,
    licence: credit.licence,
    licenceUrl: credit.licenceUrl,
    shareAlike: credit.shareAlike,
    changes: [...credit.changes.filter((c) => extraChanges.length || !c.startsWith("background removed")), ...extraChanges],
    illustration: credit.illustration,
  };
  await prisma.mediaCredit.upsert({ where: { path }, create: { path, ...data }, update: data });
}

async function main() {
  const health = await fetch(`${AI}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`AI Gateway must be running at ${AI} (cd apps/ai && pnpm dev)`);
  const index = ensureRealAssets();
  const credits = new Map((JSON.parse(readFileSync(join(ASSETS, "attribution.json"), "utf8")) as Credit[]).map((c) => [c.key, c]));
  seedPersonas();

  // Reference data
  for (const p of [
    { code: "BASIC", name: "Basic", priceRwf: 0, maxProducts: 20, tryOnAllowance: 20, staffSeats: 1 },
    { code: "PRO", name: "Pro", priceRwf: 15000, maxProducts: 200, tryOnAllowance: 200, staffSeats: 3 },
    { code: "BUSINESS", name: "Business", priceRwf: 35000, maxProducts: 1000, tryOnAllowance: 600, staffSeats: 10 },
    { code: "COOPERATIVE", name: "Cooperative", priceRwf: 25000, maxProducts: 500, tryOnAllowance: 400, staffSeats: 25 },
  ]) {
    await prisma.plan.upsert({ where: { code: p.code }, update: p, create: p });
  }
  for (const f of [
    { key: "muse.voice_beta", enabled: true, rollout: 100, description: "Kinyarwanda/English voice Muse (beta). Plan §7.6 says OFF for the pilot by default; ON in local dev." },
    { key: "looks.daily_cap", enabled: false, rollout: 15, description: "Override daily per-user generation cap (rollout = cap)." },
    { key: "ai.kill_switch", enabled: false, rollout: 100, description: "Stop all new look generation (budget kill-switch, NFR-CST-02)." },
    { key: "looks.hd_on_hold", enabled: true, rollout: 100, description: "Render HD tier only on save/share/hold (preview first)." },
  ]) {
    await prisma.featureFlag.upsert({ where: { key: f.key }, update: { description: f.description }, create: f });
  }
  const models = (await (await fetch(`${AI}/v1/models`)).json()) as { id: string; provider: string; name: string; version: string; tier: string; cost_rwf: number; nlb_score: number | null }[];
  for (const m of models) {
    await prisma.modelVersion.upsert({
      where: { id: m.id },
      update: {},
      create: { id: m.id, provider: m.provider, name: m.name, version: m.version, tier: m.tier, costRwf: m.cost_rwf, nlbScore: m.nlb_score },
    });
  }

  // People (fictional demo logins the crawls rely on)
  const host = await prisma.user.upsert({ where: { phone: "+250788900001" }, update: {}, create: { phone: "+250788900001", name: "Nyambika Host" } });
  if (!(await prisma.roleAssignment.findFirst({ where: { userId: host.id, role: "HOST_ADMIN" } }))) {
    await prisma.roleAssignment.create({ data: { userId: host.id, role: "HOST_ADMIN" } });
  }
  const aline = await prisma.user.upsert({ where: { phone: "+250788000001" }, update: {}, create: { phone: "+250788000001", name: "Aline", locale: "rw" } });
  if (!(await prisma.roleAssignment.findFirst({ where: { userId: aline.id, role: "SHOPPER" } }))) {
    await prisma.roleAssignment.create({ data: { userId: aline.id, role: "SHOPPER" } });
  }

  for (const def of MAKERS) {
    if (await prisma.page.findUnique({ where: { handle: def.handle } })) {
      console.log(`• ${def.handle} exists, skipping`);
      continue;
    }
    const owner = await prisma.user.upsert({ where: { phone: def.owner }, update: {}, create: { phone: def.owner, name: def.ownerName } });
    const coop = def.memberType === "COOPERATIVE";
    const page = await prisma.page.create({
      data: {
        handle: def.handle,
        name: def.name,
        memberType: def.memberType,
        status: "PUBLISHED",
        verified: true,
        story: def.story,
        district: def.district,
        sector: def.sector,
        theme: def.theme,
        rating: def.rating,
        reviewCount: def.reviewCount,
        whatsapp: def.owner,
        momoMerchant: def.owner.replace("+250", "0"),
        roles: { create: [{ userId: owner.id, role: coop ? "COOP_ADMIN" : "PAGE_OWNER" }] },
        subscription: { create: { planCode: def.plan, monthlyCap: 200 } },
      },
    });
    const women = await prisma.sizeChart.create({ data: { pageId: page.id, name: "Women's body sizes (UK/EU, cm)", rows: WOMEN_CHART } });
    const men = await prisma.sizeChart.create({ data: { pageId: page.id, name: "Men's shirts (chest/neck, cm)", rows: MEN_CHART } });

    const makers: { id: string }[] = [];
    for (const m of def.members ?? []) {
      let userId: string | null = null;
      if (m.phone) {
        const u = await prisma.user.upsert({ where: { phone: m.phone }, update: {}, create: { phone: m.phone, name: m.name } });
        await prisma.roleAssignment.create({ data: { userId: u.id, role: "COOP_MEMBER", pageId: page.id } });
        userId = u.id;
      }
      makers.push(await prisma.coopMember.create({ data: { pageId: page.id, name: m.name, phone: m.phone ?? "", userId, momoMerchant: m.momo ?? "" } }));
    }

    const defs = PRODUCTS.filter((p) => p.handle === def.handle);
    for (const [gi, p] of defs.entries()) {
      const copy = describe(p, def);
      const maker = makers.length ? makers[gi % makers.length] : null;
      const sizes = sizesFor(p);
      const product = await prisma.product.create({
        data: {
          pageId: page.id,
          title: p.title.en,
          description: copy.en,
          category: p.category,
          priceRwf: p.priceRwf,
          madeToOrder: p.madeToOrder,
          leadTimeDays: p.leadTimeDays,
          styles: p.styles,
          occasions: p.occasions,
          fabric: p.fabric,
          status: "PUBLISHED",
          featured: Boolean(p.featured),
          payoutTarget: maker && gi % 2 === 0 ? "MAKER" : "PAGE",
          submittedById: owner.id,
          sizeChartId: p.chart === "none" ? null : p.chart === "men" ? men.id : women.id,
          variants: {
            create: p.colours.map((col) => ({ colourName: col.name.en, colourHex: index[col.asset]?.hex ?? "#888888", sizes, stock: p.madeToOrder ? 0 : 6 })),
          },
          ...(maker ? { makers: { create: [{ coopMemberId: maker.id }] } } : {}),
        },
        include: { variants: true },
      });
      await prisma.productCopy.createMany({
        data: (["rw", "en", "fr"] as const).map((locale) => ({ productId: product.id, locale, title: p.title[locale], description: copy[locale], needsReview: locale === "rw" })),
      });

      // Real readiness pipeline for each colour photo, credits on every stored file.
      let ready = true;
      for (const [vi, v] of product.variants.entries()) {
        const asset = p.colours[vi].asset;
        const item = index[asset];
        const credit = credits.get(asset);
        if (!item || !credit) throw new Error(`seed asset ${asset} missing: re-run scripts/seed-assets/build.py`);
        const base = `public/media/${page.id}/${v.id}`;
        mkdirSync(join(STORAGE, "public/media", page.id), { recursive: true });
        const photoPath = `${base}-photo${extname(item.photo)}`;
        copyFileSync(join(REAL_DIR, item.photo), join(STORAGE, photoPath));
        await seedCredit(photoPath, credit);
        await prisma.mediaAsset.create({ data: { productId: product.id, path: photoPath } });
        if (NO_TRYON.has(p.category)) {
          await prisma.variant.update({ where: { id: v.id }, data: { imagePath: photoPath } });
          ready = false;
          continue;
        }
        const img = readFileSync(join(STORAGE, photoPath));
        const a = await ai<{ readiness: string; cutout_b64: string; embedding: number[]; quality_score: number; notes: string[] }>("/v1/garment/assess", {
          image_b64: img.toString("base64"),
          category: product.category,
        });
        const cutoutPath = `${base}-cutout.png`;
        writeFileSync(join(STORAGE, cutoutPath), Buffer.from(a.cutout_b64, "base64"));
        await seedCredit(cutoutPath, credit, ["background removed (cut-out)"]);
        await prisma.variant.update({ where: { id: v.id }, data: { imagePath: photoPath, cutoutPath } });
        await prisma.$executeRawUnsafe(`UPDATE "Variant" SET embedding = $1::vector WHERE id = $2`, `[${a.embedding.join(",")}]`, v.id);
        ready &&= a.readiness === "READY";
        if (vi === 0) await prisma.product.update({ where: { id: product.id }, data: { qualityScore: a.quality_score, readinessNotes: a.notes } });
      }
      const readiness = NO_TRYON.has(p.category) ? "NOT_SUPPORTED" : ready ? "READY" : "NEEDS_BETTER_PHOTO";
      await prisma.product.update({
        where: { id: product.id },
        data: { readiness, ...(NO_TRYON.has(p.category) ? { readinessNotes: [p.category === "fabric" ? "Fabric by the metre: no try-on." : "Try-on does not support accessories yet."] } : {}) },
      });
    }
    console.log(`✓ ${def.name}: ${defs.length} products`);
  }
  await seedTailor(prisma);
  await seed3d(prisma);
  await seedVr(prisma);
  await seedRegion(prisma);
  console.log(
    "Seed complete. Demo shopper 0788000001 · tailor 0788100001 · coop admin 0788100002 · seller 0788100003 · coop maker 0788100004 · tailor 0788100005 · seller 0788100006 · host 0788900001",
  );
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
