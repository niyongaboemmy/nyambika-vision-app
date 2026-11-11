import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MemoryCounterStore } from "../circle/guards";
import { extractKey, generateKey, hasScopes, hashKey, KEY_PATTERN, keyState, quotaDecision, verifyKey } from "./keys";
import { itemsHash, signMandate, verifyMandate } from "./mandate";
import { admit, statementCsv, type ContractTerms } from "./metering";
import { sandboxWatermark, webhookUrlAllowed } from "./partner.service";
import { signWebhook, verifyWebhook } from "./webhook";

describe("API keys (FR-AGT-08)", () => {
  it("generates high-entropy keys and stores only a peppered hash", () => {
    const a = generateKey("LIVE");
    const b = generateKey("SANDBOX");
    expect(a.secret).toMatch(KEY_PATTERN);
    expect(a.secret.startsWith("nya_live_")).toBe(true);
    expect(b.secret.startsWith("nya_test_")).toBe(true);
    expect(a.prefix).toBe(a.secret.slice(0, 16));
    expect(a.secret).not.toBe(generateKey("LIVE").secret);
    const h = hashKey(a.secret, "pepper");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(a.secret.slice(9));
    expect(hashKey(a.secret, "other-pepper")).not.toBe(h);
    expect(verifyKey(a.secret, h, "pepper")).toBe(true);
    expect(verifyKey(b.secret, h, "pepper")).toBe(false);
  });

  it("reads keys from Bearer or X-Api-Key, ignoring session JWTs and junk", () => {
    const { secret } = generateKey("LIVE");
    expect(extractKey({ authorization: `Bearer ${secret}` })).toBe(secret);
    expect(extractKey({ "x-api-key": secret })).toBe(secret);
    expect(extractKey({ authorization: "Bearer eyJhbGciOi.jwt.token" })).toBeNull();
    expect(extractKey({ "x-api-key": "nya_live_short" })).toBeNull();
  });

  it("enforces scopes, revocation, expiry and client suspension", () => {
    expect(hasScopes(["catalogue:read", "mcp:use"], ["mcp:use"])).toBe(true);
    expect(hasScopes(["catalogue:read"], ["checkout:write"])).toBe(false);
    expect(hasScopes(["catalogue:read"], [])).toBe(true);
    const now = new Date("2026-11-11T10:00:00Z");
    expect(keyState({ revokedAt: null, expiresAt: null }, "ACTIVE", now)).toBe("OK");
    expect(keyState({ revokedAt: now, expiresAt: null }, "ACTIVE", now)).toBe("REVOKED");
    expect(keyState({ revokedAt: null, expiresAt: new Date("2026-11-11T09:59:59Z") }, "ACTIVE", now)).toBe("EXPIRED");
    expect(keyState({ revokedAt: null, expiresAt: null }, "SUSPENDED", now)).toBe("CLIENT_SUSPENDED");
  });

  it("allows exactly the monthly quota, then refuses", async () => {
    const store = new MemoryCounterStore();
    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(quotaDecision(await store.incr("agq:k1:202611", 3600), 3));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions[2].remaining).toBe(0);
    expect(quotaDecision(1_000_000, null).allowed).toBe(true);
  });

  it("rate-limit windows reset after a minute", async () => {
    let t = 0;
    const store = new MemoryCounterStore(() => t);
    for (let i = 0; i < 5; i++) await store.incr("ag:key:1", 60);
    expect(await store.incr("ag:key:1", 60)).toBe(6);
    t += 61_000;
    expect(await store.incr("ag:key:1", 60)).toBe(1);
  });
});

describe("user mandate (FR-AGT-04)", () => {
  const secret = "test-secret";
  const items = [{ variantId: "v1", size: "M", qty: 1, unitPriceRwf: 25000 }];
  const base = { sid: "s1", n: "nonce1", pageId: "p1", totalRwf: 25000, ih: itemsHash(items) };

  it("verifies a fresh, untampered token", () => {
    const token = signMandate({ ...base, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
    const r = verifyMandate(token, secret);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ sid: "s1", totalRwf: 25000 });
  });

  it("rejects expired, tampered, foreign-key and malformed tokens", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signMandate({ ...base, exp }, secret);
    expect(verifyMandate(token, secret, (exp + 1) * 1000)).toEqual({ ok: false, reason: "EXPIRED" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, ...base, totalRwf: 1, exp })).toString("base64url");
    expect(verifyMandate(`${forged}.${sig}`, secret)).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyMandate(token, "another-secret")).toEqual({ ok: false, reason: "BAD_SIGNATURE" });
    expect(verifyMandate(body, secret)).toEqual({ ok: false, reason: "MALFORMED" });
    expect(verifyMandate(`${token}.x`, secret)).toEqual({ ok: false, reason: "MALFORMED" });
  });

  it("binds the exact cart: any change to items, sizes, qty or price changes the hash", () => {
    const h = itemsHash(items);
    expect(itemsHash([{ ...items[0] }])).toBe(h);
    expect(itemsHash([{ ...items[0], size: "L" }])).not.toBe(h);
    expect(itemsHash([{ ...items[0], qty: 2 }])).not.toBe(h);
    expect(itemsHash([{ ...items[0], unitPriceRwf: 24000 }])).not.toBe(h);
    const two = [items[0], { variantId: "v2", size: "S", qty: 1, unitPriceRwf: 9000 }];
    expect(itemsHash(two)).toBe(itemsHash([...two].reverse()));
  });
});

