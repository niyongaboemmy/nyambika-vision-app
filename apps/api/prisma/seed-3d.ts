/**
 * E27 demo content: AI 3D garments for a handful of seeded products, so the 3D viewer and AR button
 * have something to show right away. Uses the real gateway pipeline (/v1/garment/3d); approved as if
 * the page owner had reviewed them (FR-3D-06). Seed data is not metered.
 *
 * Runs at the end of `pnpm db:seed`, or on its own: `pnpm db:seed:3d` (needs the AI gateway).
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import "dotenv/config";

const AI = process.env.AI_GATEWAY_URL ?? "http://localhost:8100";
const STORAGE = resolve(process.env.STORAGE_DIR ?? "./storage");
const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

interface Result3d {
  glb_b64: string;
  poster_b64: string;
  triangles: number;
  dimensions_m: { width: number; height: number; depth: number };
  model_version: string;
  sha256: string;
}

/** `handle`: only that maker's pieces (e.g. a full showroom for one page). */
export async function seed3d(prisma: PrismaClient, limit = 6, handle?: string) {
  const products = await prisma.product.findMany({
    where: { status: "PUBLISHED", readiness: "READY", category: { notIn: ["shoes", "bag"] }, ...(handle ? { page: { handle } } : {}) },
    include: { variants: true },
    orderBy: [{ featured: "desc" }, { createdAt: "asc" }],
  });
  // One per page first so every maker has a 3D piece, then fill up.
  const seen = new Set<string>();
  const picks = [...products.filter((p) => !seen.has(p.pageId) && seen.add(p.pageId)), ...products].filter((p, i, a) => a.indexOf(p) === i).slice(0, limit);
  let n = 0;
  for (const p of picks) {
    for (const v of p.variants) {
      if (!v.cutoutPath) continue;
      const size = v.sizes.includes("M") ? "M" : (v.sizes[Math.floor((v.sizes.length - 1) / 2)] ?? "M");
      const res = await fetch(`${AI}/v1/garment/3d`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cutout_b64: readFileSync(join(STORAGE, v.cutoutPath)).toString("base64"), category: p.category, size: SIZES.includes(size) ? size : "M", request_id: `seed-${v.id}` }),
      });
      if (!res.ok) throw new Error(`3D seed failed for ${p.title}: ${res.status} ${await res.text()}`);
      const r = (await res.json()) as Result3d;
      const glbPath = `public/media/${p.pageId}/${v.id}-3d.glb`;
      const posterPath = `public/media/${p.pageId}/${v.id}-3d-poster.webp`;
      const glb = Buffer.from(r.glb_b64, "base64");
      mkdirSync(dirname(join(STORAGE, glbPath)), { recursive: true });
      writeFileSync(join(STORAGE, glbPath), glb);
      writeFileSync(join(STORAGE, posterPath), Buffer.from(r.poster_b64, "base64"));
      const data = {
        productId: p.id,
        pageId: p.pageId,
        status: "READY",
        progress: 100,
        approved: true,
        glbPath,
        posterPath,
        bytes: glb.length,
        triangles: r.triangles,
        widthM: r.dimensions_m.width,
        heightM: r.dimensions_m.height,
        depthM: r.dimensions_m.depth,
        size,
        modelVersion: r.model_version,
        sha256: r.sha256,
        readyAt: new Date(),
        error: null,
      };
      await prisma.garmentAsset3d.upsert({ where: { variantId: v.id }, create: { variantId: v.id, ...data }, update: data });
      await prisma.mediaAsset.deleteMany({ where: { productId: p.id, path: glbPath } });
      await prisma.mediaAsset.create({ data: { productId: p.id, path: glbPath, kind: "MODEL_3D" } });
      n += 1;
    }
  }
  console.log(`✓ 3D garments: ${n} colour(s) across ${picks.length} product(s)`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  // SEED_3D_HANDLE=kigali-kitenge-house SEED_3D_LIMIT=50 pnpm db:seed:3d → every piece of one maker in 3D.
  seed3d(prisma, Number(process.env.SEED_3D_LIMIT ?? 6), process.env.SEED_3D_HANDLE || undefined)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
