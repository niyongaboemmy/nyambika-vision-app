// R4 spike (not committed): physics drape + fit heatmap on the 3D twin, tailor "Preview pattern in 3D" (Pixel 7).
// host turns `fit.heatmap_spike` on + stores a smoke DRAPE_SPIKE eval record → shopper builds a 3D twin, drapes a
// dress (heatmap + print) → shopper asks Uwase for a custom dress with measurements shared → tailor previews the
// pattern in 3D, adjusts length/ease/sleeve → flag off again (panels gone, API refuses).
// Run: BASE_URL=http://localhost:3101 node scripts/crawl-drape.mjs
import { createRequire } from "node:module";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");
const { browser, page, shot, finish, issues } = await start("drape", { args: ["--enable-unsafe-swiftshader"] });
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
const call = async (p, method, path, data) => {
  const url = `${BASE}/api${path}`;
  const r = method === "GET" ? await p.request.get(url) : method === "PATCH" ? await p.request.patch(url, { data }) : method === "PUT" ? await p.request.put(url, { data }) : await p.request.post(url, { data, timeout: 180000 });
  return { status: r.status(), body: await r.json().catch(() => null) };
};
const stageLoaded = async (p, scope, timeout = 60000) => {
  await scope.locator("model-viewer").first().waitFor({ timeout: 30000 });
  await p.waitForFunction((sel) => document.querySelector(sel)?.loaded === true, `[data-testid="${await scope.getAttribute("data-testid")}"] [data-testid="drape-stage"] model-viewer`, { timeout });
  await p.waitForTimeout(800);
};

// ── Host: flag on + smoke eval stored in the model registry ────────────────────────────────────────────────
const hostCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const host = await hostCtx.newPage();
watch(host, "host");
await signIn(host, "0788900001");
assert((await call(host, "GET", "/drape-spike/status")).body?.enabled === false, "spike flag is off by default");
await call(host, "PATCH", "/admin/flags/fit.heatmap_spike", { enabled: true });
assert((await call(host, "GET", "/drape-spike/status")).body?.enabled === true, "host turned fit.heatmap_spike on");
const ev = await call(host, "POST", "/drape-spike/eval", { scope: "smoke" });
assert(ev.status === 201 && typeof ev.body?.passed === "boolean", `smoke eval stored (passed=${ev.body?.passed}, runs=${ev.body?.summary?.runs})`);
const evals = await call(host, "GET", "/drape-spike/evals");
assert(evals.body?.some((e) => e.id === ev.body?.id), "DRAPE_SPIKE record listed in the model registry");

// ── Shopper: 3D twin → physics drape + heatmap ─────────────────────────────────────────────────────────────
const phone = `07885${String(Date.now()).slice(-5)}`;
await signIn(page, phone);
// Measurement profile (also what the tailor will see while shared): an L body.
await call(page, "PUT", "/measurements", { measurements: { heightCm: 167, bustCm: 97, waistCm: 80, hipsCm: 104 }, consent: true });
await page.goto(`${BASE}/mirror/3d`);
await page.getByRole("switch", { name: /consent to creating my private 3d twin/i }).waitFor();
await page.getByText("Private 3D twin").click();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: /measurements/i }).first().waitFor();
await page.getByRole("button", { name: /measurements/i }).first().click();
await page.getByRole("button", { name: "Skin tone 6 of 10" }).click();
await page.locator('[data-testid="twin3d-stage"] model-viewer').first().waitFor({ timeout: 60000 });
const panel = page.getByTestId("drape-spike-twin");
await panel.waitFor({ timeout: 30000 });
await panel.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot("twin-drape-panel");
assert(await panel.getByText("Experimental").isVisible(), "panel carries the Experimental label");
await panel.getByRole("radio", { name: "M", exact: true }).click(); // one size down on an L body
await panel.getByRole("button", { name: /drape it on my twin/i }).click();
await stageLoaded(page, panel);
await panel.getByTestId("drape-stage").scrollIntoViewIfNeeded();
await shot("twin-heatmap-size-M-on-L");
const bust = await panel.locator("dl > div").first().innerText();
assert(/tight/i.test(bust), `size M on an L twin reads tight at the bust (${bust.replace(/\n/g, " ")})`);
assert(await panel.getByText(/visual guidance only/i).isVisible(), "disclaimer shown under the heatmap");
await panel.getByRole("radio", { name: /print/i }).click();
await stageLoaded(page, panel);
await shot("twin-drape-print");
await panel.getByRole("radio", { name: "XXL", exact: true }).click();
await panel.getByRole("radio", { name: "Jersey knit" }).click();
await panel.getByRole("button", { name: /drape again/i }).click();
await page.waitForFunction(() => /XXL/.test(document.querySelector('[data-testid="drape-spike-twin"] [role="note"]')?.textContent ?? ""), null, { timeout: 60000 });
await panel.getByRole("radio", { name: /fit heatmap/i }).click();
await stageLoaded(page, panel);
await panel.locator("dl").scrollIntoViewIfNeeded();
await shot("twin-heatmap-XXL-jersey-loose");

