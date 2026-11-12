// UI/UX modernisation crawl: every shopper and member screen, in light and dark, at phone (390) and desktop (1280),
// plus an axe-core WCAG 2.2 AA pass and a 360px overflow check. Fails on console errors, 5xx, horizontal overflow,
// a flash of the wrong theme, or any serious/critical axe violation.
//
// Usage: BASE_URL=http://localhost:3104 node scripts/crawl-uiux.mjs [label]
//   THEMES=light,dark   (default both)     VIEWPORTS=390,1280 (default; add 360 to also screenshot 360)
//   ONLY=muse,bag       (substring filter on screen names)   AXE=0 to skip axe (quick visual runs)
//   FULL=1 full-page screenshots (review)   STRICT_TARGETS=1 fail on tap targets under 44 px
//   LOCALE=rw|fr|sw     render in that locale (stored choice, as after a switch)   WRAP=warn report wraps, don't fail
// Polish pass: one-line elements (pills, chips, badges, tabs, short buttons, prices/counts) that wrap fail the crawl
// at 360 and 390 px; outlines (visible borders / rings) per screen are counted at 390 for the before/after table.
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
const warnings = [];
const axeSummary = [];
// Copy & alignment pass: per-screen words, paragraphs taller than 2 lines and small tap targets at 390 px.
// STRICT_TARGETS=1 turns tap targets under 44 px into failures.
const metrics = {};
const STRICT = process.env.STRICT_TARGETS === "1";
const LOCALE = process.env.LOCALE;
const WRAP_FAIL = process.env.WRAP !== "warn";

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
const maker = await j("anon", "/pages/by-handle/umurage-wear");
const variant = maker?.products?.[0]?.variants?.[0]?.id;
// A product that has a published Digital Product Passport (seeded on the Urudodo coop).
const coopPublic = await j("anon", "/pages/by-handle/urudodo-collective");
let productId = null;
for (const pr of coopPublic?.products ?? []) if (!productId && (await j("anon", `/passports/${pr.id}`))) productId = pr.id;
const look = await j("fresh", "/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a kitenge dress for a wedding under 60000", source: "text", locale: "en" }) });
const orders = (await j("shopper", "/orders/mine")) ?? [];
const polls = (await j("shopper", "/circle/polls")) ?? [];
const customs = (await j("shopper", "/custom-orders/mine")) ?? [];
const wardrobe = await j("shopper", "/wardrobe");
const tailorPages = (await j("tailor", "/pages/mine/list")) ?? [];
const uwase = tailorPages.find((p) => p.name.includes("Uwase")) ?? tailorPages[0];
const coopPage = ((await j("coop", "/pages/mine/list")) ?? []).find((p) => p.name.includes("Urudodo"));
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
  ["muse-typing", "shopper", "/", async (p) => { await p.getByRole("button", { name: /type|andika|écri|tape|chapa/i }).last().click(); }],
  look && ["looks", "fresh", `/looks/${look.sessionId}`],
  variant && ["look-try", "fresh", `/looks/try?variant=${variant}`],
  ["maker-space", "anon", "/m/umurage-wear"],
  ["maker-showroom", "anon", "/m/umurage-wear/showroom"],
  show && ["maker-show", "anon", `/m/umurage-wear/shows/${show.id}`],
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

/** Polish pass. Wraps: elements meant to sit on one line whose text breaks over 2+ line boxes: pill-shaped controls
 *  and chips (radius about half their height), tabs/options, `.tabular` numbers, `[data-nowrap]`, and short buttons
 *  (up to 3 words). An element counts only if its text flows as one run (no block/column children), so stacked
 *  title + subtitle buttons are not flagged; `[data-allow-wrap]` opts a subtree out. Outlines: visible boxes with a
 *  border on all four sides or a ring (0 0 0 Npx shadow) in a non-transparent colour; 0.5 px hairline separators
 *  (one side, or inset 0.5 px shadows) are not outlines. */
