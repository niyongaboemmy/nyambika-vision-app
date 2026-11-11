import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

// E23 Live morph · E24 Tailor custom orders · E32 Size recommendation, against the real app + database.
let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
let payments: import("../src/modules/payments/payments.module").PaymentsService;
let orders: import("../src/modules/tailor/custom-orders").CustomOrdersService;
let aiUp = false;
let productId = "";
let variantId = "";
let pageId = "";
const phone = `0789${String(Date.now()).slice(-6)}`;

async function login(p: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone: p }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone: p, code: r.body.devCode }).expect(200);
  return agent;
}

async function settleLatest(customOrderId: string, status: "SUCCESSFUL" | "FAILED") {
  const link = await prisma.customOrderPayment.findFirstOrThrow({ where: { customOrderId }, orderBy: { createdAt: "desc" } });
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: link.paymentId } });
  await payments.settle(p.providerRef, status, { source: "test" });
  return p;
}

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const { PaymentsService } = await import("../src/modules/payments/payments.module");
  const { CustomOrdersService } = await import("../src/modules/tailor/custom-orders");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  payments = app.get(PaymentsService);
  orders = app.get(CustomOrdersService);
  aiUp = await fetch(`${process.env.AI_GATEWAY_URL ?? "http://localhost:8100"}/health`).then((r) => r.ok).catch(() => false);
  const templated = (await prisma.morphTemplate.findMany()).map((t) => t.productId);
  const product = await prisma.product.findFirstOrThrow({
    where: { title: "Uruziga a-line dress", page: { handle: "uwase-couture" }, id: { in: templated } },
    include: { variants: true },
  });
  productId = product.id;
  variantId = product.variants[0].id;
  pageId = product.pageId;
});

afterAll(async () => {
  await app?.close();
});

describe("measurement profile + size recommendation (FR-SIZE-01/02/08)", () => {
  it("prefills from the twin, encrypts every field at rest and recommends a size", async () => {
    const s = await login(phone);
    await s.post("/twin/persona").send({ persona: 3, consent: true }).expect((r) => expect([200, 201, 503]).toContain(r.status));
    const before = await s.get("/measurements").expect(200);
    expect(before.body.profile).toBeNull();
    if (before.body.twinSize) expect(before.body.prefill.bustCm).toBeGreaterThan(70);

    await s.put("/measurements").send({ measurements: { bustCm: 90 }, consent: false }).expect(400);
    await s.put("/measurements").send({ measurements: { bustCm: 90, waistCm: 72, hipsCm: 96, heightCm: 166 }, consent: true }).expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: `+250${phone.slice(1)}` } });
    const row = await prisma.measurementProfile.findUniqueOrThrow({ where: { userId: user.id } });
    const raw = JSON.stringify(row.fields);
    // Plaintext would appear as a bare JSON value; random hex in the ciphertext may contain the digits.
    expect(raw).not.toMatch(/(:|")(90|96|166)("|,|\}|\.)/);
    expect(Object.values(row.fields as Record<string, string>).every((v) => v.startsWith("v1:"))).toBe(true);
    const consent = await prisma.consentRecord.findFirst({ where: { userId: user.id, purpose: "MEASUREMENT_PROFILE", granted: true } });
    expect(consent).toBeTruthy();

    const rec = await s.get(`/size/recommend?productId=${productId}&variantId=${variantId}`).expect(200);
    expect(rec.body.recommendation).toMatchObject({ size: "M", basis: "PROFILE", confidence: "high" });
    const anon = await request(app.getHttpServer()).get(`/size/recommend?productId=${productId}`).expect(200);
    expect(anon.body.recommendation).toBeNull();
  });
});

