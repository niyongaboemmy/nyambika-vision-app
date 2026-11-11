import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** E23/E24/E32 demo data: same idempotent SQL as the migration, re-run after the makers are seeded. */
export async function seedTailor(prisma: PrismaClient) {
  const sql = readFileSync(join(__dirname, "sql", "e23_e24_e32_seed.sql"), "utf8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  for (const s of statements) await prisma.$executeRawUnsafe(s);
  console.log("✓ Tailor templates, services and fitting slots");
}
