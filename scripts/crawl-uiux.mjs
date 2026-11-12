// UI/UX modernisation crawl: every shopper and member screen, in light and dark, at phone (390) and desktop (1280),
// plus an axe-core WCAG 2.2 AA pass and a 360px overflow check. Fails on console errors, 5xx, horizontal overflow,
// a flash of the wrong theme, or any serious/critical axe violation.
//
// Usage: BASE_URL=http://localhost:3104 node scripts/crawl-uiux.mjs [label]
//   THEMES=light,dark   (default both)     VIEWPORTS=390,1280 (default; add 360 to also screenshot 360)
//   ONLY=muse,bag       (substring filter on screen names)   AXE=0 to skip axe (quick visual runs)
//   FULL=1 full-page screenshots (review)   STRICT_TARGETS=1 fail on tap targets under 44 px
// Screenshots: scripts/crawl-output/uiux/<label>/<theme>-<vp>/<nn>-<screen>.png
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, signIn } from "./crawl-lib.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium, devices } = require("@playwright/test");
const { default: AxeBuilder } = require("@axe-core/playwright");

const label = process.argv[2] ?? "after";
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const VPS = (process.env.VIEWPORTS ?? "390,1280").split(",").map(Number);
const ONLY = process.env.ONLY?.split(",");
const AXE = process.env.AXE !== "0";
const root = new URL(`./crawl-output/uiux/${label}/`, import.meta.url).pathname;
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const issues = [];
const axeSummary = [];
// Copy & alignment pass: per-screen words, paragraphs taller than 2 lines and small tap targets at 390 px.
// STRICT_TARGETS=1 turns tap targets under 44 px into failures.
const metrics = {};
const STRICT = process.env.STRICT_TARGETS === "1";

const vpOpts = (w) =>
  w >= 1000
    ? { viewport: { width: w, height: 800 }, deviceScaleFactor: 1 }
    : { ...devices["Pixel 7"], viewport: { width: w, height: w === 360 ? 780 : 844 }, deviceScaleFactor: 2 };

// ── sign in each role once; contexts per theme/viewport reuse the cookies ──────────────────────────────────────
async function login(phone) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
  const page = await ctx.newPage();
  if (phone) await signIn(page, phone);
  else await page.goto(`${BASE}/trust`);
  const state = await ctx.storageState();
  return { state, page, ctx };
}
const fresh = `0785${String(Date.now()).slice(-6)}`;
const roles = {
  anon: await login(null),
  shopper: await login("0788000001"),
  fresh: await login(fresh),
  tailor: await login("0788100001"),
  coop: await login("0788100002"),
  maker: await login("0788100004"),
  host: await login("0788900001"),
};
const j = (role, path, init) => roles[role].page.evaluate(async ([p, i]) => { const r = await fetch(`/api${p}`, i ?? {}); return r.ok ? r.json() : null; }, [path, init]);

// ── discover ids for dynamic routes ────────────────────────────────────────────────────────────────────────────
const maker = await j("anon", "/pages/by-handle/uwase-couture");
const variant = maker?.products?.[0]?.variants?.[0]?.id;
// A product that has a published Digital Product Passport (seeded on the Abahizi coop).
const coopPublic = await j("anon", "/pages/by-handle/abahizi-coop");
let productId = null;
for (const pr of coopPublic?.products ?? []) if (!productId && (await j("anon", `/passports/${pr.id}`))) productId = pr.id;
const look = await j("fresh", "/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a kitenge dress for a wedding under 60000", source: "text", locale: "en" }) });
const orders = (await j("shopper", "/orders/mine")) ?? [];
const polls = (await j("shopper", "/circle/polls")) ?? [];
const customs = (await j("shopper", "/custom-orders/mine")) ?? [];
const wardrobe = await j("shopper", "/wardrobe");
const tailorPages = (await j("tailor", "/pages/mine/list")) ?? [];
const uwase = tailorPages.find((p) => p.name.includes("Uwase")) ?? tailorPages[0];
const coopPage = ((await j("coop", "/pages/mine/list")) ?? []).find((p) => p.name.includes("Abahizi"));
const uwaseProducts = uwase ? (await j("tailor", `/pages/${uwase.id}/products`)) ?? [] : [];
const vr = uwase ? await j("tailor", `/vr/pages/${uwase.id}`) : null;
const show = vr?.shows?.find((s) => s.phase === "UPCOMING") ?? vr?.shows?.[0];
const tailorOrders = uwase ? (await j("tailor", `/pages/${uwase.id}/custom-orders`)) ?? [] : [];
const wardrobeEvent = wardrobe?.events?.[0]?.id;
const wardrobeItem = wardrobe?.owned?.[0]?.id;

