// E30 growth tools · E31 low-literacy coop flows · E21 full-network migration crawl (Pixel 7).
// Promo cards → discount code → shopper opts in + applies the code at hold-to-buy → broadcast in the outbox →
// coop admin turns on voice mode + asks for assisted-mode consent → coop maker approves and adds a piece in
// voice-and-icon mode → USSD simulator → admin helps the maker → 200-page network wave with dashboard + rollback.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");
const { browser, page, shot, finish, issues } = await start("growth");
const OUT = new URL("./crawl-output/growth/", import.meta.url).pathname;
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const api = async (p, path, data) => (data ? await p.request.post(`${BASE}/api${path}`, { data }) : await p.request.get(`${BASE}/api${path}`)).json();
let n = 50;
async function ctx(label) {
  const c = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
  const p = await c.newPage();
  p.on("console", (m) => m.type() === "error" && !/speechSynthesis|getUserMedia|NotAllowedError|Permission/i.test(m.text()) && issues.push(`${label} console: ${m.text()}`));
  p.on("pageerror", (e) => issues.push(`${label} pageerror: ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && issues.push(`${label} HTTP ${r.status()} ${r.url()}`));
  p.on("dialog", (d) => d.accept());
  const snap = async (name, full = false) => {
    n += 1;
    await p.screenshot({ path: `${OUT}${n}-${label}-${name}.png`, fullPage: full });
    console.log(`📸 ${label}/${name}`);
  };
  return { c, p, snap };
}
// Secondary sections (Settings, Grow) sit in the More sheet on phones.
const nav = async (p, name) => {
  const link = p.getByRole("navigation", { name: "Studio" }).last().getByRole("link", { name, exact: true });
  if (await link.count()) return link.click();
  await p.getByRole("button", { name: "More" }).click();
  await p.getByRole("dialog").getByRole("link", { name: new RegExp(`^${name}`) }).click();
};

// ── E30: tailor share kit + offer ─────────────────────────────────────────────
const T = await ctx("tailor");
await signIn(T.p, "0788100001");
const uwase = await api(T.p, "/pages/by-handle/umurage-wear");
await T.p.goto(`${BASE}/studio/${uwase.id}`);
await T.p.getByRole("heading", { name: "Grow your page" }).waitFor({ timeout: 20000 });
await T.p.getByText(/suggestion/i).first().waitFor({ timeout: 15000 });
await T.snap("home-insights", true);
await nav(T.p, "Grow");
await T.p.getByRole("button", { name: /make my card/i }).waitFor();
await T.p.getByRole("button", { name: /make my card/i }).click();
await T.p.locator('img[alt^="Promo card"]').waitFor({ timeout: 30000 });
await T.p.waitForTimeout(400);
await T.snap("story-card-rw", true);
const card = await T.p.locator('img[alt^="Promo card"]').getAttribute("src");
const png = await T.p.request.get(`${BASE}${card}`);
assert(png.ok() && png.headers()["content-type"]?.includes("png"), `promo card served as PNG (${card})`);
await T.p.getByRole("button", { name: "Square 1:1" }).click();
await T.p.getByRole("button", { name: "English" }).click();
await T.p.getByRole("button", { name: /make my card/i }).click();
await T.p.locator('img[alt^="Promo card"]').waitFor({ timeout: 30000 });
await T.p.waitForTimeout(400);
await T.snap("square-card-en", true);

const code = `CRAWL${String(Date.now()).slice(-4)}`;
await T.p.getByRole("button", { name: "Offers" }).click();
await T.p.getByRole("button", { name: /new offer/i }).click();
await T.p.getByRole("textbox", { name: /^Code/ }).fill(code);
await T.p.getByLabel("Percent off").fill("15");
await T.snap("offer-sheet");
await T.p.getByRole("button", { name: /start offer/i }).click();
await T.p.getByText(`Code ${code} is live.`).waitFor();
await T.snap("offers-list", true);

// ── Shopper: tagged visit, opt in, apply the code at hold-to-buy ──────────────
const shopperPhone = `0789${String(Date.now()).slice(-6)}`;
const S = await ctx("shopper");
await signIn(S.p, shopperPhone);
await api(S.p, "/twin/persona", { persona: 2, consent: true });
await S.p.goto(`${BASE}/m/umurage-wear?src=wa_status&utm_source=whatsapp`);
await S.p.getByRole("switch", { name: /whatsapp updates/i }).click();
await S.p.getByText(/you'll hear when they post/i).waitFor();
await S.snap("maker-space-optin", true);
const product = uwase.products.find((p) => p.readiness === "READY" && (p.madeToOrder || p.variants.some((v) => v.inStock)));
const variant = product.variants.find((v) => product.madeToOrder || v.inStock);
await S.p.goto(`${BASE}/looks/try?variant=${variant.id}`);
await S.p.getByRole("button", { name: /buy/i }).first().waitFor({ timeout: 30000 });
await S.p.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 30000 });
await S.p.getByRole("button", { name: /buy/i }).first().click();
await S.p.getByText(/have a code from the maker/i).click();
await S.p.getByLabel("Discount code").fill(code);
await S.p.getByRole("button", { name: "Apply" }).click();
await S.p.getByText(new RegExp(`Code ${code}`)).waitFor();
await S.p.getByRole("button", { name: /pickup in/i }).click();
await S.snap("buy-sheet-code");
const hold = S.p.getByRole("button", { name: /hold to buy/i });
const box = await hold.boundingBox();
await S.p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await S.p.mouse.down();
await S.p.waitForTimeout(1500);
await S.p.mouse.up();
await S.p.waitForURL(/\/orders\/.+fresh=1/, { timeout: 15000 });
const orders = await api(S.p, "/orders/mine");
const expected = Math.round(product.priceRwf * 0.85) + (orders[0].deliveryMode === "DELIVERY" ? 2000 : 0);
assert(orders[0].totalRwf === expected, `discount applied at hold-to-buy: ${orders[0].totalRwf} = ${expected}`);
assert(orders[0].events[0].note.includes(code), "order timeline names the maker-funded code");
await S.snap("order-discounted");

// ── Tailor: broadcast to opted-in followers → outbox ──────────────────────────
await T.p.getByRole("button", { name: "Updates" }).click();
await T.p.getByText(/want whatsapp updates/i).waitFor();
const sendBtn = T.p.getByRole("button", { name: /send to \d+ on whatsapp/i });
let broadcastSent = false;
if (await sendBtn.isEnabled().catch(() => false)) {
  broadcastSent = true;
  await sendBtn.click();
  await T.p.getByText(/sent to \d+ follower/i).waitFor();
} else console.log("ℹ broadcast already sent today (rate limit) — showing the blocked state");
await T.snap("broadcast-sent", true);
await T.p.getByRole("button", { name: "Insights" }).click();
await T.p.getByText(/where visitors come from/i).waitFor();
await T.p.waitForTimeout(500);
await T.snap("insights", true);

const H = await ctx("host");
await signIn(H.p, "0788900001");
await H.p.goto(`${BASE}/admin?tab=Outbox`);
// When today's broadcast was already sent (re-runs on one DB), newer messages may have pushed it off the outbox page.
if (broadcastSent) await H.p.getByText(/broadcast_new_collection/).first().waitFor({ timeout: 15000 });
else await H.p.getByRole("heading", { name: "Outbox" }).waitFor();
await H.snap("outbox-broadcast");
const shopperE164 = `+250${shopperPhone.slice(1)}`;
const outbox = await api(H.p, "/admin/notifications");
if (broadcastSent) assert(Array.isArray(outbox) && outbox.some((m) => m.template === "broadcast_new_collection" && m.to === shopperE164), "broadcast reached the opted-in shopper through the WhatsApp outbox");

// ── E31: coop admin turns on voice mode + SMS, asks for assisted-mode consent ─
const A = await ctx("coopadmin");
await signIn(A.p, "0788100002");
const coop = await api(A.p, "/pages/by-handle/urudodo-collective");
await A.p.goto(`${BASE}/studio/${coop.id}/makers`);
const jeanne = A.p.locator("li", { hasText: "Mukamana Jeanne" }).first();
await jeanne.getByText(/voice & icon mode/i).waitFor({ timeout: 15000 });
const voice = jeanne.getByRole("switch", { name: /voice & icon mode/i });
if (!(await voice.isChecked())) await voice.click();
const smsSw = jeanne.getByRole("switch", { name: /sms & ussd/i });
if (!(await smsSw.isChecked())) await smsSw.click();
await A.p.waitForTimeout(600);
const stop = jeanne.getByRole("button", { name: /stop assisted mode/i });
if (await stop.isVisible().catch(() => false)) {
  await stop.click();
  await A.p.waitForTimeout(600);
}
await jeanne.scrollIntoViewIfNeeded();
await A.snap("makers-access");
await jeanne.getByRole("button", { name: /assisted mode/i }).click();
const sendCode = A.p.getByRole("button", { name: /send mukamana the code/i });
if (await sendCode.isVisible({ timeout: 3000 }).catch(() => false)) await sendCode.click();
else await A.p.getByRole("button", { name: /send a new code/i }).click();
await A.p.getByText(/Nemereye|I allow/).waitFor();
await A.snap("consent-sheet");

// ── Coop maker: voice-and-icon mode, approves help, adds a piece camera-first ─
const M = await ctx("maker");
await signIn(M.p, "0788100004");
await M.p.goto(`${BASE}/studio/${coop.id}`);
await M.p.waitForURL(/\/easy/, { timeout: 20000 });
await M.p.getByRole("button", { name: /yego/i }).waitFor({ timeout: 15000 });
await M.snap("easy-home-consent");
await M.p.getByRole("button", { name: /yego/i }).click();
await M.p.getByRole("button", { name: "Ongeraho umwenda" }).waitFor();
await M.p.waitForTimeout(500);
await M.snap("easy-home");
await M.p.getByRole("button", { name: "Ongeraho umwenda" }).click();
await M.p.waitForTimeout(800);
await M.snap("capture-guide");
const photo = new URL("../apps/api/storage/seed/umushanana-royal-purple-diamonds.png", import.meta.url).pathname;
const seedPhoto = existsSync(photo) ? photo : new URL("../apps/api/storage/seed/a-line-dress-gold-waves.png", import.meta.url).pathname;
await M.p.locator('input[type="file"]').first().setInputFiles(seedPhoto);
await M.p.getByRole("button", { name: /ni byiza/i }).waitFor();
await M.snap("capture-preview");
await M.p.getByRole("button", { name: /ni byiza/i }).click();
await M.p.getByRole("button", { name: "Umushanana" }).waitFor();
await M.snap("pick-type");
await M.p.getByRole("button", { name: "Umushanana" }).click();
await M.p.getByRole("button", { name: "Ubururu" }).waitFor();
await M.snap("pick-colour");
await M.p.getByRole("button", { name: "Ubururu" }).click();
await M.p.getByRole("button", { name: "Delete" }).waitFor();
for (const k of ["2", "8", "000"]) await M.p.getByRole("button", { name: k, exact: true }).click();
await M.snap("number-pad");
await M.p.getByRole("button", { name: /ni byiza/i }).click();
await M.p.getByRole("button", { name: /ohereza/i }).waitFor();
await M.snap("review");
await M.p.getByRole("button", { name: /ohereza/i }).click();
await M.p.getByText(/byoherejwe|ntisobanutse/i).first().waitFor({ timeout: 30000 });
await M.snap("sent");
const mine = await api(M.p, `/pages/${coop.id}/products`);
const added = mine.find((p) => p.title === "Indigo umushanana" && p.status === "PENDING_APPROVAL");
assert(added && added.makers.some((m) => m.name === "Mukamana Jeanne"), "voice-mode piece submitted for approval, credited to the maker");
await M.p.getByRole("button", { name: /✓|ni byiza/i }).first().click();
await M.p.getByRole("button", { name: "Amafaranga yanjye" }).click();
await M.p.getByText(/koperative izakwishyura/i).waitFor();
await M.snap("money");

// ── USSD simulator (feature phone) ────────────────────────────────────────────
const U = await ctx("ussd");
await U.p.goto(`${BASE}/dev/ussd`);
await U.p.getByLabel("Phone number of the SIM").fill("0788100004");
await U.p.getByRole("button", { name: "Call", exact: true }).click();
await U.p.getByText(/1\. Ibyo nagurishije/).waitFor();
await U.snap("menu");
await U.p.getByRole("textbox", { name: "Reply" }).fill("1");
await U.p.getByRole("button", { name: "Send reply" }).click();
await U.p.getByText(/uku kwezi/i).first().waitFor();
await U.snap("sales");
await U.p.getByRole("button", { name: "Call", exact: true }).click();
await U.p.getByText(/1\. Ibyo nagurishije/).waitFor();
await U.p.getByRole("textbox", { name: "Reply" }).fill("3");
await U.p.getByRole("button", { name: "Send reply" }).click();
await U.p.waitForTimeout(500);
const approvable = await U.p.getByText(/^1\. NY-/m).count().catch(() => 0);
if (await U.p.getByText(/NY-/).first().isVisible().catch(() => false)) {
  await U.p.getByRole("textbox", { name: "Reply" }).fill("1");
  await U.p.getByRole("button", { name: "Send reply" }).click();
  await U.p.getByText(/yemeze/i).first().waitFor();
  await U.snap("order-detail");
  await U.p.getByRole("textbox", { name: "Reply" }).fill("1");
  await U.p.getByRole("button", { name: "Send reply" }).click();
  await U.p.getByText(/wemeje/i).first().waitFor();
} else console.log(`ℹ no paid order waiting for this maker (${approvable})`);
await U.p.waitForTimeout(3500); // SMS inbox polls every 3 s
await U.snap("approved-sms", true);

// ── Admin helps the maker (consent recorded via the maker's tap) ──────────────
await A.p.reload();
const jeanne2 = A.p.locator("li", { hasText: "Mukamana Jeanne" }).first();
await jeanne2.getByRole("link", { name: /help mukamana/i }).click();
await A.p.getByText(/helping mukamana jeanne with their consent/i).waitFor();
await A.snap("assist-banner");
await A.p.goto(`${BASE}/studio/${coop.id}/makers`);
await A.p.locator("li", { hasText: "Mukamana Jeanne" }).first().getByRole("button", { name: /statement/i }).click();
await A.p.getByRole("button", { name: /read it aloud/i }).waitFor();
await A.snap("statement");

// ── E21: 200-page synthetic network wave with dashboard + rollback ────────────
const bundle = new URL("./crawl-output/network.json", import.meta.url).pathname;
execFileSync(`${process.env.MAIN_REPO ?? "/Users/m2pro/dev/projects/nyambika-vision-app"}/apps/ai/.venv/bin/python`, [new URL("./migration/make-network.py", import.meta.url).pathname, bundle, "200", OUT], { stdio: "inherit" });
await H.p.goto(`${BASE}/admin/network`);
await H.p.getByRole("combobox").first().selectOption("6");
await H.p.locator('input[type=file][accept*="json"]').setInputFiles(bundle);
await H.p.getByText(/wave queued: 203 pages/i).waitFor({ timeout: 60000 });
await H.p.waitForTimeout(1500);
await H.snap("wave-running", true);
await H.p.waitForFunction(() => /203 \/ 203 processed/.test(document.body.innerText), null, { timeout: 300000 });
await H.p.waitForTimeout(1500);
await H.snap("wave-imported", true);
const runs = await api(H.p, "/admin/migration/network");
const waveId = runs[0].waveId;
let dash = await api(H.p, `/admin/migration/network/${waveId}`);
assert(dash.run.done === 200 && dash.run.failed === 3, `200 pages imported, 3 deliberate failures (${dash.run.done}/${dash.run.failed})`);
assert(dash.run.maxRunning <= 6 && dash.run.maxRunning >= 1, `queue respected the window of 6 (peak ${dash.run.maxRunning})`);

await H.p.getByRole("button", { name: /send review links/i }).click();
await H.p.getByText(/review links sent: 200/i).waitFor({ timeout: 60000 });
// Two owners sign off from their review links.
const waves = await api(H.p, "/admin/migration/waves");
const items = waves.find((w) => w.id === waveId).items.slice(0, 2);
for (const it of items) {
  const owner = await ctx("owner");
  const ownerPhone = `0${(await api(H.p, `/pages/${it.page.id}`)).roles.find((r) => r.role === "PAGE_OWNER" || r.role === "COOP_ADMIN").user.phone.slice(4)}`;
  await signIn(owner.p, ownerPhone);
  await owner.p.goto(it.reviewUrl.replace(/^https?:\/\/[^/]+/, BASE));
  await owner.p.getByRole("button", { name: /looks right, sign off/i }).click();
  await owner.p.getByText(/thank you/i).first().waitFor();
  await owner.c.close();
}
await H.p.getByRole("button", { name: /rehearse cadence/i }).click();
await H.p.getByText(/rehearsal reminders: 198/i).waitFor({ timeout: 60000 });
await H.p.getByRole("button", { name: /go live: all signed off \(2\)/i }).click();
await H.p.getByText(/went live: 2/i).waitFor({ timeout: 30000 });
const legacy = new URL(items[0].legacyUrl).pathname;
for (let i = 0; i < 3; i++) {
  const r = await H.p.request.get(`${BASE}${legacy}`, { maxRedirects: 0 });
  if (i === 0) assert([301, 308].includes(r.status()), `legacy ${legacy} redirects (${r.status()})`);
}
const csv = await H.p.request.get(`${BASE}/api/admin/migration/network/${waveId}/redirects?format=nginx`);
assert((await csv.text()).includes("map $uri $nyambika_new"), "nginx redirect map exported");
await H.p.reload();
await H.p.getByText(/cut-over checklist/i).waitFor();
await H.p.waitForTimeout(1200);
await H.snap("dashboard-live", true);
dash = await api(H.p, `/admin/migration/network/${waveId}`);
assert(dash.funnel.live === 2 && dash.redirects.hits >= 3 && dash.outreach.reminders >= 198, `dashboard: live ${dash.funnel.live}, redirect hits ${dash.redirects.hits}, reminders ${dash.outreach.reminders}`);

await H.p.getByRole("button", { name: /roll back whole wave/i }).click();
await H.p.getByText(/rolled back: 200/i).waitFor({ timeout: 60000 });
const after = await H.p.request.get(`${BASE}${legacy}`, { maxRedirects: 0 });
assert(after.status() === 404 || after.status() === 200, `after rollback-all the legacy URL is no longer redirected (${after.status()})`);
await H.p.waitForTimeout(800);
await H.snap("rolled-back", true);

await shot("done");
await finish();
