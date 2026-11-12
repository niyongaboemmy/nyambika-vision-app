import { BASE, signIn, start } from "./crawl-lib.mjs";

const { browser, context, page, shot, finish } = await start("s5");

// Host admin
await signIn(page, "0788900001");
await page.goto(`${BASE}/admin`);
await page.getByText(/ai unit economics/i).waitFor();
await shot("admin-overview");
await page.getByRole("button", { name: "Verify", exact: true }).click();
const verify = page.getByRole("button", { name: /verify & publish/i }).first();
if (await verify.isVisible().catch(() => false)) {
  await shot("admin-verify-queue");
  await verify.click();
  await page.waitForTimeout(600);
}
await page.getByRole("button", { name: "Moderation" }).click();
await page.waitForTimeout(500);
await shot("admin-moderation");
await page.getByRole("button", { name: "Flags & models" }).click();
await page.getByLabel("ai.kill_switch").check();
await page.waitForTimeout(400);
await shot("admin-flags-killswitch-on");

// Kill switch really stops generation for shoppers
const c2 = await browser.newContext({ ...context._options });
const shopper = await c2.newPage();
const phone = `07884${String(Date.now()).slice(-5)}`;
await signIn(shopper, phone);
// A personal twin means every look is a new generation (cached AI-model renders stay free to re-view).
await shopper.goto(`${BASE}/mirror`);
await shopper.getByRole("switch").check({ force: true });
await shopper.getByText(/synthetic demo persona/i).click();
await shopper.getByRole("button", { name: "Persona 5" }).click();
await shopper.getByText(/your twin is ready/i).waitFor({ timeout: 20000 });
await shopper.goto(`${BASE}/m/akeza-couture`);
await shopper.getByRole("listbox", { name: "Collection" }).getByRole("option", { selected: true }).click();
await shopper.getByRole("button", { name: /try on me/i }).click();
await shopper.getByText(/looks are resting/i).waitFor({ timeout: 15000 }); // KILL_SWITCH → calm LimitState card
await shopper.screenshot({ path: new URL("./crawl-output/s5/90-killswitch-blocks-shopper.png", import.meta.url).pathname });
await page.getByLabel("ai.kill_switch").uncheck();
await page.waitForTimeout(400);

await page.getByRole("button", { name: "Outbox" }).click();
await page.waitForTimeout(500);
await shot("admin-outbox");
await page.getByRole("button", { name: "Audit" }).click();
await page.waitForTimeout(500);
await shot("admin-audit");

// Shopper Trust centre: withdraw try-on consent, export, delete twin
await shopper.goto(`${BASE}/trust`);
await shopper.getByText(/ledger verified/i).waitFor();
await shopper.screenshot({ path: new URL("./crawl-output/s5/91-trust-centre.png", import.meta.url).pathname, fullPage: true });
await shopper.getByLabel("Render looks on my twin").uncheck({ force: true });
await shopper.waitForTimeout(500);
await shopper.goto(`${BASE}/m/kanombe-kitenge-corner`);
await shopper.getByRole("listbox", { name: "Collection" }).getByRole("option", { selected: true }).click();
await shopper.getByRole("button", { name: /try on me/i }).click();
await shopper.getByText(/looks on your twin are (paused|off)/i).waitFor({ timeout: 15000 }); // CONSENT_WITHDRAWN → LimitState with inline "Turn on"
await shopper.getByRole("button", { name: "Turn on" }).waitFor();
await shopper.screenshot({ path: new URL("./crawl-output/s5/92-consent-withdrawn-blocks.png", import.meta.url).pathname });
const exp = await shopper.request.get(`${BASE}/api/privacy/export`);
console.log(`data export: HTTP ${exp.status()} · ${(await exp.body()).length} bytes`);
await shopper.goto(`${BASE}/trust`);
await shopper.getByRole("button", { name: "Delete twin" }).click();
await shopper.getByRole("dialog").getByRole("button", { name: /delete/i }).click();
await shopper.getByText(/deleted ✓/i).waitFor();
await shopper.screenshot({ path: new URL("./crawl-output/s5/93-twin-deleted.png", import.meta.url).pathname });
await c2.close();

const sm = await page.request.get(`${BASE}/sitemap.xml`);
const xml = await sm.text();
console.log(`sitemap: HTTP ${sm.status()} · ${(xml.match(/<url>/g) ?? []).length} urls`);
await finish();