describe("partner metering (E37)", () => {
  const c: ContractTerms = { status: "ACTIVE", monthlyQuota: 2, monthlyFeeRwf: 60000, overagePriceRwf: 150, hardCap: false, sandboxDailyCap: 3, startsAt: new Date("2026-01-01"), endsAt: null };

  it("bills included looks, then overage, or stops at a hard cap", () => {
    expect(admit(c, false, 0, 0)).toEqual({ allowed: true, sandbox: false, overage: false, priceRwf: 0 });
    expect(admit(c, false, 2, 0)).toEqual({ allowed: true, sandbox: false, overage: true, priceRwf: 150 });
    expect(admit({ ...c, hardCap: true }, false, 2, 0)).toMatchObject({ allowed: false, code: "QUOTA_EXCEEDED" });
  });

  it("refuses live calls without an active contract; sandbox works on drafts but has a daily cap", () => {
    expect(admit(null, false, 0, 0)).toMatchObject({ allowed: false, code: "NO_CONTRACT" });
    expect(admit({ ...c, status: "DRAFT" }, false, 0, 0)).toMatchObject({ allowed: false, code: "CONTRACT_INACTIVE" });
    expect(admit({ ...c, endsAt: new Date("2026-02-01") }, false, 0, 0, new Date("2026-03-01"))).toMatchObject({ allowed: false });
    expect(admit({ ...c, status: "DRAFT" }, true, 99, 0)).toEqual({ allowed: true, sandbox: true, overage: false, priceRwf: 0 });
    expect(admit(c, true, 0, 3)).toMatchObject({ allowed: false, code: "SANDBOX_DAILY_CAP" });
    expect(admit({ ...c, status: "SUSPENDED" }, true, 0, 0)).toMatchObject({ allowed: false, code: "CONTRACT_INACTIVE" });
  });

  it("statement CSV totals fee + overage and never bills sandbox or withheld jobs", () => {
    const at = new Date("2026-11-02T08:00:00Z");
    const row = (id: string, o: Partial<{ billable: boolean; overage: boolean; priceRwf: number; sandbox: boolean; status: string }>) => ({ id, createdAt: at, clientReference: `ref-${id}`, modelId: "nya-model-1", status: "DELIVERED", billable: true, overage: false, priceRwf: 0, sandbox: false, ...o });
    const s = statementCsv("Demo", "2026-11", c, [row("a", {}), row("b", {}), row("c", { overage: true, priceRwf: 150 }), row("d", { status: "WITHHELD", billable: false }), row("e", { sandbox: true, billable: false })]);
    expect(s.totals).toEqual({ fee: 60000, included: 2, overage: 1, overageRwf: 150, total: 60150 });
    expect(s.csv.split("\n")[0]).toBe("job_id,created_at,client_reference,model_id,status,environment,billable,band,price_rwf");
    expect(s.csv).toContain('"e","2026-11-02T08:00:00.000Z","ref-e","nya-model-1","DELIVERED","sandbox","no","","0"');
    expect(s.csv).toContain('"total_due_rwf",60150');
  });
});

describe("partner webhooks (E37)", () => {
  it("signs with HMAC-SHA-256 over t.body and verifies within the tolerance", () => {
    const body = JSON.stringify({ type: "tryon.finished", data: { id: "ptj_1" } });
    const t = 1_800_000_000;
    const header = signWebhook(body, "whsec_x", t);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook(body, header, "whsec_x", t + 10)).toBe(true);
    expect(verifyWebhook(body + " ", header, "whsec_x", t + 10)).toBe(false);
    expect(verifyWebhook(body, header, "whsec_other", t + 10)).toBe(false);
    expect(verifyWebhook(body, header, "whsec_x", t + 301)).toBe(false);
    expect(verifyWebhook(body, "v1=abc", "whsec_x", t)).toBe(false);
  });

  it("only allows public https webhook targets in production", () => {
    expect(webhookUrlAllowed("https://partner.example.com/hooks", true)).toBe(true);
    expect(webhookUrlAllowed("http://partner.example.com/hooks", true)).toBe(false);
    expect(webhookUrlAllowed("https://127.0.0.1/x", true)).toBe(false);
    expect(webhookUrlAllowed("https://10.0.0.4/x", true)).toBe(false);
    expect(webhookUrlAllowed("https://localhost/x", true)).toBe(false);
    expect(webhookUrlAllowed("http://localhost:9999/x", false)).toBe(true);
    expect(webhookUrlAllowed("ftp://x", false)).toBe(false);
  });

  it("sandbox results carry a visible watermark (pixels change)", async () => {
    const img = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#204060" } }).png().toBuffer();
    const out = await sandboxWatermark(img);
    const a = await sharp(img).raw().toBuffer();
    const b = await sharp(out).removeAlpha().raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
    expect(changed / a.length).toBeGreaterThan(0.05);
  });
});
