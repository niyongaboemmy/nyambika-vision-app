// E23 Live morph · E24 Tailor custom orders · E32 Size recommendation crawl (Pixel 7).
// Shopper morphs a tailor template on the twin → asks Uwase to sew it → tailor quotes → deposit on
// /dev/handset → fitting booked → progress → balance on /dev/handset → delivered; size rec in the buy sheet.
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { browser, context, page, shot, finish, issues } = await start("tailor");
const out = new URL("./crawl-output/tailor/", import.meta.url).pathname;
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const watch = (p, label) => {
  p.on("console", (m) => m.type() === "error" && issues.push(`${label} console: ${m.text()}`));
  p.on("pageerror", (e) => issues.push(`${label} pageerror: ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && issues.push(`${label} HTTP ${r.status()} ${r.url()}`));
};
const api = async (p, path, init) => {
  const r = init ? await p.request.post(`${BASE}/api${path}`, { data: init }) : await p.request.get(`${BASE}/api${path}`);
  return r.json();
};

// ── Shopper with a synthetic twin ─────────────────────────────────────────────
const phone = `07887${String(Date.now()).slice(-5)}`;
await signIn(page, phone);
await api(page, "/twin/persona", { persona: 3, consent: true });
const uwase = await api(page, "/pages/by-handle/umurage-wear");
const dress = uwase.products.find((p) => p.title === "Ineza A-line dress");
assert(Boolean(dress), "Umurage's customizable Ineza dress is listed");

await page.goto(`${BASE}/looks/try?variant=${dress.variants[0].id}`);
await page.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Morph" }).waitFor();
await page.waitForTimeout(400);
await shot("look-with-morph-rail");

// ── Live morph ────────────────────────────────────────────────────────────────
await page.getByRole("button", { name: "Morph" }).click();
const sheet = page.getByRole("dialog");
await sheet.getByText(/live morph · umurage wear/i).waitFor();
await page.waitForTimeout(500);
await shot("morph-sheet");
// Drag the knob around the ring towards blue (~225°).
const knob = sheet.getByRole("slider", { name: "Colour" });
const ringBox = await knob.evaluate((el) => el.parentElement.getBoundingClientRect().toJSON());
const cx = ringBox.x + ringBox.width / 2;
const cy = ringBox.y + ringBox.height / 2;
const r = ringBox.width * 0.46;
const at = (deg) => [cx + Math.sin((deg * Math.PI) / 180) * r, cy - Math.cos((deg * Math.PI) / 180) * r];
await page.mouse.move(...at(10));
await page.mouse.down();
for (const d of [40, 90, 150, 200, 225]) await page.mouse.move(...at(d), { steps: 4 });
await page.mouse.up();
assert(Number(await knob.getAttribute("aria-valuenow")) >= 210 && Number(await knob.getAttribute("aria-valuenow")) <= 240, `ring dragged to hue ${await knob.getAttribute("aria-valuenow")}°`);
await sheet.getByText("Maxi", { exact: true }).click();
await sheet.getByText("Long", { exact: true }).click();
await page.waitForTimeout(300);
await shot("morph-rendering-keeps-previous");
await sheet.getByText(/drag the ring/i).waitFor({ timeout: 40000 });
const morphImg = await sheet.locator('img[alt*="live morph preview"]').getAttribute("src");
assert(morphImg?.startsWith("/api/private/look"), "morph preview rendered through the generation path (signed private image)");
await page.waitForTimeout(400);
await shot("morph-blue-maxi-long");
const askText = await sheet.getByRole("button", { name: /ask umurage to sew this/i }).innerText();
// Options picked above: colour (+3,000) + maxi (+5,000) + long sleeves (+3,000) on the seeded base price.
const expected = `RWF ${(dress.priceRwf + 11000).toLocaleString("en-US")}`;
assert(askText.includes(expected) && askText.includes("+RWF 11,000"), `price = base + options: ${expected} (${askText.split("\n").join(" ")})`);

// ── Ask Uwase to sew this ─────────────────────────────────────────────────────
await sheet.getByRole("button", { name: /ask umurage to sew this/i }).click();
const ask = page.getByRole("dialog").last();
await ask.getByText(/what umurage will see/i).waitFor();
await ask.getByRole("checkbox", { name: /this preview image/i }).check();
await page.waitForTimeout(300);
await shot("ask-tailor-consent");
await ask.getByRole("button", { name: /send request to umurage/i }).click();
await page.waitForURL(/\/custom\/.+fresh=1/, { timeout: 20000 });
const coId = new URL(page.url()).pathname.split("/").pop();
await page.getByText(/sent to umurage wear/i).waitFor();
await page.waitForTimeout(500);
await shot("custom-order-requested");

// ── Tailor: inbox → measurements → quote ──────────────────────────────────────
const tailorCtx = await browser.newContext({ ...context._options });
const tailor = await tailorCtx.newPage();
watch(tailor, "tailor");
await signIn(tailor, "0788100001");
await tailor.goto(`${BASE}/studio/${uwase.id}/tailor`);
await tailor.getByText("New requests").waitFor();
await tailor.locator(`a[href$="/tailor/${coId}"]`).waitFor();
await tailor.waitForTimeout(400);
await tailor.screenshot({ path: `${out}20-tailor-inbox.png` });
await tailor.locator(`a[href$="/tailor/${coId}"]`).click();
await tailor.getByRole("button", { name: "View measurements" }).click();
await tailor.getByText(/each view is logged/i).waitFor();
await tailor.getByText("Hips").waitFor();
await tailor.waitForTimeout(300);
await tailor.screenshot({ path: `${out}21-tailor-order-measurements.png`, fullPage: true });
await tailor.getByRole("button", { name: /suggested/i }).click();
await tailor.getByRole("button", { name: "50%" }).click();
await tailor.getByRole("button", { name: /send quote/i }).click();
await tailor.getByText("Quote sent").first().waitFor();
await tailor.screenshot({ path: `${out}22-tailor-quote-sent.png` });

// ── Shopper: accept + deposit on the simulated handset ────────────────────────
const handset = await context.newPage();
watch(handset, "handset");
async function approveOnHandset(label) {
  await handset.goto(`${BASE}/dev/handset`);
  await handset.getByText(/pay rwf/i).waitFor({ timeout: 10000 });
  await handset.getByLabel("PIN").fill("12345");
  await handset.screenshot({ path: `${out}${label}.png` });
  await handset.getByRole("button", { name: "Approve" }).click();
  await handset.getByText(/no pending payment requests/i).waitFor({ timeout: 10000 });
}
await page.reload();
await page.getByText(/quote from umurage/i).waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
await shot("shopper-quote");
await page.getByRole("button", { name: /accept & pay deposit/i }).click();
await page.getByText(/approve rwf .* on your phone/i).waitFor();
await shot("shopper-deposit-pending");
await approveOnHandset("31-handset-deposit");
await page.getByText("Book a fitting").waitFor({ timeout: 15000 });
assert((await api(page, `/custom-orders/${coId}`)).status === "DEPOSIT_PAID", "deposit paid to the tailor");

// Fitting slot (a pilot survey sheet may pop up after the deposit when the pilot is running on this DB)
const survey = page.getByRole("dialog").getByRole("button", { name: /not now/i });
if (await survey.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
  await survey.click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}
await page.locator('[role="tablist"][aria-label="Day"] button').first().click();
const time = page.locator("section", { hasText: "Book a fitting" }).locator("button", { hasText: /^\d\d:\d\d$/ }).first();
await time.click();
await page.getByText("Your fitting").waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
await shot("shopper-fitting-booked");
const outbox = await api(tailor, `/custom-orders/${coId}`);
assert(Boolean(outbox.fitting), "fitting booked");

// ── Tailor: progress → ready ──────────────────────────────────────────────────
await tailor.reload();
for (const step of ["Cutting", "Sewing", "Fitting", "Finishing", "Ready"]) {
  await tailor.getByRole("button", { name: new RegExp(step) }).first().click();
  await tailor.waitForTimeout(500);
}
await tailor.getByText(/waiting for the customer to pay the balance/i).waitFor();
await tailor.screenshot({ path: `${out}40-tailor-ready.png`, fullPage: true });

// ── Shopper: balance ──────────────────────────────────────────────────────────
await page.reload();
await page.getByRole("button", { name: /pay balance/i }).waitFor({ timeout: 10000 });
await shot("shopper-ready-pay-balance");
await page.getByRole("button", { name: /pay balance/i }).click();
await approveOnHandset("51-handset-balance");
await page.getByText("Fully paid").first().waitFor({ timeout: 15000 });

// ── Tailor: delivered ─────────────────────────────────────────────────────────
await tailor.reload();
await tailor.getByRole("button", { name: /mark as delivered/i }).click();
await tailor.getByText("Delivered").first().waitFor();
await tailor.screenshot({ path: `${out}60-tailor-delivered.png` });
await page.reload();
await page.getByText("Delivered").first().waitFor();
await page.waitForTimeout(300);
await shot("shopper-delivered");
const final = await api(page, `/custom-orders/${coId}`);
assert(final.status === "DELIVERED" && final.payments.filter((p) => p.status === "SUCCESSFUL").length === 2, "delivered, deposit + balance both paid");
assert(final.measurementShare && !final.measurementShare.active, "measurement share ended with the order");

// ── Studio: slots, services, product morph options ────────────────────────────
await tailor.goto(`${BASE}/studio/${uwase.id}/tailor/slots`);
await tailor.getByText("Add fitting times").waitFor();
// Earlier runs may already have published 17:00 (shown struck-through, disabled): pick any free time.
await tailor.locator("button[aria-pressed]:not([disabled])").filter({ hasText: /^\d\d:\d\d$/ }).first().click();
await tailor.waitForTimeout(200);
await tailor.screenshot({ path: `${out}70-tailor-slots.png`, fullPage: true });
await tailor.goto(`${BASE}/studio/${uwase.id}/tailor/services`);
await tailor.getByText("Custom dress from your fabric").waitFor();
await tailor.screenshot({ path: `${out}71-tailor-services.png` });
await tailor.goto(`${BASE}/studio/${uwase.id}/products/${dress.id}`);
await tailor.getByText(/live morph options/i).waitFor();
await tailor.getByText(/live morph options/i).scrollIntoViewIfNeeded();
await tailor.screenshot({ path: `${out}72-tailor-morph-options.png` });

// ── Shopper: size recommendation in the hold-to-buy sheet ─────────────────────
await page.goto(`${BASE}/looks/try?variant=${dress.variants[0].id}`);
await page.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 30000 });
await page.getByRole("button", { name: /buy/i }).first().click();
await page.getByText(/recommended/i).first().waitFor({ timeout: 10000 });
await page.getByText(/your measurements ·/i).waitFor();
await page.waitForTimeout(300);
await shot("buy-sheet-size-recommendation");
await page.keyboard.press("Escape");

// Maker Space services + measurements page
await page.goto(`${BASE}/m/umurage-wear`);
await page.getByText("Made for you").scrollIntoViewIfNeeded();
await page.getByRole("button", { name: "Request this" }).first().waitFor();
await page.evaluate(() => window.scrollBy(0, 360));
await page.waitForTimeout(300);
await shot("maker-space-services");
await page.goto(`${BASE}/measurements`);
await page.getByText("Shared with tailors").waitFor();
await page.waitForTimeout(300);
await shot("measurements");
await page.goto(`${BASE}/custom`);
await page.getByText("Ineza A-line dress").first().waitFor();
await shot("my-custom-orders");

await tailorCtx.close();
await finish();
