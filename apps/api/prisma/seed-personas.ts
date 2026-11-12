/**
 * Synthetic persona set for try-on demos, AI product studio and the pilot (never real people, plan §4.6).
 *
 * Swap-in (docs/seed-data.md): drop persona-1..N.png (+ manifest.json) from scripts/personas/generate.py into
 * apps/api/storage/personas/ and run `pnpm db:seed` (or `pnpm db:seed:personas`). This keeps generated personas,
 * bumps the set version (new cache keys for every persona try-on, new turnaround cache) and records provenance.
 * With no generated set, the original illustrated personas 1..5 are (re)created from the asset script.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import "dotenv/config";

const STORAGE = resolve(process.env.STORAGE_DIR ?? "./storage");
const AI_DIR = resolve(__dirname, "../../ai");

interface GeneratedManifest {
  generator?: string;
  personas?: { id: string; file: string; model?: string; seed?: number; sha256?: string }[];
}

export interface PersonaResult {
  count: number;
  version: number;
  source: string;
}

export function seedPersonas(): PersonaResult {
  const dir = join(STORAGE, "personas");
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, "manifest.json");
  const previous = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>) : {};
  const generated = existsSync(join(dir, "generation.json")) ? (JSON.parse(readFileSync(join(dir, "generation.json"), "utf8")) as GeneratedManifest) : null;

  let files = readdirSync(dir).filter((f) => /^persona-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  let source = "illustration";
  if (generated?.personas?.length) {
    source = `generated:${generated.generator ?? "unknown"}`;
  } else {
    // Illustrated fallback set (flat drawings) from the AI asset script.
    const seedDir = join(STORAGE, "seed");
    if (!existsSync(join(seedDir, "persona-1.png"))) {
      mkdirSync(seedDir, { recursive: true });
      execFileSync(process.env.AI_PYTHON ?? join(AI_DIR, ".venv/bin/python"), [join(AI_DIR, "scripts/make_seed_assets.py"), seedDir, "--personas"]);
    }
    for (let i = 1; i <= 5; i++) copyFileSync(join(seedDir, `persona-${i}.png`), join(dir, `persona-${i}.png`));
    files = Array.from({ length: 5 }, (_, i) => `persona-${i + 1}.png`);
  }
  // Contiguous 1..N only (the app addresses personas by number).
  let count = 0;
  while (files.includes(`persona-${count + 1}.png`)) count++;
  const hash = createHash("sha256");
  for (let i = 1; i <= count; i++) hash.update(readFileSync(join(dir, `persona-${i}.png`)));
  const digest = hash.digest("hex").slice(0, 16);
  const prevVersion = Number(previous.version ?? 0);
  // Version 0 = the original illustrated set (keeps existing cache keys); any other set gets a new version on change.
  const version = source === "illustration" ? 0 : previous.digest === digest ? prevVersion : Math.max(1, prevVersion + 1);
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        count,
        version,
        source,
        digest,
        synthetic: true,
        label: source === "illustration" ? "Illustrated synthetic model" : "AI-generated, fictional person",
        personas: generated?.personas ?? Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, file: `persona-${i + 1}.png`, model: "make_seed_assets.py (flat illustration)" })),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`✓ Personas: ${count} (${source}, set v${version})`);
  return { count, version, source };
}

if (require.main === module) seedPersonas();
