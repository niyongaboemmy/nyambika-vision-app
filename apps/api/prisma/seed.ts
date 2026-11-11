/**
 * Synthetic seed (plan §16.1: no real persons). Generates garment + persona assets through the
 * AI Gateway's asset script, then creates makers, products, plans, flags and demo accounts.
 * Every garment image goes through the real readiness / cut-out / embedding pipeline.
 */
import { PrismaClient, type MemberType } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import "dotenv/config";
import { seedTailor } from "./seed-tailor";

const prisma = new PrismaClient();
const AI = process.env.AI_GATEWAY_URL ?? "http://localhost:8100";
const STORAGE = resolve(process.env.STORAGE_DIR ?? "./storage");
const SEED_DIR = join(STORAGE, "seed");
const AI_DIR = resolve(__dirname, "../../ai");

interface ManifestItem {
  slug: string;
  kind: string;
  category: string;
  pattern: string;
  colour: string;
  hex: string;
}

const PAGES: {
  handle: string;
  name: string;
  memberType: MemberType;
  owner: string;
  ownerName: string;
  district: string;
  sector: string;
  story: string;
  theme: string;
  rating: number;
  reviewCount: number;
  momo: string;
  kinds: string[];
}[] = [
  {
    handle: "uwase-couture",
    name: "Uwase Couture",
    memberType: "TAILOR",
    owner: "+250788100001",
    ownerName: "Uwase Diane",
    district: "Gasabo",
    sector: "Kimihurura",
    story: "Since 2014 I design wedding and office wear from Rwandan kitenge, made to your measurements.",
    theme: "terra",
    rating: 4.8,
    reviewCount: 126,
    momo: "0788100001",
    kinds: ["wrap-dress", "a-line-dress"],
  },
  {
    handle: "abahizi-coop",
    name: "Abahizi Sewing Cooperative",
    memberType: "COOPERATIVE",
    owner: "+250788100002",
    ownerName: "Mukarugwiza Solange",
    district: "Nyarugenge",
    sector: "Nyamirambo",
    story: "Twenty-two women sewing umushanana and everyday kitenge in Nyamirambo. Every piece names the maker who sewed it.",
    theme: "forest",
    rating: 4.7,
    reviewCount: 58,
    momo: "0788100002",
    kinds: ["umushanana", "skirt"],
  },
  {
    handle: "kigali-kitenge-house",
    name: "Kigali Kitenge House",
    memberType: "SELLER",
    owner: "+250788100003",
    ownerName: "Habimana Eric",
    district: "Gasabo",
    sector: "Remera",
    story: "Ready-to-wear kitenge shirts and skirts, in stock and delivered across Kigali within a day.",
    theme: "indigo",
    rating: 4.5,
    reviewCount: 211,
    momo: "0788100003",
    kinds: ["shirt", "skirt"],
  },
  {
    handle: "inzozi-atelier",
    name: "Inzozi Atelier",
    memberType: "TAILOR",
    owner: "+250788100005",
    ownerName: "Ishimwe Patrick",
    district: "Kicukiro",
    sector: "Kicukiro",
    story: "Tailored shirts and modern African occasion wear. Book a fitting and we sew it in five days.",
    theme: "violet",
    rating: 4.6,
    reviewCount: 74,
    momo: "0788100005",
    kinds: ["shirt", "a-line-dress"],
  },
  {
    handle: "imena-styles",
    name: "Imena Styles",
    memberType: "SELLER",
    owner: "+250788100006",
    ownerName: "Umutoni Claudine",
    district: "Gasabo",
    sector: "Kacyiru",
    story: "Bold party dresses and wraps for the weekend. New prints every Friday.",
    theme: "terra",
    rating: 4.4,
    reviewCount: 39,
    momo: "0788100006",
    kinds: ["wrap-dress", "umushanana"],
  },
];

