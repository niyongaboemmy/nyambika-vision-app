// E33 3D twin + E34 3D try-on / AR mirror crawl (Pixel 7).
// consent → synthetic persona turnaround (coverage ring) → avatar built → dress, spin, colour switch, size, pose
// → look → 3D stage → "Try on my 3D twin" → AR mirror (flag off, then on with a fake camera stream).
// Run: BASE_URL=http://localhost:3102 node scripts/crawl-twin3d.mjs
import { createRequire } from "node:module";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");

// Fake camera for the AR mirror (Chromium's synthetic test pattern), auto-accepted permission prompt.
const { browser, context, page, shot, finish, issues } = await start("twin3d", {
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-unsafe-swiftshader"],
});
await context.grantPermissions(["camera"], { origin: BASE });
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const api = async (p, path, data, method) => {
  const r = method === "PATCH" ? await p.request.patch(`${BASE}/api${path}`, { data }) : data ? await p.request.post(`${BASE}/api${path}`, { data }) : await p.request.get(`${BASE}/api${path}`);
  return r.json();
};
const modelLoaded = async (p, timeout = 45000) => {
  await p.locator("model-viewer").first().waitFor({ timeout: 30000 });
  await p.waitForFunction(() => document.querySelector("model-viewer")?.loaded === true, null, { timeout });
  await p.waitForTimeout(700);
};
// React 19 assigns `src` as a property on the custom element, so read the property, not the attribute.
const srcNow = (p) => p.evaluate(() => document.querySelector("model-viewer")?.src ?? null);

// ── Tailor: make sure the seeded dress has an approved 3D model (E27) for the look entry point ──────────────
const tailorCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const tailor = await tailorCtx.newPage();
await signIn(tailor, "0788100001");
const uwase = await api(tailor, "/pages/by-handle/uwase-couture");
const seeded = uwase.products.find((p) => p.title === "Uruziga a-line dress");
let s3d = await api(tailor, `/xr/products/${seeded.id}/3d`);
if (!s3d.variants.some((v) => v.asset?.status === "READY")) {
  await api(tailor, `/xr/products/${seeded.id}/3d`, {});
  for (let i = 0; i < 60 && !s3d.variants.every((v) => !v.hasCutout || ["READY", "FAILED"].includes(v.asset?.status)); i++) {
    await tailor.waitForTimeout(1000);
    s3d = await api(tailor, `/xr/products/${seeded.id}/3d`);
  }
}
await api(tailor, `/xr/products/${seeded.id}/3d/approve`, { approved: true });
assert((await api(tailor, `/xr/public/products/${seeded.id}/3d`)).assets.length >= 1, "seeded dress has an approved 3D model");
await tailorCtx.close();

// ── Shopper: consent → persona turnaround → avatar ─────────────────────────────────────────────────────────
const phone = `07886${String(Date.now()).slice(-5)}`;
await signIn(page, phone);
await page.goto(`${BASE}/mirror`);
await page.getByText(/Prefer 3D\? Make a 3D twin/).waitFor();
await page.goto(`${BASE}/mirror/3d`);
await page.getByRole("switch", { name: /consent to creating my private 3d twin/i }).waitFor();
await page.waitForTimeout(400);
await shot("consent-intro");
assert(await page.getByRole("button", { name: "Continue" }).isDisabled(), "nothing happens before the separate 3D consent");
await page.getByText("Private 3D twin").click();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Persona 3" }).waitFor();
await page.waitForTimeout(300);
await shot("start-options");
const consents = await api(page, "/privacy");
assert(consents.consents.find((c) => c.purpose === "AVATAR_3D")?.granted === true, "AVATAR_3D consent recorded in the ledger");

