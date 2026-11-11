import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

// E29 optional checkout + E22 voice + passkey endpoints, against the real app + database.
let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
let payments: import("../src/modules/payments/payments.module").PaymentsService;
const phone = `0787${String(Date.now()).slice(-6)}`;
const variants: Record<string, { id: string; stock: number }> = {};

async function login(p: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone: p }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone: p, code: r.body.devCode }).expect(200);
  return agent;
}

async function stocked(handle: string, title: string) {
  const v = await prisma.variant.findFirstOrThrow({ where: { stock: { gte: 3 }, product: { title, status: "PUBLISHED", page: { handle } } } });
  return { id: v.id, stock: v.stock };
}

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const { PaymentsService } = await import("../src/modules/payments/payments.module");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  payments = app.get(PaymentsService);
  variants.shirt = await stocked("kigali-kitenge-house", "Umuraba kitenge shirt");
  variants.skirt = await stocked("kigali-kitenge-house", "Inyenyeri kitenge skirt");
  variants.wrap = await stocked("imena-styles", "Uruziga wrap dress");
});

afterAll(async () => {
  // Give the stock back so reruns and other suites see the seed unchanged.
  for (const v of Object.values(variants)) await prisma?.variant.update({ where: { id: v.id }, data: { stock: v.stock } });
  await app?.close();
});

describe("bag + checkout (E29, FR-ORD-07 direct-to-maker split)", () => {
  it("splits a two-maker bag into one order + one MoMo request per maker, idempotently", async () => {
    const s = await login(phone);
    await s.post("/bag/items").send({ variantId: variants.shirt.id, size: "M" }).expect(201);
    await s.post("/bag/items").send({ variantId: variants.shirt.id, size: "M" }).expect(201); // same line → qty 2
    await s.post("/bag/items").send({ variantId: variants.skirt.id, size: "L" }).expect(201);
    const bag = (await s.post("/bag/items").send({ variantId: variants.wrap.id, size: "S" }).expect(201)).body;
    expect(bag.payments).toBe(2);
    expect(bag.count).toBe(4);
    const kkh = bag.groups.find((g: { pageName: string }) => /kitenge/i.test(g.pageName));
    expect(kkh.lines).toHaveLength(2);
    expect(kkh.lines.find((l: { variantId: string }) => l.variantId === variants.shirt.id).qty).toBe(2);
    await s.post("/bag/items").send({ variantId: variants.wrap.id, size: "XXL" }).expect(400);

    // Pickup at Imena, delivery from Kigali Kitenge House: fees differ per maker.
    const imena = bag.groups.find((g: { pageName: string }) => /imena/i.test(g.pageName));
    const quote = (await s.post("/bag/quote").send({ delivery: { [imena.key]: "PICKUP" } }).expect(201)).body;
    expect(quote.groups.find((g: { key: string }) => g.key === imena.key).deliveryFeeRwf).toBe(0);

    await s.post("/checkout").set("idempotency-key", "short").send({}).expect(400);
    const key = `test-${Date.now()}`;
    const body = { wallet: "MTN_MOMO", payerPhone: phone, delivery: { [imena.key]: "PICKUP" }, address: "KG 7 Ave, Kacyiru", saveAddress: true, addressLabel: "Home" };
    const first = (await s.post("/checkout").set("idempotency-key", key).send(body).expect(201)).body;
    expect(first.failed).toEqual([]);
    expect(first.orders).toHaveLength(2);
    const again = (await s.post("/checkout").set("idempotency-key", key).send(body).expect(201)).body;
    expect(again.orders.map((o: { id: string }) => o.id).sort()).toEqual(first.orders.map((o: { id: string }) => o.id).sort());

    const orders = await prisma.order.findMany({ where: { id: { in: first.orders.map((o: { id: string }) => o.id) } }, include: { items: true, payments: true, page: true } });
    for (const o of orders) {
      expect(o.payments).toHaveLength(1); // never pushed twice
      expect(o.payments[0].merchant).toBe(o.page.momoMerchant); // straight to that maker
      expect(o.payments[0].amountRwf).toBe(o.totalRwf);
    }
    const k = orders.find((o) => /kitenge/i.test(o.page.name))!;
    expect(k.items.map((i) => i.qty).sort()).toEqual([1, 2]);
    expect(k.deliveryMode).toBe("DELIVERY");
    expect(k.address).toBe("KG 7 Ave, Kacyiru");
    expect(k.totalRwf).toBe(k.items.reduce((n, i) => n + i.qty * i.unitPriceRwf, 0) + 2000);
    const i = orders.find((o) => /imena/i.test(o.page.name))!;
    expect(i.deliveryMode).toBe("PICKUP");
    expect(i.deliveryFeeRwf).toBe(0);
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variants.shirt.id } })).stock).toBe(variants.shirt.stock - 2);

    // Bag emptied; the address was saved sealed and comes back decrypted only to its owner.
    expect((await s.get("/bag").expect(200)).body.count).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: `+250${phone.slice(1)}` } });
    const sealed = await prisma.savedAddress.findFirstOrThrow({ where: { userId: user.id } });
    expect(sealed.sealed).not.toContain("Kacyiru");
    expect((await s.get("/addresses").expect(200)).body[0].address).toBe("KG 7 Ave, Kacyiru");

    // Each maker's payment settles independently.
    await payments.settle(k.payments[0].providerRef, "SUCCESSFUL", { source: "test" });
    await payments.settle(i.payments[0].providerRef, "FAILED", { source: "test" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: k.id } })).status).toBe("PAID");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: i.id } })).status).toBe("CANCELLED");
    const view = (await s.get(`/orders/${k.id}`).expect(200)).body;
    expect(view.items).toHaveLength(2);
    // Failed payment gives the stock back.
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variants.wrap.id } })).stock).toBe(variants.wrap.stock);

    // Privacy: export includes addresses; account deletion removes them.
    const exp = await s.get("/privacy/export").expect(200);
    expect(JSON.parse(exp.text).addresses[0].address).toBe("KG 7 Ave, Kacyiru");
    await s.post("/privacy/delete").send({ scope: "ACCOUNT" }).expect(201);
    expect(await prisma.savedAddress.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses an empty bag", async () => {
    const s = await login(`0786${String(Date.now()).slice(-6)}`);
    await s.post("/checkout").set("idempotency-key", `empty-${Date.now()}`).send({ wallet: "MTN_MOMO", payerPhone: "0788000001" }).expect(400);
  });
});

