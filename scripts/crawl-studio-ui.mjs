// Visual crawl of the member Page Manager (/studio) and host admin (/admin, /migrate) at
// phone (390px) and desktop (1280px). Fails on console errors, 5xx and horizontal overflow at 360px.
// Usage: BASE_URL=http://localhost:3101 node scripts/crawl-studio-ui.mjs [label]   (label defaults to "after")
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, signIn } from "./crawl-lib.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const label = process.argv[2] ?? "after";
const out = new URL(`./crawl-output/studio-ui/${label}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const issues = [];

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desk: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

async function session(phone, vp) {
  const context = await browser.newContext({ ...VIEWPORTS[vp], locale: "en-US" });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && issues.push(`[${vp}] console: ${m.text()}`));
  page.on("pageerror", (e) => issues.push(`[${vp}] pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 500 && issues.push(`[${vp}] HTTP ${r.status()} ${r.url()}`));
  if (phone) await signIn(page, phone);
  return { context, page };
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  // Wait for skeletons/"Loading…" to go away.
  await page.waitForFunction(() => !document.querySelector("[data-skeleton]") && !/Loading…/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(350);
}

async function overflowCheck(page, name, vp) {
  if (vp !== "phone") return;
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(150);
  const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (w > 1) issues.push(`[360px] horizontal overflow of ${w}px on ${name}`);
  // Also catch content that is clipped rather than scrolled: visible elements poking past the viewport
  // that are not inside an intentional horizontal scroller (lanes, chip rows).
  const poking = await page.evaluate(() => {
    const vw = window.innerWidth;
    const scroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") return true;
      }
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== "fixed" && !scroller(el)) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
      if (bad.length > 2) break;
    }
    return bad;
  });
  if (poking.length) issues.push(`[360px] content wider than the screen on ${name}: ${poking.join(", ")}`);
  await page.setViewportSize(VIEWPORTS.phone.viewport);
}

let n = 0;
async function shot(page, name, vp, { full = false } = {}) {
  await settle(page);
  await overflowCheck(page, name, vp);
  n += 1;
  const file = `${out}${String(n).padStart(2, "0")}-${name}-${vp}.png`;
  await page.screenshot({ path: file, fullPage: full, caret: "initial" });
  console.log(`📸 ${name} [${vp}] → ${file}`);
}

const firstPage = async (page, name) => {
  const pages = await page.evaluate(async () => (await fetch("/api/pages/mine/list", { credentials: "include" })).json());
  return (name ? pages.find((p) => p.name.includes(name)) : pages[0]) ?? pages[0];
};