describe("live morph template (E23)", () => {
  it("exposes the tailor template publicly and lets only the page manage it", async () => {
    const v = await request(app.getHttpServer()).get(`/morph/templates/${productId}`).expect(200);
    expect(v.body.customizable).toBe(true);
    expect(v.body.lengths).toContain("maxi");
    expect(v.body.sleeves).toContain("long");
    const shopper = await login(phone);
    await shopper.put(`/products/${productId}/morph-template`).send({ colourDeltaRwf: 1 }).expect(403);
    const tailor = await login("0788100001");
    const m = await tailor.get(`/products/${productId}/morph-template`).expect(200);
    expect(m.body.options.baseLength).toBe("knee");
    await tailor.put(`/products/${productId}/morph-template`).send(m.body.options).expect(200);
    expect(await prisma.auditLog.count({ where: { action: "MORPH_TEMPLATE_SET", pageId } })).toBeGreaterThan(0);
  });

  it("renders a morph on the twin through the generation path (AI gateway up)", async () => {
    if (!aiUp) return;
    const s = await login(phone);
    const r = await s.post("/morph/preview").send({ productId, variantId, spec: { hue: 203, length: "maxi", sleeve: "long" } }).expect(201);
    expect(r.body.spec).toEqual({ hue: 210, length: "maxi", sleeve: "long" });
    expect(r.body.price.lines.length).toBe(3);
    const gen = await prisma.generation.findUniqueOrThrow({ where: { id: r.body.renderId } });
    expect(gen.cacheKey).toContain("|morph:h210|lmaxi|slong");
    let status = r.body.status;
    for (let i = 0; i < 60 && !["DELIVERED", "WITHHELD", "FAILED"].includes(status); i++) {
      await new Promise((ok) => setTimeout(ok, 500));
      status = (await s.get(`/morph/renders/${r.body.renderId}`).expect(200)).body.status;
    }
    expect(status).toBe("DELIVERED");
    const done = await prisma.generation.findUniqueOrThrow({ where: { id: r.body.renderId } });
    expect(done.c2pa).toBeTruthy();
    expect(await prisma.usageEvent.count({ where: { refId: done.id, kind: "TRYON" } })).toBe(1);
    // Same spec (nearby hue) is a cache hit: same generation, no new charge.
    const again = await s.post("/morph/preview").send({ productId, variantId, spec: { hue: 208, length: "maxi", sleeve: "long" } }).expect(201);
    expect(again.body.renderId).toBe(r.body.renderId);
    await s.post("/morph/preview").send({ productId, variantId, spec: { hue: 0, length: "floor", sleeve: null } }).expect(400);
  });
});

