// Maker Space redesign crawl (docs/design/ui-audit.md §9): showroom-first hero with the live 3D preview, one-line
// identity, the "N pieces" sheet → product sheet (3D first), the slim fashion-show row with RSVP, the floating bar
// that appears once the hero scrolls away, Enter showroom, View in VR (mocked immersive-vr), reduced motion and
// data saver (poster only). Pixel 7 + SwiftShader WebGL. Fails on console errors / 5xx.
// Run: BASE_URL=http://localhost:3103 node scripts/crawl-makerspace.mjs
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { browser, context, page, shot, finish, issues } = await start("makerspace", { args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const hero = () => page.getByRole("region", { name: /showroom$/ });

// ── Anonymous shopper: hero, identity, pieces sheet ───────────────────────────────────────────────────────
await page.goto(`${BASE}/m/kanombe-kitenge-corner`);
await hero().getByRole("link", { name: "Enter showroom" }).waitFor();
const h1 = page.getByRole("heading", { level: 1 });
const lines = await h1.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
assert(lines === 1, `maker name sits on one line (${lines})`);
assert((await page.getByRole("listbox").count()) === 0, "no coverflow or 3D shelf listbox left");
await page.waitForFunction(() => document.querySelector("section canvas")?.classList.contains("opacity-100"), null, { timeout: 45000 });
await page.waitForTimeout(1500);
await shot("hero-live-preview");
await page.getByRole("button", { name: /See all \d+ pieces/ }).click();
const list = page.getByRole("list", { name: "Collection" });
await list.waitFor();
assert((await list.getByRole("button").count()) >= 6, "the sheet lists every piece");
assert((await list.getByText("3D", { exact: true }).count()) >= 1, "pieces with a model carry a 3D badge");
await page.waitForTimeout(500);
await shot("pieces-sheet");
await list.getByRole("button", { name: /Golden kaftan/ }).click();
const sheet = page.getByRole("dialog");
await sheet.getByRole("button", { name: /view in 3d/i }).waitFor({ timeout: 15000 });
await sheet.getByRole("button", { name: /try on me/i }).waitFor();
await page.waitForTimeout(400);
await shot("product-sheet-3d-first");
await page.keyboard.press("Escape");
await list.waitFor();
await page.keyboard.press("Escape");
await list.waitFor({ state: "detached" });

// Floating bar: hidden while the hero CTA is on screen, shown once it scrolls away; content is padded clear of it.
// The page is about 1.5 screens, so the bar only matters on short viewports (landscape, small phones): test at 600 px tall.
await page.setViewportSize({ width: 412, height: 600 });
await page.goto(`${BASE}/m/umurage-wear`);
await page.getByRole("heading", { level: 1 }).waitFor();
const bar = page.locator("[data-maker-bar]");
assert((await bar.getAttribute("aria-hidden")) === "true", "floating bar hidden at the top");
await page.waitForLoadState("networkidle");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(600);
assert((await bar.getAttribute("aria-hidden")) === "false", "floating bar appears once the hero scrolls away");
const overlap = await page.evaluate(() => {
  const b = document.querySelector("[data-maker-bar]").getBoundingClientRect();
  const follow = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim().endsWith("Follow"))?.getBoundingClientRect();
  return follow ? follow.bottom > b.top : false;
});
assert(!overlap, "floating bar does not cover the Follow / Chat row");
await shot("floating-bar");
await bar.getByRole("link", { name: "Enter showroom" }).click();
await page.waitForURL(/\/showroom$/);
await page.setViewportSize({ width: 412, height: 839 });
await page.locator("canvas").waitFor();
await shot("showroom-from-bar");

// ── Show row: countdown + RSVP (signed out → sign in; signed in → Going) ──────────────────────────────────
await page.goto(`${BASE}/m/umurage-wear`);
const showRow = page.getByRole("region", { name: /Fashion show:/ });
await showRow.waitFor();
assert(await showRow.getByRole("timer").isVisible(), "upcoming show shows a ticking countdown");
await shot("show-row");
await showRow.getByRole("button", { name: "RSVP" }).click();
await page.waitForURL(/\/signin/);
const phone = `07886${String(Date.now()).slice(-5)}`;
await signIn(page, phone);
await page.goto(`${BASE}/m/umurage-wear`);
await showRow.getByRole("button", { name: "RSVP" }).click();
await showRow.getByRole("button", { name: "Going" }).waitFor();
assert(true, "RSVP in place flips to Going");
await showRow.getByRole("button", { name: "Going" }).click();
await showRow.getByRole("button", { name: "RSVP" }).waitFor();
await page.getByRole("button", { name: /^\+?\s*Follow$/ }).first().click();
await page.getByRole("button", { name: /Following/ }).first().waitFor();
await page.getByRole("button", { name: /Following/ }).first().click();
await shot("signed-in");

// ── View in VR (mocked immersive-vr) ───────────────────────────────────────────────────────────────────────
const vr = await browser.newContext({ ...context._options });
await vr.addInitScript(() => Object.defineProperty(navigator, "xr", { configurable: true, value: { isSessionSupported: async (m) => m === "immersive-vr", requestSession: async () => { throw new DOMException("mocked", "NotSupportedError"); }, addEventListener() {}, removeEventListener() {} } }));
const vp = await vr.newPage();
vp.on("console", (m) => m.type() === "error" && issues.push(`console(vr): ${m.text()}`));
await vp.goto(`${BASE}/m/umurage-wear`);
await vp.getByRole("link", { name: "View in VR" }).click();
await vp.waitForURL(/showroom\?vr=1/);
await vp.getByRole("button", { name: /Enter VR/ }).waitFor({ timeout: 45000 });
assert(true, "View in VR leads to the showroom with Enter VR ready");
await vr.close();

// ── Reduced motion + data saver: poster only, no WebGL preview ─────────────────────────────────────────────
const lite = await browser.newContext({ ...context._options, reducedMotion: "reduce" });
await lite.addInitScript(() => Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } }));
const lp = await lite.newPage();
await lp.goto(`${BASE}/m/kanombe-kitenge-corner`);
await lp.getByRole("link", { name: "Enter showroom" }).waitFor();
await lp.waitForTimeout(3000);
assert((await lp.locator("section canvas").count()) === 0, "data saver keeps the composed poster (no 3D download)");
await lp.screenshot({ path: new URL("./crawl-output/makerspace/90-data-saver-poster.png", import.meta.url).pathname });
await lite.close();

// ── 360 px: no horizontal scroll, name still one line ───────────────────────────────────────────────────────
await page.setViewportSize({ width: 360, height: 780 });
for (const h of ["urudodo-collective", "kanombe-kitenge-corner"]) {
  await page.goto(`${BASE}/m/${h}`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(o <= 0, `${h}: no horizontal overflow at 360 (${o})`);
  const t = await page.getByRole("heading", { level: 1 }).evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  assert(Math.round(t) === 1, `${h}: name on one line at 360`);
}
await shot("360");
await finish();
