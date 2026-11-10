// Shared Playwright helpers for manual-test crawls (mobile-first: Pixel 7 viewport).
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, devices } = require("@playwright/test");

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";

export async function start(name) {
  const out = new URL(`./crawl-output/${name}/`, import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
  const page = await context.newPage();
  const issues = [];
  page.on("console", (m) => m.type() === "error" && issues.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 500 && issues.push(`HTTP ${r.status()} ${r.url()}`));
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
