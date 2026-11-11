// R4 spike crawl (Pixel 7, SwiftShader WebGL): mixed-reality fitting mirror + multi-user VR showroom.
// MR mirror: flag off → explainer; flag on with a mocked navigator.xr (immersive-ar + immersive-vr "supported",
// session start fails: no headset in CI) → inline stage preview, colour/size switch, enter-MR error path;
// no WebXR → inline fallback = the E34 AR mirror. Multi-user: host (maker) + two guests share
// /m/uwase-couture/showroom: presence count + avatars, spatial reaction + caption, report → moderation queue,
// host mute + remove (guest sees why), host starts the runway (guest gets the banner).
// Run: BASE_URL=http://localhost:3102 node scripts/crawl-mrvr.mjs   (needs psql access to nyambika_mrvr)
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { BASE, CRAWL_DB, signIn, start } from "./crawl-lib.mjs";

const DB = CRAWL_DB; // CRAWL_DB env, else the database in apps/api/.env
const sql = (q) => execSync(`psql -d ${DB} -tAc ${JSON.stringify(q)}`).toString().trim();
const setFlag = (key, on) => sql(`update "FeatureFlag" set enabled=${on} where key='${key}'`);
const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");
const GL = { args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] };
const { browser, context, page, shot, finish, issues } = await start("mrvr", GL);
const out = new URL("./crawl-output/mrvr/", import.meta.url).pathname;
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const phone = (n) => `0788${n}${String(Date.now()).slice(-5)}`;

