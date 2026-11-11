import { readdirSync } from "node:fs";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const seedDir = new URL("../apps/api/storage/seed/", import.meta.url).pathname;
const photo = seedDir + readdirSync(seedDir).find((f) => f.startsWith("wrap-dress-teal"));

const { browser, page, shot, finish, context } = await start("s1");

// Shopper-facing: directory + Maker Space (anonymous, SSR)
await page.goto(`${BASE}/makers`);
await page.getByText("Uwase Couture").first().waitFor();
await shot("directory");
await page.getByText("Uwase Couture").first().click();
await page.waitForURL(/\/m\/uwase-couture/);
await page.getByRole("listbox", { name: "Collection" }).waitFor();
await shot("maker-space");
await page.getByRole("listbox", { name: "Collection" }).getByRole("option", { selected: true }).click(); // the 3D shelf is a second listbox
await page.getByText(/order on whatsapp/i).waitFor();
await shot("maker-product-sheet");

// Tailor: create product → upload photo → readiness → publish
await signIn(page, "0788100001");
await page.goto(`${BASE}/studio`);
await page.getByText("Uwase Couture").click();
await page.getByRole("navigation", { name: "Studio" }).getByRole("link", { name: "Products" }).click();
await page.getByText(/try-on: ready/i).first().waitFor();
await shot("studio-products");
await page.getByRole("button", { name: "Add product" }).click();
await page.getByPlaceholder("Indigo wrap dress").fill("Teal Ikiyaga wrap");
await page.locator("input[inputmode=numeric]").fill("41000");
await page.getByRole("button", { name: "wedding" }).click();
await page.getByRole("button", { name: "elegant" }).click();
await page.getByLabel("Colour name").fill("Teal");
await shot("studio-new-product");
await page.getByRole("button", { name: /save and add photos/i }).click();
await page.getByText(/now add a clear photo/i).waitFor();
await page.locator("input[type=file]").setInputFiles(photo);
await page.getByText(/try-on cut-out \(auto\)/i).waitFor(); // the 3D panel also mentions the cut-out
await page.locator('img[alt="Teal cut-out"]').waitFor({ timeout: 20000 });
await shot("studio-photo-assessed");
await page.getByRole("button", { name: "Publish" }).click();
await page.getByText(/done: publish/i).waitFor();
await shot("studio-published");

// Coop maker submits → admin approves
const c2 = await browser.newContext({ ...context._options });
const maker = await c2.newPage();
await signIn(maker, "0788100004");
await maker.goto(`${BASE}/studio`);
await maker.getByText("Abahizi Sewing Cooperative").click();
await maker.getByRole("navigation", { name: "Studio" }).getByRole("link", { name: "My products" }).click();
await maker.getByRole("button", { name: "Add product" }).click();
await maker.getByPlaceholder("Indigo wrap dress").fill("Jeanne's gold skirt");
await maker.locator("input[inputmode=numeric]").fill("19000");
await maker.getByLabel("Colour name").fill("Gold");
await maker.getByRole("button", { name: /save and add photos/i }).click();
await maker.getByRole("button", { name: /submit for approval/i }).click();
await maker.getByText(/sent to your cooperative admin/i).waitFor();
await maker.screenshot({ path: new URL("./crawl-output/s1/90-maker-submitted.png", import.meta.url).pathname });
await c2.close();

const c3 = await browser.newContext({ ...context._options });
const admin = await c3.newPage();
await signIn(admin, "0788100002");
await admin.goto(`${BASE}/studio`);
await admin.getByText("Abahizi Sewing Cooperative").click();
await admin.getByRole("navigation", { name: "Studio" }).getByRole("link", { name: "Products" }).click();
await admin.getByText(/waiting for approval/i).waitFor();
await admin.screenshot({ path: new URL("./crawl-output/s1/91-admin-approval-queue.png", import.meta.url).pathname });
await admin.getByRole("button", { name: "Approve" }).first().click();
await admin.getByText(/waiting for approval/i).waitFor({ state: "detached" });
await admin.getByRole("navigation", { name: "Studio" }).getByRole("link", { name: "Makers" }).click();
await admin.getByRole("heading", { name: /Makers \(/ }).waitFor();
await admin.screenshot({ path: new URL("./crawl-output/s1/92-coop-makers.png", import.meta.url).pathname });
await c3.close();

// New member creates a page → pending verification
const c4 = await browser.newContext({ ...context._options });
const fresh = await c4.newPage();
await signIn(fresh, `07885${String(Date.now()).slice(-5)}`);
await fresh.goto(`${BASE}/studio`);
await fresh.getByRole("button", { name: "Create my page" }).click();
await fresh.getByPlaceholder("Uwase Couture").fill(`Gisenyi Threads ${String(Date.now()).slice(-4)}`);
await fresh.getByRole("button", { name: /^continue/i }).click();
await fresh.getByRole("button", { name: /^continue/i }).click();
await fresh.getByRole("button", { name: "Create page" }).click();
await fresh.getByText(/waiting for verification/i).waitFor();
await fresh.screenshot({ path: new URL("./crawl-output/s1/93-new-page-pending.png", import.meta.url).pathname });
await c4.close();

await finish();
