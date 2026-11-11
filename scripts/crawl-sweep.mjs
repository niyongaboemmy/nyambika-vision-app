// Error sweep crawl: visits EVERY route under apps/web/app (enumerated from the filesystem; dynamic params filled
// from seeded data) as anonymous, shopper, tailor, coop admin, coop maker and host, at 390 px and 1280 px.
// Collects: console errors, uncaught errors / unhandled promise rejections, failed requests (4xx except the
// intended 401/403/404/410 probes, every 5xx), React hydration warnings, raw API error text rendered in the UI,
// broken images and horizontal overflow. Writes crawl-output/sweep/findings.{json,md}; exits 1 on any finding
// that is not in KNOWN (intended behaviour, with the reason).
//
// Run: BASE_URL=http://localhost:3103 CRAWL_DB=nyambika_errsweep node scripts/crawl-sweep.mjs
//      [--roles=shopper,host] [--only=/studio] [--widths=390]   (filters for quick re-checks)
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { BASE, CRAWL_DB } from "./crawl-lib.mjs";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const OUT = new URL("./crawl-output/sweep/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const APP = new URL("../apps/web/app/", import.meta.url).pathname;
const sql = (q) => execSync(`psql -d ${CRAWL_DB} -tAc ${JSON.stringify(q)}`).toString().trim();
const one = (q) => sql(q).split("\n")[0] || null;

const ROLES = {
  anonymous: null,
  shopper: "0788000001",
  tailor: "0788100001",
  coopAdmin: "0788100002",
  coopMaker: "0788100004",
  host: "0788900001",
};
const WIDTHS = (arg("widths") ?? "390,1280").split(",").map(Number);
const roleFilter = arg("roles")?.split(",");
const only = arg("only");

// Intended outcomes, not bugs: [route regex, finding regex, reason].
const KNOWN = [
  [/^\/dev\//, /HTTP 4\d\d .*\/api\/dev\//, "dev-only simulator pages probe endpoints that refuse non-dev roles"],
  [/./, /HTTP 400 .*\/api\/auth\/refresh/, "silent refresh without a refresh cookie answers 400/401 by design (anonymous)"],
];

// ── 1. enumerate routes ──────────────────────────────────────────────────────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name === "page.tsx" || name === "route.ts") out.push(p);
  }
  return out;
}
const routes = walk(APP)
  .map((f) => ({ file: relative(APP, f), kind: f.endsWith("route.ts") ? "handler" : "page", path: "/" + relative(APP, f).replace(/\/?(page\.tsx|route\.ts)$/, "") }))
  .map((r) => ({ ...r, path: r.path.split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/") || "/" }))
  .filter((r) => !only || r.path.startsWith(only))
  .sort((a, b) => a.path.localeCompare(b.path));

// ── 2. seeded data for dynamic params ────────────────────────────────────────────────────────────────────────────
const uid = (phone) => one(`select id from "User" where phone = '+250${phone.slice(1)}' limit 1`);
const users = Object.fromEntries(Object.entries(ROLES).map(([r, p]) => [r, p ? uid(p) : null]));
const shopperId = users.shopper;
const pageOf = (userId) => (userId ? one(`select "pageId" from "RoleAssignment" where "userId"='${userId}' and "pageId" is not null order by "pageId" limit 1`) : null);
const seed = {
  handle: one(`select handle from "Page" where handle='uwase-couture'`) ?? one(`select handle from "Page" where status='PUBLISHED' order by handle limit 1`),
  showId: one(`select s.id from "FashionShow" s join "Page" p on p.id=s."pageId" where p.handle='uwase-couture' order by s."startsAt" desc limit 1`) ?? one(`select id from "FashionShow" limit 1`),
  productId: one(`select id from "Product" where status='PUBLISHED' order by "createdAt" limit 1`),
  passportId: one(`select "productId" from "ProductPassport" limit 1`),
  gtin: one(`select gtin from "ProductPassport" where gtin is not null limit 1`) ?? "00000000",
  variantId: one(`select v.id from "Variant" v join "Product" p on p."id"=v."productId" where p.status='PUBLISHED' and v."cutoutPath" is not null limit 1`),
  pollToken: one(`select token from "CirclePoll" order by "createdAt" desc limit 1`) ?? "unknown-token",
  migrateToken: one(`select "reviewToken" from "MigrationItem" where "reviewToken" is not null limit 1`) ?? "unknown-token",
};
const perRole = (role) => {
  const u = users[role];
  return {
    pageId: pageOf(u) ?? pageOf(users.tailor),
    sessionId: (u && one(`select id from "IntentSession" where "userId"='${u}' order by "createdAt" desc limit 1`)) ?? one(`select id from "IntentSession" where "userId"='${shopperId}' order by "createdAt" desc limit 1`),
    orderId: (u && one(`select id from "Order" where "shopperId"='${u}' order by "createdAt" desc limit 1`)) ?? one(`select id from "Order" where "shopperId"='${shopperId}' order by "createdAt" desc limit 1`),
    circleId: (u && one(`select id from "CirclePoll" where "ownerId"='${u}' limit 1`)) ?? one(`select id from "CirclePoll" limit 1`),
    customId: (u && one(`select id from "CustomOrder" where "shopperId"='${u}' limit 1`)) ?? one(`select id from "CustomOrder" limit 1`),
    tailorOrderId: one(`select id from "CustomOrder" where "pageId"='${pageOf(u) ?? pageOf(users.tailor)}' limit 1`) ?? one(`select id from "CustomOrder" limit 1`),
    eventId: (u && one(`select id from "WardrobeEvent" where "userId"='${u}' limit 1`)) ?? one(`select id from "WardrobeEvent" limit 1`),
    studioProductId: one(`select id from "Product" where "pageId"='${pageOf(u) ?? pageOf(users.tailor)}' limit 1`),
  };
};

function fill(path, role, extra) {
  const r = { ...perRole(role), ...extra };
  const map = {
    "[handle]": seed.handle,
    "[showId]": seed.showId,
    "[pageId]": r.pageId,
    "[productId]": r.studioProductId ?? seed.productId,
    "[orderId]": path.startsWith("/studio") ? r.tailorOrderId : r.orderId,
    "[sessionId]": r.sessionId,
    "[token]": path.startsWith("/c/") ? seed.pollToken : path.startsWith("/migrate") ? seed.migrateToken : "sweep-unknown-mandate",
    "[gtin]": seed.gtin,
    "[[...code]]": "",
    "[...legacy]": "shop/old-legacy-page",
  };
  let url = path
    .split("/")
    .map((seg) => {
      if (seg in map) return map[seg] ?? "missing";
      if (seg === "[id]") {
        if (path.startsWith("/circle")) return r.circleId;
        if (path.startsWith("/custom")) return r.customId;
        if (path.startsWith("/orders")) return r.orderId;
        if (path.startsWith("/p/")) return seed.passportId ?? seed.productId;
        if (path.startsWith("/wardrobe/events")) return r.eventId;
        if (path.startsWith("/wardrobe/item")) return r.wardrobeItemId ?? "missing";
        return "missing";
      }
      return seg;
    })
    .join("/")
    .replace(/\/+$/, "") || "/";
  if (path === "/looks/try") url += `?variant=${seed.variantId}`;
  return url;
}

// ── 3. crawl ────────────────────────────────────────────────────────────────────────────────────────────────────
const RAW = [
  /Validation failed/, /Internal server error/i, /Daily look limit reached/, /Cannot (GET|POST|PUT|PATCH|DELETE) \//, /Forbidden resource/,
  /Failed to fetch/, /"statusCode"/, /\[object Object\]/, /\bNaN\b/, /Unexpected token/, /is not a function/, /Cannot read properties/,
  /Unauthorized\b/, /\bundefined\b(?! behaviour)/, /Too many codes requested/, /Lots of voice requests/, /Looks are paused for a moment/,
  /ECONNREFUSED/, /Request failed with status/, /prisma/i,
];
const findings = [];
const add = (f) => findings.push(f);

async function signInApi(ctx, phone) {
  const cache = `${OUT}auth-${phone}.json`;
  if (existsSync(cache)) {
    const state = JSON.parse(readFileSync(cache, "utf8"));
    await ctx.addCookies(state.cookies);
    const me = await (await ctx.request.get(`${BASE}/api/auth/me`)).json().catch(() => null);
    if (me?.user) return;
  }
  const req = await ctx.request.post(`${BASE}/api/auth/otp/request`, { data: { phone } });
  if (!req.ok()) throw new Error(`OTP request for ${phone}: HTTP ${req.status()} ${await req.text()}`);
  const { devCode } = await req.json();
  const ver = await ctx.request.post(`${BASE}/api/auth/otp/verify`, { data: { phone, code: devCode } });
  if (!ver.ok()) throw new Error(`OTP verify for ${phone}: HTTP ${ver.status()}`);
  writeFileSync(cache, JSON.stringify(await ctx.storageState()));
}

async function visit(ctx, role, width, route, url) {
  const page = await ctx.newPage();
  const tag = { role, width, route: route.path, url };
  const local = [];
  const push = (kind, detail) => local.push({ ...tag, kind, detail: String(detail).slice(0, 400) });
  page.on("console", (m) => {
    const text = m.text();
    if (/hydrat/i.test(text) && (m.type() === "error" || m.type() === "warning")) return push("hydration", text);
    if (m.type() !== "error") return;
    if (/Failed to load resource: the server responded with a status of (401|403|404|410)/.test(text)) return; // probes; responses are checked below
    if (/Failed to load resource: the server responded with a status of (4|5)\d\d/.test(text)) return; // reported via the response hook with the URL
    push("console", text);
  });
  page.on("pageerror", (e) => push(/promise/i.test(e.message) ? "unhandled-rejection" : "uncaught", e.message));
  page.on("response", (r) => {
    const s = r.status();
    const u = r.url();
    if (!u.startsWith(BASE)) return;
    if (s >= 500) push("http-5xx", `HTTP ${s} ${r.request().method()} ${u.replace(BASE, "")}`);
    else if (s >= 400 && ![401, 403, 404, 410].includes(s)) push("http-4xx", `HTTP ${s} ${r.request().method()} ${u.replace(BASE, "")}`);
  });
  try {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (route.kind === "page" && res && res.status() >= 500) push("http-5xx", `document HTTP ${res.status()}`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(700);
    if (route.kind === "page") {
      const probe = await page.evaluate(() => {
        const text = document.body?.innerText ?? "";
        const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src") && !i.src.startsWith("data:")).map((i) => i.getAttribute("src"));
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const wide =
          overflow > 1
            ? [...document.querySelectorAll("body *")]
                .filter((el) => { const b = el.getBoundingClientRect(); return b.right > window.innerWidth + 1 && b.width > 0 && getComputedStyle(el).position !== "fixed"; })
                .slice(0, 3)
                .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`)
            : [];
        return { text, broken, overflow, wide, path: location.pathname };
      });
      for (const re of RAW) {
        const m = probe.text.match(re);
        if (m) {
          const at = probe.text.indexOf(m[0]);
          push("raw-error-text", `"${probe.text.slice(Math.max(0, at - 60), at + 80).replace(/\s+/g, " ")}"`);
        }
      }
      for (const b of probe.broken) push("broken-image", b);
      if (probe.overflow > 1) push("overflow", `${probe.overflow}px wider than the screen: ${probe.wide.join(", ")}`);
      tag.landed = probe.path;
    }
  } catch (e) {
    push("navigation", e.message.split("\n")[0]);
  }
  await page.close();
  return local;
}

const browser = await chromium.launch();
const started = Date.now();
let visits = 0;
const roleNames = Object.keys(ROLES).filter((r) => !roleFilter || roleFilter.includes(r));
await Promise.all(
  roleNames.map(async (role) => {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 600 ? 844 : 900 },
        deviceScaleFactor: width < 600 ? 3 : 1,
        isMobile: width < 600,
        hasTouch: width < 600,
        locale: "en-US",
        serviceWorkers: "block",
      });
      if (ROLES[role]) await signInApi(ctx, ROLES[role]);
      // Wardrobe items are derived (orders + looks): ask the API as this role.
      let wardrobeItemId = null;
      if (ROLES[role]) {
        const w = await (await ctx.request.get(`${BASE}/api/wardrobe`)).json().catch(() => null);
        wardrobeItemId = w?.items?.[0]?.id ?? null;
      }
      for (const route of routes) {
        const url = fill(route.path, role, { wardrobeItemId });
        const got = await visit(ctx, role, width, route, url);
        visits++;
        for (const f of got) add(f);
        if (got.length) console.log(`  ✗ ${role}@${width} ${url}: ${got.map((g) => g.kind).join(", ")}`);
      }
      await ctx.close();
      console.log(`✓ ${role} @ ${width}px · ${routes.length} routes`);
    }
  }),
);
await browser.close();

// ── 4. report ───────────────────────────────────────────────────────────────────────────────────────────────────
const known = (f) => KNOWN.find(([r, d]) => r.test(f.route) && d.test(f.detail));
const norm = (s) => s.replace(/c[a-z0-9]{24}/g, ":id").replace(/\d{6,}/g, ":n").replace(/\?.*$/, "");
const groups = new Map();
for (const f of findings) {
  const k = `${f.route}|${f.kind}|${norm(f.detail)}`;
  const g = groups.get(k) ?? { route: f.route, kind: f.kind, detail: norm(f.detail), where: new Set(), known: known(f)?.[2] ?? null };
  g.where.add(`${f.role}@${f.width}`);
  groups.set(k, g);
}
const rows = [...groups.values()].sort((a, b) => a.route.localeCompare(b.route) || a.kind.localeCompare(b.kind));
const open = rows.filter((r) => !r.known);
writeFileSync(`${OUT}findings.json`, JSON.stringify({ base: BASE, routes: routes.length, visits, findings }, null, 1));
writeFileSync(
  `${OUT}findings.md`,
  [`| Route | Kind | Detail | Seen as | Status |`, `|---|---|---|---|---|`, ...rows.map((r) => `| \`${r.route}\` | ${r.kind} | ${r.detail.replace(/\|/g, "\\|")} | ${[...r.where].join(" ")} | ${r.known ? `intended: ${r.known}` : "OPEN"} |`)].join("\n") + "\n",
);
console.log(`\n${routes.length} routes × ${roleNames.length} roles × ${WIDTHS.length} widths = ${visits} visits in ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`${rows.length} distinct finding(s), ${open.length} open → ${OUT}findings.md`);
for (const r of open) console.log(` - ${r.route} · ${r.kind} · ${r.detail} [${[...r.where].join(" ")}]`);
if (open.length) process.exitCode = 1;
else console.log("\n✅ sweep clean: no console errors, failed requests, hydration warnings, raw error text, broken images or overflow");
