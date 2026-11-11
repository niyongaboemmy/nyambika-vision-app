// E22 Voice Muse GA · E29 Passkeys + optional checkout crawl (Pixel 7).
// OTP sign-in → passkey offer (virtual authenticator) → hold-to-speak with a fake microphone (WAV file)
// → editable transcript → Muse reply; keyboard hold parity → trust centre passkeys (rename) → sign out →
// passkey sign-in → bag across two makers (split explained) → two-item checkout from one maker → PIN on
// /dev/handset → order paid. Run with BASE_URL=http://localhost:3101.
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, start } from "./crawl-lib.mjs";

const out = new URL("./crawl-output/voice/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

// Fake microphone: 8 s of speech-like bursts (voiced 140–260 Hz with a 4 Hz syllable envelope).
const wavPath = `${out}fake-speech.wav`;
{
  const rate = 16000;
  const n = rate * 8;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 0.6;
    const f = 180 + 60 * Math.sin(2 * Math.PI * 0.7 * t);
    const v = env * (0.55 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * 2 * f * t) + 0.1 * Math.sin(2 * Math.PI * 3 * f * t));
    buf.writeInt16LE(Math.round(v * 20000), 44 + i * 2);
  }
  writeFileSync(wavPath, buf);
}

const { context, page, shot, finish, issues } = await start("voice", {
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wavPath}`],
});
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
await context.grantPermissions(["microphone"], { origin: BASE });
// The passkey offer is skipped for automated browsers unless a crawl opts in (lib/passkeys.ts).
await context.addInitScript(() => localStorage.setItem("nya_passkey_offer_force", "1"));
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const sttCalls = [];
page.on("response", async (r) => {
  if (r.url().endsWith("/api/voice/stt")) sttCalls.push({ status: r.status(), body: await r.json().catch(() => null) });
});

// ── OTP sign-in → "Sign in faster next time" ──────────────────────────────────
// The running "voice vs text Muse" pilot experiment (plan §8.1) puts ~half of fresh users in the text arm (no mic).
// Not a bug: pre-register fresh numbers over the API (outside the browser) until one lands in the voice arm.
async function voiceArmPhone() {
  for (let i = 0; i < 12; i++) {
    const p = `07885${String(Date.now() + i * 7).slice(-5)}`;
    const post = (path, data, cookie) => fetch(`${BASE}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
    const { devCode } = await (await post("/auth/otp/request", { phone: p })).json();
    const v = await post("/auth/otp/verify", { phone: p, code: devCode });
    const cookie = v.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const f = await (await fetch(`${BASE}/api/flags`, { headers: { cookie } })).json();
    if (f["muse.voice"]) return p;
    console.log(`ℹ ${p} is in the text arm of the muse.voice experiment, trying another number`);
  }
  throw new Error("no voice-arm shopper after 12 tries");
}
const phone = await voiceArmPhone();
await page.goto(`${BASE}/signin`);
await page.getByLabel(/phone/i).fill(phone);
await page.getByRole("button", { name: /send code/i }).click();
await page.locator("button.font-mono").click();
await page.getByRole("button", { name: /continue/i }).click();
await page.getByRole("heading", { name: /sign in faster next time/i }).waitFor();
await page.waitForTimeout(400);
await shot("passkey-offer");
await page.getByRole("button", { name: /create a passkey/i }).click();
await page.getByRole("heading", { name: /passkey saved/i }).waitFor();
await shot("passkey-saved");
await page.waitForURL((u) => u.pathname === "/", { timeout: 10000 });
const creds = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
assert(creds.credentials.length === 1 && creds.credentials[0].isResidentCredential, "virtual authenticator holds one discoverable Nyambika passkey");


// ── Hold to speak (fake microphone) ───────────────────────────────────────────
const mic =page.getByRole("button", { name: /hold to speak to the muse/i });
await mic.waitFor();
await page.waitForTimeout(600);
await shot("muse-voice-ga");
const box = await mic.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.up();
await page.getByText(/talk to the muse/i).waitFor();
await page.waitForTimeout(300);
await shot("voice-consent");
await page.getByRole("button", { name: /allow voice/i }).click();
await page.getByText(/voice is on/i).first().waitFor().catch(() => {});

