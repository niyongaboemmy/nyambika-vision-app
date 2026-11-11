import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const bundlePath = new URL("./crawl-output/wave0.json", import.meta.url).pathname;
// Build a fresh synthetic Wave 0 bundle every run (new handle suffix): re-importing an old bundle finds its
// pages already migrated, so the "✓ handle" row never appears. MIG_BUNDLE_KEEP=1 reuses the existing file.
if (!(process.env.MIG_BUNDLE_KEEP && existsSync(bundlePath))) {
  const root = new URL("..", import.meta.url).pathname;
  const mainRoot = dirname(execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: root }).toString().trim());
  const py = [process.env.AI_PYTHON, join(root, "apps/ai/.venv/bin/python"), join(mainRoot, "apps/ai/.venv/bin/python")].find((p) => p && existsSync(p));
  if (!py) throw new Error("No AI venv python found to build wave0.json (set AI_PYTHON)");
  mkdirSync(dirname(bundlePath), { recursive: true });
  execFileSync(py, [join(root, "scripts/migration/make-sample-wave.py"), bundlePath, dirname(bundlePath)], { stdio: "inherit" });
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
const [tailor, seller] = bundle.pages;
const { browser, context, page, shot, finish } = await start("migration");

await signIn(page, "0788900001");
await page.goto(`${BASE}/admin`);
await page.getByRole("button", { name: "Migration" }).click();
await page.locator('input[type=file][accept*="json"]').setInputFiles(bundlePath);
await page.getByText(`Imported: ${tailor.handle}`).waitFor({ timeout: 60000 });
await shot("admin-wave-imported");

// Hidden until go-live; legacy URL not redirected yet
let r = await page.request.get(`${BASE}/m/${tailor.handle}`, { maxRedirects: 0 });
console.log(`new page before go-live: HTTP ${r.status()}`);

// Waves are listed newest first; earlier dry runs may reuse the same sample names.
const card = (name) => page.getByRole("article", { name, exact: true }).first();
await card(tailor.name).getByRole("button", { name: /send review link/i }).click();
await card(seller.name).getByRole("button", { name: /send review link/i }).click();
await page.waitForTimeout(600);
const tailorReview = await card(tailor.name).getByRole("link", { name: "review link" }).getAttribute("href");
const sellerReview = await card(seller.name).getByRole("link", { name: "review link" }).getAttribute("href");

// Tailor owner reviews and signs off
const c2 = await browser.newContext({ ...context._options });
const owner = await c2.newPage();
await signIn(owner, tailor.ownerPhone);
await owner.goto(tailorReview.replace(/^https?:\/\/[^/]+/, BASE));
await owner.getByText(/things to check/i).waitFor();
await owner.screenshot({ path: new URL("./crawl-output/migration/90-owner-review.png", import.meta.url).pathname, fullPage: true });
await owner.getByRole("button", { name: /looks right, sign off/i }).click();
await owner.getByText(/thank you/i).first().waitFor();

// Seller owner requests changes, then signs off after the fix
const c3 = await browser.newContext({ ...context._options });
const s = await c3.newPage();
await signIn(s, seller.ownerPhone);
await s.goto(sellerReview.replace(/^https?:\/\/[^/]+/, BASE));
await s.getByPlaceholder(/what to fix/i).fill("Please add our MoMo number 0788123123");
await s.getByRole("button", { name: /request changes/i }).click();
await s.getByText(/we'll fix it/i).waitFor();

// A different person cannot open someone else's review link
const c4 = await browser.newContext({ ...context._options });
const stranger = await c4.newPage();
await signIn(stranger, "0788000001");
await stranger.goto(tailorReview.replace(/^https?:\/\/[^/]+/, BASE));
await stranger.getByText(/registered for this page/i).waitFor();
await c4.close();

await page.reload();
await page.getByRole("button", { name: "Migration" }).click();
await card(tailor.name).getByRole("button", { name: /go live/i }).click();
await page.waitForTimeout(700);
await shot("admin-after-go-live");

// Legacy URL → permanent redirect to the new Maker Space
const legacy = new URL(tailor.legacyUrl).pathname;
r = await page.request.get(`${BASE}${legacy}`, { maxRedirects: 0 });
console.log(`legacy ${legacy}: HTTP ${r.status()} → ${r.headers()["location"]}`);
await page.goto(`${BASE}${legacy}`);
await page.waitForURL(new RegExp(`/m/${tailor.handle}`));
await page.getByRole("listbox", { name: "Collection" }).waitFor();
await shot("legacy-redirected-maker-space");

// Rollback disables the redirect; misses are recorded
await page.goto(`${BASE}/admin`);
await page.getByRole("button", { name: "Migration" }).click();
await card(tailor.name).getByRole("button", { name: /roll back/i }).click();
await page.waitForTimeout(600);
r = await page.request.get(`${BASE}${legacy}`, { maxRedirects: 0 });
console.log(`legacy after rollback: HTTP ${r.status()}`);
await page.reload();
await page.getByRole("button", { name: "Migration" }).click();
await page.getByText(/unmatched legacy urls/i).waitFor();
await shot("admin-rollback-and-404s");
await c2.close();
await c3.close();
await finish();