/** Each screen: [name, role, path | null, optional action(page) run before the screenshot]. */
const S = [
  ["muse-signed-out", "anon", "/"],
  ["signin", "anon", "/signin"],
  ["muse", "shopper", "/"],
  ["muse-menu", "shopper", "/", async (p) => { await p.getByRole("button", { name: "Menu" }).click(); await p.getByRole("dialog").waitFor(); }],
  ["muse-typing", "shopper", "/", async (p) => { await p.getByRole("button", { name: /type/i }).last().click(); }],
  look && ["looks", "fresh", `/looks/${look.sessionId}`],
  variant && ["look-try", "fresh", `/looks/try?variant=${variant}`],
  ["maker-space", "anon", "/m/uwase-couture"],
  ["maker-showroom", "anon", "/m/uwase-couture/showroom"],
  show && ["maker-show", "anon", `/m/uwase-couture/shows/${show.id}`],
  ["makers", "shopper", "/makers"],
  productId && ["passport", "anon", `/p/${productId}`],
  ["mirror", "shopper", "/mirror"],
  ["mirror-3d", "shopper", "/mirror/3d"],
  ["mirror-ar", "shopper", "/mirror/ar"],
  ["mirror-mr", "shopper", "/mirror/mr"],
  ["measurements", "shopper", "/measurements"],
  ["wardrobe", "shopper", "/wardrobe"],
  wardrobeEvent && ["wardrobe-event", "shopper", `/wardrobe/events/${wardrobeEvent}`],
  wardrobeItem && ["wardrobe-item", "shopper", `/wardrobe/item/${wardrobeItem}`],
  ["circle", "shopper", "/circle"],
  polls[0] && ["circle-poll", "shopper", `/circle/${polls[0].id}`],
  ["bag", "shopper", "/bag"],
  ["orders", "shopper", "/orders"],
  orders[0] && ["order", "shopper", `/orders/${orders[0].id}`],
  ["saved", "shopper", "/saved"],
  ["custom", "shopper", "/custom"],
  customs[0] && ["custom-order", "shopper", `/custom/${customs[0].id}`],
  ["trust", "shopper", "/trust"],
  ["join", "anon", "/join"],
  // members
  ["studio-pages", "tailor", "/studio"],
  uwase && ["studio-home", "tailor", `/studio/${uwase.id}`],
  uwase && ["studio-products", "tailor", `/studio/${uwase.id}/products`],
  uwase && ["studio-product-new", "tailor", `/studio/${uwase.id}/products/new`],
  uwase && uwaseProducts[0] && ["studio-product", "tailor", `/studio/${uwase.id}/products/${uwaseProducts[0].id}`],
  uwase && ["studio-orders", "tailor", `/studio/${uwase.id}/orders`],
  uwase && ["studio-tailor", "tailor", `/studio/${uwase.id}/tailor`],
  uwase && tailorOrders[0] && ["studio-tailor-order", "tailor", `/studio/${uwase.id}/tailor/${tailorOrders[0].id}`],
  uwase && ["studio-tailor-services", "tailor", `/studio/${uwase.id}/tailor/services`],
  uwase && ["studio-tailor-slots", "tailor", `/studio/${uwase.id}/tailor/slots`],
  uwase && ["studio-grow", "tailor", `/studio/${uwase.id}/grow`],
  uwase && ["studio-showroom", "tailor", `/studio/${uwase.id}/showroom`],
  uwase && ["studio-settings", "tailor", `/studio/${uwase.id}/settings`],
  uwase && ["studio-share-sheet", "tailor", `/studio/${uwase.id}`, async (p) => { const b = p.getByRole("button", { name: /share my page/i }); if (await b.count()) { await b.first().click(); await p.getByRole("dialog").waitFor(); } }],
  coopPage && ["coop-makers", "coop", `/studio/${coopPage.id}/makers`],
  coopPage && ["coop-easy", "maker", `/studio/${coopPage.id}/easy`],
  ["admin", "host", "/admin"],
  ["admin-migration", "host", "/admin?tab=Migration"],
  ["admin-agents", "host", "/admin/agents"],
  ["admin-network", "host", "/admin/network"],
  ["admin-pilot", "host", "/admin/pilot"],
  ["admin-regions", "host", "/admin/regions"],
].filter(Boolean).filter(([name]) => !ONLY || ONLY.some((o) => name.includes(o)));

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector("[data-skeleton],[aria-busy=true]") && !/Loading…/.test(document.body.innerText), null, { timeout: 12000 }).catch(() => {});
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.waitForTimeout(400);
}

