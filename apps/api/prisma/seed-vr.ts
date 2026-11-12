/**
 * E35 demo content: a showroom-ready Maker Space (Umurage Wear: approved 3D for its seeded dresses, booth banner,
 * featured mannequins) and one scheduled virtual fashion show whose runway models are dressed on the synthetic
 * parametric avatar (never a shopper's twin). Uses the real AI gateway (/v1/garment/3d, /v1/avatar/dress).
 *
 * Runs at the end of `pnpm db:seed`, or on its own: `pnpm db:seed:vr` (idempotent; needs the AI gateway).
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import "dotenv/config";

const AI = process.env.AI_GATEWAY_URL ?? "http://localhost:8100";
const STORAGE = resolve(process.env.STORAGE_DIR ?? "./storage");
const SHOW_TITLE = "Imigongo Nights · launch show";
/** The pieces seeded by seed.ts for Umurage Wear (seed-catalogue.ts; duplicates from manual tests are ignored). */
const PIECES = ["Ineza A-line dress", "Gisenyi shirt dress", "Akagera tiered lace dress"];

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${AI}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function write(rel: string, data: Buffer) {
  mkdirSync(dirname(join(STORAGE, rel)), { recursive: true });
  writeFileSync(join(STORAGE, rel), data);
}

/** Next 18:00 Kigali (UTC+2) at least `days` days from now. */
function eveningIn(days: number) {
  const d = new Date(Date.now() + days * 86400_000);
  d.setUTCHours(16, 0, 0, 0);
  return d;
}

export async function seedVr(prisma: PrismaClient) {
  const page = await prisma.page.findUnique({ where: { handle: "umurage-wear" } });
  if (!page) return console.log("· E35 seed skipped: umurage-wear not found");
  const owner = await prisma.roleAssignment.findFirst({ where: { pageId: page.id, role: "PAGE_OWNER" } });
  const products = [];
  for (const title of PIECES) {
    const p = await prisma.product.findFirst({ where: { pageId: page.id, title, status: "PUBLISHED" }, orderBy: { createdAt: "asc" }, include: { variants: { orderBy: { id: "asc" } } } });
    if (p) products.push(p);
  }

  // 1. Approved 3D garments for every colour of the showroom pieces (as if the owner reviewed them, FR-3D-06).
  let made = 0;
  for (const p of products) {
    for (const v of p.variants) {
      if (!v.cutoutPath) continue;
      const have = await prisma.garmentAsset3d.findUnique({ where: { variantId: v.id } });
      if (have?.status === "READY" && have.approved) continue;
      const r = await post<{ glb_b64: string; poster_b64: string; triangles: number; dimensions_m: { width: number; height: number; depth: number }; model_version: string; sha256: string }>(
        "/v1/garment/3d",
        { cutout_b64: readFileSync(join(STORAGE, v.cutoutPath)).toString("base64"), category: p.category, size: "M", request_id: `seed-vr-${v.id}` },
      );
      const glbPath = `public/media/${p.pageId}/${v.id}-3d.glb`;
      const posterPath = `public/media/${p.pageId}/${v.id}-3d-poster.webp`;
      const glb = Buffer.from(r.glb_b64, "base64");
      write(glbPath, glb);
      write(posterPath, Buffer.from(r.poster_b64, "base64"));
      const data = {
        productId: p.id, pageId: p.pageId, status: "READY", progress: 100, approved: true, glbPath, posterPath, bytes: glb.length, triangles: r.triangles,
        widthM: r.dimensions_m.width, heightM: r.dimensions_m.height, depthM: r.dimensions_m.depth, size: "M", modelVersion: r.model_version, sha256: r.sha256, readyAt: new Date(), error: null,
      };
      await prisma.garmentAsset3d.upsert({ where: { variantId: v.id }, create: { variantId: v.id, ...data }, update: data });
      await prisma.mediaAsset.deleteMany({ where: { productId: p.id, path: glbPath } });
      await prisma.mediaAsset.create({ data: { productId: p.id, path: glbPath, kind: "MODEL_3D" } });
      made += 1;
    }
  }

  // 2. Booth: banner + three featured mannequins.
  const featured = products.slice(0, 3).map((p) => p.id);
  await prisma.showroomBooth.upsert({
    where: { pageId: page.id },
    create: { pageId: page.id, enabled: true, banner: "Florals and adire, cut to measure in Kimihurura", featured },
    update: { enabled: true, banner: "Florals and adire, cut to measure in Kimihurura", featured },
  });

  // 3. One scheduled show (2 days ahead, 18:00 Kigali), runway dressed on the synthetic avatar.
  const existing = await prisma.fashionShow.findFirst({ where: { pageId: page.id, title: SHOW_TITLE, status: "SCHEDULED", startsAt: { gt: new Date() } } });
  if (!existing) {
    const show = await prisma.fashionShow.create({
      data: {
        pageId: page.id,
        title: SHOW_TITLE,
        description: "Three new dresses walk the runway in 3D. RSVP for a WhatsApp reminder, react live, replay any time.",
        startsAt: eveningIn(2),
        modelSkin: "#825C43",
        modelSize: "M",
        createdById: owner?.userId ?? "seed",
        items: { create: products.slice(0, 4).map((p, position) => ({ productId: p.id, variantId: (p.variants.find((v) => v.cutoutPath) ?? p.variants[0]).id, position })) },
      },
      include: { items: true },
    });
    const params = { measurements: {}, skin_rgb: [0.51, 0.361, 0.263], size_estimate: "M" };
    let ready = 0;
    for (const item of show.items) {
      const p = products.find((x) => x.id === item.productId)!;
      const v = p.variants.find((x) => x.id === item.variantId)!;
      if (!v.cutoutPath) continue;
      const r = await post<{ glb_b64: string; poster_b64: string; bytes: number }>("/v1/avatar/dress", {
        params, cutout_b64: readFileSync(join(STORAGE, v.cutoutPath)).toString("base64"), category: p.category, size: "M", request_id: `seed-show-${item.id}`,
      });
      const base = `public/media/${page.id}/shows/${show.id}/${item.position}-${v.id}`;
      write(`${base}.glb`, Buffer.from(r.glb_b64, "base64"));
      write(`${base}.png`, Buffer.from(r.poster_b64, "base64"));
      await prisma.fashionShowItem.update({ where: { id: item.id }, data: { status: "READY", glbPath: `${base}.glb`, posterPath: `${base}.png`, bytes: r.bytes } });
      ready += 1;
    }
    await prisma.fashionShow.update({ where: { id: show.id }, data: { runwayStatus: ready === show.items.length ? "READY" : "PARTIAL" } });
  }
  console.log(`✓ E35 showroom: ${products.length} pieces (${made} new 3D colours), booth + show "${SHOW_TITLE}"`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedVr(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
