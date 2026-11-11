// E42 self-hosted inference + E39 video try-on crawl (Pixel 7). Needs the gateway with INFERENCE_ROUTING=1,
// VTON_PROVIDER=routed and INFERENCE_POOL_URL pointing at the fake pool (apps/ai/app/fake_pool.py).
// Host: Inference panel → pool healthy → fail the fake pool → traffic falls back to hosted → pool down → recovers.
// Host: activating an unevaluated video provider is refused → NLB eval passes → activation accepted.
// Shopper: "See it on video" on the twin (turnaround) and from a short synthetic clip (consent, clip deleted).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BASE, signIn, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");
const OUT = new URL("./crawl-output/infer/", import.meta.url).pathname;
const { browser, page: host, shot, finish, issues } = await start("infer");
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const get = async (p, path) => (await p.request.get(`${BASE}/api${path}`)).json();
const post = async (p, path, data) => (await p.request.post(`${BASE}/api${path}`, { data })).json();
const route = async (name) => (await get(host, "/admin/inference")).routes.find((r) => r.route === name);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Host: Inference panel ────────────────────────────────────────────────────
await signIn(host, "0788900001");
await host.goto(`${BASE}/admin?tab=${encodeURIComponent("Flags & models")}`);
const panel = host.locator("section", { has: host.getByRole("heading", { name: "Inference", exact: true }) });
await panel.waitFor({ timeout: 20000 });
const chaos = (label) => panel.getByRole("group", { name: "Fake pool failure mode" }).getByRole("button", { name: label, exact: true });
const tryonCard = panel.locator('[data-route="tryon"]');
const send = async () => {
  await panel.getByRole("group", { name: "Route for test traffic" }).getByRole("button", { name: "Photo try-on" }).click();
  await panel.getByRole("button", { name: /send 10 calls/i }).click();
  await panel.getByText(/^10 calls:/).waitFor({ timeout: 60000 });
  return (await panel.getByText(/^10 calls:/).textContent()) ?? "";
};

await chaos("Healthy").click();
await panel.getByText(/Fake pool set to healthy/).waitFor();
let msg = await send();
assert(/pool 10, hosted 0/.test(msg), `healthy pool serves all try-on calls (${msg})`);
await tryonCard.scrollIntoViewIfNeeded();
await host.waitForTimeout(3200);
await shot("inference-pool-healthy");
await tryonCard.screenshot({ path: `${OUT}01b-tryon-card-healthy.png` });

// Shorter cool-down through the policy editor (also exercises the editor + versioned push).
await tryonCard.getByRole("button", { name: /edit photo try-on policy/i }).click();
const editor = host.getByRole("dialog", { name: /photo try-on routing/i });
await editor.waitFor();
await editor.getByLabel("Cool-down (s)").fill("4");
await host.waitForTimeout(300);
await shot("policy-editor");
await editor.getByRole("button", { name: /save and push/i }).click();
await panel.getByText(/Policy v\d+ saved and pushed/).waitFor();
const status = await (await host.request.get(`${BASE}/api/admin/inference`)).json();
assert(status.breaker.cooldown_s === 4, "policy pushed to the gateway (breaker cool-down 4 s)");

await chaos("Fail").click();
await panel.getByText(/Fake pool set to failing/).waitFor();
msg = await send();
const failing = await route("tryon");
assert(/hosted 10/.test(msg) && failing.backends.hosted.served_as_fallback >= 3, `failing pool → calls fall back to hosted (${msg})`);
assert(failing.backends.pool.breaker.state === "OPEN", `breaker OPEN after repeated pool failures (${failing.backends.pool.breaker.state})`);
await host.waitForTimeout(3200);
await tryonCard.scrollIntoViewIfNeeded();
await shot("inference-pool-failing-fallback");

await chaos("Down").click();
await panel.getByText(/Fake pool set to down/).waitFor();
await host.waitForTimeout(3500);
assert((await route("tryon")).health.status === "DOWN", "health check marks the pool DOWN");
await tryonCard.scrollIntoViewIfNeeded();
await shot("inference-pool-down");

