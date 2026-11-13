// Navigation & workflow pass (docs/design/flows.md): every detour returns to the exact screen it left.
// Pixel 7. Asserts the landing URL plus state (look index, selected piece, open sheet) after each detour, for a
// signed-out shopper (sign in on a sheet) and a signed-in one (twin, measurements, order), plus studio/admin.
// Run: BASE_URL=http://localhost:3101 node scripts/crawl-flows.mjs   (fresh phone numbers per run)
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { browser, page, shot, finish, issues } = await start("flows");
const ok = (cond, msg) => {
  if (cond) console.log(`✔ ${msg}`);
  else {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  }
};
const here = (p = page) => {
  const u = new URL(p.url());
  return u.pathname + u.search;
};
// The seeded tailor with a showroom: "umurage-wear" since the realistic reseed, "uwase-couture" before it.
const HANDLE = (await Promise.all(["umurage-wear", "uwase-couture"].map(async (h) => ((await fetch(`${BASE}/api/pages/by-handle/${h}`)).ok ? h : null)))).find(Boolean) ?? "umurage-wear";
console.log(`maker: ${HANDLE}`);
const fresh = (prefix) => `${prefix}${String(Date.now()).slice(-5)}`;
const api = (p, path, body) =>
  p.evaluate(
    async ([path, body]) => {
      const r = await fetch(`/api${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return r.ok ? r.json() : { error: r.status };
    },
    [path, body],
  );
/** Index of the look on screen (the stream is a vertical snap scroller). */
const lookIndex = (p = page) => p.evaluate(() => {
  const el = document.querySelector('[aria-label="Looks stream"]');
  return el ? Math.round(el.scrollTop / el.clientHeight) : -1;
});
/** OTP inside the sign-in sheet (same steps as the page, scoped to the dialog). */
async function signInOnSheet(p, phone) {
  const sheet = p.getByRole("dialog");
  await sheet.getByLabel(/phone/i).fill(phone);
  await sheet.getByRole("button", { name: /send code|ohereza|envoyer/i }).click();
  const dev = sheet.locator("button.font-mono");
  await dev.waitFor();
  await dev.click();
  await sheet.getByRole("button", { name: /continue|komeza|continuer/i }).click();
}
async function hold(p, button) {
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(1500);
  await p.mouse.up();
}

// ── 1. Signed out: Maker Space Follow → sign-in sheet → still on the Maker Space, following ─────────────────────
await page.goto(`${BASE}/m/${HANDLE}`);
await page.getByRole("button", { name: /follow/i }).first().click();
await page.getByRole("dialog").getByText("Sign in to follow").waitFor();
await shot("anon-follow-signin-sheet");
await signInOnSheet(page, fresh("07883"));
await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 });
ok(here() === `/m/${HANDLE}`, `Follow: signed in on a sheet, still on ${here()}`);
await page.getByRole("button", { name: /following/i }).first().waitFor({ timeout: 10000 }).catch(() => {});
ok((await page.getByRole("button", { name: /following/i }).count()) > 0, "Follow resumed after sign-in (Following)");

// ── 2. Signed out: showroom piece → Buy → sign-in sheet → buy sheet open on the same piece ──────────────────────
{
  const anon = await browser.newContext({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, locale: "en-US" });
  const p = await anon.newPage();
  p.on("pageerror", (e) => issues.push(`pageerror(anon): ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && issues.push(`HTTP ${r.status()} ${r.url()}`));
  await p.goto(`${BASE}/m/${HANDLE}/showroom`);
  const strip = p.getByRole("navigation", { name: "Pieces in this room" });
  await strip.waitFor({ timeout: 30000 });
  // The 3D room streams its pieces in first (crawl-vr does the same wait).
  await p.getByText(/Bringing in pieces/).waitFor({ timeout: 10000 }).catch(() => undefined);
  await p.waitForFunction(() => !document.body.innerText.includes("Bringing in pieces"), null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await strip.getByRole("button").nth(1).click();
  await p.waitForURL(/item=/, { timeout: 10000 });
  const pieceUrl = here(p);
  ok(/\?item=/.test(pieceUrl), `showroom: the selected piece is in the URL (${pieceUrl})`);
  await p.waitForTimeout(1600);
  await p.getByRole("button", { name: /^Buy$/ }).first().click();
  await p.getByRole("dialog").getByText("Sign in to buy").waitFor();
  await p.screenshot({ path: new URL("./crawl-output/flows/anon-showroom-signin-sheet.png", import.meta.url).pathname });
  await signInOnSheet(p, fresh("07884"));
  const holdBtn = p.getByRole("dialog").getByRole("button", { name: /hold to buy/i });
  await holdBtn.waitFor({ timeout: 20000 });
  ok(here(p) === pieceUrl, `showroom Buy: same piece after sign-in (${here(p)})`);
  ok(await holdBtn.isVisible(), "showroom Buy: the buy sheet opened by itself after sign-in");
  await p.screenshot({ path: new URL("./crawl-output/flows/anon-showroom-buy-sheet.png", import.meta.url).pathname });
  // Deep-linked sign in with an off-site next stays on this site.
  await p.context().clearCookies();
  await p.goto(`${BASE}/signin?next=${encodeURIComponent("//evil.example/x")}`);
  await p.getByLabel(/phone/i).fill(fresh("07885"));
  await p.getByRole("button", { name: /send code/i }).click();
  await p.locator("button.font-mono").click();
  await p.getByRole("button", { name: /continue/i }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 15000 });
  ok(new URL(p.url()).origin === new URL(BASE).origin && new URL(p.url()).pathname === "/", `sign in ignores an off-site next (${p.url()})`);
  await anon.close();
}

// ── 3. Signed in: Looks keep their place across Maker Space, twin, measurements and an order ────────────────────
await signIn(page, fresh("07886"));
const { sessionId } = await api(page, "/intent", { text: "a kitenge dress for a wedding under 60000", source: "text", locale: "en" });
ok(Boolean(sessionId), `Muse session ${sessionId}`);
await page.goto(`${BASE}/`);
await page.goto(`${BASE}/looks/${sessionId}`); // in-app history: Muse → Looks
await page.locator('[aria-label="Looks stream"]').waitFor();
await page.locator("section").first().waitFor();
for (let k = 0; k < 3; k++) {
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(700);
}
await page.waitForURL(/[?&]i=3/, { timeout: 10000 });
ok((await lookIndex()) === 3, "Looks: on look 4, ?i=3 in the URL");
await shot("looks-at-4");

// 3a. Maker Space and back (history): same look.
const active = page.locator("section").nth(3);
await active.locator('a[href^="/m/"]').first().click();
await page.waitForURL(/\/m\//, { timeout: 15000 });
await page.waitForTimeout(500);
await page.getByRole("link", { name: "Back" }).first().click();
await page.waitForURL(new RegExp(`/looks/${sessionId}\\?i=3`), { timeout: 15000 });
await page.waitForTimeout(600);
ok((await lookIndex()) === 3, `Maker Space → Back: look 4 again (${here()})`);

// 3b. Twin from the stream (nudge, else the menu's twin link with next): consent + demo persona → back to look 4.
const nudge = page.locator('a[href^="/mirror"]').first();
if (await nudge.isVisible().catch(() => false)) await nudge.click();
else await page.goto(`${BASE}/mirror?next=${encodeURIComponent(here())}`);
await page.waitForURL(/\/mirror/, { timeout: 15000 });
ok(new URL(page.url()).searchParams.get("next")?.includes(`i=3`) ?? false, `twin detour carries next with the look index (${here()})`);
await page.getByRole("switch").check({ force: true });
await page.getByText(/demo|synthetic/i).first().click();
await page.getByRole("button", { name: "Persona 2" }).click();
await page.getByRole("button", { name: /back to your looks/i }).waitFor({ timeout: 30000 });
await shot("twin-ready-return-countdown");
await page.waitForURL(new RegExp(`/looks/${sessionId}\\?i=3`), { timeout: 15000 });
await page.waitForTimeout(800);
ok((await lookIndex()) === 3, `twin made → auto-return to look 4 (${here()})`);
// Twin follow-through: the visible look re-renders on the twin (sheen, then "On you now").
const sheen = await page.locator("section").nth(3).locator("[data-retwin]").waitFor({ timeout: 8000 }).then(() => true, () => false);
if (sheen) await shot("retwin-sheen");
const onYou = await page.getByText("On you now").waitFor({ timeout: 45000 }).then(() => true, () => false);
ok(sheen || onYou, `looks re-render on the new twin (sheen ${sheen}, toast ${onYou})`);
await page.locator("section").nth(3).locator('img[alt*="on your twin"]').waitFor({ timeout: 45000 }).catch(() => {});
ok((await page.locator("section").nth(3).locator('img[alt*="on your twin"]').count()) === 1, "look 4 is now on the twin");
ok((await lookIndex()) === 3, "still on look 4 after the re-render");
await shot("retwin-on-you");

// 3c. Buy sheet → Add measurements → save → back on look 4 with the buy sheet open.
await page.locator("section").nth(3).getByRole("button", { name: /^Buy$/ }).click();
const buy = page.getByRole("dialog");
await buy.getByRole("button", { name: /hold to buy/i }).waitFor({ timeout: 15000 });
const addM = buy.getByRole("link", { name: /measurements/i });
if (await addM.isVisible().catch(() => false)) {
  await addM.click();
  await page.waitForURL(/\/measurements\?next=/, { timeout: 15000 });
  const saveM = page.getByRole("button", { name: /save measurements|save changes/i });
  await saveM.waitFor({ timeout: 15000 });
  if (await saveM.isDisabled()) await page.getByText("Store encrypted · size advice").click();
  await page.getByRole("button", { name: /save measurements|save changes/i }).click();
  await page.getByRole("button", { name: /back to your looks/i }).waitFor({ timeout: 10000 });
  await shot("measurements-saved-return");
  await page.waitForURL(new RegExp(`/looks/${sessionId}\\?i=3`), { timeout: 15000 });
  await page.getByRole("dialog").getByRole("button", { name: /hold to buy/i }).waitFor({ timeout: 15000 });
  ok((await lookIndex()) === 3, `measurements → back on look 4 (${here()})`);
  ok(await page.getByRole("dialog").getByRole("button", { name: /hold to buy/i }).isVisible(), "the buy sheet reopened by itself");
  await shot("buy-sheet-resumed");
} else ok(false, "a measurements link in the buy sheet");

// 3d. Hold to buy → order (terminal) → "Back to your looks" → look 4.
const sheet = page.getByRole("dialog");
await sheet.getByRole("button", { name: /^Pickup in/ }).click();
await hold(page, sheet.getByRole("button", { name: /hold to buy/i }));
await page.waitForURL(/\/orders\/.+fresh=1/, { timeout: 20000 });
const orderPath = new URL(page.url()).pathname;
await page.getByRole("button", { name: /back to your looks/i }).waitFor({ timeout: 10000 });
await shot("order-back-to-looks");
await page.getByRole("button", { name: /back to your looks/i }).click();
await page.waitForURL(new RegExp(`/looks/${sessionId}\\?i=3`), { timeout: 15000 });
await page.waitForTimeout(600);
ok((await lookIndex()) === 3, `order → Back to your looks → look 4 (${here()})`);

// 3e. Deep links never dead-end: a fresh tab on the order goes Back to the orders list.
{
  const tab = await page.context().newPage();
  await tab.goto(`${BASE}${orderPath}`);
  await tab.getByRole("link", { name: "Back" }).first().click();
  await tab.waitForURL((u) => u.pathname === "/orders", { timeout: 15000 });
  ok(new URL(tab.url()).pathname === "/orders", `deep-linked order → Back → ${new URL(tab.url()).pathname}`);
  await tab.close();
}

// ── 4. Admin tab and studio filter survive a round trip ──────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, locale: "en-US" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => issues.push(`pageerror(host): ${e.message}`));
  await signIn(p, "0788900001");
  await p.goto(`${BASE}/admin`);
  await p.getByRole("button", { name: /^Moderation/ }).first().click();
  await p.waitForURL(/tab=Moderation/, { timeout: 10000 });
  await p.reload();
  await p.locator('[aria-current="page"]:visible', { hasText: "Moderation" }).first().waitFor({ timeout: 15000 });
  ok(/tab=Moderation/.test(here(p)), `admin: open tab kept in the URL across reload (${here(p)})`);
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, locale: "en-US" });
  const s = await ctx2.newPage();
  s.on("pageerror", (e) => issues.push(`pageerror(studio): ${e.message}`));
  await signIn(s, "0788100001");
  const pages = await api(s, "/pages/mine/list");
  const uwase = pages.find?.((x) => x.handle === HANDLE) ?? pages[0];
  await s.goto(`${BASE}/studio/${uwase.id}/products?filter=live`);
  const first = s.locator(`a[href^="/studio/${uwase.id}/products/"]`).filter({ hasNot: s.locator('[href$="/new"]') }).first();
  await first.waitFor({ timeout: 20000 });
  const before = here(s);
  await first.click();
  await s.waitForURL(/\/products\/[^/?]+/, { timeout: 15000 });
  await s.getByRole("link", { name: "Back to products" }).click();
  await s.waitForURL((u) => u.pathname.endsWith("/products"), { timeout: 15000 });
  ok(here(s) === before, `studio: product → Back keeps the list filter (${before} → ${here(s)})`);
  await ctx2.close();
}

await finish();