for (const vp of ["phone", "desk"]) {
  // Tailor: home, products, editor, product detail, orders, settings
  {
    const { context, page } = await session("0788100001", vp);
    await page.goto(`${BASE}/studio`);
    await shot(page, "studio-pages", vp);
    const p = await firstPage(page, "Uwase");
    await page.goto(`${BASE}/studio/${p.id}`);
    await shot(page, "tailor-home", vp, { full: true });
    if (vp === "phone") {
      const share = page.getByRole("button", { name: /share my page/i });
      if (await share.count()) {
        await share.first().click();
        await shot(page, "tailor-share-qr", vp);
        await page.keyboard.press("Escape");
      }
      const more = page.getByRole("button", { name: "More" });
      if (await more.count()) {
        await more.click();
        await shot(page, "more-sheet", vp);
        await page.keyboard.press("Escape");
      }
    }
    await page.goto(`${BASE}/studio/${p.id}/products`);
    await shot(page, "tailor-products", vp, { full: true });
    const products = await page.evaluate(async (id) => (await fetch(`/api/pages/${id}/products`, { credentials: "include" })).json(), p.id);
    const withPhoto = products.find((x) => x.variants.some((v) => v.cutout)) ?? products[0];
    await page.goto(`${BASE}/studio/${p.id}/products/new`);
    await page.getByPlaceholder("Indigo wrap dress").fill("Indigo wrap dress");
    await page.locator("input[inputmode=numeric]").fill("38000");
    await page.getByLabel("Colour name").fill("Indigo");
    await shot(page, "tailor-product-new", vp, { full: true });
    if (withPhoto) {
      await page.goto(`${BASE}/studio/${p.id}/products/${withPhoto.id}`);
      await shot(page, "tailor-product-detail", vp, { full: true });
    }
    await page.goto(`${BASE}/studio/${p.id}/orders`);
    await shot(page, "tailor-orders", vp, { full: vp === "desk" });
    const card = page.locator("[data-order-card]").first();
    if (await card.count()) {
      await card.locator("[data-order-open]").click();
      await shot(page, "tailor-order-sheet", vp);
      await page.keyboard.press("Escape");
    }
    await page.goto(`${BASE}/studio/${p.id}/settings`);
    await shot(page, "tailor-settings", vp, { full: true });
    await context.close();
  }
  // Cooperative admin: home + makers + products (approval queue)
  {
    const { context, page } = await session("0788100002", vp);
    const p = await firstPage(page, "Urudodo");
    await page.goto(`${BASE}/studio/${p.id}`);
    await shot(page, "coop-home", vp, { full: true });
    await page.goto(`${BASE}/studio/${p.id}/makers`);
    await shot(page, "coop-makers", vp, { full: true });
    await page.goto(`${BASE}/studio/${p.id}/products`);
    await shot(page, "coop-products", vp);
    await context.close();
  }
  // Coop maker (member access)
  {
    const { context, page } = await session("0788100004", vp);
    const p = await firstPage(page, "Urudodo");
    await page.goto(`${BASE}/studio/${p.id}`);
    await shot(page, "maker-home", vp);
    await context.close();
  }
  // New member: 3-step create wizard
  {
    const phone = `0789${String(Date.now()).slice(-6)}`;
    const { context, page } = await session(phone, vp);
    await page.goto(`${BASE}/studio`);
    await shot(page, "new-empty", vp);
    await page.getByRole("button", { name: "Create my page" }).click();
    await page.getByPlaceholder("Uwase Couture").fill("Rubavu Threads");
    await shot(page, "new-wizard-1", vp);
    const next = page.getByRole("button", { name: /^continue/i });
    if (await next.count()) {
      await next.click();
      await shot(page, "new-wizard-2", vp);
      await next.click();
      await shot(page, "new-wizard-3", vp);
    }
    await context.close();
  }
  // Host admin: every tab
  {
    const { context, page } = await session("0788900001", vp);
    await page.goto(`${BASE}/admin`);
    await page.getByText(/ai unit economics/i).waitFor();
    await shot(page, "admin-overview", vp, { full: true });
    let reviewUrl = null;
    for (const tab of ["Verify", "Moderation", "Migration", "Flags & models", "Outbox", "Audit"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      await shot(page, `admin-${tab.toLowerCase().replace(/[^a-z]+/g, "-")}`, vp);
      if (tab === "Migration") {
        const link = page.getByRole("link", { name: "review link" }).first();
        if (await link.count()) reviewUrl = await link.getAttribute("href");
      }
    }
    await context.close();
    if (reviewUrl) {
      // The owner-review screen needs the page owner; the host sees the access message, which is still a designed state.
      const { context: c2, page: p2 } = await session("0788900001", vp);
      await p2.goto(reviewUrl.replace(/^https?:\/\/[^/]+/, BASE));
      await shot(p2, "migrate-review", vp, { full: true });
      await c2.close();
    }
  }
}

await browser.close();
if (issues.length) {
  console.log(`\n⚠️  ${issues.length} issue(s):\n` + issues.map((i) => ` - ${i}`).join("\n"));
  process.exitCode = 1;
} else console.log("\n✅ no console errors, 5xx responses or 360px overflow");
