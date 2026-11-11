// E25 Ask your circle + E26 Digital wardrobe crawl (Pixel 7). Two browser contexts:
// owner creates a poll → friend opens /c/<token> anonymously, votes and comments → owner sees it live
// → owner holds to buy the winner → maker delivers → wardrobe restyle → rendered outfits → reminder in the outbox.
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { browser, context, page, shot, finish, issues } = await start("social");
const out = new URL("./crawl-output/social/", import.meta.url).pathname;
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

// ── Owner: fresh shopper with a synthetic twin ────────────────────────────────
const phone = `07886${String(Date.now()).slice(-5)}`;
await signIn(page, phone);
await page.goto(`${BASE}/mirror`);
await page.getByRole("switch").check({ force: true });
await page.getByText(/synthetic demo persona/i).click();
await page.getByRole("button", { name: "Persona 3" }).click();
await page.getByText(/your twin is ready/i).waitFor({ timeout: 20000 });

await page.goto(BASE);
await page.locator("footer button[title]").click();
await page.getByRole("textbox").fill("Kitenge shirt for the office");
await page.keyboard.press("Enter");
await page.waitForURL(/\/looks\//, { timeout: 20000 });
const first = page.locator('section[aria-label^="Look 1 of"]');
await first.locator('img[alt*="AI preview"]').waitFor({ timeout: 30000 });
// Make sure looks 2 and 3 are finished too so they can go in the poll.
const stream = page.getByLabel("Looks stream");
await stream.evaluate((el) => el.scrollTo({ top: el.clientHeight }));
await page.locator('section[aria-label^="Look 2 of"] img[alt*="AI preview"]').waitFor({ timeout: 30000 });
await stream.evaluate((el) => el.scrollTo({ top: 0 }));
await page.waitForTimeout(600);

// Ask your circle from the rail
await first.getByRole("button", { name: "Ask" }).click();
const sheet = page.getByRole("dialog");
await sheet.getByRole("group", { name: "Your looks" }).locator("img").first().waitFor();
await page.waitForTimeout(400);
await shot("ask-pick");
const unpicked = sheet.getByRole("group", { name: "Your looks" }).locator('button[aria-pressed="false"]');
// Include a separate (shirt/skirt) when one is on offer, so the bought winner can be restyled with new pieces.
const separate = sheet.locator('[aria-label="Your looks"] button[aria-pressed="false"][aria-label*="shirt"], [aria-label="Your looks"] button[aria-pressed="false"][aria-label*="skirt"]');
const picked0 = await sheet.locator('button[aria-pressed="true"]').getAttribute("aria-label");
if (!/shirt|skirt/.test(picked0 ?? "") && (await separate.count())) await separate.first().click();
else await unpicked.first().click();
if ((await unpicked.count()) > 0) await unpicked.first().click();
await shot("ask-picked");
await sheet.getByRole("button", { name: /^next/i }).click();
await sheet.getByText(/what your circle will see/i).waitFor();
await shot("ask-review-consent");
assert(await sheet.getByRole("button", { name: "Create poll" }).isDisabled(), "Create poll is disabled until consent is ticked");
await sheet.getByRole("checkbox").check();
await sheet.getByRole("button", { name: "Create poll" }).click();
await sheet.getByText(/your poll is live/i).waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
await shot("ask-live-share");
const href = await sheet.getByRole("link", { name: /live results/i }).getAttribute("href");
const pollId = href.split("/").pop();
const owner = await (await page.request.get(`${BASE}/api/circle/polls/${pollId}`)).json();
console.log(`poll ${pollId} → ${owner.shareUrl}`);
assert(owner.options.length >= 2, `poll has ${owner.options.length} looks`);

await page.goto(`${BASE}${href}`);
await page.getByText(/votes and comments appear here/i).waitFor();
await page.getByText("Live", { exact: true }).waitFor({ timeout: 8000 });
await shot("owner-waiting");

// WhatsApp preview: OG tags + image
const html = await (await page.request.get(`${BASE}/c/${owner.token}`)).text();
const og = html.match(/property="og:image" content="([^"]+)"/)?.[1];
assert(og?.endsWith(`/api/c/${owner.token}/og.jpg`), `og:image is absolute (${og})`);
const ogRes = await page.request.get(`${BASE}/api/c/${owner.token}/og.jpg`);
assert(ogRes.ok() && ogRes.headers()["content-type"] === "image/jpeg", "OG preview image renders");
const { writeFileSync } = await import("node:fs");
writeFileSync(`${out}og-preview.jpg`, await ogRes.body());

