// R4 spike crawl (Pixel 7): maker training-data opt-in (page + per product, withdrawal), consented dataset
// versions, local attribute model eval + gated activation, ✨ auto-fill suggestion in the product editor with
// `ml.local_attr_spike` on, and the k-anonymous Trends card with `insights.trends_spike` on.
// Needs the API on 410N, the web on 310N and this branch's AI gateway (route `attr`, /v1/ml/*).
import { API_BASE, BASE, signIn, start } from "./crawl-lib.mjs";

const API_URL = API_BASE;

const OUT = new URL("./crawl-output/mlspike/", import.meta.url).pathname;
const { browser, page: maker, shot, finish, issues } = await start("mlspike");
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};

// Host session in its own context (API calls only).
const hostCtx = await browser.newContext();
const host = await hostCtx.newPage();
await signIn(host, "0788900001");
const api = async (method, path, data) => {
  // Long admin jobs (dataset build, train + eval) go straight to the API: the Next dev proxy drops requests after ~30 s.
  const r = await host.request.fetch(`${API_URL}${path}`, { method, data, timeout: 600_000 });
  const body = await r.json().catch(() => ({}));
  if (r.status() >= 400) console.log(`  ${method} ${path} → ${r.status()} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};
const flag = (key, enabled) => api("PATCH", `/admin/flags/${key}`, { enabled });

// Both spike flags are off by default: nothing new shows to members.
await flag("ml.local_attr_spike", false);
await flag("insights.trends_spike", false);

await signIn(maker, "0788100001"); // Uwase Couture (tailor, page owner)
const pages = await (await maker.request.get(`${BASE}/api/pages/mine/list`)).json();
const P = pages[0].id;
const PRODUCT = "cmwbblzvu00198o8dfz9ppkuk"; // Imigongo a-line dress (one colour is named "Teal")

await maker.goto(`${BASE}/studio/${P}`);
await maker.getByRole("heading", { name: /Today at/ }).waitFor();
await maker.waitForTimeout(1500);
assert((await maker.getByRole("heading", { name: /What shoppers want right now/ }).count()) === 0, "flag off: no Trends card on the studio home");

// ── Maker: opt in from Settings ──────────────────────────────────────────────
await maker.goto(`${BASE}/studio/${P}/settings`);
const link = maker.getByRole("link", { name: /Help train Nyambika/ });
await link.scrollIntoViewIfNeeded();
await maker.waitForTimeout(400);
await shot("settings-training-link");
await link.click();
await maker.waitForURL(/\/training$/);
const sw = maker.getByRole("switch", { name: /Share my garment photos/ });
await sw.waitFor();
if (await sw.isChecked()) {
  // start from a clean "off" state (this records a withdrawal + tombstone, as a real maker would)
  await sw.click(); // controlled switch: state flips after the API answers
  await maker.getByText(/Stopped\. Your photos will be removed/).waitFor();
}
await maker.waitForTimeout(300);
await shot("training-off-by-default");
await sw.click();
await maker.getByText(/Thank you! Your garment photos can now help/).waitFor();
await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
await maker.waitForTimeout(300);
await shot("training-opted-in");
// Per-piece toggles (seed titles repeat, so act on the first tile). `share` first makes reruns start from "shared".
const piece = async (title, want) => {
  await maker.getByRole("heading", { name: "Choose pieces" }).waitFor();
  const share = maker.getByRole("button", { name: `Share: ${title}`, exact: true }).first();
  const keep = maker.getByRole("button", { name: `Keep private: ${title}`, exact: true }).first();
  if (want === "private" && (await keep.count()) === 0) {
    await share.click();
    await maker.getByText(`${title} is shared.`).waitFor();
  }
  const btn = want === "private" ? keep : share;
  if ((await btn.count()) === 0) return;
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await maker.getByText(want === "private" ? `${title} is private again.` : `${title} is shared.`).waitFor();
};
await piece("Imigongo a-line dress", "shared");
await piece("Teal Ikiyaga wrap", "private");
await maker.waitForTimeout(300);
await shot("training-one-piece-private");

// ── Host: dataset versions, withdrawal, eval, gated activation ───────────────
const v1 = await api("POST", "/admin/mlspike/dataset", { perCell: 16 });
assert(v1.items > 900 && v1.stats?.by_source?.catalogue > 0, `dataset v${v1.version}: ${v1.items} items (${v1.stats?.by_source?.catalogue} consented catalogue photos), ${v1.dropped} dropped`);
assert((v1.stats?.dropped?.["person detected (PII screen)"] ?? 0) > 0, "PII screen dropped synthetic images that show a person");
// The maker keeps a second piece private → the next version loses it (tombstone).
// Withdrawn pixels never come back, so on reruns pick a piece that is in v1 now (unique title, not the demo piece).
const st = await (await maker.request.get(`${BASE}/api/pages/${P}/training-data`)).json();
const titles = st.products.map((p) => p.title);
const victim = st.products.find((p) => p.inDataset && p.id !== PRODUCT && titles.filter((t) => t === p.title).length === 1);
assert(victim, `a shared piece in dataset v${v1.version} to withdraw (${victim?.title})`);
await maker.reload();
if (victim) await piece(victim.title, "private");
const v2 = await api("POST", "/admin/mlspike/dataset", { perCell: 16 });
assert(v2.diff?.removedByWithdrawal >= 1 && v2.hash !== v1.hash, `dataset v${v2.version}: ${v2.diff?.removedByWithdrawal} item(s) removed by withdrawal, new hash`);
await maker.reload();
await maker.getByText(/withdrawal.* on record/).waitFor();
await maker.getByText(/withdrawal.* on record/).scrollIntoViewIfNeeded();
await shot("training-dataset-and-tombstones");

const ev = await api("POST", "/admin/mlspike/train-eval");
assert(ev.passed === true && ev.heads?.colour, `eval ${ev.modelId}: passed=${ev.passed}, failing: ${(ev.failing ?? []).length}`);
console.log(`  heads: ${Object.entries(ev.heads ?? {}).map(([h, r]) => `${h} acc ${r.accuracy} F1 ${r.macro_f1} ECE ${r.ece}`).join(" · ")}`);
const act = await api("POST", `/admin/mlspike/models/${ev.modelId}/activate`);
assert(act.status === "ACTIVE", "attribute model activated through the registry gate");
await flag("ml.local_attr_spike", true);

// ── Maker: ✨ suggestion in the product editor ─────────────────────────────────
// Simulate a slip: the photographed colour is typed as "Crimson" (the suggester reads the first photo by id).
const prod = await (await maker.request.get(`${BASE}/api/products/${PRODUCT}`)).json();
const firstPhoto = prod.variants.filter((v) => v.image).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
const realName = firstPhoto.colourName === "Crimson" ? "Forest green" : firstPhoto.colourName;
await maker.request.patch(`${BASE}/api/variants/${firstPhoto.id}`, { data: { colourName: "Crimson" } });
await maker.goto(`${BASE}/studio/${P}/products/${PRODUCT}`);
const card = maker.locator("section", { has: maker.getByRole("heading", { name: /Suggested from your photo/ }) });
await card.waitFor({ timeout: 20000 });
await card.scrollIntoViewIfNeeded();
await maker.waitForTimeout(500);
await shot("attr-suggestion");
await card.screenshot({ path: `${OUT}06b-attr-card.png` });
const use = card.getByRole("button", { name: /^(Use|Add tag)$/ }).first();
assert(await use.count(), "a mistyped colour gets a one-tap fix");
if (await use.count()) {
  await use.click();
  await card.getByText(/Added|Matches/).first().waitFor();
  await maker.waitForTimeout(400);
  await shot("attr-suggestion-applied");
  const after = await (await maker.request.get(`${BASE}/api/products/${PRODUCT}`)).json();
  assert(after.variants.find((v) => v.id === firstPhoto.id)?.colourName === realName, `colour name restored to "${realName}" only after the maker tapped Use`);
}
assert(await card.getByText(/off until fairness checks pass/).count(), "blocked heads are explained to the maker");

// ── Trends: seed synthetic signals, privacy + stability eval, card ───────────
const seeded = await api("POST", "/admin/mlspike/trends/seed");
assert(seeded.rows > 5000, `seeded ${seeded.rows} synthetic trend signals`);
const tev = await api("POST", "/admin/mlspike/trends/eval");
assert(tev.passed === true && tev.summary?.violations?.length === 0, `trends eval: ${tev.summary?.cellsChecked} cells checked across ${tev.summary?.viewersAudited} viewers, 0 below k; bootstrap Jaccard ${tev.summary?.bootstrap?.risingTopJaccard}`);
await flag("insights.trends_spike", true);
await maker.goto(`${BASE}/studio/${P}`);
const trends = maker.locator("section", { has: maker.getByRole("heading", { name: /What shoppers want right now/ }) });
await trends.waitFor({ timeout: 30000 });
await trends.scrollIntoViewIfNeeded();
await maker.waitForTimeout(800);
await shot("trends-card");
await trends.screenshot({ path: `${OUT}09b-trends-card-full.png` });
assert(await trends.getByText(/Many asks, few makers/).count(), "demand vs supply gap shown");
assert((await trends.getByText(/lilac/i).count()) === 0, "rare colour asked by 6 shoppers is suppressed (k = 10)");
const fr = await maker.request.get(`${BASE}/api/pages/${P}/trends?locale=rw`);
const rw = await fr.json();
assert(rw.enabled && rw.rising.length > 0 && /mu byumweru/.test(rw.rising[0].text), "Kinyarwanda trend copy");

// ── Cooperative: the credited maker's own consent is needed too (hardening pass 1) ─
const coopCtx = await browser.newContext({ ...maker.context()._options });
const coopAdmin = await coopCtx.newPage();
await signIn(coopAdmin, "0788100002"); // Abahizi coop admin
const coopPages = await (await coopAdmin.request.get(`${BASE}/api/pages/mine/list`)).json();
const C = coopPages.find((p) => p.memberType === "COOPERATIVE")?.id ?? coopPages[0].id;
await coopAdmin.request.put(`${BASE}/api/pages/${C}/training-data`, { data: { optedIn: true, locale: "en" } });
await coopAdmin.goto(`${BASE}/studio/${C}/training`);
const waiting = coopAdmin.getByText(/^Waiting for /).first();
await waiting.waitFor({ timeout: 20000 });
await waiting.scrollIntoViewIfNeeded();
await coopAdmin.waitForTimeout(500);
await coopAdmin.screenshot({ path: `${OUT}20-coop-admin-waiting-for-maker.png` });
const before = (await (await coopAdmin.request.get(`${BASE}/api/pages/${C}/training-data`)).json()).products;
assert(before.some((p) => p.waitingForMaker && !p.included), "coop admin's yes alone: credited pieces wait for the maker");

const makerCtx = await browser.newContext({ ...maker.context()._options });
const coopMaker = await makerCtx.newPage();
for (const [p, label] of [[coopAdmin, "coop admin"], [coopMaker, "coop maker"]]) {
  p.on("console", (m) => m.type() === "error" && issues.push(`${label} console: ${m.text()}`));
  p.on("response", (r) => r.status() >= 500 && issues.push(`${label} HTTP ${r.status()} ${r.url()}`));
}
await signIn(coopMaker, "0788100004"); // Mukamana Jeanne, coop maker
await coopMaker.goto(`${BASE}/studio/${C}/products`);
await coopMaker.getByRole("link", { name: /your photos for training/i }).click();
await coopMaker.waitForURL(/\/training$/);
await coopMaker.getByRole("heading", { name: /pieces credited to you/i }).waitFor({ timeout: 20000 });
await coopMaker.waitForTimeout(500);
await coopMaker.screenshot({ path: `${OUT}21-coop-maker-consent-off.png` });
const makerSwitch = coopMaker.getByRole("switch", { name: /share photos of pieces i made/i });
if (await makerSwitch.isChecked()) await makerSwitch.click({ force: true }); // start from "off" on reruns
await coopMaker.waitForTimeout(400);
await makerSwitch.click({ force: true });
await coopMaker.getByText(/thank you! pieces you made/i).waitFor();
await coopMaker.waitForTimeout(400);
await coopMaker.screenshot({ path: `${OUT}22-coop-maker-consent-on.png` });
const after = (await (await coopAdmin.request.get(`${BASE}/api/pages/${C}/training-data`)).json()).products;
const mine = (await (await coopMaker.request.get(`${BASE}/api/pages/${C}/training-data/maker`)).json()).pieces;
assert(mine.length > 0 && mine.every((p) => after.find((a) => a.id === p.id)?.included === p.coopShares), "maker's yes + admin's yes → her pieces are shared");
await makerSwitch.click({ force: true });
await coopMaker.getByText(/stopped\. pieces you made/i).waitFor();
const outNow = (await (await coopAdmin.request.get(`${BASE}/api/pages/${C}/training-data`)).json()).products;
assert(mine.every((p) => outNow.find((a) => a.id === p.id)?.included === false), "maker withdraws → her pieces leave the dataset");
assert((await coopAdmin.request.get(`${BASE}/api/pages/${C}/training-data/maker`)).status() === 403, "the coop admin cannot decide for the maker");
await coopAdmin.request.put(`${BASE}/api/pages/${C}/training-data`, { data: { optedIn: false, locale: "en" } });
await coopCtx.close();
await makerCtx.close();

// Leave the spike flags off (default) for whoever runs next.
await flag("ml.local_attr_spike", false);
await flag("insights.trends_spike", false);
await hostCtx.close();
await finish();