await page.mouse.move(cx, cy);
await page.mouse.down();
await page.getByText(/listening/i).first().waitFor();
await page.waitForTimeout(1600);
await shot("hold-to-speak-waveform");
await page.waitForTimeout(1200);
await page.mouse.up();
const transcript = page.locator("textarea#transcript");
await transcript.waitFor({ timeout: 20000 });
await page.waitForTimeout(300);
await shot("transcript-review");
const stt = sttCalls.at(-1);
assert(stt?.status === 200 && stt.body?.duration_s > 1 && stt.body?.duration_s <= 30, `server STT answered (${stt?.body?.provider}, ${stt?.body?.duration_s}s, ${Math.round((stt?.body?.confidence ?? 0) * 100)}%)`);
assert((await transcript.inputValue()).length > 5, `transcript shown for editing: “${await transcript.inputValue()}”`);
await transcript.fill("I need a dress for a wedding on Saturday under 50,000");
await page.getByRole("button", { name: /^✨ send$/i }).click();
await page.getByText(/got it: something for a wedding/i).waitFor({ timeout: 15000 });
await page.waitForTimeout(300);
await shot("muse-understood-reply");
assert(await page.getByText(/under 50,000 francs/i).isVisible(), "short spoken-reply caption matches the edited transcript");

// Keyboard parity: hold Space on the focused mic.
await page.goto(BASE);
await mic.waitFor();
await mic.focus();
await page.keyboard.down("Space");
await page.getByText(/listening/i).first().waitFor();
await page.waitForTimeout(1500);
await page.keyboard.up("Space");
await transcript.waitFor({ timeout: 20000 });
assert(true, "keyboard hold (Space) records and returns an editable transcript");
await page.getByRole("button", { name: /speak again/i }).click();

// Reduced motion: no swell/spin; a flat level meter carries the input level instead.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.getByText(/listening/i).first().waitFor();
await page.waitForTimeout(1300);
await shot("listening-reduced-motion");
await page.mouse.up();
await transcript.waitFor({ timeout: 20000 });
await page.getByRole("button", { name: /speak again/i }).click();
await page.emulateMedia({ reducedMotion: "no-preference" });

