// Shared Playwright helpers for manual-test crawls (mobile-first: Pixel 7 viewport).
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, devices } = require("@playwright/test");

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
/** Core API for direct calls: API_URL, else the agent-slot convention web 310N ↔ API 410N (3000 ↔ 4000). */
export const API_BASE = process.env.API_URL ?? BASE.replace(/:3(\d{3})\b/, ":4$1");
/** Database for crawls that flip flags with psql: CRAWL_DB, else the one apps/api/.env points at. */
export const CRAWL_DB = process.env.CRAWL_DB ?? dbFromEnv() ?? "nyambika_dev";
/**
 * Playwright screenshots hide the text caret by injecting `caret-color: transparent`; a screenshot taken while React
 * is still hydrating then shows up as a hydration "mismatch" on that style alone. That is the crawler, not the app.
 */
export function isCrawlArtifact(text) {
  if (!/hydrated but some attributes/i.test(text)) return false;
  const diff = text.split("\n").filter((l) => /^\s*[+-]\s{2,}\S/.test(l)); // diff rows ("-      style=…"), not the "- A server/client branch" hints
  return diff.length > 0 && diff.every((l) => /caret-color/.test(l));
}
function dbFromEnv() {
  try {
    const env = readFileSync(new URL("../apps/api/.env", import.meta.url), "utf8");
    return env.match(/^DATABASE_URL="?postgres(?:ql)?:\/\/[^/]+\/([^?"\s]+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function start(name, launch = {}) {
  const out = new URL(`./crawl-output/${name}/`, import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(launch); // e.g. { args: [fake media flags] } (crawl-voice)
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
  const page = await context.newPage();
  const issues = [];
  page.on("console", (m) => m.type() === "error" && !isCrawlArtifact(m.text()) && issues.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`));
  page.on("response", (r) => (r.status() >= 500 || r.status() === 429) && issues.push(`HTTP ${r.status()} ${r.url()}`));
  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${out}${String(n).padStart(2, "0")}-${label}.png`;
    await page.screenshot({ path: file, caret: "initial" });
    console.log(`📸 ${label} → ${file}`);
  };
  const finish = async () => {
    await browser.close();
    if (issues.length) {
      console.log(`\n⚠️  ${issues.length} issue(s):\n` + issues.map((i) => ` - ${i}`).join("\n"));
      process.exitCode = 1;
    } else console.log("\n✅ no console errors or 5xx responses");
  };
  return { browser, context, page, shot, finish, issues };
}

/** Sign in through the real OTP UI using the dev-exposed code. */
export async function signIn(page, phone) {
  await page.goto(`${BASE}/signin`);
  await page.getByLabel(/phone/i).fill(phone);
  await page.getByRole("button", { name: /send code|ohereza|envoyer/i }).click();
  const dev = page.locator("button.font-mono");
  await dev.waitFor();
  await dev.click();
  await page.getByRole("button", { name: /continue|komeza|continuer/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

/**
 * Maker Space (showroom-first redesign): open a piece's product sheet through the hero's "N pieces" sheet.
 * `name` (string or RegExp) picks a piece by its accessible name; without it, the first piece (products[0]).
 */
export async function openMakerPiece(page, name) {
  await page.getByRole("button", { name: /\d+ pieces.*see all/i }).click();
  const list = page.getByRole("list", { name: "Collection" });
  await list.waitFor();
  await (name ? list.getByRole("button", { name }).first() : list.getByRole("button").first()).click();
  await page.getByRole("dialog").waitFor();
}