const KIND_INFO: Record<string, { title: string; price: [number, number]; occasions: string[]; styles: string[] }> = {
  "a-line-dress": { title: "A-line dress", price: [28000, 42000], occasions: ["wedding", "church", "party"], styles: ["elegant", "modern"] },
  "wrap-dress": { title: "Wrap dress", price: [32000, 48000], occasions: ["wedding", "party", "office"], styles: ["elegant", "bold"] },
  umushanana: { title: "Umushanana", price: [55000, 85000], occasions: ["traditional-ceremony", "wedding"], styles: ["traditional", "elegant"] },
  shirt: { title: "Kitenge shirt", price: [18000, 26000], occasions: ["office", "casual", "party"], styles: ["modern", "casual"] },
  skirt: { title: "Kitenge skirt", price: [15000, 24000], occasions: ["office", "church", "casual"], styles: ["casual", "minimal"] },
};

const PATTERN_NAME: Record<string, string> = {
  circles: "Uruziga",
  crosses: "Inyenyeri",
  diamonds: "Imigongo",
  zigzag: "Umuraba",
  waves: "Ikiyaga",
};

const SIZES = ["S", "M", "L", "XL"];
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

async function ai<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${AI}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function ensureAssets(): ManifestItem[] {
  const manifestPath = join(SEED_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    mkdirSync(SEED_DIR, { recursive: true });
    const out = execFileSync(join(AI_DIR, ".venv/bin/python"), [join(AI_DIR, "scripts/make_seed_assets.py"), SEED_DIR, "--catalogue", "--personas"]);
    writeFileSync(manifestPath, out);
  }
  mkdirSync(join(STORAGE, "personas"), { recursive: true });
  for (let i = 1; i <= 5; i++) copyFileSync(join(SEED_DIR, `persona-${i}.png`), join(STORAGE, "personas", `persona-${i}.png`));
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

async function main() {
  const health = await fetch(`${AI}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`AI Gateway must be running at ${AI} (cd apps/ai && pnpm dev)`);
  const manifest = ensureAssets();

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

  // People
  const host = await prisma.user.upsert({ where: { phone: "+250788900001" }, update: {}, create: { phone: "+250788900001", name: "Nyambika Host" } });
  if (!(await prisma.roleAssignment.findFirst({ where: { userId: host.id, role: "HOST_ADMIN" } }))) {
    await prisma.roleAssignment.create({ data: { userId: host.id, role: "HOST_ADMIN" } });
  }
  const aline = await prisma.user.upsert({ where: { phone: "+250788000001" }, update: {}, create: { phone: "+250788000001", name: "Aline", locale: "rw" } });
  if (!(await prisma.roleAssignment.findFirst({ where: { userId: aline.id, role: "SHOPPER" } }))) {
    await prisma.roleAssignment.create({ data: { userId: aline.id, role: "SHOPPER" } });
  }

  // Group catalogue images into products by (kind, pattern)
  const groups = new Map<string, ManifestItem[]>();
  for (const m of manifest) {
    const k = `${m.kind}|${m.pattern}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const used = new Set<string>();

  for (const [pi, def] of PAGES.entries()) {
    if (await prisma.page.findUnique({ where: { handle: def.handle } })) {
      console.log(`• ${def.handle} exists, skipping`);
      continue;
    }
    const owner = await prisma.user.upsert({ where: { phone: def.owner }, update: {}, create: { phone: def.owner, name: def.ownerName } });
    const role = def.memberType === "COOPERATIVE" ? "COOP_ADMIN" : "PAGE_OWNER";
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
        momoMerchant: def.momo,
        roles: { create: [{ userId: owner.id, role }] },
        subscription: { create: { planCode: def.memberType === "COOPERATIVE" ? "COOPERATIVE" : pi % 2 ? "BASIC" : "PRO", monthlyCap: 200 } },
      },
    });
    await prisma.sizeChart.create({
      data: {
        pageId: page.id,
        name: "Standard women's (RW)",
        rows: [
          { size: "S", bustCm: [80, 86] },
          { size: "M", bustCm: [87, 93] },
          { size: "L", bustCm: [94, 101] },
          { size: "XL", bustCm: [102, 110] },
        ],
      },
    });

    let makers: { id: string; name: string }[] = [];
    if (def.memberType === "COOPERATIVE") {
      const member = await prisma.user.upsert({ where: { phone: "+250788100004" }, update: {}, create: { phone: "+250788100004", name: "Mukamana Jeanne" } });
      await prisma.roleAssignment.create({ data: { userId: member.id, role: "COOP_MEMBER", pageId: page.id } });
      makers = await Promise.all(
        [
          { name: "Mukamana Jeanne", phone: "+250788100004", userId: member.id, momoMerchant: "0788100004" },
          { name: "Uwimana Grace", phone: "", userId: null, momoMerchant: "0788100007" },
          { name: "Nyirahabimana Alice", phone: "", userId: null, momoMerchant: "" },
        ].map((m) => prisma.coopMember.create({ data: { ...m, pageId: page.id } })),
      );
    }

    // Pick up to 5 product groups for this page, preferring its kinds
    const picks = [...groups.entries()].filter(([k]) => !used.has(k) && def.kinds.includes(k.split("|")[0])).slice(0, 5);
    for (const [gi, [key, items]] of picks.entries()) {
      used.add(key);
      const [kind, pattern] = key.split("|");
      const info = KIND_INFO[kind];
      const price = Math.round((info.price[0] + ((gi * 7919 + pi * 104729) % (info.price[1] - info.price[0]))) / 500) * 500;
      const madeToOrder = def.memberType === "TAILOR";
      const maker = makers.length ? makers[gi % makers.length] : null;
      const product = await prisma.product.create({
        data: {
          pageId: page.id,
          title: `${PATTERN_NAME[pattern]} ${info.title.toLowerCase()}`.replace(/^\w/, (c) => c.toUpperCase()),
          description: `${info.title} in ${pattern} kitenge print, sewn in ${def.sector}. ${madeToOrder ? "Made to your measurements." : "Ready to wear."}`,
          category: items[0].category,
          priceRwf: price,
          madeToOrder,
          leadTimeDays: madeToOrder ? 4 : 1,
          styles: info.styles,
          occasions: info.occasions,
          fabric: "Cotton kitenge (wax print)",
          status: "PUBLISHED",
          featured: gi === 0,
          payoutTarget: maker && gi % 2 === 0 ? "MAKER" : "PAGE",
          submittedById: owner.id,
          variants: { create: items.map((it) => ({ colourName: titleCase(it.colour), colourHex: it.hex, sizes: SIZES, stock: madeToOrder ? 0 : 6 })) },
          ...(maker ? { makers: { create: [{ coopMemberId: maker.id }] } } : {}),
        },
        include: { variants: true },
      });
      // Real readiness pipeline for each variant photo
      let ready = true;
      for (const [vi, v] of product.variants.entries()) {
        const img = readFileSync(join(SEED_DIR, `${items[vi].slug}.png`));
        const a = await ai<{ readiness: string; cutout_b64: string; embedding: number[]; quality_score: number; notes: string[] }>(
          "/v1/garment/assess",
          { image_b64: img.toString("base64"), category: product.category },
        );
        const base = `public/media/${page.id}/${v.id}`;
        mkdirSync(join(STORAGE, "public/media", page.id), { recursive: true });
        writeFileSync(join(STORAGE, `${base}-photo.png`), img);
        writeFileSync(join(STORAGE, `${base}-cutout.png`), Buffer.from(a.cutout_b64, "base64"));
        await prisma.variant.update({ where: { id: v.id }, data: { imagePath: `${base}-photo.png`, cutoutPath: `${base}-cutout.png` } });
        await prisma.$executeRawUnsafe(`UPDATE "Variant" SET embedding = $1::vector WHERE id = $2`, `[${a.embedding.join(",")}]`, v.id);
        await prisma.mediaAsset.create({ data: { productId: product.id, path: `${base}-photo.png` } });
        ready &&= a.readiness === "READY";
        if (vi === 0) await prisma.product.update({ where: { id: product.id }, data: { qualityScore: a.quality_score, readinessNotes: a.notes } });
      }
      await prisma.product.update({ where: { id: product.id }, data: { readiness: ready ? "READY" : "NEEDS_BETTER_PHOTO" } });
    }
    console.log(`✓ ${def.name}: ${picks.length} products`);
  }
  await seedTailor(prisma);
  console.log("Seed complete. Demo shopper 0788000001 · tailor 0788100001 · coop admin 0788100002 · seller 0788100003 · coop maker 0788100004 · host 0788900001");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
