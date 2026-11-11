// No emoji anywhere in the web UI source or its strings (iOS pass: icons come from components/icons.tsx).
// Scans apps/web/{app,components,lib} and packages/i18n for Unicode Extended_Pictographic code points and the emoji
// presentation selector U+FE0F. ©, ® and ™ are typographic, not emoji, and are allowed.
// Run: `pnpm --filter @nyambika/web test`. The crawl (scripts/crawl-uiux.mjs) checks rendered text the same way.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const web = new URL("..", import.meta.url).pathname;
const roots = ["app", "components", "lib"].map((d) => join(web, d)).concat(join(web, "../../packages/i18n/src"));
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;
const ALLOWED = new Set(["©", "®", "™"]);

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(tsx?|mjs)$/.test(name)) yield p;
  }
}

export function findEmoji(text: string): string[] {
  return [...text].filter((c) => EMOJI.test(c) && !ALLOWED.has(c));
}

describe("no emoji in the UI", () => {
  it("the detector flags emoji and spares typography", () => {
    assert.deepEqual(findEmoji("Try on ✨ 👗"), ["✨", "👗"]);
    assert.deepEqual(findEmoji("© Nyambika · ✓ ★ → ‹ ›"), []);
  });

  it("app, components, lib and i18n strings contain none", () => {
    const hits: string[] = [];
    for (const root of roots) {
      for (const f of files(root)) {
        if (f.endsWith("no-emoji.test.ts")) continue;
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const e = findEmoji(line);
            if (e.length) hits.push(`${relative(web, f)}:${i + 1} ${e.join("")}`);
          });
      }
    }
    assert.equal(hits.length, 0, `emoji found (use <Icon> from components/icons.tsx):\n${hits.slice(0, 60).join("\n")}${hits.length > 60 ? `\n… ${hits.length - 60} more` : ""}`);
  });
});
