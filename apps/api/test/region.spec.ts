import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { json, type Request } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";
delete process.env.STRIPE_SECRET_KEY; // always the offline mock here

// E40/E41 against the real app + database (needs `pnpm db:seed:region`).
let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
let sign: (b: string) => string;
let signStripe: (payload: string, secret: string) => string;
let whsec: () => string;
const kePhone = `+2547${String(Date.now()).slice(-8)}`;
let variant: { id: string; stock: number };

async function login(p: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone: p }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone: p, code: r.body.devCode }).expect(200);
  return agent;
}

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  ({ sign } = await import("../src/modules/payments/providers"));
  const stripe = await import("../src/modules/region/stripe");
  signStripe = stripe.signStripePayload;
  whsec = stripe.stripeWebhookSecret;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication({ bodyParser: false });
  app.use("/stripe/webhook", json({ verify: (req, _res, buf) => void ((req as Request & { rawBody?: Buffer }).rawBody = buf) }));
  app.use(json());
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  const v = await prisma.variant.findFirstOrThrow({ where: { product: { status: "PUBLISHED", page: { handle: "nairobi-kikoi-studio" } }, stock: { gte: 3 } } });
  variant = { id: v.id, stock: v.stock };
});

afterAll(async () => {
  if (variant) await prisma?.variant.update({ where: { id: variant.id }, data: { stock: variant.stock } });
  await app?.close();
});

describe("Kenyan page in KES with M-Pesa (E41)", () => {
  it("prices in KES, ranks KE first for a Kenyan shopper and hides it from RW shoppers without opt-in", async () => {
    const c = (await request(app.getHttpServer()).get("/region/pages/by-handle/nairobi-kikoi-studio/commerce").expect(200)).body;
    expect(c.currency).toBe("KES");
    expect(c.wallets).toEqual(["MPESA"]);
    expect(Object.values(c.prices).every((p) => Number.isInteger(p))).toBe(true);
    const ke = (await request(app.getHttpServer()).get("/region/directory?country=KE&xb=0").expect(200)).body;
    expect(ke.map((p: { handle: string }) => p.handle)).toEqual(["nairobi-kikoi-studio"]);
    const rw = (await request(app.getHttpServer()).get("/region/directory?country=RW&xb=0").expect(200)).body;
    expect(rw.some((p: { region: string }) => p.region !== "RW")).toBe(false);
    const rwx = (await request(app.getHttpServer()).get("/region/directory?country=RW&xb=1").expect(200)).body;
    expect(rwx.at(-1).handle).toBe("nairobi-kikoi-studio");
    expect(rwx.at(-1).crossBorderListing).toBe(true);
  });

  it("rejects a Rwandan number for M-Pesa, then charges KES via the signed wallet webhook", async () => {
    const s = await login(kePhone);
    const prefs = (await s.get("/region/prefs").expect(200)).body;
    expect(prefs).toMatchObject({ country: "KE", displayCurrency: "KES" });
    await s.put("/region/prefs").send({ displayCurrency: "USD" }).expect(200);
    const body = { variantId: variant.id, size: "M", method: "MPESA", payerPhone: "+250788123456", delivery: "DELIVERY", address: "Moi Avenue, Nairobi", displayCurrency: "USD" };
    const bad = await s.post("/region/checkout").set("idempotency-key", randomUUID()).send(body).expect(400);
    expect(bad.body.code).toBe("PHONE_INVALID");
    const key = randomUUID();
    const r = (await s.post("/region/checkout").set("idempotency-key", key).send({ ...body, payerPhone: kePhone.replace("+254", "0") }).expect(201)).body;
    expect(r.money.currency).toBe("KES");
    expect(r.money.method).toBe("MPESA");
    const c = (await request(app.getHttpServer()).get("/region/pages/by-handle/nairobi-kikoi-studio/commerce")).body;
    const price = c.prices[(await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } })).productId];
    expect(r.money.totalMinor).toBe(price + c.domesticDeliveryMinor);
    expect(r.money.display.currency).toBe("USD"); // ≈ snapshot only
    expect(r.money.display.text).toMatch(/^≈ USD /);
    const pay = await prisma.regionPayment.findFirstOrThrow({ where: { orderId: r.orderId } });
    expect(pay).toMatchObject({ currency: "KES", amountMinor: r.money.totalMinor, merchant: "5123456", payerPhone: kePhone }); // charged in KES to the maker's till
    // idempotent retry
    expect((await s.post("/region/checkout").set("idempotency-key", key).send(body).expect(201)).body.orderId).toBe(r.orderId);
    // unsigned webhook is refused; signed one settles
    const hook = JSON.stringify({ referenceId: pay.providerRef, status: "SUCCESSFUL" });
    await request(app.getHttpServer()).post("/region/webhook/wallet-mock").set("content-type", "application/json").set("x-signature", "00").send(hook).expect(401);
    await request(app.getHttpServer()).post("/region/webhook/wallet-mock").set("content-type", "application/json").set("x-signature", sign(hook)).send(hook).expect(200);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { events: true } });
    expect(o.status).toBe("PAID");
    expect(o.events.at(-1)?.note).toMatch(/Paid KES .* directly to Nairobi Kikoi Studio via M-Pesa/);
  });
});