await chaos("Healthy").click();
await panel.getByText(/Fake pool set to healthy/).waitFor();
await wait(4500); // cool-down → half-open trial
msg = await send();
const recovered = await route("tryon");
assert(/pool 10/.test(msg) && recovered.backends.pool.breaker.state === "CLOSED", `pool recovers: half-open trial closes the breaker (${msg})`);
await host.waitForTimeout(3200);
await tryonCard.scrollIntoViewIfNeeded();
await shot("inference-pool-recovered");
const metrics = await (await host.request.get(`${BASE}/api/metrics`)).text();
assert(/nyambika_ai_inference_cost_rwf_total\{route="tryon",backend="pool"\}/.test(metrics), "per-route inference cost exported to Prometheus");

// ── Host: NLB gate on the video provider ─────────────────────────────────────
// Re-runnable: start with every video provider retired.
for (const m of await get(host, "/admin/video/models")) {
  if (m.status === "ACTIVE") await host.request.patch(`${BASE}/api/admin/models/${encodeURIComponent(m.id)}`, { data: { status: "RETIRED" } });
}
await host.reload();
await panel.waitFor({ timeout: 20000 });
const expected409 = () => {
  // The refused PATCH is the expected outcome; the browser logs the 409 as a console error.
  for (let i = issues.length - 1; i >= 0; i--) if (/status of 409/.test(issues[i])) issues.splice(i, 1);
};
const slot = panel.locator('[data-model="hosted-video@unconfigured"]');
await slot.scrollIntoViewIfNeeded();
await slot.getByRole("button", { name: "Activate" }).click();
await slot.getByText(/Activation refused: (No NLB evaluation on record|The last NLB eval of hosted-video@unconfigured did not pass)/).waitFor();
expected409();
await host.waitForTimeout(300);
await slot.screenshot({ path: `${OUT}06-video-activation-refused-unevaluated.png` });
await slot.getByRole("button", { name: /run nlb eval/i }).click();
await slot.getByText(/NLB video eval did not pass for hosted-video@unconfigured/).waitFor({ timeout: 60000 });
await slot.getByRole("button", { name: "Activate" }).click();
await slot.getByText(/Activation refused: The last NLB eval of hosted-video@unconfigured did not pass \(provider 'hosted-rest' is not configured\)/).waitFor();
expected409();
await host.waitForTimeout(300);
await slot.scrollIntoViewIfNeeded();
await shot("video-activation-refused-failed-eval");
const audit = await get(host, "/admin/audit");
assert(audit.some((a) => a.action === "admin.model_activation_refused" && a.data?.id === "hosted-video@unconfigured"), "refused activation is audited");
assert((await get(host, "/video/available")).available === false, "no video for shoppers while no provider passed");

const card = panel.locator('[data-model="motion-compose@1.0"]');
await card.scrollIntoViewIfNeeded();
await card.getByRole("button", { name: /run nlb eval/i }).click();
await card.getByText(/NLB video eval passed for motion-compose@1.0/).waitFor({ timeout: 180000 });
await card.getByText(/15\/15 subgroups/).waitFor();
await card.scrollIntoViewIfNeeded();
await shot("video-eval-passed");
await card.getByRole("button", { name: "Activate" }).click();
await card.getByText(/motion-compose@1.0 activated for shoppers/).waitFor();
await card.scrollIntoViewIfNeeded();
await host.waitForTimeout(300);
await shot("video-provider-active");
assert((await get(host, "/video/available")).available === true, "video available once a provider passed the NLB and is active");

// ── Shopper: See it on video ────────────────────────────────────────────────
const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && issues.push(`shopper console: ${m.text()}`));
page.on("pageerror", (e) => issues.push(`shopper pageerror: ${e.message}`));
page.on("response", (r) => r.status() >= 500 && issues.push(`shopper HTTP ${r.status()} ${r.url()}`));
let n = 0;
const sshot = async (label) => {
  n += 1;
  await page.screenshot({ path: `${OUT}s${String(n).padStart(2, "0")}-${label}.png` });
  console.log(`📸 ${label}`);
};
await signIn(page, `07884${String(Date.now()).slice(-5)}`);
await post(page, "/twin/persona", { persona: 4, consent: true });
const uwase = await get(page, "/pages/by-handle/uwase-couture");
const withVariants = uwase.products.filter((p) => p.variants?.length);
const [first, second] = withVariants;