// Voice options + mute.
await page.getByRole("button", { name: /voice options/i }).click();
await page.getByText(/speak the muse's replies/i).waitFor();
await page.waitForTimeout(300);
await shot("voice-options");
await page.keyboard.press("Escape");
const mute = page.getByRole("button", { name: /speak the muse.s replies/i }).first();
await mute.click();
assert((await mute.getAttribute("aria-pressed")) === "false", "mute toggle switches spoken replies off");
await mute.click();

// ── Trust centre: passkeys + voice privacy copy ───────────────────────────────
await page.goto(`${BASE}/trust`);
await page.getByText(/chrome on android/i).waitFor();
assert(await page.getByText(/audio is never stored/i).isVisible(), "trust centre states that voice audio is never stored");
await page.getByRole("button", { name: /rename chrome on android/i }).click();
await page.getByLabel(/passkey name/i).fill("My Pixel 7");
await page.getByRole("button", { name: /^rename$/i }).click();
await page.getByText("My Pixel 7").waitFor();
await page.getByText("My Pixel 7").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot("trust-passkeys");

// ── Sign out → sign in with the passkey (no OTP) ──────────────────────────────
await page.request.post(`${BASE}/api/auth/logout`);
await page.goto(`${BASE}/signin`);
await page.getByRole("button", { name: /sign in with a passkey/i }).waitFor();
await shot("signin-passkey-option");
await page.getByRole("button", { name: /sign in with a passkey/i }).click();
await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
const me = await (await page.request.get(`${BASE}/api/auth/me`)).json();
assert(me.user?.phone === `+250${phone.slice(1)}`, "passkey sign-in restored the same account without a code");
const keys = await (await page.request.get(`${BASE}/api/auth/passkeys`)).json();
assert(keys[0]?.lastUsedAt, "passkey last-used time recorded");

// ── Bag: two makers (split explained), then two items from one maker ─────────
const kkh = await (await page.request.get(`${BASE}/api/pages/by-handle/kigali-kitenge-house`)).json();
const imena = await (await page.request.get(`${BASE}/api/pages/by-handle/imena-styles`)).json();
const pick = (pg, n) => pg.products.filter((p) => !p.madeToOrder && p.readiness === "READY" && p.variants.some((v) => v.inStock)).slice(0, n);
const [shirt, skirt] = pick(kkh, 2);
const [wrap] = pick(imena, 1);
async function addToBag(product, label) {
  const v = product.variants.find((x) => x.inStock);
  await page.goto(`${BASE}/looks/try?variant=${v.id}`);
  const buy = page.getByRole("button", { name: /✋ buy/i });
  await buy.waitFor({ timeout: 30000 });
  await buy.click();
  await page.getByRole("button", { name: /add to bag/i }).click();
  await page.getByText(/added to your bag/i).waitFor();
  if (label) {
    await page.waitForTimeout(300);
    await shot(label);
  }
}
await addToBag(shirt, "buy-sheet-added-to-bag");
await addToBag(skirt);
await addToBag(wrap);
await page.goto(`${BASE}/bag`);
await page.getByText(/2 makers · 2 mobile money requests/i).waitFor();
await page.waitForTimeout(400);
await shot("bag-two-makers-split");
// Back to one maker: remove the Imena wrap, add a second shirt.
await page.getByRole("button", { name: new RegExp(`remove ${wrap.title}`, "i") }).click();
await page.getByText(/2 makers/i).waitFor({ state: "detached" });
const oneMore = page.getByRole("button", { name: new RegExp(`one more ${shirt.title}`, "i") });
if (await oneMore.isEnabled()) await oneMore.click();
else {
  // Repeated runs on a shared dev DB can leave the shirt with a single piece in stock (+ is disabled at stock):
  // add a third piece from the same maker instead, so the one-maker checkout still has 3 items.
  const [, , third] = pick(kkh, 3);
  await addToBag(third);
  await page.goto(`${BASE}/bag`);
}
await page.getByText(/3 items/).waitFor();
await page.waitForTimeout(300);
await shot("bag-one-maker-two-items");
await page.getByRole("button", { name: /checkout →/i }).click();
await page.getByLabel(/delivery address/i).fill("KG 7 Ave, Kacyiru");
await page.waitForTimeout(300);
await shot("checkout-sheet");
await page.getByRole("button", { name: /^pay rwf/i }).click();
await page.getByText(/approve on your phone/i).waitFor({ timeout: 15000 });
await page.waitForTimeout(300);
await shot("checkout-sent");
const orderLink = page.getByRole("link", { name: /kigali kitenge house/i });
const orderHref = await orderLink.getAttribute("href");

// ── /dev/handset: approve with PIN ────────────────────────────────────────────
const handset = await context.newPage();
handset.on("console", (m) => m.type() === "error" && issues.push(`handset console: ${m.text()}`));
await handset.goto(`${BASE}/dev/handset`);
await handset.getByText(/pay .*rwf .* to .*kigali kitenge house/i).waitFor({ timeout: 15000 });
await handset.getByLabel("PIN").fill("12345");
await handset.screenshot({ path: `${out}handset-pin.png` });
await handset.getByRole("button", { name: /approve/i }).click();
await handset.getByText(/no pending payment requests/i).waitFor({ timeout: 15000 });
await handset.close();

await page.goto(`${BASE}${orderHref}`);
await page.getByText(/paid/i).first().waitFor({ timeout: 20000 });
await page.waitForTimeout(600);
await shot("order-paid-two-items");
const orderId = orderHref.split("?")[0].split("/").pop();
const order = await (await page.request.get(`${BASE}/api/orders/${orderId}`)).json();
assert(order.status === "PAID" && [2, 3].includes(order.items.length) && order.items.reduce((n, i) => n + i.qty, 0) === 3, `bag order PAID with 3 pieces from one maker (${order.status}, ${order.items.length} lines)`);
assert(order.payment?.status === "SUCCESSFUL", "one Mobile Money payment, straight to the maker");
await page.goto(`${BASE}/trust`);
await page.getByText(/saved addresses/i).waitFor();
// The address list loads after the heading: wait for it instead of sampling once.
assert(await page.getByText(/KG 7 Ave, Kacyiru/).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "saved delivery address listed in the trust centre");

// Remove the passkey (OTP stays the fallback).
await page.getByRole("button", { name: /remove my pixel 7/i }).click();
await page.getByRole("dialog").getByRole("button", { name: /^remove$/i }).click();
await page.getByText(/no passkeys yet/i).waitFor();
assert(true, "passkey removed from the trust centre");

await finish();