// ── Friend: anonymous, separate context ───────────────────────────────────────
const friendCtx = await browser.newContext({ ...context._options });
const friend = await friendCtx.newPage();
watch(friend, "friend");
await friend.goto(`${BASE}/c/${owner.token}`);
await friend.getByRole("button", { name: /^vote for/i }).first().waitFor();
await friend.locator('img[alt$="AI preview"]').first().evaluate((img) => img.complete || new Promise((r) => (img.onload = r)));
await friend.screenshot({ path: `${out}50-friend-poll.png` });
// Vote for a separate (shirt/skirt) if there is one, so the wardrobe restyle can mix owned + new pieces.
const pick = Math.max(0, owner.options.findIndex((o) => ["shirt", "skirt"].includes(o.look?.product.category)));
const card = friend.locator('[aria-label="Looks to vote on"] > button').nth(pick);
if (pick > 0) {
  await card.click(); // first tap on a side card brings it to the centre
  await friend.waitForTimeout(700);
}
await card.click(); // tap the centred look to vote
await friend.getByText("Your vote ✓").waitFor();
await friend.waitForTimeout(900);
await friend.screenshot({ path: `${out}51-friend-voted.png` });
await friend.getByRole("button", { name: /add a comment/i }).click();
await friend.getByRole("button", { name: "React 💙" }).click();
await friend.getByLabel(/your name/i).fill("Grace");
await friend.getByLabel(/comment/i).fill("This one! So elegant");
await friend.screenshot({ path: `${out}52-friend-comment.png` });
await friend.getByRole("button", { name: "Send" }).click();
await friend.getByText("This one! So elegant").waitFor();
const dup = await friend.request.post(`${BASE}/api/c/${owner.token}/vote`, { data: { optionId: owner.options[0].id } });
assert((await dup.json()).total === 1, "a second vote from the same device is not counted twice");
await friend.screenshot({ path: `${out}53-friend-comment-posted.png`, fullPage: true });

// ── Owner sees it live (no reload) ────────────────────────────────────────────
const t0 = Date.now();
await page.getByText("This one! So elegant").waitFor({ timeout: 10000 });
console.log(`⏱  live update reached the owner in ≤ ${Date.now() - t0} ms`);
await page.getByText(/your circle picked/i).waitFor();
await page.waitForTimeout(800);
await shot("owner-live-update");

// Hold to buy the winner
await page.locator("section", { hasText: /your circle picked/i }).getByRole("button", { name: /buy/i }).click();
await page.getByRole("button", { name: /hold to buy/i }).waitFor();
await page.getByRole("button", { name: /pickup in/i }).click();
await shot("winner-hold-sheet");
const hold = page.getByRole("button", { name: /hold to buy/i });
const box = await hold.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(1500);
await page.mouse.up();
await page.waitForURL(/\/orders\/.+fresh=1/, { timeout: 15000 }).catch(async (e) => {
  const why = await page.locator('[role="alert"], [role="status"][data-limit]').allInnerTexts().catch(() => []);
  await shot("winner-hold-failed");
  throw new Error(`hold to buy did not reach the order page: ${why.join(" | ") || e.message}`);
});
const orderId = new URL(page.url()).pathname.split("/").pop();
await shot("winner-order");

// ── Maker fulfils (host acting on the page), so the piece lands in the wardrobe ─
const hostCtx = await browser.newContext({ ...context._options });
const host = await hostCtx.newPage();
await signIn(host, "0788900001");
for (let i = 0; i < 30; i++) {
  const o = await (await page.request.get(`${BASE}/api/orders/${orderId}`)).json();
  if (o.status === "PAID") break;
  await page.waitForTimeout(1000);
}
for (const to of ["ACCEPTED", "IN_PREPARATION", "READY", "DELIVERED"]) {
  const r = await host.request.post(`${BASE}/api/orders/${orderId}/transition`, { data: { to } });
  assert(r.ok(), `order → ${to}`);
}