await page.getByRole("button", { name: "Persona 3" }).click();
await page.getByRole("progressbar", { name: "Turn coverage" }).waitFor();
await page.waitForFunction(() => Number(document.querySelector('[aria-label="Turn coverage"]')?.getAttribute("aria-valuenow")) >= 50, null, { timeout: 15000 });
await shot("persona-turnaround-capture");
await page.getByText(/Building your 3D twin|3D twin · 360°/).first().waitFor({ timeout: 20000 });
if (await page.getByText("Building your 3D twin").isVisible().catch(() => false)) await shot("building");
await modelLoaded(page);
await page.waitForTimeout(1200);
await shot("avatar-built-spin");
const st = await api(page, "/twin3d");
assert(st.avatar?.status === "READY" && st.avatar.joints === 18, `avatar READY with an 18-joint skeleton (v${st.avatar?.version})`);
assert(st.avatar?.eval?.passed === true, `NLB-style eval passed (skin Δ ${st.avatar?.eval?.skin_tone_delta})`);
const glbRes = await page.request.get(`${BASE}${st.avatar.glb}`);
assert(glbRes.status() === 200 && glbRes.headers()["content-type"] === "model/gltf-binary", "private GLB served via signed link");
assert((await page.request.get(`${BASE}${st.avatar.glb.replace(/sig=[0-9a-f]{4}/, "sig=0000")}`)).status() === 403, "tampered avatar link refused");

// ── 3D try-on: dress, colour switch, size, pose ────────────────────────────────────────────────────────────
const firstPiece = page.getByRole("button", { name: /^Wear / }).first();
await firstPiece.waitFor({ timeout: 15000 });
let before = await srcNow(page);
await firstPiece.click();
await page.getByRole("region", { name: "Dressed in" }).waitFor({ timeout: 30000 });
await page.waitForFunction((b) => (document.querySelector("model-viewer")?.src ?? null) !== b, before, { timeout: 30000 });
await modelLoaded(page);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500);
await shot("dressed-spin");
await page.getByRole("region", { name: "Dressed in" }).scrollIntoViewIfNeeded();
await shot("dressed-controls");

