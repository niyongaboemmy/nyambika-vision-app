// Phase 2 pilot crawl (Pixel 7). Requires `pnpm --filter @nyambika/api db:seed:pilot` first.
// Host: /admin → Pilot tab → dashboard (KPIs, funnel, experiments, hypercare) → invite codes → Gate 3 export.
// Shopper: /join/<code> → sign in → joined → Muse → 5 looks → "helped me decide" survey → hold to buy → paid →
// order survey (dismissed). Allowlist: a non-member is stopped at the Muse with a join prompt.
import { writeFileSync } from "node:fs";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { browser, context, page: host, shot, finish, issues } = await start("pilot");
const out = new URL("./crawl-output/pilot/", import.meta.url).pathname;
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
// Expected 403 (allowlist) shows up as a console resource error; everything else counts.
const expected = (m) => /status of 403/.test(m);
const watch = (p, label) => {
  p.on("console", (m) => m.type() === "error" && !expected(m.text()) && issues.push(`${label} console: ${m.text()}`));
  p.on("pageerror", (e) => issues.push(`${label} pageerror: ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && issues.push(`${label} HTTP ${r.status()} ${r.url()}`));
};

// ── Host: pilot dashboard ─────────────────────────────────────────────────────
await signIn(host, "0788900001");
await host.goto(`${BASE}/admin`);
await host.getByRole("button", { name: "Pilot" }).first().click();
await host.waitForURL(/\/admin\/pilot/);
await host.getByRole("heading", { name: /Gate 3 recommendation/i }).waitFor({ timeout: 20000 }).catch(() => {});
await host.getByText(/Phase 2 KPIs/).waitFor({ timeout: 20000 });
const decision = await host.locator("#g3").innerText();
assert(["Scale", "Iterate", "Pivot"].includes(decision.trim()), `Gate 3 recommendation shown (${decision.trim()})`);
assert((await host.locator("li", { hasText: "Twin creation rate" }).count()) > 0, "twin creation rate KPI listed");
await host.waitForTimeout(500);
await shot("dashboard-top");
await host.getByRole("heading", { name: /Phase 2 KPIs/ }).scrollIntoViewIfNeeded();
await shot("kpis");
await host.getByRole("heading", { name: "Shopper funnel" }).scrollIntoViewIfNeeded();
await shot("funnel");
await host.getByRole("heading", { name: "Unit economics" }).scrollIntoViewIfNeeded();
await shot("economics");
const nudge = host.locator(".st-card", { hasText: "twin.nudge" });
await nudge.scrollIntoViewIfNeeded();
const zText = await nudge.innerText();
assert(/z = -?\d/.test(zText) && /p = /.test(zText), "twin nudge experiment shows a z-test");
await nudge.screenshot({ path: `${out}experiment-twin-nudge.png` });
console.log(`📸 experiment-twin-nudge → ${out}experiment-twin-nudge.png`);
await host.getByRole("heading", { name: /Experiments/ }).scrollIntoViewIfNeeded();
await shot("experiments");
await host.getByRole("heading", { name: /Hypercare/ }).scrollIntoViewIfNeeded();
await shot("hypercare");

// Invite codes for shoppers
await host.getByRole("heading", { name: /Cohort & invites/ }).scrollIntoViewIfNeeded();
await host.getByRole("button", { name: /5 codes/ }).click();
const codesBox = host.getByLabel("New invite codes");
await codesBox.waitFor();
const code = (await codesBox.innerText()).trim().split(/\s+/)[0];
assert(/^NYA-[0-9A-F]{6}$/.test(code), `invite code created (${code})`);
await shot("cohort-invites");

// Gate 3 export (Markdown + JSON)
const [md] = await Promise.all([host.waitForEvent("download"), host.getByRole("link", { name: /Gate 3 report/ }).click()]);
const mdPath = `${out}gate3-report.md`;
await md.saveAs(mdPath);
const [js] = await Promise.all([host.waitForEvent("download"), host.getByRole("link", { name: "JSON" }).click()]);
const jsPath = `${out}gate3-report.json`;
await js.saveAs(jsPath);
const mdText = (await (await host.request.get(`${BASE}/api/admin/pilot/gate3?format=md`)).text());
const json = await (await host.request.get(`${BASE}/api/admin/pilot/gate3?format=json`)).json();
assert(/## Recommendation: \*\*(Scale|Iterate|Pivot)\*\*/.test(mdText), "Gate 3 markdown has a recommendation");
assert(/Unit economics/.test(mdText) && /z = /.test(mdText), "Gate 3 markdown has economics and experiment tests");
assert(Array.isArray(json.kpis) && json.kpis.length >= 12 && json.economics?.pilot, "Gate 3 JSON has KPIs and economics");
const preview = await context.newPage();
await preview.setContent(`<body style="margin:0;background:#fbf7f2;color:#1d1814;font:13px/1.5 ui-monospace,monospace"><pre style="white-space:pre-wrap;padding:16px">${mdText.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body>`);
await preview.screenshot({ path: `${out}gate3-report-md.png`, fullPage: false });
console.log(`📸 gate3-report-md → ${out}gate3-report-md.png`);
await preview.close();

// ── Shopper: join via invite, Muse, looks, surveys ────────────────────────────
const shopCtx = await browser.newContext({ ...context._options });
const page = await shopCtx.newPage();
watch(page, "shopper");
await page.goto(`${BASE}/join/${code}`);
await page.getByRole("heading", { name: /join the pilot/i }).waitFor();
await page.screenshot({ path: `${out}join-signed-out.png` });
await page.getByRole("button", { name: /join the pilot/i }).click();
await page.waitForURL(/\/signin/);
assert((await page.getByLabel(/invite code/i).inputValue()) === code, "invite code carried into sign-in");
await page.screenshot({ path: `${out}signin-invite.png` });
const phone = `07887${String(Date.now()).slice(-5)}`;
await page.getByLabel(/phone/i).fill(phone);
await page.getByRole("button", { name: /send code|ohereza|envoyer/i }).click();
await page.locator("button.font-mono").click();
await page.getByRole("button", { name: /continue|komeza|continuer/i }).click();
await page.getByRole("heading", { name: /in the nyambika pilot/i }).waitFor({ timeout: 15000 });
await page.screenshot({ path: `${out}joined.png` });
assert(true, "shopper redeemed the invite");

await page.getByRole("button", { name: /ask the muse/i }).click();
await page.waitForURL(`${BASE}/`);
await page.locator("footer button[title]").click();
await page.getByRole("textbox").fill("A kitenge dress for a wedding");
await page.keyboard.press("Enter");
await page.waitForURL(/\/looks\//, { timeout: 25000 });
const stream = page.getByLabel("Looks stream");
await page.locator(`section[aria-label^="Look 1 of"]`).waitFor({ timeout: 30000 });
let seen = 0;
for (let i = 0; i < 6; i++) {
  const sec = page.locator(`section[aria-label^="Look ${i + 1} of"]`);
  if (!(await sec.count())) break;
  await stream.evaluate((el, n) => el.scrollTo({ top: el.clientHeight * n }), i);
  await sec.locator('img[alt*="AI preview"]').waitFor({ timeout: 30000 });
  seen++;
  await page.waitForTimeout(700);
  if (i === 2) await page.screenshot({ path: `${out}stream-look3.png` });
}
assert(seen >= 5, `viewed ${seen} looks`);
const dialog = page.getByRole("dialog");
await dialog.getByText(/help you decide/i).waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}survey-looks5.png` });
await dialog.getByRole("button", { name: /yes, it helped/i }).click();
await dialog.getByRole("button", { name: "9 / 10" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}survey-nps.png` });
await dialog.getByRole("button", { name: /^send$/i }).click();
await dialog.getByText(/murakoze/i).waitFor();
await page.screenshot({ path: `${out}survey-thanks.png` });
await dialog.waitFor({ state: "detached", timeout: 5000 });

// Hold to buy the current look (pickup) → paid → order survey
const current = page.locator(`section[aria-label^="Look ${seen} of"]`);
await current.getByRole("button", { name: /buy/i }).click();
await page.getByRole("button", { name: /hold to buy/i }).waitFor();
await page.getByRole("button", { name: /pickup in/i }).click();
const hold = page.getByRole("button", { name: /hold to buy/i });
const box = await hold.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(1500);
await page.mouse.up();
await page.waitForURL(/\/orders\/.+fresh=1/, { timeout: 15000 });
await page.getByRole("dialog").getByText(/help you decide/i).waitFor({ timeout: 40000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}survey-order-paid.png` });
await page.getByRole("dialog").getByRole("button", { name: /not now/i }).click();
await page.getByRole("dialog").waitFor({ state: "detached" });
const pending = await (await page.request.get(`${BASE}/api/survey/pending`)).json();
assert(pending.trigger === null, "both surveys answered or dismissed: nothing pending");

// Events were recorded for this shopper (server sees the funnel)
const after = await (await host.request.get(`${BASE}/api/admin/pilot`)).json();
const paidStep = after.funnel.steps.find((s) => s.name === "order_paid");
assert(paidStep.actors > 0, `funnel has paid shoppers (${paidStep.actors})`);

// ── Allowlist on: a non-member is stopped with a join prompt ──────────────────
await host.request.patch(`${BASE}/api/admin/flags/pilot.allowlist`, { data: { enabled: false } });
await host.goto(`${BASE}/admin/pilot`);
await host.getByText(/Closed pilot allowlist/).waitFor();
await host.getByRole("switch", { name: /closed pilot allowlist/i }).click({ force: true });
await host.getByText(/cohort shoppers only/).waitFor();
await host.waitForTimeout(800);
const outsider = await (await browser.newContext({ ...context._options })).newPage();
watch(outsider, "outsider");
await signIn(outsider, `07886${String(Date.now()).slice(-5)}`);
await outsider.goto(BASE);
await outsider.locator("footer button[title]").click();
await outsider.getByRole("textbox").fill("Office shirt");
await outsider.keyboard.press("Enter");
await outsider.getByText(/closed pilot/i).waitFor({ timeout: 15000 });
await outsider.screenshot({ path: `${out}allowlist-blocked.png` });
assert(true, "non-member blocked while pilot.allowlist is on");
await host.getByRole("switch", { name: /closed pilot allowlist/i }).click({ force: true });
await host.getByText(/everyone can ask/).waitFor();
await host.waitForTimeout(800);
const flags = await (await host.request.get(`${BASE}/api/admin/flags`)).json();
assert(flags.find((f) => f.key === "pilot.allowlist")?.enabled === false, "allowlist switched back off");

writeFileSync(`${out}summary.json`, JSON.stringify({ decision, code, kpis: after.kpis.map((k) => [k.key, k.display, k.rag]) }, null, 1));
await finish();