await page.goto(`${BASE}/looks/try?variant=${first.variants[0].id}`);
await page.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 40000 });
const rail = page.getByRole("button", { name: "See it on video" });
await rail.waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
await sshot("look-rail-video");
await rail.click();
const sheet = page.getByRole("dialog");
await sheet.getByText(/premium video/i).waitFor();
await page.waitForTimeout(300);
await sshot("video-sheet-twin");
await sheet.getByRole("button", { name: /see it on video/i }).click();
await page.getByRole("button", { name: /video \d+% ready/i }).waitFor({ timeout: 10000 }).catch(() => undefined);
await sshot("video-progress");
const media = page.locator('video[aria-label*="AI video try-on"], img[alt*="AI video try-on"]').first();
await media.waitFor({ timeout: 90000 });
await page.waitForTimeout(1500);
await sshot("video-playing-twin");
await page.getByRole("button", { name: "About this video" }).click();
await page.waitForTimeout(300);
await sshot("video-about");
const src = await media.getAttribute("src");
const r = await page.request.get(`${BASE}${src}`, { headers: { range: "bytes=0-99" } });
assert(r.status() === 206, `video served privately with range support (${r.status()})`);
const tampered = await page.request.get(`${BASE}${src.replace(/sig=[0-9a-f]{4}/, "sig=0000")}`);
assert(tampered.status() === 403, "tampered video link is refused");
const anon = await browser.newContext();
const leak = await anon.request.get(`${BASE}/api/video/jobs/x`);
assert(leak.status() === 401, `video jobs need sign-in (${leak.status()})`);
await anon.close();

// Clip source: a synthetic 3 s webm of persona 4 swaying (never a real person), consent, clip deleted after.
const clip = `${OUT}synthetic-clip.webm`;
const persona = new URL("../apps/api/storage/personas/persona-4.png", import.meta.url).pathname;
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", persona, "-t", "3", "-r", "12",
  "-vf", "scale=-2:540,crop=300:540:'(iw-300)/2+10*sin(2*PI*t/1.5)':0", "-c:v", "libvpx", "-b:v", "800k", "-pix_fmt", "yuv420p", clip]);
await page.goto(`${BASE}/looks/try?variant=${second.variants[0].id}`);
await page.locator('img[alt*="AI preview"]').first().waitFor({ timeout: 40000 });
await page.getByRole("button", { name: "See it on video" }).click();
await sheet.getByText(/premium video/i).waitFor();
await sheet.getByText("My short clip").click();
await sheet.getByLabel("Choose or record a short clip").setInputFiles({ name: "me.webm", mimeType: "video/webm", buffer: readFileSync(clip) });
await sheet.getByAltText("A frame from your clip").waitFor({ timeout: 20000 });
const startBtn = sheet.getByRole("button", { name: /see it on video/i });
assert(await startBtn.isDisabled(), "clip upload needs consent first");
await sheet.getByRole("checkbox").check();
await page.waitForTimeout(300);
await sshot("video-sheet-clip-consent");
const started = page.waitForResponse((res) => res.url().includes("/api/video/looks/") && res.request().method() === "POST");
await startBtn.click();
const job = await (await started).json();
await page.locator('video[aria-label*="AI video try-on"], img[alt*="AI video try-on"]').first().waitFor({ timeout: 90000 });
await page.waitForTimeout(1500);
await sshot("video-playing-clip");
const done = await get(page, `/video/jobs/${job.id}`);
assert(done.status === "DELIVERED" && done.source === "CLIP" && done.clipDeleted === true, `clip video delivered and the clip deleted (${done.status}, deleted=${done.clipDeleted})`);
assert(done.c2pa?.signed === true && done.guard?.sampledFrames >= 6, "C2PA signed, sampled frames guarded");
await ctx.close();

await finish();