// Makers never see polls
const makerCtx = await browser.newContext({ ...context._options });
const maker = await makerCtx.newPage();
await signIn(maker, "0788100003");
assert((await maker.request.get(`${BASE}/api/circle/polls/${pollId}`)).status() === 404, "a maker cannot open the owner's poll");
await makerCtx.close();

// ── Wardrobe ─────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/wardrobe`);
await page.getByRole("link", { name: /owned/i }).first().waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
await shot("wardrobe");
await page.getByRole("link", { name: /owned/i }).first().click();
await page.waitForURL(/\/wardrobe\/item\//);
await page.getByRole("heading", { name: /styled by the muse/i }).waitFor();
await shot("wardrobe-item");
// The pilot micro-survey (E26) pops up after the paid order and would cover the restyle sheet: answer it
// "not now" through the API first (the pilot crawl covers the survey UI).
for (const trigger of ["ORDER_PAID", "LOOKS_5"]) await page.request.post(`${BASE}/api/survey`, { data: { trigger, helped: null, nps: null, dismissed: true } });
await page.reload();
await page.getByRole("heading", { name: /styled by the muse/i }).waitFor();
await page.getByRole("button", { name: /restyle for an event/i }).click();
await page.getByRole("dialog").getByRole("button", { name: "Office", exact: true }).click();
await page.getByRole("dialog").getByPlaceholder(/e\.g\./).fill("Board presentation");
await page.getByRole("dialog").getByRole("button", { name: "In 3 days" }).click();
await page.getByRole("dialog").getByRole("button", { name: /≤ RWF 40,000/ }).click();
await shot("restyle-sheet");
await page.getByRole("button", { name: /style 3 outfits/i }).click();
await page.waitForURL(/\/wardrobe\/events\//, { timeout: 20000 });
await shot("restyle-rendering");
await page.getByText(/whatsapp reminder sent/i).waitFor({ timeout: 45000 });
await page.waitForTimeout(800);
await shot("restyle-outfits");
await page.getByLabel("Outfits").evaluate((el) => el.scrollTo({ left: el.scrollWidth / 3 }));
await page.waitForTimeout(700);
await shot("restyle-outfit-2");

const notes = await (await host.request.get(`${BASE}/api/admin/notifications`)).json();
const reminder = notes.find((n) => n.template === "wardrobe_event_reminder" && n.to.endsWith(phone.slice(1)));
assert(reminder, `reminder in the WhatsApp outbox: “${reminder?.body}”`);

// Ambient card on the Muse + menu entry
await page.goto(BASE);
await page.getByText(/your outfit is ready/i).waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
await shot("muse-ambient-card");
await page.getByRole("button", { name: "Menu" }).click();
await page.getByRole("dialog").getByRole("link", { name: /wardrobe/i }).waitFor();
await shot("menu-wardrobe");
await page.keyboard.press("Escape");

// ── Revocation: the friend's link dies immediately ────────────────────────────
await page.goto(`${BASE}/circle/${pollId}`);
await page.getByRole("button", { name: "Take down" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Take down" }).click();
await page.getByText(/shared copies are deleted/i).waitFor();
await shot("owner-revoked");
await friend.reload();
await friend.getByText("Taken down").waitFor();
await friend.screenshot({ path: `${out}90-friend-revoked.png` });
assert((await friend.request.get(`${BASE}/api/c/${owner.token}/img/${owner.options[0].id}`)).status() === 404, "shared image is gone after take-down");
await page.goto(`${BASE}/circle`);
await page.getByText(/closed/i).first().waitFor();
await shot("my-polls");

// Privacy export carries polls + wardrobe
const exp = await (await page.request.get(`${BASE}/api/privacy/export`)).json();
assert(exp.circlePolls?.length === 1 && exp.wardrobe?.events?.length === 1, "data export includes polls and wardrobe");

await friendCtx.close();
await hostCtx.close();
await finish();
