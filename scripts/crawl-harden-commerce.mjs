// Hardening pass 1 (commerce) crawl (Pixel 7).
// Sign-in country selector: Rwanda by default, Kenya preselected from the region cookie, Kenyan rules enforced
// on a national number. Kenyan shopper → Looks feed → a Nairobi piece shows KES (not RWF) → hold-to-buy sheet in
// KES with M-Pesa → held → simulated STK prompt → paid in KES to the maker's till.
// Needs `pnpm db:seed:region` (nairobi-kikoi-studio).
import { createRequire } from "node:module";
import { BASE, start } from "./crawl-lib.mjs";

const { devices } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@playwright/test");
const { browser, page: p, shot, finish, issues } = await start("harden-commerce");
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const api = async (path, body) => {
  const r = body ? await p.request.post(`${BASE}/api${path}`, { data: body }) : await p.request.get(`${BASE}/api${path}`);
  return r.json();
};
await p.addLocatorHandler(p.getByText("Did Nyambika help you decide?"), async () => {
  await p.getByRole("button", { name: "Not now" }).click();
});

// ── Default country: Rwanda in a fresh browser, Kenya once the region cookie says so ───────────
const fresh = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
const fp = await fresh.newPage();
await fp.goto(`${BASE}/signin`);
await fp.getByLabel("Your country").waitFor();
assert((await fp.getByLabel("Your country").inputValue()) === "RW", "fresh browser defaults to Rwanda (+250)");
await fresh.close();

await p.context().addCookies([{ name: "nya_cc", value: "KE", url: BASE }]);
await p.goto(`${BASE}/signin`);
const country = p.getByLabel("Your country");
await country.waitFor();
await p.waitForTimeout(300);
assert((await country.inputValue()) === "KE", "region cookie preselects Kenya (+254)");
const phone = p.getByLabel(/phone/i);
await phone.fill("0812 345 678");
await p.getByText(/Kenya numbers look like 0712 345 678/).waitFor();
assert(await p.getByRole("button", { name: /send code/i }).isDisabled(), "send code stays disabled for an invalid Kenyan number");
await shot("signin-ke-invalid");
const national = `07${String(Date.now()).slice(-8)}`;
await phone.fill(national.replace(/^(\d{4})(\d{3})/, "$1 $2 "));
await shot("signin-ke-valid");
await p.getByRole("button", { name: /send code/i }).click();
await p.locator("button.font-mono").click();
await p.getByRole("button", { name: /continue/i }).click();
await p.waitForURL((u) => !u.pathname.startsWith("/signin"));
const { user: me } = await api("/auth/me");
assert(me.phone === `+254${national.slice(1)}`, `Kenyan national number signed in as ${me.phone}`);

// ── Looks feed → KES hold-to-buy with M-Pesa ───────────────────────────────────────────────────
await api("/twin/persona", { persona: 2, consent: true });
// The shopper also picks USD as display currency: the KES price gets an "≈ USD" reference, the charge stays KES.
await p.request.put(`${BASE}/api/region/prefs`, { data: { displayCurrency: "USD" } });
await p.context().addCookies([{ name: "nya_cur", value: "USD", url: BASE }]);
const { sessionId } = await api("/intent", { text: "kitenge safari shirt" });
const feed = await api(`/intent/${sessionId}`);
const idx = feed.looks.findIndex((l) => l.maker.handle === "nairobi-kikoi-studio");
assert(idx >= 0, `the Looks feed includes a Nairobi piece (look ${idx + 1})`);
await p.goto(`${BASE}/looks/${sessionId}`);
const card = p.getByRole("region", { name: `Look ${idx + 1} of ${feed.looks.length}` });
await card.scrollIntoViewIfNeeded();
await card.getByText(/KES \d/).first().waitFor({ timeout: 20000 });
const rwfTexts = await card.getByText(/RWF \d/).allInnerTexts();
assert(rwfTexts.length === 0, `the Nairobi look shows KES, not an RWF figure ${rwfTexts.join(" | ")}`);
await p.waitForTimeout(600);
await shot("feed-kes-look");
await card.getByRole("button", { name: /^Buy$/ }).click();
const sheet = p.getByRole("dialog");
await sheet.getByText("You'll be charged").waitFor({ timeout: 15000 });
assert((await sheet.getByRole("button", { name: /M-Pesa/ }).count()) === 1, "buy sheet offers M-Pesa (Kenyan wallet)");
assert((await sheet.getByRole("button", { name: /MTN MoMo/ }).count()) === 0, "no Rwandan MoMo chip for a Kenyan page");
assert((await sheet.getByLabel(/M-Pesa number/).inputValue()) === me.phone, "M-Pesa number prefilled from the Kenyan sign-in");
await sheet.getByRole("button", { name: /Pickup in/ }).click();
await p.waitForTimeout(300);
const charged = await sheet.locator("p.font-display.text-3xl").innerText();
assert(/^KES \d/.test(charged), `charged in the maker's currency: ${charged}`);
assert((await sheet.getByText(/≈ USD/).count()) > 0, "≈ USD display price shown as reference only");
await shot("buy-sheet-kes-mpesa");
const hold = sheet.getByRole("button", { name: /hold to buy: KES/i });
await hold.scrollIntoViewIfNeeded();
const box = await hold.boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.mouse.down();
await p.waitForTimeout(1500);
await p.mouse.up();
await p.waitForURL(/\/orders\/.+fresh=1/, { timeout: 20000 });
const orderId = new URL(p.url()).pathname.split("/").pop();
const money = await api(`/region/orders/${orderId}/money`);
assert(money.currency === "KES" && money.method === "MPESA", `order charged ${money.total} via ${money.methodLabel}`);
assert(money.payment?.ref?.startsWith("MPESA"), "M-Pesa (mock) push to the maker's till");
await p.getByRole("group", { name: "Simulated phone prompt" }).waitFor({ timeout: 15000 });
await shot("stk-prompt");
await p.getByLabel(/M-Pesa PIN/).fill("1234");
await p.getByRole("button", { name: "Approve" }).click();
await p.getByText(/Paid KES .* via M-Pesa/).first().waitFor({ timeout: 20000 });
await p.waitForTimeout(400);
await shot("order-paid-kes");

await finish();
