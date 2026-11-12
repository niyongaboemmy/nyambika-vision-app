import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Synthetic persona set (storage/personas/manifest.json, written by the seed). Swapping the PNGs and re-running
 * the seed bumps `version`, which changes every persona cache key (`persona-N:vX`) so old try-ons are not reused.
 * Without a manifest: the original 5 illustrated personas, version 0.
 */
export interface PersonaSet {
  count: number;
  version: number;
  source: string;
}

const DEFAULT: PersonaSet = { count: 5, version: 0, source: "illustration" };
let cache: { root: string; mtime: number; set: PersonaSet } | null = null;

export function personaSet(storageRoot: string): PersonaSet {
  const file = join(storageRoot, "personas", "manifest.json");
  try {
    const mtime = statSync(file).mtimeMs;
    if (cache && cache.root === storageRoot && cache.mtime === mtime) return cache.set;
    const m = JSON.parse(readFileSync(file, "utf8")) as Partial<PersonaSet>;
    const set = { count: Math.max(1, Math.min(12, Number(m.count) || DEFAULT.count)), version: Number(m.version) || 0, source: String(m.source ?? DEFAULT.source) };
    cache = { root: storageRoot, mtime, set };
    return set;
  } catch {
    return DEFAULT;
  }
}

export const clampPersona = (n: number, count: number) => Math.min(Math.max(1, Math.round(n)), count);