/** Visible words; paragraphs taller than 2 lines (closed LearnMore details are hidden, so not counted); and
 *  interactive elements whose hit area (own box, wrapping <label>, or a `.hit` ::after expansion) is under 44 px. */
async function copyMetrics(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[aria-hidden=true],.sr-only");
    };
    const words = (document.body.innerText.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
    const paras = [];
    for (const el of document.querySelectorAll("p,li,span,div,dd,figcaption,small,label,legend")) {
      if (!vis(el) || el.closest("input,textarea,select,code,pre,[role=log],[data-allow-prose]") || el.closest("details:not([open]) > :not(summary)")) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      if (own.length < 40) continue;
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const lines = Math.round((el.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh); // content lines, not padding
      if (lines > 2) paras.push({ lines, text: el.innerText.slice(0, 90) });
    }
    const small = [];
    for (const el of document.querySelectorAll("a[href],button,[role=button],[role=switch],[role=tab],[role=option],select,summary,input:not([type=hidden]),textarea")) {
      if (!vis(el) || el.disabled) continue;
      if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement?.closest("p,li")) continue; // inline text link
      const r = el.getBoundingClientRect();
      const host = el.closest("label") ?? el;
      const hr = host.getBoundingClientRect();
      // `.hit` expansion on the control itself or on its wrapping <label> (inputs can't have ::after).
      const hits = [el, host].map((x) => getComputedStyle(x, "::after")).filter((af) => af.content !== "none" && af.position === "absolute");
      const w = Math.max(r.width, hr.width, ...hits.map((af) => parseFloat(af.width) || 0));
      const h = Math.max(r.height, hr.height, ...hits.map((af) => parseFloat(af.height) || 0));
      if (w < 43.5 || h < 43.5) small.push(`${el.tagName.toLowerCase()} ${Math.round(w)}x${Math.round(h)} "${(el.getAttribute("aria-label") ?? el.innerText ?? "").trim().slice(0, 30)}"`);
    }
    // iOS pass: no emoji in rendered text or in names/placeholders (Extended_Pictographic + U+FE0F; © ® ™ allowed).
    const EMO = /[\p{Extended_Pictographic}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u; // + regional indicators (flags)
    const emo = (s) => [...(s ?? "")].filter((c) => EMO.test(c) && !"©®™".includes(c)).join("");
    const emoji = [];
    const bodyEmo = emo(document.body.innerText);
    if (bodyEmo) emoji.push(`text "${bodyEmo.slice(0, 12)}"`);
    for (const el of document.querySelectorAll("[aria-label],[title],[placeholder],img[alt]")) {
      const v = ["aria-label", "title", "placeholder", "alt"].map((a) => el.getAttribute(a)).filter(Boolean).join(" ");
      const e = emo(v);
      if (e) emoji.push(`${el.tagName.toLowerCase()} "${v.slice(0, 40)}"`);
    }
    return { words, longParas: paras.length, paras: paras.sort((a, b) => b.lines - a.lines).slice(0, 8), smallTargets: small.length, small: small.slice(0, 12), emoji: emoji.slice(0, 6) };
  });
}

async function overflow(page, name) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (w > 1) issues.push(`[360] horizontal overflow ${w}px on ${name}`);
}

