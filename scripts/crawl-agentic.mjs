// E36 Agentic commerce · E37 Try-on as a Service crawl (Pixel 7).
// Host creates an agent key in Admin → Agents & partners → an AI agent (official MCP SDK client) searches and
// creates a checkout → the shopper opens the mandate link, signs in, holds to confirm → PIN on /dev/handset →
// paid → link can't be reused → host runs a partner sandbox try-on → maker's AI-assistant opt-in in studio.
// Run with BASE_URL=http://localhost:3101 API_URL=http://localhost:4101.
import { createRequire } from "node:module";
import { API_BASE, BASE, signIn, start } from "./crawl-lib.mjs";

const API = API_BASE;
const req = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Client } = req("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = req("@modelcontextprotocol/sdk/client/streamableHttp.js");

const { context, page, shot, finish, issues } = await start("agentic");
const assert = (cond, msg) => {
  if (!cond) {
    issues.push(`assert: ${msg}`);
    console.log(`❌ ${msg}`);
  } else console.log(`✔ ${msg}`);
};
const stamp = String(Date.now()).slice(-5);

// ── Host: Agents & partners → new agent client + key (secret shown once) ─────────────────
await signIn(page, "0788900001");
await page.goto(`${BASE}/admin`);
await page.getByRole("button", { name: "Agents & partners" }).first().click();
await page.waitForURL(/\/admin\/agents/);
await page.getByRole("heading", { name: "Calls per day" }).waitFor();
await page.waitForTimeout(500);
await shot("admin-agents-overview");
await page.getByRole("button", { name: /new client/i }).click();
await page.getByLabel("Name").fill(`Crawl Assistant ${stamp}`);
await page.getByRole("button", { name: /create client/i }).click();
const card = page.locator(".st-card", { hasText: `Crawl Assistant ${stamp}` });
await card.waitFor();
await card.getByRole("button", { name: /new key/i }).click();
await page.getByRole("heading", { name: /new key/i }).waitFor();
await page.waitForTimeout(300);
await shot("admin-new-key-sheet");
await page.getByRole("button", { name: /create key/i }).click();
const secretEl = page.getByTestId("new-secret");
await secretEl.waitFor();
const secret = (await secretEl.textContent()).trim();
assert(/^nya_live_[0-9A-Za-z]{32}$/.test(secret), "key secret shown once in the admin");
await shot("admin-key-secret-once");
await page.getByRole("button", { name: /i saved it/i }).click();
await page.request.post(`${BASE}/api/auth/logout`);

// ── The AI agent: MCP over Streamable HTTP ───────────────────────────────────────────────
const mcp = new Client({ name: "crawl-agent", version: "1.0.0" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${API}/mcp`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }));
const tools = (await mcp.listTools()).tools.map((t) => t.name);
assert(tools.length === 5 && tools.includes("create_checkout_intent"), `MCP tools: ${tools.join(", ")}`);
const text = (r) => JSON.parse(r.content[0].text);
const found = text(await mcp.callTool({ name: "search_products", arguments: { query: "kitenge shirt under 30000", limit: 6 } }));
const pick = found.results.find((r) => !r.made_to_order && r.maker.handle === "kigali-kitenge-house" && r.variants.some((v) => v.availability === "in_stock" || v.availability === "low_stock")) ?? found.results.find((r) => r.variants.some((v) => v.availability !== "out_of_stock"));
assert(pick, `search_products found ${found.results.length} results (picked ${pick?.title} by ${pick?.maker.name})`);
const v = pick.variants.find((x) => x.availability !== "out_of_stock");
const avail = text(await mcp.callTool({ name: "check_availability", arguments: { id: v.id, size: v.sizes[0] } }));
assert(avail.variants[0].orderable, "check_availability: orderable");
const session = text(await mcp.callTool({ name: "create_checkout_intent", arguments: { items: [{ variant_id: v.id, size: v.sizes[0], quantity: 1 }], external_reference: `crawl-${stamp}` } }));
assert(session.status === "not_ready_for_payment" && session.mandate.confirmation_url, "checkout intent awaits the shopper's confirmation");
await mcp.close();
const link = session.mandate.confirmation_url.replace(/^https?:\/\/[^/]+/, BASE);

// ── Shopper: open the mandate link → sign in → hold to confirm ───────────────────────────
await page.goto(link);
await page.getByRole("heading", { name: /confirm your order/i }).waitFor();
await page.waitForTimeout(500);
await shot("mandate-signed-out");
assert(await page.getByText(/nothing is ordered or paid/i).isVisible(), "mandate says nothing is ordered until the shopper confirms");
const phone = `07887${stamp}`;
await signIn(page, phone);
await page.goto(link);
await page.getByRole("button", { name: /hold to confirm/i }).waitFor();
await page.waitForTimeout(400);
await shot("mandate-ready-to-hold");
const hold = page.getByRole("button", { name: /hold to confirm/i });
await hold.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const box = await hold.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(700);
await shot("mandate-holding");
await page.waitForURL(/\/orders\//, { timeout: 15000 });
await page.mouse.up();
await page.getByText(/approve|PIN/i).first().waitFor();
await page.waitForTimeout(400);
await shot("order-awaiting-momo");

const handset = await context.newPage();
await handset.goto(`${BASE}/dev/handset`);
await handset.getByLabel("PIN").waitFor({ timeout: 15000 }).catch(() => {});
if (await handset.getByLabel("PIN").isVisible()) {
  await handset.getByLabel("PIN").fill("12345");
  await handset.waitForTimeout(200);
  await handset.screenshot({ path: new URL(`./crawl-output/agentic/06b-handset.png`, import.meta.url).pathname });
  await handset.getByRole("button", { name: /approve/i }).click();
}
await handset.close();
await page.getByText(/paid directly/i).first().waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
await shot("order-paid-direct-to-maker");

await page.goto(link);
await page.getByText(/already used/i).waitFor();
await shot("mandate-already-used");
const r = await fetch(`${API}/v1/agent/checkout_sessions/${session.id}`, { headers: { authorization: `Bearer ${secret}` } });
const final = await r.json();
assert(final.status === "completed" && final.nyambika_status === "paid", `agent sees the session as ${final.status}/${final.nyambika_status}`);
assert(!JSON.stringify(final).includes(phone.slice(1)), "agent never sees the shopper's phone");
await page.request.post(`${BASE}/api/auth/logout`);

// ── Host: partner sandbox try-on + conversions ──────────────────────────────────────────
await signIn(page, "0788900001");
await page.goto(`${BASE}/admin/agents`);
const partner = page.locator(".st-card", { hasText: "Sandbox Partner" }).first();
await partner.waitFor();
await partner.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot("admin-partner-contract");
await partner.getByRole("button", { name: /sandbox try-on/i }).click();
await page.getByRole("heading", { name: /sandbox try-on/i }).waitFor();
await page.getByRole("button", { name: /run sandbox try-on/i }).click();
await page.getByRole("img", { name: /sandbox try-on result/i }).waitFor({ timeout: 60000 });
await page.getByRole("img", { name: /sandbox try-on result/i }).scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await shot("admin-sandbox-result");
await page.keyboard.press("Escape");
await page.reload();
await page.getByText(/mandate conversions/i).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot("admin-conversions");
await page.getByRole("heading", { name: /partner try-on jobs/i }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot("admin-partner-jobs");
await page.request.post(`${BASE}/api/auth/logout`);

// ── Maker: opt in/out of AI assistants (FR-AGT-05) ──────────────────────────────────────
await signIn(page, "0788100003");
const kkh = await (await page.request.get(`${BASE}/api/pages/by-handle/kigali-kitenge-house`)).json();
await page.goto(`${BASE}/studio/${kkh.id}/settings`);
const ai = page.getByRole("heading", { name: /ai assistants & marketplaces/i });
await ai.waitFor();
await ai.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot("studio-agent-channels");

await finish();