async function polishMetrics(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[aria-hidden=true],.sr-only,[data-allow-wrap]");
    };
    const column = (cs) => cs.display.includes("grid") || (cs.display.includes("flex") && cs.flexDirection.startsWith("column"));
    const oneRun = (el) => {
      if (column(getComputedStyle(el))) return false;
      for (const d of el.querySelectorAll("*")) {
        if (!d.textContent.trim()) continue;
        const cs = getComputedStyle(d);
        if (cs.display === "block" || cs.display === "list-item" || column(cs)) return false;
      }
      return true;
    };
    const lines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const mids = [];
      for (const b of r.getClientRects()) {
        if (b.width < 1 || b.height < 1) continue;
        const mid = b.top + b.height / 2;
        if (!mids.some((t) => Math.abs(t - mid) < Math.max(6, b.height / 2))) mids.push(mid);
      }
      return mids.length;
    };
    const wraps = [];
    const flagged = [];
    for (const el of document.querySelectorAll("button,a,[role=tab],[role=option],[role=button],span,div,p,dd,dt,small,strong,b,label,summary")) {
      const text = el.innerText?.trim();
      if (!text || text.length > 60 || !vis(el) || el.closest("input,textarea,select,[role=log],[data-allow-prose]")) continue;
      const cs = getComputedStyle(el);
      const h = el.getBoundingClientRect().height;
      const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0;
      const pill = h <= 64 && filled && parseFloat(cs.borderTopLeftRadius) >= Math.min(h, 40) / 2 - 2;
      const role = el.getAttribute("role") ?? "";
      const control = /^(BUTTON|A)$/.test(el.tagName) || /tab|option|button/.test(role);
      const short = text.split(/\s+/).length <= 3;
      const num = el.classList.contains("tabular") || el.classList.contains("tabular-nums") || el.hasAttribute("data-nowrap");
      if (!(pill || (control && short) || num || role === "tab")) continue;
      if (flagged.some((f) => f.contains(el)) || !oneRun(el)) continue;
      const n = lines(el);
      if (n > 1) { flagged.push(el); wraps.push(`${el.tagName.toLowerCase()} "${text.replace(/\s+/g, " ").slice(0, 40)}" ${n} lines`); }
    }
    const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return c.includes("color(") || c.includes("oklab") ? 1 : 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
    let outlines = 0;
    const outlineEx = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".theme-media,[aria-hidden=true],svg,canvas") || el.matches(":focus-visible")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 16 || r.bottom < 0 || r.top > innerHeight * 3) continue;
      const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) >= 1 && cs[`border${s}Style`] !== "none" && alpha(cs[`border${s}Color`]) > 0.04);
      // Rings: a "0px 0px 0px Npx" shadow layer (N >= 1) whose colour is visible.
      const ring = cs.boxShadow.split(/,(?![^(]*\))/).some((layer) => /0px 0px 0px (?:[1-9][\d.]*)px/.test(layer) && alpha(layer) > 0.04);
      if (sides.length === 4 || ring) {
        outlines += 1;
        if (outlineEx.length < 6) outlineEx.push(`${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(" ").slice(0, 4).join(".")}`);
      }
    }
    return { wraps: wraps.slice(0, 12), wrapCount: wraps.length, outlines, outlineEx };
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
      if (LOCALE) await ctx.addInitScript((l) => { try { localStorage.setItem("nya_locale", l); } catch {} }, LOCALE);
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
        if (vp === 360 || vp === 390) {
          const pm = await polishMetrics(page);
          if (vp === 390) (metrics[name] ??= {})[`${theme}-polish`] = pm;
          if (vp === 360) (metrics[name] ??= {})[`${theme}-360-wraps`] = pm.wraps;
          if (pm.wrapCount) (WRAP_FAIL ? issues : warnings).push(`${tag} ${pm.wrapCount} one-line element(s) wrap: ${pm.wraps.slice(0, 4).join(", ")}`);
        }
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
        if (vp !== 1280) { mkdirSync(root, { recursive: true }); writeFileSync(`${root}metrics.json`, JSON.stringify(metrics, null, 1)); } // incremental (survives an interrupted run)
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
console.log(`\ncopy metrics (390, ${THEMES[0]}): screen · words · paragraphs >2 lines · tap targets <44px · wraps · outlines`);
for (const [name, m] of Object.entries(metrics)) {
  const x = m[THEMES[0]];
  const pm = m[`${THEMES[0]}-polish`];
  if (x) console.log(` - ${name.padEnd(24)} ${String(x.words).padStart(4)} · ${x.longParas} · ${x.smallTargets} · ${pm?.wrapCount ?? "-"} · ${pm?.outlines ?? "-"}`);
}
if (warnings.length) console.log(`\nwarnings (WRAP=warn):\n` + warnings.map((w) => ` - ${w}`).join("\n"));
if (AXE) console.log(`\naxe (390px):\n${axeSummary.map((s) => ` - ${s}`).join("\n")}`);
console.log(`\nscreens: ${S.length} · themes: ${THEMES.join("/")} · viewports: ${VPS.join("/")} (+360 overflow) · output ${root}`);
if (issues.length) {
  console.log(`\n⚠️  ${issues.length} issue(s):\n` + issues.map((i) => ` - ${i}`).join("\n"));
  process.exitCode = 1;
} else console.log("\n✅ no console errors, 5xx, overflow, theme flash or serious axe violations");