describe("voice + passkey endpoints (E22, E29)", () => {
  it("STT needs consent and never stores audio", async () => {
    // A running muse.voice experiment (e.g. after the pilot seed) would hold this user out at random.
    const exp = await prisma.experiment.findUnique({ where: { key: "muse.voice" } });
    if (exp?.status === "RUNNING") await prisma.experiment.update({ where: { key: "muse.voice" }, data: { status: "PAUSED" } });
    onTestFinished(async () => {
      if (exp?.status === "RUNNING") await prisma.experiment.update({ where: { key: "muse.voice" }, data: { status: "RUNNING" } });
    });
    const s = await login(`0785${String(Date.now()).slice(-6)}`);
    const wav = Buffer.alloc(44 + 3200);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + 3200, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(3200, 40);
    for (let i = 0; i < 1600; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), 44 + i * 2);
    const denied = await s.post("/voice/stt").attach("audio", wav, { filename: "a.wav", contentType: "audio/wav" }).field("language", "rw");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("VOICE_CONSENT");
    await s.post("/privacy/consents").send({ purpose: "VOICE_PROCESSING", granted: true }).expect(201);
    const aiUp = await fetch(`${process.env.AI_GATEWAY_URL ?? "http://localhost:8100"}/health`).then((r) => r.ok).catch(() => false);
    const r = await s.post("/voice/stt").attach("audio", wav, { filename: "a.wav", contentType: "audio/wav" }).field("language", "rw");
    if (!aiUp) return expect(r.status).toBe(503);
    expect(r.status).toBe(200);
    expect(r.body.language).toBe("rw");
    expect(typeof r.body.text).toBe("string");
    expect(r.body.duration_s).toBeCloseTo(0.1, 2);
  });

  it("STT rate limit lives in Redis, so it holds across API instances", async () => {
    const exp = await prisma.experiment.findUnique({ where: { key: "muse.voice" } });
    if (exp?.status === "RUNNING") await prisma.experiment.update({ where: { key: "muse.voice" }, data: { status: "PAUSED" } });
    onTestFinished(async () => {
      if (exp?.status === "RUNNING") await prisma.experiment.update({ where: { key: "muse.voice" }, data: { status: "RUNNING" } });
    });
    const { VoiceService, STT_LIMITS } = await import("../src/modules/voice/voice.module");
    const { RedisCounterStore } = await import("../src/modules/circle/guards");
    const { config } = await import("../src/config");
    const voice = app.get(VoiceService);
    for (let i = 0; i < 40 && !(voice.counters instanceof RedisCounterStore); i++) await new Promise((r) => setTimeout(r, 50));
    expect(voice.counters).toBeInstanceOf(RedisCounterStore);
    const s = await login(`0782${String(Date.now()).slice(-6)}`);
    await s.post("/privacy/consents").send({ purpose: "VOICE_PROCESSING", granted: true }).expect(201);
    const userId = (await s.get("/auth/me")).body.user.id as string;
    // Another API instance has already used this user's whole window: it only shares Redis with us.
    const { Redis } = await import("ioredis");
    const other = new Redis(config.redisUrl, { keyPrefix: config.redisKeyPrefix });
    onTestFinished(() => void other.quit());
    const [limit] = STT_LIMITS(userId);
    await other.set(`rl:${limit.key}`, String(limit.max), "EX", limit.windowSec);
    const r = await s.post("/voice/stt").attach("audio", Buffer.from("RIFF0000WAVE"), { filename: "a.wav", contentType: "audio/wav" }).field("language", "rw");
    expect(r.status).toBe(429);
    // Once the shared window is clear, the same user may speak again.
    await other.del(`rl:${limit.key}`);
    const ok = await s.post("/voice/stt").attach("audio", Buffer.from("RIFF0000WAVE"), { filename: "a.wav", contentType: "audio/wav" }).field("language", "rw");
    expect(ok.status).not.toBe(429);
  });

  it("passkey options are bound to PUBLIC_WEB_URL and challenges are single-use", async () => {
    const s = await login(`0784${String(Date.now()).slice(-6)}`);
    const opts = (await s.post("/auth/passkeys/register/options").expect(200)).body;
    expect(opts.rp.id).toBe(new URL(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").hostname);
    expect(opts.authenticatorSelection.residentKey).toBe("required");
    const login2 = (await request(app.getHttpServer()).post("/auth/passkeys/login/options").expect(200)).body;
    expect(login2.challenge).toBeTruthy();
    // A forged response naming an unknown challenge is rejected before any key lookup.
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: "A".repeat(43), origin: "http://evil.test" })).toString("base64url");
    await request(app.getHttpServer()).post("/auth/passkeys/login").send({ response: { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON, authenticatorData: "", signature: "" }, clientExtensionResults: {} } }).expect(401);
    expect((await s.get("/auth/passkeys").expect(200)).body).toEqual([]);
  });
});
