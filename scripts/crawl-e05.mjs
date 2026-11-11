import { readdirSync } from "node:fs";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const seedDir = new URL("../apps/api/storage/seed/", import.meta.url).pathname;
const photo = seedDir + readdirSync(seedDir).find((f) => f.startsWith("umushanana-gold"));
const { page, shot, finish } = await start("e05");

await signIn(page, "0788100001");
await page.goto(`${BASE}/studio`);
await page.getByText("Uwase Couture").first().click();
await page.getByRole("navigation", { name: "Studio" }).getByRole("link", { name: "Products" }).click();
await page.getByRole("button", { name: "Add product" }).click();
await page.getByRole("button", { name: "umushanana" }).first().waitFor().catch(() => {});
await page.locator("select").first().selectOption("umushanana");
await page.locator("input[inputmode=numeric]").fill("72000");
await page.getByRole("button", { name: "traditional ceremony" }).click();
await page.getByLabel("Colour name").fill("Gold");
await page.getByRole("button", { name: "RW", exact: true }).click();
await page.getByRole("button", { name: /write it for me/i }).click();
await page.waitForFunction(() => (document.querySelector("textarea")?.value.length ?? 0) > 10);
await shot("ai-listing-rw");
await page.getByRole("button", { name: /save and add photos/i }).click();
await page.locator("input[type=file]").setInputFiles(photo);
await page.locator('img[alt="Gold cut-out"]').waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Publish" }).click();
await page.getByText(/done: publish/i).waitFor();
await page.getByRole("button", { name: /create 3 photo/i }).click();
await page.locator('img[alt="Product on an AI model"]').nth(2).waitFor({ timeout: 30000 });
await shot("ai-product-studio");
const title = (await page.locator("h2").first().textContent()).trim();

// Settings lives under "More" in the phone dock.
await page.getByRole("navigation", { name: "Studio" }).getByRole("button", { name: "More" }).click();
await page.getByRole("dialog").getByRole("link", { name: "Settings" }).click();
await page.getByRole("button", { name: /write it for me/i }).click();
await page.waitForTimeout(800);
await shot("ai-page-story");

// Maker Spaces are server-rendered with a 10 s revalidate window.
await page.waitForTimeout(11000);
await page.goto(`${BASE}/m/uwase-couture`);
await page.reload();
// First tap centres a side card in the coverflow, the second opens it.
// Scope to the coverflow: the 3D shelf (E35) is a second listbox on the same page.
const coverflow = page.getByRole("listbox", { name: "Collection" });
const card = coverflow.getByRole("option", { name: new RegExp(title.slice(0, 12)) }).first();
await card.click();
await page.waitForTimeout(400);
await coverflow.getByRole("option", { selected: true }).click();
await page.getByRole("dialog").waitFor();
await page.locator('img[alt*="on an AI model"]').first().waitFor({ timeout: 10000 });
await shot("maker-space-studio-gallery");
await finish();
