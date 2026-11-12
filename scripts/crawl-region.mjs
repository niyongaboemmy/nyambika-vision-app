// E40 Export & DPP · E41 EAC multi-region crawl (Pixel 7).
// Kenyan shopper: KES Maker Space → M-Pesa checkout (phone validation, simulated STK prompt) → paid.
// Rwandan shopper: switches display currency to USD + cross-border → KES prices with "≈ USD" → international
// card checkout through the mock Stripe Payment Element → paid. Coop admin: DPP editor → new version → public
// passport with QR + history. Kenyan maker: region & export studio. Host: country launch checklist.
import { createRequire } from "node:module";
import { BASE, isCrawlArtifact, openMakerPiece, signIn, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");
const { browser, finish, issues } = await start("region");
const OUT = new URL("./crawl-output/region/", import.meta.url).pathname;
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const api = async (p, path) => (await p.request.get(`${BASE}/api${path}`)).json();
let n = 0;
async function ctx(label) {
  const c = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
  const p = await c.newPage();
  p.on("console", (m) => m.type() === "error" && !isCrawlArtifact(m.text()) && issues.push(`${label} console: ${m.text()}`));
  p.on("pageerror", (e) => issues.push(`${label} pageerror: ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && issues.push(`${label} HTTP ${r.status()} ${r.url()}`));
  // The pilot survey (Phase 2) may pop up for seeded shoppers; dismiss it whenever it blocks a step.
  await p.addLocatorHandler(p.getByText("Did Nyambika help you decide?"), async () => {
    await p.getByRole("button", { name: "Not now" }).click();
  });
  const snap = async (name, full = false) => {
    n += 1;
    await p.screenshot({ path: `${OUT}${String(n).padStart(2, "0")}-${label}-${name}.png`, fullPage: full, caret: "initial" }); // caret:"hide" restyles inputs and can race hydration
    console.log(`📸 ${label}/${name}`);
  };
  return { c, p, snap };
}
const openFirstProduct = async (p) => {
  await openMakerPiece(p); // hero "N pieces" sheet → first piece
};

// ── Kenyan shopper · KES + M-Pesa ─────────────────────────────────────────────
const kePhone = `+2547${String(Date.now()).slice(-8)}`;
const K = await ctx("ke-shopper");
await signIn(K.p, kePhone);
await K.p.goto(`${BASE}/makers`);
await K.p.getByRole("link", { name: /Nairobi Kikoi Studio/ }).first().waitFor({ timeout: 20000 });
const firstMaker = await K.p.locator("main a, div.mt-4 a").first().innerText().catch(() => "");
assert(/Nairobi Kikoi/.test(firstMaker) || (await K.p.locator('a[href="/m/nairobi-kikoi-studio"]').count()) > 0, "Kenyan shopper sees the Kenyan maker (home country first)");
const rwCount = await K.p.locator('a[href="/m/umurage-wear"]').count();
assert(rwCount === 0, "Rwandan makers hidden for a Kenyan shopper without cross-border opt-in");
await K.snap("directory-ke");
await K.p.goto(`${BASE}/m/nairobi-kikoi-studio`);
await K.p.getByText(/KES \d/).first().waitFor({ timeout: 20000 });
await K.snap("maker-space-kes");
await openFirstProduct(K.p);
await K.p.getByRole("button", { name: /Buy · KES/ }).click();
await K.p.getByLabel("Delivery address").fill("Moi Avenue 12, Nairobi");
const payer = K.p.getByLabel(/M-Pesa number/);
await payer.fill("+250788123456");
await K.p.getByText(/Use a Kenya number/).waitFor();
await K.snap("mpesa-phone-invalid");
await payer.fill(kePhone.replace("+254", "0"));
await K.p.waitForTimeout(300);
await K.snap("mpesa-checkout");
await K.p.getByRole("button", { name: /^Buy · KES/ }).last().click();
await K.p.waitForURL(/\/orders\//, { timeout: 20000 });
await K.p.getByRole("group", { name: "Simulated phone prompt" }).waitFor({ timeout: 15000 });
await K.snap("stk-prompt");
await K.p.getByLabel(/M-Pesa PIN/).fill("1234");
await K.p.getByRole("button", { name: "Approve" }).click();
await K.p.getByText(/Paid KES .* via M-Pesa/).first().waitFor({ timeout: 20000 });
await K.p.waitForTimeout(400);
await K.snap("order-paid-mpesa", true);

// ── Rwandan shopper · display currency + international card (mock Stripe) ─────
const R = await ctx("rw-shopper");
await signIn(R.p, "0788000001");
await R.p.goto(`${BASE}/makers`);
await R.p.getByRole("button", { name: /^Country .*Change$/ }).click();
await R.p.getByRole("dialog").getByRole("button", { name: "USD", exact: true }).click();
await R.p.getByRole("dialog").getByRole("button", { name: /Rwanda/ }).click();
await R.p.getByRole("switch", { name: /other countries/ }).check();
await R.p.waitForTimeout(500);
await R.snap("currency-sheet");
await R.p.getByRole("button", { name: "Done" }).click();
await R.p.getByText("ships to you").first().waitFor({ timeout: 15000 });
await R.snap("directory-cross-border");
await R.p.goto(`${BASE}/m/nairobi-kikoi-studio`);
await R.p.getByText(/≈ USD/).first().waitFor({ timeout: 20000 });
await R.snap("maker-space-approx-usd");
await openFirstProduct(R.p);
await R.snap("product-sheet");
await R.p.getByRole("button", { name: /Buy · KES/ }).click();
await R.p.getByLabel("Delivery address").fill("KG 7 Ave 3, Kacyiru, Kigali");
await R.p.getByText(/≈ USD .* reference only/).waitFor();
await R.p.waitForTimeout(600);
await R.snap("card-checkout-summary");
await R.p.getByRole("button", { name: /Continue to card/ }).click();
await R.p.getByRole("heading", { name: "Pay by card" }).waitFor();
await R.snap("mock-payment-element");
await R.p.getByRole("button", { name: /^Pay KES/ }).click();
await R.p.waitForURL(/\/orders\//, { timeout: 20000 });
await R.p.getByText(/Card/).first().waitFor();
await R.p.getByText(/Paid KES .* via card/).first().waitFor({ timeout: 15000 });
await R.snap("order-paid-card", true);

// ── Coop admin · DPP editor + public passport ─────────────────────────────────
const C = await ctx("coop-admin");
await signIn(C.p, "0788100002");
const coop = await api(C.p, "/pages/by-handle/urudodo-collective");
let productId = null;
for (const pr of coop.products) {
  const r = await C.p.request.get(`${BASE}/api/passports/${pr.id}`);
  if (r.ok()) {
    productId = pr.id;
    break;
  }
}
assert(productId, "seeded passport found");
await C.p.goto(`${BASE}/studio/${coop.id}/products/${productId}`);
const card = C.p.getByRole("region", { name: "Product passport" });
await card.waitFor({ timeout: 20000 });
await card.scrollIntoViewIfNeeded();
await C.snap("dpp-card");
await card.getByRole("button", { name: /Update passport/ }).click();
const sheet = C.p.getByRole("dialog");
await sheet.getByLabel(/^Care/).fill(`Hand wash cold, inside out\nDry in shade\nIron on medium\nStore folded (${new Date().toISOString().slice(11, 19)})`);
await sheet.getByLabel(/What changed/).fill("Added storage tip");
await C.snap("dpp-editor");
await sheet.getByRole("button", { name: /^Publish version/ }).click();
await sheet.waitFor({ state: "detached", timeout: 15000 });
await card.getByText("Added storage tip").first().waitFor({ timeout: 10000 });
await C.snap("dpp-new-version");

const P = await ctx("passport");
await P.p.goto(`${BASE}/p/${productId}`);
await P.p.getByRole("heading", { level: 1 }).waitFor();
assert((await P.p.locator('svg[role="img"][aria-label^="QR code"]').count()) === 1, "passport page shows a QR code");
const ld = await P.p.locator('script[type="application/ld+json"]').first().textContent();
assert(ld?.includes('"@type":"Product"') && ld.includes("dpp:fibreComposition"), "passport embeds JSON-LD with draft DPP fields");
await P.snap("passport", true);
await P.p.goto(`${BASE}/p/${productId}?v=1`);
await P.p.getByText(/You are reading version 1/).waitFor();
await P.snap("passport-v1");

// ── Kenyan maker · region & export studio ─────────────────────────────────────
const M = await ctx("ke-maker");
await signIn(M.p, "+254711000001");
const ke = await api(M.p, "/pages/by-handle/nairobi-kikoi-studio");
await M.p.goto(`${BASE}/studio/${ke.id}/region`);
await M.p.getByRole("heading", { name: /Card payments for international buyers/ }).waitFor({ timeout: 20000 });
await M.snap("studio-region", true);

// ── Host · country launch checklist + region switcher ─────────────────────────
const H = await ctx("host");
await signIn(H.p, "0788900001");
await H.p.goto(`${BASE}/admin/regions`);
await H.p.getByRole("heading", { name: /Launch checklist · Kenya/ }).waitFor({ timeout: 20000 });
await H.snap("admin-ke-checklist", true);
const reg = H.p.getByRole("switch", { name: /regulator approval/ });
if (!(await reg.isChecked())) await reg.click();
await H.p.getByText(/Signed off by/).first().waitFor({ timeout: 10000 });
await H.p.getByRole("group", { name: "Region" }).getByRole("button", { name: /Uganda/ }).click();
await H.p.getByRole("heading", { name: /Launch checklist · Uganda/ }).waitFor();
await H.snap("admin-ug");

await finish();
