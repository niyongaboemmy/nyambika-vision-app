// Lighthouse-style perf sample for the UI/UX modernisation (docs/design/ui-audit.md §Performance).
// Run against a production build:  NEXT_DIST_DIR=.next-build next build && next start --port 3114
// Usage: BASE_URL=http://localhost:3114 node scripts/perf-uiux.mjs [label]
// Per route, in a cold browser context on a Pixel 7 profile with 4x CPU slowdown and "slow 4G"
// (150 ms RTT, 1.6 Mbps): JS at the load event and JS until network idle (incl. deferred chunks and Next's
// route prefetches), gzip bytes over the wire, LCP, CLS, and an INP proxy
// (the slowest event-timing entry after tapping the page's first button-free area and first chip/button that
// does not navigate). Writes JSON to scripts/crawl-output/perf-<label>.json and prints a markdown table.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, signIn } from "./crawl-lib.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, devices } = require("@playwright/test");

const label = process.argv[2] ?? "after";
const browser = await chromium.launch();

const VITALS = () => {
  window.__v = { lcp: 0, cls: 0, inp: 0 };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__v.lcp = e.renderTime || e.loadTime || e.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.interactionId) window.__v.inp = Math.max(window.__v.inp, e.duration);
  }).observe({ type: "event", buffered: true, durationThreshold: 16 });
};

async function ctx(storage) {
  const context = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US", storageState: storage });
  await context.addInitScript(VITALS);
  return context;
}

// One signed-in storage state (cookies) reused by the cold contexts; HTTP cache is per context.
const seed = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const sp = await seed.newPage();
await signIn(sp, `0786${String(Date.now()).slice(-6)}`);
const look = await sp.evaluate(async () => {
  const r = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a kitenge dress for a wedding under 60000", source: "text", locale: "en" }) });
  return r.ok ? (await r.json()).sessionId : null;
});
const products = await sp.evaluate(async () => {
  const r = await fetch("/api/pages/by-handle/umurage-wear");
  return r.ok ? r.json() : null;
});
const variant = products?.products?.[0]?.variants?.[0]?.id;
const storage = await seed.storageState();
await seed.close();

const ROUTES = [
  ["/", "Muse (home)"],
  look && [`/looks/${look}`, "Looks"],
  variant && [`/looks/try?variant=${variant}`, "Try one look"],
  ["/m/umurage-wear", "Maker page"],
  ["/bag", "Bag"],
  ["/orders", "Orders"],
  ["/wardrobe", "Wardrobe"],
  ["/circle", "Circle"],
  ["/trust", "Trust centre"],
  ["/mirror", "Mirror"],
  ["/signin", "Sign in"],
].filter(Boolean);

const rows = [];
for (const [path, name] of ROUTES) {
  const context = await ctx(storage);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  let js = 0;
  const reqType = new Map();
  cdp.on("Network.responseReceived", (e) => reqType.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => {
    if (reqType.get(e.requestId) === "Script") js += e.encodedDataLength;
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  const jsAtLoad = js; // critical JS: everything fetched before the load event
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  // INP proxy: tap a neutral spot, then the first in-page toggle-like control that does not navigate.
  await page.mouse.click(20, 300).catch(() => {});
  const ctl = page.locator("main button:not([type=submit]), main [role=tab], main [aria-pressed]").first();
  if (await ctl.count()) await ctl.click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
  await page.waitForTimeout(800);
  const v = await page.evaluate(() => window.__v);
  rows.push({ path: path.replace(/looks\/[a-z0-9]{20,}/, "looks/:id").replace(/variant=.*/, "variant=:id"), name, jsLoadKB: +(jsAtLoad / 1024).toFixed(1), jsKB: +(js / 1024).toFixed(1), lcp: Math.round(v.lcp), cls: +v.cls.toFixed(3), inp: Math.round(v.inp) });
  console.log(`${name}: ${(js / 1024).toFixed(1)} KB js · LCP ${Math.round(v.lcp)} ms · CLS ${v.cls.toFixed(3)} · INP~ ${Math.round(v.inp)} ms`);
  await context.close();
}
await browser.close();

mkdirSync(new URL("./crawl-output/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./crawl-output/perf-${label}.json`, import.meta.url), JSON.stringify(rows, null, 2));
console.log(`\n| Route | JS at load (KB gz) | JS until idle incl. deferred + prefetch (KB gz) | LCP (ms) | CLS | INP proxy (ms) |\n|---|---:|---:|---:|---:|---:|`);
for (const r of rows) console.log(`| ${r.name} \`${r.path}\` | ${r.jsLoadKB} | ${r.jsKB} | ${r.lcp} | ${r.cls} | ${r.inp} |`);