const colours = page.getByRole("radiogroup", { name: "Colour" }).getByRole("radio");
if ((await colours.count()) > 1) {
  before = await srcNow(page);
  await colours.nth(1).click();
  await page.waitForFunction((b) => (document.querySelector("model-viewer")?.src ?? null) !== b, before, { timeout: 30000 });
  await modelLoaded(page);
  await page.locator('[data-testid="twin3d-stage"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await shot("colour-switched");
  assert(true, "colour switch re-dressed the twin");
} else console.log("ℹ only one colour for this piece");

const otherSize = page.getByRole("radiogroup", { name: "Size" }).locator('[aria-checked="false"]').first();
if (await otherSize.count()) {
  const label = ((await otherSize.innerText()).match(/^[A-Z0-9]+/) ?? [""])[0];
  before = await srcNow(page);
  await otherSize.click();
  await page.waitForFunction((b) => (document.querySelector("model-viewer")?.src ?? null) !== b, before, { timeout: 30000 });
  await modelLoaded(page);
  const t = await page.getByRole("region", { name: "Dressed in" }).innerText();
  assert(new RegExp(`Size ${label}\\b`).test(t), `size ${label} fitted (different ease)`);
}
await page.getByRole("radio", { name: "Walk" }).click();
await page.locator('[data-testid="twin3d-stage"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(900);
assert((await page.evaluate(() => document.querySelector("model-viewer")?.animationName)) === "Walk", "Walk clip playing from the skeleton");
await shot("pose-walk");
await page.getByRole("radio", { name: "Turn" }).click();
await page.waitForTimeout(1500);
await shot("pose-turn");
await page.getByRole("button", { name: /Adjust body/ }).click();
await page.getByText("Adjust my body").waitFor();
await page.waitForTimeout(300);
await shot("adjust-body-sheet");
await page.keyboard.press("Escape");

// ── Look → 3D stage → Try on my 3D twin ────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/looks/try?variant=${seeded.variants[0].id}`);
const rail3d = page.getByRole("button", { name: "3D", exact: true });
await rail3d.waitFor({ timeout: 30000 });
await rail3d.click();
await page.getByRole("dialog", { name: /in 3d/i }).waitFor();
await modelLoaded(page);
await page.getByRole("link", { name: /try on my 3d twin/i }).scrollIntoViewIfNeeded();
await shot("look-3d-stage-try-in-3d");
await page.getByRole("link", { name: /try on my 3d twin/i }).click();
await page.waitForURL(/\/mirror\/3d\?variant=/);
await page.getByRole("region", { name: "Dressed in" }).waitFor({ timeout: 30000 });
await modelLoaded(page);
await page.waitForTimeout(1200);
const dressedTitle = await page.getByRole("region", { name: "Dressed in" }).innerText();
assert(dressedTitle.includes(seeded.title), "Try in 3D dressed the twin in the look's dress");
await shot("look-try-in-3d-dressed");

// ── AR mirror: flag off → pilot card; host turns it on → live mirror with the fake camera ─────────────────
await page.goto(`${BASE}/mirror/ar?variant=${seeded.variants[0].id}`);
await page.getByText("AR mirror is a pilot").waitFor({ timeout: 15000 });
await shot("ar-flag-off");

const hostCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const host = await hostCtx.newPage();
await signIn(host, "0788900001");
await api(host, "/admin/flags/ar.mirror_pilot", { enabled: true }, "PATCH");
try {
  await page.goto(`${BASE}/mirror/ar?variant=${seeded.variants[0].id}`);
  await page.getByRole("button", { name: /start live mirror|try live mirror anyway/i }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await shot("ar-ready-static");
  await page.getByRole("button", { name: /start live mirror|try live mirror anyway/i }).click();
  const live = await page.getByText("LIVE AR MIRROR", { exact: false }).waitFor({ timeout: 45000 }).then(() => true).catch(() => false);
  if (live) {
    const uploads = [];
    page.on("request", (r) => r.method() !== "GET" && uploads.push(r.url()));
    await page.waitForTimeout(1200);
    const drawn = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="ar-stage"] canvas');
      if (!c || !c.width) return false;
      const d = c.getContext("2d").getImageData(c.width / 2, c.height / 2, 1, 1).data;
      return d[3] > 0;
    });
    await shot("ar-live-fake-camera");
    assert(drawn, "camera frames drawn on the mirror canvas (on-device)");
    // Headless SwiftShader runs pose tracking well under 10 fps: the pilot must drop to the static try-on by itself.
    const fellBack = await page.getByText(/too slow on this phone/).waitFor({ timeout: 9000 }).then(() => true).catch(() => false);
    if (!fellBack) await page.getByRole("button", { name: "Stop camera" }).click({ timeout: 3000 }).catch(() => undefined);
    const stopped = fellBack ? "fallback" : "live";
    console.log(`ℹ mirror ${fellBack ? "fell back to the still try-on (slow headless GPU)" : "kept running at full speed"}`);
    assert(uploads.length === 0, "no video/frames uploaded while the mirror runs");
    const tracks = await page.evaluate(() => [...document.querySelectorAll("video")].some((v) => v.srcObject && v.srcObject.getTracks().some((t) => t.readyState === "live")));
    assert(!tracks || stopped === "live", "camera released after the fallback");
  } else {
    // Without network access to the MediaPipe CDN the pilot must fall back to the static try-on.
    await page.getByText(/still try-on/).waitFor({ timeout: 10000 });
    console.log("ℹ live tracking unavailable here; static fallback shown");
  }
  await page.waitForTimeout(500);
  await shot("ar-after");
} finally {
  await api(host, "/admin/flags/ar.mirror_pilot", { enabled: false }, "PATCH");
  await hostCtx.close();
}

// ── Trust centre shows the separate consent ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/trust`);
await page.getByText("Keep my private 3D twin").waitFor();
await page.getByText("Keep my private 3D twin").scrollIntoViewIfNeeded();
await shot("trust-3d-consent");

// MediaPipe's WASM logs its TFLite delegate setup through console.error; that is informational, not a failure.
for (let i = issues.length - 1; i >= 0; i--) if (/TensorFlow Lite|XNNPACK|gl_context|OpenGL error checking|GL version/i.test(issues[i])) issues.splice(i, 1);
await finish();
