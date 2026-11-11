// E27 3D garment + AR view · E28 Motion preview crawl (Pixel 7).
// Tailor builds + approves 3D in the studio → shopper opens 3D from a look (AR button) → See it move
// (confirm with price, progress, inline loop) → Maker Space product sheet 3D section.
import { createRequire } from "node:module";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");

const { browser, page, shot, finish, issues } = await start("xr");
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const api = async (p, path, data) => (data ? await p.request.post(`${BASE}/api${path}`, { data }) : await p.request.get(`${BASE}/api${path}`)).json();
const waitModel = async (p) => {
  await p.locator("model-viewer").first().waitFor({ timeout: 30000 });
  await p.waitForFunction(() => document.querySelector("model-viewer")?.loaded === true, null, { timeout: 45000 });
  await p.waitForTimeout(900);
};

// ── Tailor: 3D readiness card in the studio ───────────────────────────────────
const tailorCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const tailor = await tailorCtx.newPage();
tailor.on("console", (m) => m.type() === "error" && issues.push(`tailor console: ${m.text()}`));
tailor.on("pageerror", (e) => issues.push(`tailor pageerror: ${e.message}`));
tailor.on("response", (r) => r.status() >= 500 && issues.push(`tailor HTTP ${r.status()} ${r.url()}`));
await signIn(tailor, "0788100001");
const uwase = await api(tailor, "/pages/by-handle/uwase-couture");
const seeded = uwase.products.find((p) => p.title === "Uruziga a-line dress");
const fresh = uwase.products.find((p) => p.id !== seeded.id && p.variants?.length);
assert(Boolean(seeded && fresh), "Uwase has a seeded-3D product and one without 3D");

await tailor.goto(`${BASE}/studio/${uwase.id}/products/${fresh.id}`);
const card = tailor.locator("section", { has: tailor.getByRole("heading", { name: "3D and AR view" }) });
await card.waitFor({ timeout: 20000 });
await card.scrollIntoViewIfNeeded();
await tailor.waitForTimeout(400);
await card.screenshot({ path: new URL("./crawl-output/xr/00-studio-3d-card-empty.png", import.meta.url).pathname });
await card.getByRole("button", { name: /make 3d|rebuild 3d/i }).click();
await card.getByText(/building/i).first().waitFor({ timeout: 10000 });
await card.screenshot({ path: new URL("./crawl-output/xr/00-studio-3d-card-building.png", import.meta.url).pathname });
await card.getByText("Needs your review").waitFor({ timeout: 60000 });
await card.getByRole("switch", { name: /show 3d to shoppers/i }).click();
await card.getByText("Live for shoppers").waitFor({ timeout: 10000 });
await tailor.waitForTimeout(300);
await card.screenshot({ path: new URL("./crawl-output/xr/00-studio-3d-card-ready.png", import.meta.url).pathname });
const pub = await api(tailor, `/xr/public/products/${fresh.id}/3d`);
assert(pub.assets.length >= 1, `approved 3D is public (${pub.assets.length} colour(s))`);
await card.getByRole("button", { name: /preview in 3d/i }).click();
await waitModel(tailor);
await tailor.screenshot({ path: new URL("./crawl-output/xr/00-studio-3d-preview.png", import.meta.url).pathname });
await tailorCtx.close();

// ── Shopper: look → 3D stage with AR → See it move ───────────────────────────
const phone = `07885${String(Date.now()).slice(-5)}`;
await signIn(page, phone);
await api(page, "/twin/persona", { persona: 3, consent: true });
await page.goto(`${BASE}/looks/try?variant=${seeded.variants[0].id}`);
await page.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 30000 });
const rail3d = page.getByRole("button", { name: "3D", exact: true });
await rail3d.waitFor({ timeout: 10000 });
assert(await page.getByRole("button", { name: "Morph" }).isVisible(), "Morph rail button still present");
assert(await page.getByRole("button", { name: "Ask" }).isVisible(), "Ask rail button still present");
await page.waitForTimeout(300);
await shot("look-rail-3d-and-move");

await rail3d.click();
await page.getByRole("dialog", { name: /in 3d/i }).waitFor();
await waitModel(page);
await shot("look-3d-stage");
const ar = page.locator('model-viewer [slot="ar-button"]');
assert(await ar.isVisible(), "AR 'View in your space' button visible on an Android-class device");
assert((await page.locator("model-viewer").getAttribute("ar-modes")) === "webxr scene-viewer quick-look", "ar-modes webxr/scene-viewer/quick-look");
// Keyboard orbit + colour switch
await page.locator("model-viewer").focus();
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
const colours = page.getByRole("radiogroup", { name: "Colour" }).getByRole("radio");
if ((await colours.count()) > 1) {
  await colours.nth(1).click();
  await page.waitForFunction(() => document.querySelector("model-viewer")?.loaded === true, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  await shot("look-3d-colour-switched");
}
await page.getByRole("button", { name: "Close 3D view" }).click();

await page.getByRole("button", { name: /see it move/i }).click();
const sheet = page.getByRole("dialog");
await sheet.getByText(/premium preview/i).waitFor();
await page.waitForTimeout(300);
await shot("motion-confirm-price");
await sheet.getByRole("button", { name: /see it move/i }).click();
await page.getByRole("button", { name: /motion preview \d+% ready/i }).waitFor({ timeout: 10000 }).catch(() => undefined);
await shot("motion-progress");
await page.getByText(/AI motion preview/).first().waitFor({ timeout: 60000 });
const media = page.locator('video[aria-label*="motion preview" i], img[alt*="motion preview" i]').first();
await media.waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
await shot("motion-playing");
const playing = await page.evaluate(() => {
  const v = document.querySelector("video");
  return v ? !v.paused && v.readyState >= 2 && v.duration >= 3 && v.duration <= 5.5 : Boolean(document.querySelector('img[alt*="motion preview" i]'));
});
assert(playing, "motion preview loops inline (3–5 s)");
const src = await media.getAttribute("src");
const r = await page.request.get(`${BASE}${src}`, { headers: { range: "bytes=0-99" } });
assert(r.status() === 206, `motion file served privately with range support (${r.status()})`);
const tampered = await page.request.get(`${BASE}${src.replace(/sig=[0-9a-f]{4}/, "sig=0000")}`);
assert(tampered.status() === 403, "tampered motion link is refused");

// ── Maker Space: 3D section in the product sheet ─────────────────────────────
await page.goto(`${BASE}/m/uwase-couture`);
const option = page.getByRole("listbox", { name: "Collection" }).getByRole("option", { name: new RegExp(seeded.title) }); // not the 3D shelf
await option.waitFor();
for (let i = 0; i < 8 && (await option.getAttribute("aria-selected")) !== "true"; i++) {
  await option.click();
  await page.waitForTimeout(350);
}
await option.click();
const pSheet = page.getByRole("dialog");
await pSheet.getByRole("button", { name: /view in 3d/i }).waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
await shot("maker-sheet-3d-card");
await pSheet.getByRole("button", { name: /view in 3d/i }).click();
await waitModel(page);
await pSheet.locator("model-viewer").scrollIntoViewIfNeeded();
await shot("maker-sheet-3d-viewer");

await finish();
