import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PushMessage } from "@nyambika/contracts";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PushProvider, PushResult, PushTarget } from "../src/common/push/providers";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

// Hardening pass 1 (commerce): discount release, phone countries at sign-in, coop accept push, wardrobe copy.
// The Kenyan cases need `pnpm db:seed:region` (nairobi-kikoi-studio).
let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
let payments: import("../src/modules/payments/payments.module").PaymentsService;
let region: import("../src/modules/region/region.service").RegionService;
let push: import("../src/common/push/push.service").PushService;
const uniq = String(Date.now()).slice(-6);

class Recorder implements PushProvider {
  readonly name = "recorder";
  sent: { target: PushTarget; msg: PushMessage }[] = [];
  async send(target: PushTarget, msg: PushMessage): Promise<PushResult> {
    this.sent.push({ target, msg });
    return { ok: true };
  }
}
const rec = new Recorder();

async function login(phone: string, country?: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone, country }).expect(200);
  const v = await agent.post("/auth/otp/verify").send({ phone, country, code: r.body.devCode }).expect(200);
  return { agent, userId: v.body.user.id as string, phone: r.body.phone as string };
}
const webSub = (n: string) => ({ installationId: `web_hc_${uniq}_${n}`, platform: "WEB", transport: "WEBPUSH", token: `https://push.example.test/send/hc-${uniq}-${n}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const { PaymentsService } = await import("../src/modules/payments/payments.module");
  const { RegionService } = await import("../src/modules/region/region.service");
  const { PushService } = await import("../src/common/push/push.service");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  payments = app.get(PaymentsService);
  region = app.get(RegionService);
  push = app.get(PushService);
  push.providers = { fcm: rec, apns: rec, webpush: rec, mode: "dev" };
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  rec.sent = [];
});

/** Fresh published RW page with one made-to-order product and a single-use code. */
async function codePage(tag: string) {
  const { agent: owner } = await login(`0783${tag}${uniq.slice(-5)}`);
  const page = await owner.post("/pages").send({ handle: `hc-${tag}-${uniq}`, name: `Harden ${tag}`, memberType: "TAILOR", momoMerchant: "0788555000" }).expect(201);
  await prisma.page.update({ where: { id: page.body.id }, data: { status: "PUBLISHED" } });
  const p = await owner
    .post(`/pages/${page.body.id}/products`)
    .send({ title: "Gisozi wrap dress", category: "dress", priceRwf: 36000, madeToOrder: true, variants: [{ colourName: "Indigo", colourHex: "#2B4EA2", sizes: ["M"], stock: 0 }] })
    .expect(201);
  await prisma.product.update({ where: { id: p.body.id }, data: { status: "PUBLISHED" } });
  const code = `HC${tag}${uniq}`;
  await owner.post(`/pages/${page.body.id}/discounts`).send({ code, kind: "PERCENT", value: 10, maxUses: 1 }).expect(201);
  return { owner, pageId: page.body.id as string, variantId: p.body.variants[0].id as string, code };
}

function holdWithCode(shopper: request.Agent, phone: string, variantId: string, code: string) {
  return shopper
    .post("/orders")
    .set("idempotency-key", randomUUID())
    .send({ variantId, size: "M", delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: phone, discountCode: code });
}

const uses = async (pageId: string, code: string) => (await prisma.discountCode.findFirstOrThrow({ where: { pageId, code } })).uses;

describe("discount use is released when a hold-to-buy doesn't go through (E30)", () => {
  it("declined MoMo payment restores per-code and per-shopper counts exactly once", async () => {
    const { pageId, variantId, code } = await codePage("1");
    const s = await login(`0784${uniq.slice(-5)}1`);
    const o = (await holdWithCode(s.agent, s.phone, variantId, code).expect(201)).body;
    expect(o.totalRwf).toBe(32400);
    expect(await uses(pageId, code)).toBe(1);
    // A second shopper can't use the single-use code while it is held.
    const other = await login(`0784${uniq.slice(-5)}2`);
    expect((await holdWithCode(other.agent, other.phone, variantId, code).expect(400)).body.code).toMatch(/^DISCOUNT_/);

    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } });
    await payments.settle(pay.providerRef, "FAILED", { source: "test" });
    await payments.settle(pay.providerRef, "FAILED", { source: "test-retry" }); // duplicate webhook
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("CANCELLED");
    expect(await uses(pageId, code)).toBe(0);
    expect(await prisma.discountRedemption.count({ where: { orderId: o.id } })).toBe(0);
    const { DiscountService } = await import("../src/modules/growth/discounts");
    expect(await app.get(DiscountService).release(o.id)).toBe(false); // already released: no double decrement
    expect(await uses(pageId, code)).toBe(0);

    // The same shopper may use it again, and the code is available again.
    const again = (await holdWithCode(s.agent, s.phone, variantId, code).expect(201)).body;
    expect(again.totalRwf).toBe(32400);
    expect(await uses(pageId, code)).toBe(1);
  });

  it("reconciliation timeout releases the use", async () => {
    const { pageId, variantId, code } = await codePage("2");
    const s = await login(`0784${uniq.slice(-5)}3`);
    const o = (await holdWithCode(s.agent, s.phone, variantId, code).expect(201)).body;
    await prisma.payment.updateMany({ where: { orderId: o.id }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    await payments.reconcile();
    expect((await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } })).status).toBe("FAILED");
    expect(await uses(pageId, code)).toBe(0);
    expect(await prisma.discountRedemption.count({ where: { orderId: o.id } })).toBe(0);
  });

  it("maker cancelling before payment releases the use", async () => {
    const { owner, pageId, variantId, code } = await codePage("3");
    const s = await login(`0784${uniq.slice(-5)}4`);
    const o = (await holdWithCode(s.agent, s.phone, variantId, code).expect(201)).body;
    await owner.post(`/orders/${o.id}/transition`).send({ to: "CANCELLED" }).expect(201);
    expect(await uses(pageId, code)).toBe(0);
    // A late payment failure for the same order doesn't release twice.
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } });
    await payments.settle(pay.providerRef, "FAILED", { source: "late" });
    expect(await uses(pageId, code)).toBe(0);
  });

  it("successful payment keeps the use", async () => {
    const { pageId, variantId, code } = await codePage("4");
    const s = await login(`0784${uniq.slice(-5)}5`);
    const o = (await holdWithCode(s.agent, s.phone, variantId, code).expect(201)).body;
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } });
    await payments.settle(pay.providerRef, "SUCCESSFUL", { source: "test" });
    expect(await uses(pageId, code)).toBe(1);
    expect(await prisma.discountRedemption.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("regional (KES / M-Pesa) checkout releases on failure and on the 15-minute expiry", async () => {
    const page = await prisma.page.findUniqueOrThrow({ where: { handle: "nairobi-kikoi-studio" } });
    const v = await prisma.variant.findFirstOrThrow({ where: { product: { status: "PUBLISHED", pageId: page.id }, stock: { gte: 3 } } });
    const code = `HCKE${uniq}`;
    await prisma.discountCode.create({ data: { pageId: page.id, code, kind: "PERCENT", value: 10, maxUses: 2, createdBy: "test" } });
    const ke = await login(`07${String(Date.now()).slice(-8)}`, "KE");
    expect(ke.phone).toMatch(/^\+2547\d{8}$/);
    const body = { variantId: v.id, size: "M", method: "MPESA", payerPhone: ke.phone, delivery: "PICKUP", address: "", discountCode: code };
    const a = (await ke.agent.post("/region/checkout").set("idempotency-key", randomUUID()).send(body).expect(201)).body;
    expect(a.money.discountMinor).toBeGreaterThan(0);
    expect(await uses(page.id, code)).toBe(1);
    const payA = await prisma.regionPayment.findFirstOrThrow({ where: { orderId: a.orderId } });
    await region.settle(payA.providerRef, "FAILED", { source: "test" });
    await region.settle(payA.providerRef, "FAILED", { source: "dup" });
    expect(await uses(page.id, code)).toBe(0);

    const b = (await ke.agent.post("/region/checkout").set("idempotency-key", randomUUID()).send(body).expect(201)).body;
    await prisma.regionPayment.updateMany({ where: { orderId: b.orderId }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    await region.expirePending();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe("CANCELLED");
    expect(await uses(page.id, code)).toBe(0);
    await prisma.variant.update({ where: { id: v.id }, data: { stock: v.stock } });

    // The bag (E29) is RWF/MoMo only and takes no codes: a KES piece is refused rather than converted.
    const bag = await ke.agent.post("/bag/items").send({ variantId: v.id, size: "M", qty: 1 }).expect(409);
    expect(bag.body.code).toBe("BAG_CURRENCY");
  });
});

describe("sign-in phone numbers outside Rwanda (E41)", () => {
  it("reads a national number for the chosen country and validates it with that country's rules", async () => {
    const n = String(Date.now()).slice(-7);
    const ke = await login(`07 1${n.slice(0, 1)} ${n.slice(1)}`.replace(/\s/g, ""), "KE");
    expect(ke.phone).toBe(`+25471${n}`);
    const ug = (await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: `077${n}`, country: "UG" }).expect(200)).body;
    expect(ug.phone).toBe(`+25677${n}`);
    const tz = (await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: `075${n}`, country: "TZ" }).expect(200)).body;
    expect(tz.phone).toBe(`+25575${n}`);
    const bad = await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: "0812345", country: "KE" }).expect(400);
    expect(bad.body.message).toMatch(/Kenya numbers look like/);
    // A full international number wins over the selector.
    expect((await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: "+250788100001", country: "KE" }).expect(200)).body.phone).toBe("+250788100001");
    // Unknown countries are refused.
    await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: "0712345678", country: "ZZ" }).expect(400);
  });

  it("keeps the Rwandan behaviour with and without the selector", async () => {
    expect((await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: "0788100001" }).expect(200)).body.phone).toBe("+250788100001");
    expect((await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: "0788100001", country: "RW" }).expect(200)).body.phone).toBe("+250788100001");
    expect((await request(app.getHttpServer()).post("/auth/otp/request").send({ phone: "250788100001" }).expect(200)).body.phone).toBe("+250788100001");
  });
});

describe("coop Easy-mode / USSD accept pushes like the studio (E31/E38)", () => {
  it("sends the shopper the same order push as a studio accept", async () => {
    const coop = await prisma.page.findUniqueOrThrow({ where: { handle: "abahizi-coop" } });
    const maker = await prisma.coopMember.findFirstOrThrow({ where: { pageId: coop.id, phone: "+250788100004" } });
    const v = await prisma.variant.findFirstOrThrow({ where: { product: { status: "PUBLISHED", pageId: coop.id, makers: { some: { coopMemberId: maker.id } } } } });
    await prisma.variant.update({ where: { id: v.id }, data: { stock: { increment: 1 } } });
    const s = await login(`0786${uniq.slice(-5)}1`);
    await s.agent.post("/push/devices").send(webSub("a")).expect(201);
    const o = (await s.agent.post("/orders").set("idempotency-key", randomUUID()).send({ variantId: v.id, size: v.sizes[0], delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: s.phone }).expect(201)).body;
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: o.id } });
    await payments.settle(pay.providerRef, "SUCCESSFUL", { source: "test" });
    rec.sent = [];
    const m = await login("0788100004");
    await m.agent.post(`/coop/me/${coop.id}/orders/${o.id}/accept`).expect(201);
    const msgs = rec.sent.filter((x) => x.msg.refId === o.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].msg.order?.state.status).toBe("ACCEPTED");
  });
});