/** Extra Pixel 7 contexts with the same console / 5xx checks as crawl-lib. */
const expected = new Set(); // "<context> <pattern>" console errors the flow provokes on purpose
async function ctx(name, init) {
  const c = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
  if (init) await c.addInitScript(init);
  const p = await c.newPage();
  p.on("console", (m) => m.type() === "error" && ![...expected].some((e) => e.startsWith(`${name} `) && m.text().includes(e.slice(name.length + 1))) && issues.push(`${name} console: ${m.text()}`));
  p.on("pageerror", (e) => issues.push(`${name} pageerror: ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && issues.push(`${name} HTTP ${r.status()} ${r.url()}`));
  let n = 0;
  const snap = async (label) => {
    n += 1;
    const file = `${out}${name}-${String(n).padStart(2, "0")}-${label}.png`;
    await p.screenshot({ path: file });
    console.log(`📸 ${name} ${label} → ${file}`);
  };
  return { c, p, snap };
}

const mockXr = () => {
  Object.defineProperty(navigator, "xr", {
    configurable: true,
    value: {
      isSessionSupported: async (mode) => mode === "immersive-ar" || mode === "immersive-vr",
      requestSession: async () => {
        throw new DOMException("No headset connected (mocked WebXR)", "NotSupportedError");
      },
      addEventListener() {},
      removeEventListener() {},
    },
  });
};
const noXr = () => Object.defineProperty(navigator, "xr", { configurable: true, value: undefined });

const prevFlags = Object.fromEntries(sql(`select key||'='||enabled from "FeatureFlag" where key in ('mr.mirror_spike','vr.multiuser_spike','ar.mirror_pilot')`).split("\n").map((l) => l.split("=")).map(([k, v]) => [k, v === "t"]));
try {
  // ── 1. MR mirror: flag off ────────────────────────────────────────────────────────────────────────────
  setFlag("mr.mirror_spike", false);
  await context.addInitScript(mockXr);
  await signIn(page, phone(7));
  await page.goto(`${BASE}/mirror/mr`);
  await page.getByText(/is an experiment/).waitFor();
  await shot("mr-flag-off");
  assert(await page.getByRole("link", { name: /Open the AR mirror/ }).isVisible(), "flag off → explainer with the AR mirror link");

  // ── 2. MR mirror: flag on, mocked immersive-ar ────────────────────────────────────────────────────────
  setFlag("mr.mirror_spike", true);
  setFlag("ar.mirror_pilot", true);
  await page.goto(`${BASE}/mirror/ar`);
  await page.getByRole("link", { name: /mixed-reality mirror/i }).waitFor();
  await shot("ar-mirror-entry-chip");
  await page.getByRole("link", { name: /mixed-reality mirror/i }).click();
  await page.waitForURL(/\/mirror\/mr/);
  await page.getByRole("button", { name: /Place the mirror in my room/ }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__mrMirror) && !document.body.innerText.includes("Bringing in the piece"), null, { timeout: 45000 });
  await page.waitForTimeout(1500);
  await shot("mr-preview-synthetic-body");
  assert(await page.getByText("Experimental", { exact: true }).first().isVisible(), "labelled experimental");
  assert(await page.getByText(/never receives camera images/).isVisible(), "privacy note: camera frames never reach the page");
  assert(await page.getByRole("button", { name: /Use a virtual room instead/ }).isVisible(), "VR fallback offered when immersive-vr is also supported");
  const swatches = page.locator('fieldset:has(legend:text-matches("Colour")) button');
  if ((await swatches.count()) > 1) {
    await swatches.nth(1).click();
    await page.waitForFunction(() => !document.body.innerText.includes("Bringing in the piece"), null, { timeout: 30000 });
  }
  const sizeBtns = page.locator('fieldset:has(legend:text-matches("Size")) button');
  await sizeBtns.last().click();
  assert((await sizeBtns.last().getAttribute("aria-pressed")) === "true", "size switch");
  await page.waitForTimeout(1200);
  await shot("mr-colour-size-switched");
  await page.getByRole("button", { name: /Place the mirror in my room/ }).click();
  await page.getByRole("alert").filter({ hasText: /No headset/ }).waitFor();
  await shot("mr-enter-no-headset-error");

  // ── 3. MR mirror: no WebXR → inline fallback = E34 AR mirror ──────────────────────────────────────────
  const fb = await ctx("fallback", noXr);
  await signIn(fb.p, phone(6));
  await fb.p.goto(`${BASE}/mirror/mr`);
  await fb.p.getByText(/can't do mixed reality/).waitFor({ timeout: 30000 });
  await fb.p.waitForTimeout(1500);
  await fb.snap("mr-inline-fallback");
  await fb.p.getByText(/can't do mixed reality/).scrollIntoViewIfNeeded();
  await fb.snap("mr-inline-fallback-ar-mirror");
  assert((await fb.p.getByRole("button", { name: /Place the mirror/ }).count()) === 0, "no MR button without WebXR");
  await fb.c.close();
  await page.goto("about:blank"); // free the MR preview's WebGL context before three showroom contexts start

  // ── 4. Multi-user showroom ────────────────────────────────────────────────────────────────────────────
  setFlag("vr.multiuser_spike", true);
  const reportsBefore = Number(sql(`select count(*) from "ModerationItem" where kind='VR_PRESENCE_REPORT'`));
  const host = await ctx("host", mockXr);
  const g1 = await ctx("guest1", mockXr);
  const g2 = await ctx("guest2", mockXr);
  await signIn(host.p, "0788100001");
  await signIn(g1.p, phone(5));
  await signIn(g2.p, phone(4));
  const enter = async (x) => {
    // Seeded accounts collect paid orders / viewed looks across crawls, so the pilot micro-survey sheet (E26) can
    // pop up over the showroom: answer it "not now" first (the pilot crawl covers the survey UI).
    for (const trigger of ["ORDER_PAID", "LOOKS_5"]) await x.p.request.post(`${BASE}/api/survey`, { data: { trigger, helped: null, nps: null, dismissed: true } });
    // SwiftShader WebGL on a busy machine can stall the first scene load: one reload before giving up.
    for (let attempt = 0; ; attempt++) {
      await x.p.goto(`${BASE}/m/uwase-couture/showroom`);
      try {
        await x.p.locator("canvas").waitFor({ timeout: 60000 });
        await x.p.waitForFunction(() => !document.body.innerText.includes("Bringing in pieces") && Boolean(window.__vrShowroom), null, { timeout: 90000 });
        break;
      } catch (e) {
        if (attempt >= 1) throw e;
        console.log("ℹ showroom scene slow to load, reloading once");
      }
    }
    await x.p.getByRole("button", { name: /Shared room/ }).click();
    await x.p.getByRole("checkbox", { name: /18 or older/ }).check();
    await x.p.getByRole("button", { name: "Join the shared room" }).click();
    await x.p.getByRole("button", { name: /Open the people list/ }).waitFor({ timeout: 20000 });
  };
  await enter(host);
  await host.snap("showroom-shared-room-joined");
  await enter(g1);
  await enter(g2);
  await g2.p.getByRole("button", { name: /people in this shared room/ }).click();
  const nick2 = ((await g2.p.getByText(/^You are /).textContent()) ?? "").replace(/^You are\s*/, "").replace(/[.(].*$/, "").trim();
  console.log(`guest2 is "${nick2}"`);
  await g2.p.keyboard.press("Escape");
  // Spread the guests out so the host sees them (everyone starts at the entrance, inside each other's bubble).
  // Host walks to the centre mannequin; the guests use "Go near" on the host (lands ~1.6 m in front of them).
  await host.p.evaluate(() => window.__vrShowroom.moveTo(0, 0.6, Math.PI));
  await host.p.waitForTimeout(2500);
  for (const g of [g1, g2]) {
    await g.p.getByRole("button", { name: /people in this shared room/ }).click();
    await g.p.getByRole("button", { name: /^Go near ★?/ }).first().click();
  }
  await host.p.waitForTimeout(3500);
  const seen = await host.p.evaluate(() => window.__presence?.visibleCount() ?? -1);
  assert(seen === 2, `host renders both guests as synthetic avatars (${seen})`);
  await host.p.getByRole("button", { name: /3 people in this shared room/ }).waitFor({ timeout: 15000 });
  assert(true, "presence: host sees 3 people");
  await host.snap("host-sees-two-avatars");
  await g1.snap("guest1-view");

  await g1.p.getByRole("button", { name: "React: Fire" }).click();
  await host.p.getByText(/reacted: Fire/).waitFor({ timeout: 8000 });
  await host.p.waitForTimeout(400);
  await host.snap("host-sees-spatial-reaction-caption");
  assert(true, "reaction reaches the host with a caption");

  // Guest 1 reports guest 2 → moderation queue.
  await g1.p.getByRole("button", { name: /people in this shared room/ }).click();
  await g1.snap("guest1-people-sheet");
  await g1.p.getByRole("button", { name: `Report ${nick2}` }).click();
  await g1.snap("guest1-report-reasons");
  await g1.p.getByRole("button", { name: "Harassment or following me" }).click();
  await g1.p.getByText(/A moderator will look at it/).waitFor({ timeout: 8000 });
  await g1.snap("guest1-report-sent");
  const reportsAfter = Number(sql(`select count(*) from "ModerationItem" where kind='VR_PRESENCE_REPORT'`));
  assert(reportsAfter === reportsBefore + 1, `report landed in the moderation queue (${reportsBefore} → ${reportsAfter})`);
  await g1.p.keyboard.press("Escape");

  // Host: mute guest 2, then remove guest 2, then start the runway.
  await host.p.getByRole("button", { name: /people in this shared room/ }).click();
  await host.p.waitForTimeout(500); // sheet rise animation
  await host.snap("host-people-sheet-controls");
  await host.p.getByRole("button", { name: `Mute ${nick2}` }).click();
  await host.p.getByRole("button", { name: `Unmute ${nick2}` }).waitFor();
  await g2.p.getByText(/The host paused your reactions/).waitFor({ timeout: 8000 });
  assert(await g2.p.getByRole("button", { name: "React: Fire" }).isDisabled(), "muted guest's reaction buttons are paused");
  await g2.snap("guest2-muted");
  await host.p.getByRole("button", { name: `Remove ${nick2}` }).click();
  await g2.p.getByText(/The host removed you/).waitFor({ timeout: 8000 });
  await g2.snap("guest2-removed-by-host");
  await host.p.getByRole("button", { name: /2 people in this shared room|In this room · 2/ }).first().waitFor({ timeout: 8000 }).catch(() => undefined);
  await host.snap("host-after-remove");
  // Rejoin is refused for a while (ban): the ticket request answers 403 on purpose.
  expected.add("guest2 status of 403");
  await g2.p.getByRole("button", { name: /Shared room/ }).click();
  await g2.p.getByRole("checkbox", { name: /18 or older/ }).check();
  await g2.p.getByRole("button", { name: "Join the shared room" }).click();
  await g2.p.getByRole("dialog").getByRole("alert").filter({ hasText: /removed you/ }).waitFor({ timeout: 8000 });
  assert(true, "kicked guest cannot rejoin straight away");
  await g2.snap("guest2-rejoin-refused");

  await host.p.getByRole("button", { name: /Start the runway/ }).click();
  await g1.p.getByText("The runway is starting").waitFor({ timeout: 8000 });
  await g1.snap("guest1-runway-banner");
  assert(await g1.p.getByRole("link", { name: "Watch" }).isVisible(), "runway banner links to the show");
  const audits = sql(`select string_agg(action, ',' order by "createdAt") from "AuditLog" where action like 'vr.presence_%' and "createdAt" > (now() at time zone 'utc') - interval '5 minutes'`);
  assert(/vr.presence_mute/.test(audits) && /vr.presence_kick/.test(audits) && /vr.presence_runway/.test(audits), `host actions audited (${audits})`);

  // Flag off → the shared-room entry disappears.
  setFlag("vr.multiuser_spike", false);
  for (const x of [host, g1, g2]) await x.c.close();
  const anon = await ctx("anon", mockXr);
  await anon.p.goto(`${BASE}/m/uwase-couture/showroom`);
  await anon.p.waitForFunction(() => Boolean(window.__vrShowroom), null, { timeout: 60000 });
  await anon.p.waitForTimeout(1500);
  assert((await anon.p.getByRole("button", { name: /Shared room/ }).count()) === 0, "flag off → no shared-room entry");
  await anon.c.close();
} finally {
  for (const [k, v] of Object.entries(prevFlags)) setFlag(k, v);
}
await finish();
