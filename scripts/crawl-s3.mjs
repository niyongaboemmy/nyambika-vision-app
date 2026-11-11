import { readdirSync } from "node:fs";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const seedDir = new URL("../apps/api/storage/seed/", import.meta.url).pathname;
const fabric = seedDir + readdirSync(seedDir).find((f) => f.includes("indigo"));
const { page, shot, finish } = await start("s3");

// Anonymous: the Muse understands before sign-in
await page.goto(BASE);
await page.getByRole("heading", { name: /occasion/i }).waitFor();
await shot("muse-anon");
await page.locator("footer button[title]").click();
await page.getByPlaceholder(/type what you need/i).fill("Wedding outfit for Saturday under 50k");
await page.keyboard.press("Enter");
await page.getByText(/here's what i understood/i).waitFor();
await shot("muse-anon-chips");

// Signed in shopper with a twin, Kinyarwanda request
// Fresh shopper per run: the daily generation cap (15) is per user, so reusing one account trips it.
await signIn(page, `07883${String(Date.now()).slice(-5)}`);
await page.goto(`${BASE}/mirror`);
await page.getByRole("switch").check({ force: true });
await page.getByText(/synthetic demo persona/i).click();
await page.getByRole("button", { name: "Persona 3" }).click();
await page.getByText(/your twin is ready/i).waitFor({ timeout: 20000 });
await page.goto(BASE);
await page.locator("footer button[title]").click();
await page.getByPlaceholder(/type what you need|andika/i).fill("Ndashaka imyenda yo kwambara mu bukwe ku wa gatandatu, itarenze 50,000");
const t0 = Date.now();
await page.keyboard.press("Enter");
await page.getByText(/what i understood|ibyo numvise|compris/i).waitFor();
await shot("muse-rw-intent-chips");
await page.waitForURL(/\/looks\//, { timeout: 15000 });
await page.locator('section[aria-label="Look 1 of 9"] img[alt*="AI preview"]').waitFor({ timeout: 30000 });
console.log(`⏱  intent → first look visible: ${Date.now() - t0} ms`);
await shot("looks-1");

const stream = page.getByLabel("Looks stream");
for (let i = 1; i <= 3; i++) {
  await stream.evaluate((el, n) => el.scrollTo({ top: el.clientHeight * n }), i);
  await page.waitForTimeout(900);
}
await page.locator('section[aria-label="Look 4 of 9"] img[alt*="AI preview"]').waitFor({ timeout: 30000 });
await shot("looks-4-progressive");
await page.locator('section[aria-label="Look 4 of 9"] img[alt*="AI preview"]').dblclick();
await page.locator('section[aria-label="Look 4 of 9"]').getByRole("button", { name: "Saved" }).waitFor();

// Snap a fabric
await page.goto(BASE);
await page.locator('input[type=file][capture="environment"]').setInputFiles(fabric);
await page.waitForURL(/snap=/);
await page.locator('section[aria-label="Look 1 of 9"] img[alt*="AI preview"]').waitFor({ timeout: 30000 });
await shot("snap-looks");

// Edit a chip
await page.goto(BASE);
await page.locator("footer button[title]").click();
await page.getByPlaceholder(/type|andika|écrivez/i).fill("blue shirt for the office");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: /💍/ }).click();
await page.getByRole("button", { name: "party" }).waitFor();
await shot("muse-edit-occasion");
await page.getByRole("button", { name: "party" }).click();
await page.getByRole("button", { name: /show my looks|nyereka|voir mes looks/i }).waitFor({ timeout: 20000 });
await shot("muse-refined");

await page.goto(`${BASE}/saved`);
await page.locator("main img").first().waitFor({ timeout: 20000 });
await shot("saved");
await finish();
