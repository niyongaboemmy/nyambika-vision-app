/**
 * Try-on quality pass (Nov 2026): one plain, unbranded T-shirt product on a seeded page, so the catalogue
 * has a real-world everyday garment (dark colours included) next to the kitenge pieces.
 *
 * Source and licence of the photos: generated procedurally by `apps/ai/scripts/make_seed_assets.py --tee`
 * (in-house, same licence as this repository). No third-party photo, no logo or word mark, no person.
 * We looked for an openly licensed unbranded tee photo first; the one used in the lead's test
 * (Wikimedia "BrownIEditShirt-plainBackground.png", CC BY-SA 3.0) carries a word mark, so it is used for
 * local tests only (fetched at test time) and never seeded.
 *
 * Every photo goes through the real readiness / cut-out / embedding pipeline. Idempotent.
 * Run: `pnpm db:seed:tee` (also called at the end of `pnpm db:seed`). Needs the AI gateway.
 */
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import "dotenv/config";

const AI = process.env.AI_GATEWAY_URL ?? "http://localhost:8100";
const STORAGE = resolve(process.env.STORAGE_DIR ?? "./storage");
const AI_DIR = resolve(__dirname, "../../ai");
const PAGE = "kanombe-kitenge-corner";
const TITLE = "Plain cotton tee";
export const TEE_SOURCE = "procedural (apps/ai/scripts/make_seed_assets.py --tee), in-house generated, no third-party content";
const COLOURS = [
  { name: "Charcoal", hex: "#2E2F33", slug: "tee-charcoal" },
  { name: "Chocolate", hex: "#5C4033", slug: "tee-chocolate" },
  { name: "Rust", hex: "#C2553D", slug: "tee-rust" },
  { name: "Sky", hex: "#C9D8E8", slug: "tee-sky" },
];

async function ai<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${AI}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function seedTee(prisma: PrismaClient) {
  const page = await prisma.page.findUnique({ where: { handle: PAGE }, include: { roles: true } });
  if (!page) {
    console.log("• tee seed: base catalogue missing, run the main seed first");
    return;
  }
  if (await prisma.product.findFirst({ where: { pageId: page.id, title: TITLE } })) {
    console.log(`• ${TITLE} exists, skipping`);
    return;
  }
  const dir = join(STORAGE, "seed", "tee");
  mkdirSync(dir, { recursive: true });
  for (const c of COLOURS) {
    if (!existsSync(join(dir, `${c.slug}.png`))) {
      execFileSync(process.env.AI_PYTHON ?? join(AI_DIR, ".venv/bin/python"), [join(AI_DIR, "scripts/make_seed_assets.py"), dir, "--tee", c.hex, c.slug]);
    }
  }
  writeFileSync(join(dir, "SOURCE.json"), JSON.stringify({ source: TEE_SOURCE, licence: "repository licence (in-house generated)", colours: COLOURS }, null, 2));

  const product = await prisma.product.create({
    data: {
      pageId: page.id,
      title: TITLE,
      description: "Everyday crew-neck tee in soft combed cotton jersey. Plain, no print, true to size. Ready to wear.",
      category: "t-shirt",
      priceRwf: 9000,
      madeToOrder: false,
      leadTimeDays: 1,
      styles: ["casual", "minimal"],
      occasions: ["casual", "office"],
      fabric: "100% cotton jersey",
      status: "PUBLISHED",
      featured: false,
      payoutTarget: "PAGE",
      submittedById: page.roles[0]?.userId ?? null,
      variants: { create: COLOURS.map((c) => ({ colourName: c.name, colourHex: c.hex, sizes: ["S", "M", "L", "XL"], stock: 12 })) },
    },
    include: { variants: true },
  });
  let ready = true;
  for (const [i, v] of product.variants.entries()) {
    const img = readFileSync(join(dir, `${COLOURS[i].slug}.png`));
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
    if (i === 0) await prisma.product.update({ where: { id: product.id }, data: { qualityScore: a.quality_score, readinessNotes: a.notes } });
  }
  await prisma.product.update({ where: { id: product.id }, data: { readiness: ready ? "READY" : "NEEDS_BETTER_PHOTO" } });
  // Credits (in-house, no third-party content) and trilingual copy, like the rest of the catalogue.
  for (const v of await prisma.variant.findMany({ where: { productId: product.id } })) {
    const files: [string | null, string[]][] = [[v.imagePath, []], [v.cutoutPath, ["background removed (cut-out)"]]];
    for (const [path, changes] of files) {
      if (!path) continue;
      const data = { assetKey: "tee-procedural", sourceIds: ["tee-procedural"], title: "Plain cotton tee (procedural render)", author: "Nyambika Vision", sourceUrl: "https://github.com/niyongaboemmy/nyambika-vision-app/blob/main/apps/ai/scripts/make_seed_assets.py", licence: "Repository licence (in-house)", licenceUrl: "https://github.com/niyongaboemmy/nyambika-vision-app", shareAlike: false, changes, illustration: true };
      await prisma.mediaCredit.upsert({ where: { path }, create: { path, ...data }, update: data });
    }
  }
  await prisma.productCopy.createMany({
    data: [
      { productId: product.id, locale: "en", title: TITLE, description: "Everyday crew-neck tee in soft combed cotton jersey. Plain, no print, true to size. Ready to wear." },
      { productId: product.id, locale: "fr", title: "T-shirt uni en coton", description: "T-shirt col rond en jersey de coton peigné. Uni, sans imprimé, taille normalement. Prêt-à-porter." },
      { productId: product.id, locale: "rw", title: "Umupira w'ipamba udafite imitako", description: "Umupira w'ipamba woroshye, nta mitako, ingano isanzwe. Urahari.", needsReview: true },
    ],
    skipDuplicates: true,
  });
  console.log(`✓ ${TITLE} on ${PAGE} (${COLOURS.length} colours, ${ready ? "READY" : "needs better photo"})`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedTee(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