for (const theme of THEMES) {
  for (const vp of [...new Set([...VPS, 360])]) {
    const shoot = VPS.includes(vp);
    const out = `${root}${theme}-${vp}/`;
    if (shoot) mkdirSync(out, { recursive: true });
    const contexts = {};
    const ctxFor = async (role) => {
      if (contexts[role]) return contexts[role];
      const ctx = await browser.newContext({ ...vpOpts(vp), locale: "en-US", colorScheme: theme, storageState: roles[role].state });
      // An explicit choice beats the system preference; the crawl exercises the cookie path.
      await ctx.addCookies([{ name: "nv-theme", value: theme, url: BASE }]);
      return (contexts[role] = ctx);
    };
    let n = 0;
    for (const [name, role, path, action] of S) {
      const ctx = await ctxFor(role);
      const page = await ctx.newPage();
      const tag = `[${theme} ${vp}] ${name}`;
      page.on("console", (m) => m.type() === "error" && !/WebGL|GPU stall|camera|NotAllowedError|NotFoundError|getUserMedia|Requested device not found/i.test(m.text()) && issues.push(`${tag} console: ${m.text().slice(0, 200)}`));
      // React dev-only profiling bug on server pages ("cannot have a negative time stamp"); not an app error.
      page.on("pageerror", (e) => !/negative time stamp/.test(e.message) && issues.push(`${tag} pageerror: ${e.message}`));
      page.on("response", (r) => r.status() >= 500 && issues.push(`${tag} HTTP ${r.status()} ${r.url()}`));
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
        // No flash: the theme attribute is on <html> before first paint (set by the inline head script).
        const early = await page.evaluate(() => document.documentElement.dataset.theme);
        if (early !== theme) issues.push(`${tag} data-theme is "${early}" at DOMContentLoaded (want ${theme})`);
        await settle(page);
        if (action) { await action(page); await page.waitForTimeout(500); }
        if (vp === 360) await overflow(page, name);
        if (vp === 390) {
          const m = await copyMetrics(page);
          (metrics[name] ??= {})[theme] = m;
          if (m.emoji.length) issues.push(`${tag} emoji in UI: ${m.emoji.join(", ")}`);
          if (STRICT && m.smallTargets) issues.push(`${tag} ${m.smallTargets} tap target(s) under 44px e.g. ${m.small.slice(0, 3).join(", ")}`);
        }
        if (shoot) {
          n += 1;
          await page.screenshot({ path: `${out}${String(n).padStart(2, "0")}-${name}.png`, caret: "initial", fullPage: process.env.FULL === "1" });
        }
        if (AXE && vp === 390) {
          const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("canvas").analyze();
          const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          for (const v of bad) issues.push(`${tag} axe ${v.impact} ${v.id}: ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.target?.join(" ")} ${v.nodes[0]?.failureSummary?.split("\n")[1]?.trim() ?? ""}`.slice(0, 400));
          axeSummary.push(`${theme} ${name}: ${bad.length} serious/critical, ${res.violations.length - bad.length} minor`);
        }
        console.log(`✓ ${tag}`);
      } catch (e) {
        issues.push(`${tag} failed: ${e.message.split("\n")[0]}`);
      }
      await page.close();
    }
    for (const c of Object.values(contexts)) await c.close();
  }
}

await browser.close();
mkdirSync(root, { recursive: true });
writeFileSync(`${root}metrics.json`, JSON.stringify(metrics, null, 1));
console.log(`\ncopy metrics (390, ${THEMES[0]}): screen · words · paragraphs >2 lines · tap targets <44px`);
for (const [name, m] of Object.entries(metrics)) {
  const x = m[THEMES[0]];
  if (x) console.log(` - ${name.padEnd(24)} ${String(x.words).padStart(4)} · ${x.longParas} · ${x.smallTargets}`);
}
if (AXE) console.log(`\naxe (390px):\n${axeSummary.map((s) => ` - ${s}`).join("\n")}`);
console.log(`\nscreens: ${S.length} · themes: ${THEMES.join("/")} · viewports: ${VPS.join("/")} (+360 overflow) · output ${root}`);
if (issues.length) {
  console.log(`\n⚠️  ${issues.length} issue(s):\n` + issues.map((i) => ` - ${i}`).join("\n"));
  process.exitCode = 1;
} else console.log("\n✅ no console errors, 5xx, overflow, theme flash or serious axe violations");
