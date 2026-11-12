// E38 crawl: web push at the right moment (mocked PushManager), service worker, ambient order card,
// notification preferences, device-token API, sign-out revocation and the .well-known app-link files.
// BASE_URL=http://localhost:3101 node scripts/crawl-native.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { BASE, signIn, start } from "./crawl-lib.mjs";

/** Runs apps/web/public/sw.js in a VM and dispatches one push event; returns the showNotification call. */
async function runSwPush(payload) {
  const handlers = {};
  let shown = null;
  const self = {
    location: new URL(BASE),
    addEventListener: (t, fn) => (handlers[t] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { showNotification: async (title, options) => (shown = { title, options }) },
  };
  vm.runInNewContext(readFileSync(new URL("../apps/web/public/sw.js", import.meta.url), "utf8"), { self, caches: {}, URL, console, fetch: () => {} });
  let wait;
  handlers.push({ data: { json: () => payload, text: () => JSON.stringify(payload) }, waitUntil: (p) => (wait = p) });
  await wait;
  return shown;
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ✓ ${msg}`);
};
const phone = `0789${String(Date.now()).slice(-6)}`;
const { browser, context, page, shot, finish, issues } = await start("native");

// A mocked PushManager (headless Chromium has no push service) that records every permission ask.
await context.addInitScript(() => {
  // Permission and subscription survive navigations like the real ones do.
  window.__permAsks = 0;
  let perm = localStorage.getItem("__mockPerm") ?? "default";
  Object.defineProperty(Notification, "permission", { configurable: true, get: () => perm });
  Notification.requestPermission = async () => {
    window.__permAsks += 1;
    perm = "granted";
    localStorage.setItem("__mockPerm", perm);
    return perm;
  };
  const b64 = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let sub = null;
  const saved = localStorage.getItem("__mockSub");
  const make = (opts) => {
    const endpoint = `https://push.example.test/send/${b64(12)}`;
    const keys = { p256dh: b64(65), auth: b64(16) };
    window.__subscribeOpts = { userVisibleOnly: opts?.userVisibleOnly, keyBytes: opts?.applicationServerKey?.byteLength ?? 0 };
    localStorage.setItem("__mockSub", JSON.stringify({ endpoint, keys }));
    return wrap({ endpoint, keys });
  };
  function wrap(j) {
    return { endpoint: j.endpoint, toJSON: () => j, unsubscribe: async () => ((sub = null), localStorage.removeItem("__mockSub"), true) };
  }
  if (saved) sub = wrap(JSON.parse(saved));
  const pm = { getSubscription: async () => sub, subscribe: async (o) => (sub = make(o)), permissionState: async () => perm };
  Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { configurable: true, get: () => pm });
});