describe("custom order lifecycle (E24, FR-SIZE-04..07)", () => {
  it("request → quote → deposit → fitting → progress → balance → delivered, money to the tailor", async () => {
    const s = await login(phone);
    const tailor = await login("0788100001");
    const seller = await login("0788100003");
    const created = await s
      .post("/custom-orders")
      .send({ pageId, productId, variantId, spec: { hue: 200, length: "maxi", sleeve: "long" }, shareMeasurements: true, size: "M", note: "For a wedding" })
      .expect(201);
    const co = created.body;
    const base = (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).priceRwf;
    const t = await prisma.morphTemplate.findUniqueOrThrow({ where: { productId } });
    const o = t.options as { colourDeltaRwf: number; lengths: Record<string, number>; sleeves: Record<string, number> };
    expect(co.estimateRwf).toBe(base + o.colourDeltaRwf + o.lengths.maxi + o.sleeves.long);
    expect(co.measurementShare.active).toBe(true);
    expect(new Date(co.measurementShare.expiresAt).getTime() - Date.now()).toBeGreaterThan(13.9 * 86400_000);
    expect(co.image).toBeNull(); // no preview shared

    // Tailor sees measurements only while the share is active; others never.
    const m = await tailor.get(`/custom-orders/${co.id}/measurements`).expect(200);
    expect(m.body.measurements.hipsCm).toBe(96);
    expect(await prisma.auditLog.count({ where: { action: "MEASUREMENT_VIEWED", data: { path: ["customOrderId"], equals: co.id } } })).toBe(1);
    await seller.get(`/custom-orders/${co.id}/measurements`).expect(403);
    await seller.get(`/custom-orders/${co.id}`).expect(403);
    const inbox = await tailor.get(`/pages/${pageId}/custom-orders`).expect(200);
    const mine = inbox.body.find((x: { id: string }) => x.id === co.id);
    expect(mine.buyer.phone).toMatch(/^\+250/);

    await s.post(`/custom-orders/${co.id}/accept`).send({}).expect(400); // nothing to accept yet
    await tailor.post(`/custom-orders/${co.id}/quote`).send({ priceRwf: 45000, depositPct: 40, leadTimeDays: 6, note: "Lined bodice" }).expect(201);
    const quoted = (await s.get(`/custom-orders/${co.id}`).expect(200)).body;
    expect(quoted.quote).toMatchObject({ priceRwf: 45000, depositRwf: 18000, balanceRwf: 27000 });

    // Deposit: Mobile Money push to the shopper, payable to the tailor's merchant account.
    const acc = (await s.post(`/custom-orders/${co.id}/accept`).send({ wallet: "MTN_MOMO" }).expect(201)).body;
    expect(acc.status).toBe("DEPOSIT_PENDING");
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: acc.orderId }, include: { payments: true } });
    expect(order.payoutMsisdn).toBe(page.momoMerchant);
    expect(order.payments[0]).toMatchObject({ amountRwf: 18000, merchant: page.momoMerchant, status: "PENDING" });
    const handset = await request(app.getHttpServer()).get(`/payments/mock/handset?phone=${phone}`).expect(200);
    expect(handset.body[0]).toMatchObject({ amountRwf: 18000, to: page.name, code: co.code });

    // A declined deposit goes back to the quote; a second try succeeds.
    await settleLatest(co.id, "FAILED");
    expect((await s.get(`/custom-orders/${co.id}`)).body.status).toBe("QUOTED");
    await s.post(`/custom-orders/${co.id}/accept`).send({}).expect(201);
    await settleLatest(co.id, "SUCCESSFUL");
    const paid = (await s.get(`/custom-orders/${co.id}`)).body;
    expect(paid.status).toBe("DEPOSIT_PAID");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: acc.orderId } })).status).toBe("ACCEPTED");

    // Fitting: tailor publishes slots, shopper books, reminder lands in the WhatsApp outbox.
    const soon = new Date(Date.now() + 5 * 3600_000);
    await tailor.post(`/pages/${pageId}/slots`).send({ slots: [{ startsAt: soon.toISOString(), durationMin: 30, location: "Kimihurura studio" }] }).expect(201);
    await seller.post(`/pages/${pageId}/slots`).send({ slots: [{ startsAt: soon.toISOString() }] }).expect(403);
    const open = (await s.get(`/custom-orders/${co.id}/slots`).expect(200)).body as { id: string; startsAt: string }[];
    const slot = open.find((x) => Math.abs(new Date(x.startsAt).getTime() - soon.getTime()) < 1000)!;
    expect(slot).toBeTruthy();
    const booked = (await s.post(`/custom-orders/${co.id}/book`).send({ slotId: slot.id }).expect(201)).body;
    expect(booked.fitting.id).toBe(slot.id);
    await tailor.delete(`/pages/${pageId}/slots/${slot.id}`).expect(400); // booked slots stay
    const sent = await orders.sendReminders();
    expect(sent).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { template: "fitting_reminder", refId: co.id } })).toBe(1);
    expect(await orders.sendReminders()).toBeGreaterThanOrEqual(0);
    expect(await prisma.notification.count({ where: { template: "fitting_reminder", refId: co.id } })).toBe(1);

    // Progress (forward only), then the balance, then delivery.
    await tailor.post(`/custom-orders/${co.id}/progress`).send({ to: "CUTTING" }).expect(201);
    await tailor.post(`/custom-orders/${co.id}/progress`).send({ to: "FITTING", note: "Come try it on" }).expect(201);
    await tailor.post(`/custom-orders/${co.id}/progress`).send({ to: "CUTTING" }).expect(400);
    await s.post(`/custom-orders/${co.id}/pay-balance`).send({}).expect(400);
    await tailor.post(`/custom-orders/${co.id}/deliver`).expect(400);
    await tailor.post(`/custom-orders/${co.id}/progress`).send({ to: "READY" }).expect(201);
    await s.post(`/custom-orders/${co.id}/pay-balance`).send({ wallet: "MTN_MOMO" }).expect(201);
    const bal = await settleLatest(co.id, "SUCCESSFUL");
    expect(bal.amountRwf).toBe(27000);
    expect((await s.get(`/custom-orders/${co.id}`)).body.status).toBe("BALANCE_PAID");
    const done = (await tailor.post(`/custom-orders/${co.id}/deliver`).expect(201)).body;
    expect(done.status).toBe("DELIVERED");
    expect(done.payments.map((p: { stage: string; status: string }) => `${p.stage}:${p.status}`)).toEqual(["DEPOSIT:FAILED", "DEPOSIT:SUCCESSFUL", "BALANCE:SUCCESSFUL"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: acc.orderId } })).status).toBe("DELIVERED");
    // The share ends with the order.
    expect(done.measurementShare.active).toBe(false);
    await tailor.get(`/custom-orders/${co.id}/measurements`).expect(403);
    expect(await prisma.notification.count({ where: { refId: co.id, template: { startsWith: "custom_" } } })).toBeGreaterThanOrEqual(6);
  });

  it("share expiry and revocation cut tailor access; shared preview is a copy", async () => {
    const s = await login(phone);
    const tailor = await login("0788100001");
    const co = (await s.post("/custom-orders").send({ pageId, productId, variantId, shareMeasurements: true, shareDays: 3 }).expect(201)).body;
    await tailor.get(`/custom-orders/${co.id}/measurements`).expect(200);
    await prisma.measurementShare.updateMany({ where: { customOrderId: co.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await tailor.get(`/custom-orders/${co.id}/measurements`).expect(403);

    const co2 = (await s.post("/custom-orders").send({ pageId, productId, variantId, shareMeasurements: true }).expect(201)).body;
    await tailor.get(`/custom-orders/${co2.id}/measurements`).expect(200);
    const shares = (await s.get("/measurements").expect(200)).body.shares;
    const share = shares.find((x: { customOrder: { id: string } | null }) => x.customOrder?.id === co2.id);
    await s.post(`/measurements/shares/${share.id}/revoke`).expect(201);
    await tailor.get(`/custom-orders/${co2.id}/measurements`).expect(403);
    expect(await prisma.auditLog.count({ where: { action: "MEASUREMENT_SHARE_REVOKED", data: { path: ["shareId"], equals: share.id } } })).toBe(1);

    // Preview sharing needs an explicit render; the tailor gets a separate copy.
    await s.post("/custom-orders").send({ pageId, productId, sharePreview: true }).expect(400);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: `+250${phone.slice(1)}` } });
    const g = await prisma.generation.findFirst({ where: { userId: user.id, status: "DELIVERED" } });
    if (g) {
      const co3 = (await s.post("/custom-orders").send({ pageId, productId, variantId, renderId: g.id, sharePreview: true }).expect(201)).body;
      const row = await prisma.customOrder.findUniqueOrThrow({ where: { id: co3.id } });
      expect(row.previewPath).toMatch(new RegExp(`^private/custom-orders/${co3.id}/`));
      const tv = (await tailor.get(`/custom-orders/${co3.id}`).expect(200)).body;
      expect(tv.image).toMatch(/^\/api\/private\/look/);
      await tailor.post(`/custom-orders/${co3.id}/decline`).send({ note: "Fully booked" }).expect(201);
    }
    // Cancel before the deposit; services listing is public.
    await s.post(`/custom-orders/${co.id}/cancel`).expect(201);
    const svc = await request(app.getHttpServer()).get(`/pages/${pageId}/services`).expect(200);
    expect(svc.body.length).toBeGreaterThanOrEqual(1);
  });

  it("is in the privacy export and the account deletion", async () => {
    const s = await login(phone);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: `+250${phone.slice(1)}` } });
    const exp = await s.get("/privacy/export").expect(200);
    const body = JSON.parse(exp.text);
    expect(body.measurements.profile.bustCm).toBe(90);
    expect(body.customOrders.length).toBeGreaterThanOrEqual(3);
    const job = (await s.post("/privacy/delete").send({ scope: "ACCOUNT" }).expect(201)).body;
    expect(job.steps.map((x: { step: string }) => x.step)).toContain("Measurement profile deleted; tailor shares ended");
    expect(await prisma.measurementProfile.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.measurementShare.count({ where: { userId: user.id } })).toBe(0);
  });
});
