import { BASE, signIn, start } from "./crawl-lib.mjs";

const OWNERS = { "Umurage Wear": "0788100001", "Urudodo Stitch Collective": "0788100002", "Kanombe Kitenge Corner": "0788100003", "Inkindi Studio": "0788100005", "Akeza Couture": "0788100006" };
const { browser, context, page, shot, finish } = await start("s4");

// Fresh shopper per run: the daily generation cap (15) is per user, so reusing one account trips it.
await signIn(page, `07882${String(Date.now()).slice(-5)}`);
await page.goto(`${BASE}/mirror`);
await page.getByRole("switch").check({ force: true });
await page.getByText(/synthetic demo persona/i).click();
await page.getByRole("button", { name: "Persona 2" }).click();
await page.getByText(/your twin is ready/i).waitFor({ timeout: 20000 });
await page.goto(BASE);
await page.locator("footer button[title]").click();
await page.getByRole("textbox").fill("Wedding outfit for Saturday under 50k");
await page.keyboard.press("Enter");
await page.waitForURL(/\/looks\//, { timeout: 20000 });
const first = page.locator('section[aria-label="Look 1 of 9"]');
await first.locator('img[alt*="AI preview"]').waitFor({ timeout: 30000 });
await first.getByRole("button", { name: /buy/i }).click();
await page.getByRole("button", { name: /hold to buy/i }).waitFor();
await page.getByLabel("Delivery address").fill("KG 7 Ave, Kacyiru");
await shot("buy-sheet");

const hold = page.getByRole("button", { name: /hold to buy/i });
const box = await hold.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(600);
await shot("hold-progress");
await page.waitForTimeout(900);
await page.mouse.up();
await page.waitForURL(/\/orders\/.+fresh=1/, { timeout: 15000 });
await page.getByText(/approve on your phone/i).waitFor();
await shot("awaiting-pin");

// Simulated handset in a second tab
const handset = await context.newPage();
await handset.goto(`${BASE}/dev/handset`);
await handset.getByLabel("PIN").fill("24680");
await handset.screenshot({ path: new URL("./crawl-output/s4/90-handset.png", import.meta.url).pathname });
await handset.getByRole("button", { name: "Approve" }).click();
await handset.close();

await page.getByText(/paid directly to/i).first().waitFor({ timeout: 15000 });
await shot("paid-to-maker");
const makerName = (await page.locator('a[href^="/m/"]').first().textContent()).replace(" →", "").trim();
const orderUrl = page.url().split("?")[0]; // the order URL may also carry ?next= (navigation pass)
console.log(`order for ${makerName}`);

// Maker fulfils from the Page Manager
const c2 = await browser.newContext({ ...context._options });
const maker = await c2.newPage();
await signIn(maker, OWNERS[makerName]);
await maker.goto(`${BASE}/studio`);
await maker.getByText(makerName).first().click();
await maker.getByRole("navigation", { name: "Studio" }).getByRole("link", { name: "Orders" }).click();
await maker.getByRole("button", { name: "Accept" }).first().waitFor();
await maker.screenshot({ path: new URL("./crawl-output/s4/91-maker-inbox.png", import.meta.url).pathname });
for (const step of ["Accept", "Start making", "Send out", "Mark delivered"]) {
  await maker.getByRole("button", { name: step }).first().click();
  await maker.waitForTimeout(500);
}
await maker.getByRole("navigation", { name: "Studio" }).getByRole("link", { name: "Home" }).click();
await maker.getByText(/paid orders/i).waitFor();
await maker.screenshot({ path: new URL("./crawl-output/s4/92-maker-analytics.png", import.meta.url).pathname, fullPage: true });
await c2.close();

// Shopper: ambient timeline, confirm receipt, review
await page.goto(orderUrl);
await page.getByRole("button", { name: /i received it/i }).waitFor();
await shot("timeline-delivered");
await page.getByRole("button", { name: /i received it/i }).click();
await page.getByRole("button", { name: /post review/i }).waitFor();
await page.getByPlaceholder(/fit, fabric/i).fill("Beautiful kitenge, perfect fit from my twin size.");
await page.getByRole("button", { name: /post review/i }).click();
await page.getByText(/you rated/i).waitFor();
await shot("reviewed");
await finish();