describe("international card checkout via Stripe Connect (mock, E40)", () => {
  it("creates a direct charge on the maker's account; webhook signature + account routing decide settlement", async () => {
    const s = await login(`+2547${String(Date.now() + 7).slice(-8)}`);
    const r = (await s.post("/region/checkout").set("idempotency-key", randomUUID()).send({ variantId: variant.id, size: "M", method: "CARD", delivery: "SHIP", shipCountry: "DE", address: "Torstraße 1, Berlin", displayCurrency: "EUR" }).expect(201)).body;
    expect(r.stripe.account).toBe("acct_mock_ke0001");
    expect(r.stripe.mode).toBe("mock");
    expect(r.money.currency).toBe("KES"); // charged in KES; EUR is display only
    const zone = await prisma.shippingZone.findFirstOrThrow({ where: { name: "Europe & UK", countries: { has: "DE" }, currency: "KES" } });
    expect(r.money.deliveryMinor).toBe(zone.feeMinor);
    const pay = await prisma.regionPayment.findFirstOrThrow({ where: { orderId: r.orderId } });
    const evt = (id: string, account: string) =>
      JSON.stringify({ id, type: "payment_intent.succeeded", account, data: { object: { id: pay.providerRef, object: "payment_intent", amount: pay.amountMinor, currency: "kes" } } });

    const wrong = evt(`evt_${randomUUID()}`, "acct_attacker");
    await request(app.getHttpServer()).post("/stripe/webhook").set("content-type", "application/json").set("stripe-signature", signStripe(wrong, "whsec_wrong")).send(wrong).expect(400);
    const routed = (await request(app.getHttpServer()).post("/stripe/webhook").set("content-type", "application/json").set("stripe-signature", signStripe(wrong, whsec())).send(wrong).expect(200)).body;
    expect(routed.ignored).toBe("account mismatch");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).status).toBe("AWAITING_PAYMENT");

    const good = evt(`evt_${randomUUID()}`, "acct_mock_ke0001");
    await request(app.getHttpServer()).post("/stripe/webhook").set("content-type", "application/json").set("stripe-signature", signStripe(good, whsec())).send(good).expect(200);
    const dup = (await request(app.getHttpServer()).post("/stripe/webhook").set("content-type", "application/json").set("stripe-signature", signStripe(good, whsec())).send(good).expect(200)).body;
    expect(dup.duplicate).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).status).toBe("PAID");

    // Maker refunds part, then the rest; never more than was paid.
    const owner = await login("+254711000001");
    const half = (await owner.post(`/region/orders/${r.orderId}/refund`).send({ amount: "1000" }).expect(201)).body;
    expect(half.refundedMinor).toBe(100_000);
    await owner.post(`/region/orders/${r.orderId}/refund`).send({ amount: "999999" }).expect(400);
    await owner.post(`/region/orders/${r.orderId}/refund`).send({}).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).status).toBe("CANCELLED");
    await s.post(`/region/orders/${r.orderId}/refund`).send({}).expect(403); // shoppers can't refund
  });
});

describe("product passport versioning (FR-DPP)", () => {
  it("publishes immutable versions, keeps history and resets claim verification on claim edits", async () => {
    const owner = await login("+254711000001");
    const product = await prisma.product.findFirstOrThrow({ where: { page: { handle: "nairobi-kikoi-studio" }, status: "PUBLISHED" }, orderBy: { createdAt: "desc" } });
    await prisma.productPassportVersion.deleteMany({ where: { productId: product.id } });
    await prisma.productPassport.deleteMany({ where: { productId: product.id } });
    const draft = (await owner.get(`/passports/${product.id}/draft`).expect(200)).body;
    expect(draft.version).toBe(0);
    expect(draft.data.origin.country).toBe("KE");
    await owner.post(`/passports/${product.id}`).send({ data: { ...draft.data, materials: [{ fibre: "Cotton", percent: 80 }] } }).expect(400);
    const v1 = (await owner.post(`/passports/${product.id}`).send({ data: draft.data, note: "first" }).expect(201)).body;
    expect(v1.version).toBe(1);
    await owner.post(`/passports/${product.id}`).send({ data: draft.data }).expect(400); // nothing changed
    const host = await login("0788900001");
    await host.post(`/passports/${product.id}/verify`).send({ verified: true }).expect(201);
    await owner.post(`/passports/${product.id}/verify`).send({ verified: true }).expect(403);
    const v2 = (await owner.post(`/passports/${product.id}`).send({ data: { ...draft.data, claims: { madeIn: "Made in Kenya", impactStory: "Women-led workshop." } }, note: "claims" }).expect(201)).body;
    expect(v2.version).toBe(2);
    expect(v2.claimsVerified).toBe(false);
    const pub = (await request(app.getHttpServer()).get(`/passports/${product.id}`).expect(200)).body;
    expect(pub.version).toBe(2);
    expect(pub.versions.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect(pub.jsonLd["@type"]).toBe("Product");
    const old = (await request(app.getHttpServer()).get(`/passports/${product.id}?v=1`).expect(200)).body;
    expect(old.data.claims.madeIn).toBe(draft.data.claims.madeIn);
    await request(app.getHttpServer()).get(`/passports/${product.id}?v=9`).expect(404);
  });
});
