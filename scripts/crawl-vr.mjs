// E35 Maker Space showroom hero + VR showroom + virtual fashion shows crawl (Pixel 7, SwiftShader WebGL).
// Maker Space showroom hero (live preview, View in VR, show row) → showroom inline fallback (walk, select, hold to buy
// sheet, XR hold-to-buy hand-off) with a mocked navigator.xr (Enter VR button) → studio: booth + schedule a show
// "now" → live show watched by two viewers with live count + reactions → RSVP on the seeded show → replay.
// Run: BASE_URL=http://localhost:3102 node scripts/crawl-vr.mjs
import { createRequire } from "node:module";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");
const { browser, context, page, shot, finish, issues } = await start("vr", { args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const getJson = async (p, path) => (await p.request.get(`${BASE}/api${path}`)).json();

// Mocked WebXR: immersive-vr "supported", but starting a session fails (no headset in CI).
const mockXr = () => {
  Object.defineProperty(navigator, "xr", {
    configurable: true,
    value: {
      isSessionSupported: async (mode) => mode === "immersive-vr",
      requestSession: async () => {
        throw new DOMException("No headset connected (mocked WebXR)", "NotSupportedError");
      },
      addEventListener() {},
      removeEventListener() {},
    },
  });
};
await context.addInitScript(mockXr);

// ── Shopper: Maker Space showroom-first hero (the 3D shelf was merged into it) ─────────────────────────────
const phone = `07887${String(Date.now()).slice(-5)}`;
await signIn(page, phone);
await page.goto(`${BASE}/m/umurage-wear`);
const heroRoom = page.getByRole("region", { name: /showroom$/ });
// The live room preview (same engine, preview mode) fades in over the composed poster once seen.
await page.waitForFunction(() => document.querySelector("section canvas")?.classList.contains("opacity-100"), null, { timeout: 45000 });
await page.waitForTimeout(800);
await shot("maker-space-showroom-hero");
assert(await heroRoom.getByRole("link", { name: "View in VR" }).isVisible(), "View in VR offered beside Enter showroom (mocked immersive-vr)");
assert(await page.getByRole("region", { name: /Fashion show:/ }).isVisible(), "upcoming show row under the identity block");

// ── Showroom: inline 3D fallback ──────────────────────────────────────────────────────────────────────────
await heroRoom.getByRole("link", { name: "Enter showroom" }).click();
await page.waitForURL(/\/showroom/);
await page.locator("canvas").waitFor();
await page.getByText(/Bringing in pieces/).waitFor({ timeout: 10000 }).catch(() => undefined);
await page.waitForFunction(() => !document.body.innerText.includes("Bringing in pieces"), null, { timeout: 60000 });
await page.waitForTimeout(1500);
await shot("showroom-entrance");
assert(await page.getByRole("button", { name: /Enter VR/ }).isVisible(), "Enter VR button shown with (mocked) immersive-vr support");
await page.locator("canvas").focus();
await page.keyboard.down("ArrowUp");
await page.waitForTimeout(900);
await page.keyboard.up("ArrowUp");
await page.keyboard.down("ArrowLeft");
await page.waitForTimeout(500);
await page.keyboard.up("ArrowLeft");
await page.waitForTimeout(400);
await shot("showroom-walk-keyboard");
// Drag to look around, then tap the floor to walk there.
const cb = await page.locator("canvas").boundingBox();
await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.4);
await page.mouse.down();
await page.mouse.move(cb.x + cb.width * 0.25, cb.y + cb.height * 0.42, { steps: 6 });
await page.mouse.up();
await page.mouse.click(cb.x + cb.width * 0.5, cb.y + cb.height * 0.7);
await page.waitForTimeout(1600);
await shot("showroom-look-and-tap-walk");
await page.getByRole("button", { name: "Back to the entrance" }).click();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Next piece" }).click();
await page.getByRole("region", { name: /details/ }).waitFor();
await page.waitForTimeout(1600);
await shot("showroom-piece-selected");
const sel = await page.getByRole("region", { name: /details/ }).getAttribute("aria-label");
assert(Boolean(sel), `a garment is selected (${sel})`);
await page.getByRole("button", { name: "Close piece details" }).click();
await page.getByRole("navigation", { name: "Pieces in this room" }).getByRole("button").nth(1).click();
await page.waitForTimeout(1600);
await page.getByRole("button", { name: /Buy/ }).first().click();
await page.getByText(/Press and hold 1 second/).waitFor();
await page.waitForTimeout(500);
await shot("showroom-hold-to-buy-sheet");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
// XR hand-off: a completed hold inside VR exits XR and opens the same sheet.
const pid = await page.evaluate(() => {
  const e = window.__vrShowroom;
  const id = e.o.pieces[0].id;
  e.o.onHoldBuy(id);
  return id;
});
await page.getByText(/Press and hold 1 second/).waitFor({ timeout: 5000 });
assert(Boolean(pid), "XR hold-to-buy hand-off opens the hold-to-buy sheet");
await shot("showroom-xr-handoff-sheet");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Close piece details" }).click();
await page.getByRole("button", { name: /Enter VR/ }).click();
await page.locator('p[role="alert"]').waitFor();
assert(/headset|VR/i.test(await page.locator('p[role="alert"]').innerText()), "VR start failure is explained, not thrown");
await page.getByRole("button", { name: "High-contrast labels" }).click();
await page.waitForTimeout(500);
await shot("showroom-high-contrast-vr-error");

// ── Tailor: studio booth + schedule a show now ────────────────────────────────────────────────────────────
const tailorCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const tailor = await tailorCtx.newPage();
tailor.on("console", (m) => m.type() === "error" && issues.push(`tailor console: ${m.text()}`));
tailor.on("response", (r) => r.status() >= 500 && issues.push(`tailor HTTP ${r.status()} ${r.url()}`));
await signIn(tailor, "0788100001");
const uwase = await getJson(tailor, "/pages/by-handle/umurage-wear");
await tailor.goto(`${BASE}/studio/${uwase.id}/showroom`);
await tailor.getByText("Your room in 3D and VR").waitFor();
await tailor.waitForTimeout(500);
await tailor.screenshot({ path: new URL("./crawl-output/vr/20-studio-showroom.png", import.meta.url).pathname, fullPage: true });
await tailor.getByRole("button", { name: /Schedule a show/ }).first().click();
const sheet = tailor.getByRole("dialog");
await sheet.getByLabel("Show name").fill(`Crawl live show ${phone.slice(-4)}`);
await sheet.getByRole("button", { name: "Now" }).click();
const tiles = sheet.locator('button[aria-pressed]');
await tiles.nth(0).click();
await tiles.nth(1).click();
await tiles.nth(2).click();
await tailor.waitForTimeout(300);
await tailor.screenshot({ path: new URL("./crawl-output/vr/21-studio-schedule-sheet.png", import.meta.url).pathname });
await sheet.getByRole("button", { name: /Schedule show/ }).click();
await sheet.waitFor({ state: "detached" });
const studio = await getJson(tailor, `/vr/pages/${uwase.id}`);
const live = studio.shows.find((s) => s.title.startsWith("Crawl live show"));
assert(live && live.phase === "LIVE", `show scheduled "now" is LIVE (${live?.phase})`);
// ── Live show: two viewers + reactions ────────────────────────────────────────────────────────────────────
const showUrl = `${BASE}/m/umurage-wear/shows/${live.id}`;
const anonCtx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const viewerB = await anonCtx.newPage();
viewerB.on("console", (m) => m.type() === "error" && issues.push(`viewerB console: ${m.text()}`));
viewerB.on("response", (r) => r.status() >= 500 && issues.push(`viewerB HTTP ${r.status()} ${r.url()}`));
await page.goto(showUrl);
await viewerB.goto(showUrl);
const viewers = (p) => p.locator('[aria-label$="watching"]').getAttribute("aria-label");
for (const p of [page, viewerB]) await p.waitForFunction(() => /^2 /.test(document.querySelector('[aria-label$="watching"]')?.getAttribute("aria-label") ?? ""), null, { timeout: 15000 });
assert((await viewers(page)).startsWith("2 ") && (await viewers(viewerB)).startsWith("2 "), "both viewers see 2 watching");
await page.waitForTimeout(7000); // past the intro: first look on the runway
await page.getByRole("button", { name: /^React: Fire/ }).click();
await page.getByRole("button", { name: /^React: Love it/ }).click();
await viewerB.waitForFunction(() => /Fire\s*1/.test(document.body.innerText) && /Love it\s*1/.test(document.body.innerText), null, { timeout: 8000 });
assert(true, "viewer B sees viewer A's reactions live");
await viewerB.getByRole("button", { name: /^React: Applause/ }).click();
await page.waitForFunction(() => /Applause\s*1/.test(document.body.innerText), null, { timeout: 8000 });
await page.waitForTimeout(600);
await shot("live-show-viewer-a");
await viewerB.screenshot({ path: new URL("./crawl-output/vr/30-live-show-viewer-b.png", import.meta.url).pathname });
await viewerB.close();
await page.waitForFunction(() => /^1 /.test(document.querySelector('[aria-label$="watching"]')?.getAttribute("aria-label") ?? ""), null, { timeout: 10000 });
assert(true, "viewer count drops to 1 when viewer B leaves");
await page.getByRole("button", { name: /Buy/ }).first().click();
await page.getByText(/Press and hold 1 second/).waitFor();
await shot("live-show-hold-to-buy");
await page.keyboard.press("Escape");

await tailor.goto(`${BASE}/studio/${uwase.id}/showroom`);
await tailor.getByText("A runway for your collection").waitFor();
await tailor.waitForTimeout(500);
await tailor.screenshot({ path: new URL("./crawl-output/vr/22-studio-shows.png", import.meta.url).pathname, fullPage: true });

// ── RSVP on the seeded upcoming show ──────────────────────────────────────────────────────────────────────
const seeded = studio.shows.find((s) => s.phase === "UPCOMING" && s.title.startsWith("Imigongo Nights"));
assert(Boolean(seeded), "seeded show is scheduled");
await page.goto(`${BASE}/m/umurage-wear/shows/${seeded.id}`);
await page.getByRole("button", { name: /Remind me on WhatsApp/ }).click();
await page.getByRole("button", { name: /on the list/ }).waitFor();
await shot("upcoming-show-rsvp");

// ── Replay once the live show ends (intro + 3 looks + finale ≈ 56 s) ─────────────────────────────────────
await page.goto(showUrl);
await page.getByRole("button", { name: /Watch the replay/ }).waitFor({ timeout: 70000 });
await shot("show-ended");
await page.getByRole("button", { name: /Watch the replay/ }).click();
await page.waitForTimeout(9000);
await shot("show-replay");

await tailorCtx.close();
await anonCtx.close();
await finish();