// ── Shopper asks Uwase for a custom dress and shares measurements ─────────────────────────────────────────
const uwase = (await call(page, "GET", "/pages/by-handle/uwase-couture")).body;
const dress = uwase.products.find((p) => p.title === "Uruziga a-line dress");
const co = await call(page, "POST", "/custom-orders", { pageId: uwase.id, productId: dress.id, variantId: dress.variants[0].id, spec: { hue: 210, length: "midi", sleeve: "short" }, shareMeasurements: true, shareDays: 7, note: "Drape spike crawl" });
assert(co.status === 201 && co.body?.id, "custom order requested with measurements shared");

// ── Tailor: Preview pattern in 3D (synthetic body from the share) ──────────────────────────────────────────
const tailorCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const tailor = await tailorCtx.newPage();
watch(tailor, "tailor");
await signIn(tailor, "0788100001");
await tailor.goto(`${BASE}/studio/${uwase.id}/tailor/${co.body.id}`);
const pp = tailor.getByTestId("pattern-preview-3d");
await pp.waitFor({ timeout: 30000 });
await pp.scrollIntoViewIfNeeded();
await tailor.waitForTimeout(400);
await tailor.screenshot({ path: new URL("./crawl-output/drape/20-tailor-pattern-panel.png", import.meta.url).pathname });
await pp.getByRole("button", { name: /preview in 3d/i }).click();
await stageLoaded(tailor, pp);
await pp.getByTestId("drape-stage").scrollIntoViewIfNeeded();
await tailor.screenshot({ path: new URL("./crawl-output/drape/21-tailor-pattern-3d-heatmap.png", import.meta.url).pathname });
assert(/11[23] cm/.test(await pp.innerText()), "length defaults from the customer's morph choice (midi ≈ 112 cm, scaled by height)");
// Adjust: shorter, more ease, long sleeves.
await pp.getByRole("slider").fill("98");
await pp.getByRole("button", { name: "More ease" }).click();
await pp.getByRole("button", { name: "More ease" }).click();
await pp.getByRole("radio", { name: "Long" }).click();
await pp.getByRole("radio", { name: "Kitenge" }).click();
await pp.getByRole("button", { name: /update 3d preview/i }).click();
await tailor.waitForFunction(() => /98 cm/.test(document.querySelector('[data-testid="pattern-preview-3d"]')?.textContent ?? "") && !/Sewing and draping/.test(document.querySelector('[data-testid="pattern-preview-3d"]')?.textContent ?? ""), null, { timeout: 60000 });
await stageLoaded(tailor, pp);
await pp.getByRole("radio", { name: /print/i }).click();
await stageLoaded(tailor, pp);
await pp.getByTestId("drape-stage").scrollIntoViewIfNeeded();
await tailor.screenshot({ path: new URL("./crawl-output/drape/22-tailor-pattern-adjusted-print.png", import.meta.url).pathname });
await pp.locator("dl").scrollIntoViewIfNeeded();
await tailor.screenshot({ path: new URL("./crawl-output/drape/23-tailor-readings-legend.png", import.meta.url).pathname });

// Share revoked → the tailor can no longer preview.
const shares = (await call(page, "GET", "/measurements")).body?.shares ?? [];
const share = shares.find((s) => s.customOrder?.id === co.body.id && s.active);
if (share) await call(page, "POST", `/measurements/shares/${share.id}/revoke`, {});
const denied = await call(tailor, "POST", `/drape-spike/custom-orders/${co.body.id}/preview`, {});
assert(denied.status === 403, `preview refused after the share is revoked (${denied.status})`);

// ── Flag off: panels disappear, API refuses ────────────────────────────────────────────────────────────────
await call(host, "PATCH", "/admin/flags/fit.heatmap_spike", { enabled: false });
assert((await call(page, "POST", "/drape-spike/twin", {})).status === 404, "API refuses spike calls with the flag off");
await page.goto(`${BASE}/mirror/3d`);
await page.locator('[data-testid="twin3d-stage"]').waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
assert((await page.getByTestId("drape-spike-twin").count()) === 0, "shopper panel hidden with the flag off");

await tailorCtx.close();
await hostCtx.close();
await finish();
