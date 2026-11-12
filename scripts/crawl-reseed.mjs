// Realistic seed data: makers directory, Maker Spaces on real (credited) garment photos, the image-credit sheet,
// the umushanana illustration, /credits, Kinyarwanda titles, a look on a seeded garment and the studio products.
// Usage: BASE_URL=http://localhost:3103 node scripts/crawl-reseed.mjs
import { BASE, openMakerPiece, signIn, start } from "./crawl-lib.mjs";

const { page, shot, finish, issues } = await start("reseed");
const assert = (ok, msg) => {
  if (!ok) issues.push(`assert: ${msg}`);
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
};

/** Open the product's sheet through the hero's "N pieces" sheet. */
async function open(title) {
  await openMakerPiece(page, new RegExp(title));
  await page.getByRole("button", { name: /try on me/i }).waitFor();
}

// ── Directory
await page.goto(`${BASE}/makers`);
await page.getByText("Umurage Wear").first().waitFor();
for (const name of ["Urudodo Stitch Collective", "Kanombe Kitenge Corner", "Inkindi Studio", "Akeza Couture", "Isimbi Tailoring", "Rebero Threads", "Gikondo Makers Coop"]) {
  assert((await page.getByText(name).count()) > 0, `directory lists ${name}`);
}
await shot("makers-directory");

// ── Maker Space + credit sheet
await page.goto(`${BASE}/m/umurage-wear`);
await page.getByRole("heading", { name: /Umurage Wear/ }).waitFor();
await page.waitForTimeout(800);
await shot("maker-space-umurage");
await open("Ineza A-line dress");
await shot("product-sheet-ineza");
await page.getByRole("button", { name: "Image credit" }).click();
await page.getByText("Auckland Museum").first().waitFor();
await page.waitForTimeout(500);
assert((await page.getByRole("link", { name: "CC BY 4.0" }).count()) > 0, "credit sheet links the licence");
assert((await page.getByText(/backdrop evened/).count()) > 0, "credit sheet lists the changes");
await shot("credit-sheet");
await page.keyboard.press("Escape");

await page.goto(`${BASE}/m/inkindi-studio`);
await page.getByRole("heading", { name: /Inkindi Studio/ }).waitFor();
await open("Inkindi ceremony umushanana");
await page.getByRole("button", { name: "Image credit" }).click();
await page.getByText("Illustration", { exact: true }).waitFor();
await page.waitForTimeout(500);
await shot("umushanana-illustration-credit");
await page.keyboard.press("Escape");

await page.goto(`${BASE}/m/isimbi-tailoring`);
await page.getByRole("heading", { name: /Isimbi Tailoring/ }).waitFor();
await page.waitForTimeout(600);
await shot("maker-space-isimbi-market-photos");

// ── Credits page
await page.goto(`${BASE}/credits`);
await page.getByRole("heading", { name: "Image credits" }).waitFor();
assert((await page.locator("main li").count()) >= 30, "credits page lists every source");
assert((await page.getByText(/CC BY-SA 4.0/).count()) > 0, "share-alike sources are listed");
await shot("credits-page");

// ── Kinyarwanda title
await page.evaluate(() => localStorage.setItem("nya_locale", "rw"));
await page.goto(`${BASE}/m/umurage-wear`);
await page.getByRole("heading", { name: /Umurage Wear/ }).waitFor();
await open("Ineza A-line dress");
await page.getByRole("heading", { name: "Ikanzu Ineza (A-line)" }).waitFor();
await shot("product-sheet-rw");
await page.evaluate(() => localStorage.setItem("nya_locale", "en"));

// ── Look on a seeded garment (fresh shopper on a synthetic persona; daily cap is per user)
await signIn(page, `07885${String(Date.now()).slice(-5)}`);
await page.goto(`${BASE}/mirror`);
await page.getByRole("switch").check({ force: true });
await page.getByText(/synthetic demo persona/i).click();
await page.getByRole("button", { name: "Persona 3" }).click();
await page.getByText(/your twin is ready/i).waitFor({ timeout: 20000 });
await page.goto(`${BASE}/m/umurage-wear`);
await page.getByRole("heading", { name: /Umurage Wear/ }).waitFor();
await open("Ineza A-line dress");
await page.getByRole("button", { name: /try on me/i }).click();
await page.waitForURL(/\/looks\//, { timeout: 15000 });
await page.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 45000 });
await page.waitForTimeout(800);
await shot("look-ineza-persona-3");
await page.context().clearCookies();

// ── Studio products (tailor 0788100001)
await signIn(page, "0788100001");
const pages = await (await page.request.get(`${BASE}/api/pages/mine/list`)).json();
await page.goto(`${BASE}/studio/${pages[0].id}/products`);
await page.getByText("Ineza A-line dress").first().waitFor();
await page.waitForTimeout(800);
await shot("studio-products-umurage");
await page.context().clearCookies();
await signIn(page, "0788100008");
const isimbi = await (await page.request.get(`${BASE}/api/pages/mine/list`)).json();
await page.goto(`${BASE}/studio/${isimbi[0].id}/products`);
await page.getByText("Two-piece kitenge dress").first().waitFor();
await page.waitForTimeout(800);
await shot("studio-products-isimbi");

await finish();