try {
  // ── 1. Never ask on load ────────────────────────────────────────────────
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}/m/umurage-wear`);
  await page.waitForLoadState("networkidle");
  assert((await page.evaluate(() => window.__permAsks)) === 0, "no notification permission prompt on page load");
  assert((await page.locator('[data-testid="push-ask"]').count()) === 0, "no push ask on the Maker Space");

  // ── 2. .well-known files for universal links / App Links ─────────────────
  const aasa = await page.request.get(`${BASE}/.well-known/apple-app-site-association`);
  assert(aasa.status() === 200 && aasa.headers()["content-type"].startsWith("application/json"), "apple-app-site-association served as JSON (no redirect)");
  const a = await aasa.json();
  const comps = a.applinks.details[0].components.map((c) => c["/"]);
  assert(["/m/*", "/looks/*", "/confirm/*", "/c/*"].every((p) => comps.includes(p)), "AASA covers /m, /looks, /confirm, /c");
  assert(a.applinks.details[0].appIDs[0].endsWith(".rw.nyambika.app") && a.webcredentials.apps.length === 1, "AASA app id + passkey webcredentials");
  const al = await (await page.request.get(`${BASE}/.well-known/assetlinks.json`)).json();
  assert(al[0].target.package_name === "rw.nyambika.app" && al[0].relation.includes("delegate_permission/common.handle_all_urls"), "assetlinks.json for rw.nyambika.app");

  // ── 3. Hold to buy → the meaningful moment: "Tell me when it's paid" ─────
  await signIn(page, phone);
  const products = await (await page.request.get(`${BASE}/api/v1/public/products?limit=20`)).json();
  const product = products.data.find((p) => p.maker.handle === "umurage-wear") ?? products.data[0];
  const variant = product.variants[0];
  const order = await page.evaluate(
    async ({ variantId, size, phone }) => {
      const r = await fetch("/api/orders", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "idempotency-key": `crawl-native-${Date.now()}` },
        body: JSON.stringify({ variantId, size, delivery: "DELIVERY", address: "KG 7 Ave, Kacyiru", wallet: "MTN_MOMO", payerPhone: `+250${phone.slice(1)}` }),
      });
      return r.json();
    },
    { variantId: variant.id, size: variant.sizes[0], phone },
  );
  assert(order.status === "AWAITING_PAYMENT", `order ${order.code} waiting for the PIN`);
  await page.goto(`${BASE}/orders/${order.id}`);
  const ask = page.locator('[data-testid="push-ask"]');
  await ask.waitFor();
  assert(await ask.getByText("Tell me when it's paid").isVisible(), "push ask appears while waiting for the MoMo PIN");
  assert((await page.evaluate(() => window.__permAsks)) === 0, "still no prompt until the shopper taps");
  await page.waitForTimeout(700); // let the rise-in animation settle
  await shot("order-push-ask");

  await ask.getByRole("button", { name: "Notify me" }).click();
  await page.locator('[data-testid="push-on"]').waitFor();
  await context.grantPermissions(["notifications"], { origin: BASE });
  assert((await page.evaluate(() => window.__permAsks)) === 1, "exactly one permission prompt, from the tap");
  const opts = await page.evaluate(() => window.__subscribeOpts);
  assert(opts.userVisibleOnly === true && opts.keyBytes === 65, "subscribed with userVisibleOnly and the 65-byte VAPID key");
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.active?.scriptURL ?? null);
  assert(sw?.endsWith("/sw.js"), "service worker registered and active");
  await page.waitForTimeout(700);
  await shot("order-push-on");
  let status = await (await page.request.get(`${BASE}/api/push`)).json();
  assert(status.devices.length === 1 && status.devices[0].platform === "WEB", "device-token API stored one Web Push subscription");

  // ── 4. Payment lands → ambient card mirrors the push state model ─────────
  const host = await browser.newContext();
  const hp = await host.newPage();
  await signIn(hp, "0788900001");
  // The simulated handset approves the PIN.
  await hp.goto(`${BASE}/dev/handset`);
  const approve = hp.getByRole("button", { name: /approve|pay|emeza/i }).first();
  if (await approve.isVisible({ timeout: 4000 }).catch(() => false)) await approve.click();
  await page.waitForFunction(async (id) => (await (await fetch(`/api/orders/${id}`)).json()).status === "PAID", order.id, { timeout: 20000, polling: 1000 });
  await page.goto(`${BASE}/orders/${order.id}?fresh=1`);
  const card = page.locator('[data-testid="ambient-order"]');
  await card.waitFor();
  assert(await card.getByText(`Paid directly to ${product.maker.name}`).isVisible(), "ambient card headline = live-activity headline");
  await shot("order-paid-ambient");
  const outbox = await (await hp.request.get(`${BASE}/api/admin/notifications`)).json();
  const paidPush = outbox.find((n) => n.channel === "PUSH" && n.template === "order.paid" && n.refId === order.id);
  assert(paidPush && JSON.parse(paidPush.body).state.stepIndex === 0, "order.paid push in the outbox with the ContentState");

  // ── 5. Maker moves it along → silent updates, "on the way" alert ─────────
  const maker = await browser.newContext();
  const mp = await maker.newPage();
  await signIn(mp, "0788100001");
  for (const to of ["ACCEPTED", "IN_PREPARATION", "SHIPPED"]) {
    const r = await mp.request.post(`${BASE}/api/orders/${order.id}/transition`, { data: { to } });
    assert(r.ok(), `maker moved the order to ${to}`);
  }
  await page.goto(`${BASE}/orders/${order.id}`);
  await card.waitFor();
  assert(await card.getByText("is on the way").isVisible(), "ambient card shows On the way");
  assert((await card.getByRole("progressbar").getAttribute("aria-valuenow")) === "80", "progress 80% at step 3 of 4");
  await shot("order-on-the-way");
  const out2 = await (await hp.request.get(`${BASE}/api/admin/notifications`)).json();
  const ours = out2.filter((n) => n.channel === "PUSH" && n.refId === order.id).map((n) => n.template);
  assert(ours.includes("order.shipped") && ours.includes("order.progress"), "progress (silent) and shipped (alert) pushes fanned out");

  // The service worker's push handler (headless Chromium refuses showNotification even with the
  // permission granted, so the handler from public/sw.js runs in a Node VM with a fake registration).
  const shown = await runSwPush({ title: "Your dress is on the way", body: "NY · on the way", url: `/orders/${order.id}`, tag: `order-${order.id}`, renotify: true, silent: false, steps: ["Paid", "Making", "On the way", "Delivery"], stepIndex: 2 });
  assert(shown.title === "Your dress is on the way" && shown.options.tag === `order-${order.id}` && shown.options.renotify === true, "sw.js shows the push as a tagged, re-alerting notification");
  assert(shown.options.body.includes("● On the way") && shown.options.body.includes("○ Delivery") && shown.options.data.url === `/orders/${order.id}`, "sw.js renders the 4-step ticker and keeps the deep link");
  const quiet = await runSwPush({ title: "Accepted", body: "", tag: "order-x", renotify: false, silent: true });
  assert(quiet.options.silent === true && quiet.options.renotify === false, "silent steps replace the notification without re-alerting");

  // ── 6. Trust centre: preferences, devices, test ──────────────────────────
  await page.goto(`${BASE}/trust`);
  const prefs = page.locator('[data-testid="notification-prefs"]');
  await prefs.waitFor();
  await prefs.getByText("· this device").waitFor();
  assert((await prefs.getByRole("button", { name: "Turn on for this device" }).count()) === 0, "trust centre knows this device is already on");
  await prefs.scrollIntoViewIfNeeded();
  await shot("trust-notifications");
  await prefs.getByRole("switch", { name: /Looks ready/ }).click({ force: true });
  await page.waitForTimeout(400);
  status = await (await page.request.get(`${BASE}/api/push`)).json();
  assert(status.prefs.looks === false && status.prefs.orders === true, "turning off 'Looks ready' saved");
  await prefs.getByRole("button", { name: "Send me a test" }).click();
  await prefs.getByText("✓ 1").waitFor();
  assert(true, "test notification reached this device");
  await shot("trust-notifications-test");

  // ── 7. Sign out revokes this device ──────────────────────────────────────
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForTimeout(800);
  const left = await (await hp.request.get(`${BASE}/api/admin/notifications`)).json();
  void left;
  await signIn(page, phone);
  status = await (await page.request.get(`${BASE}/api/push`)).json();
  assert(status.devices.length === 0, "sign-out revoked the Web Push subscription");
  await page.goto(`${BASE}/trust`);
  await page.locator('[data-testid="notification-prefs"]').scrollIntoViewIfNeeded();
  await shot("trust-after-signout");

  await host.close();
  await maker.close();
} catch (e) {
  issues.push(String(e.stack ?? e));
  await shot("failure").catch(() => {});
}
await finish();
