import { BASE, signIn, start } from "./crawl-lib.mjs";

const persona = new URL("../apps/api/storage/personas/persona-4.png", import.meta.url).pathname;
const bad = new URL("./crawl-output/bad-twin.png", import.meta.url).pathname;
const { page, shot, finish } = await start("s2");
const phone = `07882${String(Date.now()).slice(-5)}`;

await signIn(page, phone);
await page.goto(`${BASE}/mirror`);
await page.getByRole("button", { name: /open camera/i }).waitFor();
await shot("mirror-intro-consent-off");
await page.getByRole("switch").check({ force: true });
await shot("mirror-consent-on");

// A bad photo is rejected with guidance
await page.locator("input[type=file]").setInputFiles(bad);
await page.getByText("Good light").waitFor();
await shot("mirror-bad-photo-checks");

// A good full-body photo passes and is saved encrypted
await page.getByRole("button", { name: "Retake" }).click();
await page.getByRole("button", { name: "Cancel" }).click();
await page.getByRole("switch").check({ force: true });
await page.locator("input[type=file]").setInputFiles(persona);
await page.getByRole("button", { name: "Save my twin" }).waitFor();
await page.waitForFunction(() => !document.querySelector("button[disabled]")?.textContent?.includes("Save my twin"));
await shot("mirror-good-photo-checks");
await page.getByRole("button", { name: "Save my twin" }).click();
await page.getByText(/your twin is ready/i).waitFor({ timeout: 20000 });
await page.waitForTimeout(400);
await shot("mirror-twin-ready");

// Maker Space → try on → guarded, labelled look on the twin
await page.goto(`${BASE}/m/uwase-couture`);
await page.getByRole("option", { selected: true }).click();
await page.getByRole("button", { name: /try on me/i }).click();
await page.waitForURL(/looks\/try/);
await page.locator('img[alt*="AI preview on your twin"]').waitFor({ timeout: 30000 });
await shot("look-on-twin");
await page.getByRole("button", { name: /AI preview on your twin/i }).click();
await page.getByText(/content credentials/i).waitFor();
await shot("look-c2pa-sheet");
await page.mouse.click(200, 100);
await page.getByRole("button", { name: /colours/i }).click();
await page.waitForTimeout(300);
await shot("look-colour-ring");
const swatch = page.locator("button[aria-pressed=false]").first();
const colour = await swatch.getAttribute("aria-label");
await swatch.click();
await page.locator(`img[alt*="in ${colour}"]`).waitFor({ timeout: 30000 });
await shot("look-variant-snapped");
const img = page.locator(`img[alt*="in ${colour}"]`);
await img.dblclick();
await page.getByRole("button", { name: "Saved" }).waitFor();
await shot("look-saved");
await finish();
