import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";
process.env.MIGRATION_WORKER_CONCURRENCY = "4";

let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
const uniq = String(Date.now()).slice(-6);

async function login(phone: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone }).expect(200);
  await agent.post("/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
  return agent;
}
const e164 = (p: string) => `+250${p.slice(1)}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
});

/** A fresh published page with one made-to-order product (no photo needed for hold-to-buy). */
async function freshPage(tag: string) {
  const owner = await login(`0783${tag}${uniq.slice(-5)}`);
  const page = await owner.post("/pages").send({ handle: `grow-${tag}-${uniq}`, name: `Grow ${tag}`, memberType: "TAILOR", momoMerchant: "0788555000" }).expect(201);
  await prisma.page.update({ where: { id: page.body.id }, data: { status: "PUBLISHED" } });
  const p = await owner
    .post(`/pages/${page.body.id}/products`)
    .send({ title: "Gisozi wrap dress", category: "dress", priceRwf: 36000, madeToOrder: true, variants: [{ colourName: "Indigo", colourHex: "#2B4EA2", sizes: ["M"], stock: 0 }] })
    .expect(201);
  await prisma.product.update({ where: { id: p.body.id }, data: { status: "PUBLISHED" } });
  return { owner, pageId: page.body.id as string, productId: p.body.id as string, variantId: p.body.variants[0].id as string };
}

describe("discount codes at hold-to-buy (E30)", () => {
  it("applies a maker-funded code once per shopper and records the redemption", async () => {
    const { owner, pageId, variantId } = await freshPage("1");
    const code = `IT${uniq}`;
    await owner.post(`/pages/${pageId}/discounts`).send({ code, kind: "PERCENT", value: 10, maxUses: 5 }).expect(201);
    const shopper = await login(`0784${uniq}1`);
    const check = await shopper.post("/discounts/check").send({ variantId, code: code.toLowerCase() }).expect(201);
    expect(check.body).toMatchObject({ applied: code, amountRwf: 3600, priceAfterRwf: 32400 });
    await shopper.post("/discounts/check").send({ variantId, code: "NOPE123" }).expect(400);

    const order = await shopper
      .post("/orders")
      .set("idempotency-key", `disc-${uniq}-1`)
      .send({ variantId, size: "M", delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: e164(`0784${uniq}1`), discountCode: code })
      .expect(201);
    expect(order.body.totalRwf).toBe(32400);
    const red = await prisma.discountRedemption.findUnique({ where: { orderId: order.body.id } });
    expect(red).toMatchObject({ amountRwf: 3600, pageId });
    expect((await prisma.discountCode.findFirst({ where: { pageId, code } }))?.uses).toBe(1);
    const pay = await prisma.payment.findFirst({ where: { orderId: order.body.id } });
    expect(pay?.amountRwf).toBe(32400); // smaller MoMo request, straight to the maker
    expect(pay?.merchant).toBe("0788555000");

    const again = await shopper
      .post("/orders")
      .set("idempotency-key", `disc-${uniq}-2`)
      .send({ variantId, size: "M", delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: e164(`0784${uniq}1`), discountCode: code })
      .expect(400);
    expect(again.body.code).toBe("DISCOUNT_ALREADY_USED");
  });

  it("applies an automatic time-boxed offer without a code; paused offers stop applying", async () => {
    const { owner, pageId, variantId } = await freshPage("2");
    const offer = await owner.post(`/pages/${pageId}/discounts`).send({ label: "Weekend", kind: "AMOUNT", value: 5000, endsAt: new Date(Date.now() + 86400_000).toISOString() }).expect(201);
    const shopper = await login(`0784${uniq}2`);
    expect((await shopper.get(`/discounts/offer?variantId=${variantId}`).expect(200)).body).toMatchObject({ amountRwf: 5000, priceAfterRwf: 31000 });
    await owner.patch(`/pages/${pageId}/discounts/${offer.body.id}`).send({ active: false }).expect(200);
    const o = await shopper.post("/orders").set("idempotency-key", `offer-${uniq}`).send({ variantId, size: "M", delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: e164(`0784${uniq}2`) }).expect(201);
    expect(o.body.totalRwf).toBe(36000);
    // strangers can't create discounts on someone else's page
    await shopper.post(`/pages/${pageId}/discounts`).send({ code: "HACK10", kind: "PERCENT", value: 10 }).expect(403);
  });
});

describe("follower broadcast opt-in and rate limit (E30)", () => {
  it("sends only to opted-in followers through the WhatsApp outbox, once a day", async () => {
    const { owner, pageId } = await freshPage("3");
    const yes = await login(`0785${uniq}1`);
    const no = await login(`0785${uniq}2`);
    await yes.post(`/pages/${pageId}/broadcast-optin`).send({ optedIn: true, locale: "rw" }).expect(201);
    await no.post(`/pages/${pageId}/follow`).expect(201); // follows, but never asked for WhatsApp updates
    expect((await yes.get(`/pages/${pageId}/broadcast-optin`).expect(200)).body.optedIn).toBe(true);
    const yesUser = await prisma.user.findUniqueOrThrow({ where: { phone: e164(`0785${uniq}1`) } });
    expect((await prisma.consentRecord.findFirst({ where: { userId: yesUser.id, purpose: `BROADCAST_OPTIN:${pageId}` } }))?.granted).toBe(true);

    const b = await owner.post(`/pages/${pageId}/broadcasts`).send({ message: "Our new collection is here! Come and try it on you", locale: "rw" }).expect(201);
    expect(b.body).toMatchObject({ recipients: 1, skipped: 1, skippedReasons: { NOT_OPTED_IN: 1 } });
    const sent = await prisma.notification.findMany({ where: { refId: b.body.id, template: "broadcast_new_collection" } });
    expect(sent.map((n) => n.to)).toEqual([e164(`0785${uniq}1`)]);
    expect(sent[0].body).toContain("src=broadcast");
    expect(sent[0].body).toContain("STOP");

    const second = await owner.post(`/pages/${pageId}/broadcasts`).send({ message: "Another update the same day, too soon" }).expect(400);
    expect(second.body.code).toBe("PAGE_DAILY_LIMIT");
    const state = await owner.get(`/pages/${pageId}/broadcasts`).expect(200);
    expect(state.body).toMatchObject({ followers: 2, optedIn: 1, canSend: false });

    // Opting out stops future updates.
    await yes.post(`/pages/${pageId}/broadcast-optin`).send({ optedIn: false }).expect(201);
    expect(await prisma.broadcastOptIn.count({ where: { pageId, optedIn: true } })).toBe(0);
  });
});

describe("assisted mode consent + USSD (E31)", () => {
  let pageId: string;
  let makerId: string;
  let makerUserId: string;
  let admin: request.Agent;

  beforeAll(async () => {
    const page = await prisma.page.findUniqueOrThrow({ where: { handle: "urudodo-collective" } });
    pageId = page.id;
    const maker = await prisma.coopMember.findFirstOrThrow({ where: { pageId, phone: "+250788100004" } });
    makerId = maker.id;
    makerUserId = maker.userId!;
    admin = await login("0788100002");
    await admin.post(`/pages/${pageId}/makers/${makerId}/assist/revoke`).expect(201);
  });

  const product = { title: "Indigo umushanana", category: "umushanana", priceRwf: 30000, madeToOrder: true, variants: [{ colourName: "Indigo", colourHex: "#2B4EA2", sizes: ["M"], stock: 0 }] };

  it("blocks on-behalf actions without consent, records consent from the maker's code, audits every action", async () => {
    const denied = await admin.post(`/pages/${pageId}/assist/${makerId}/products`).send(product).expect(403);
    expect(denied.body.code).toBe("ASSIST_NO_CONSENT");

    const req = await admin.post(`/pages/${pageId}/makers/${makerId}/assist/request`).send({ scopes: ["PRODUCTS", "ORDERS"] }).expect(201);
    await admin.post(`/pages/${pageId}/assist/${makerId}/products`).send(product).expect(403); // still pending
    const sms = await prisma.notification.findFirstOrThrow({ where: { refId: req.body.grantId, template: "coop_assist_code" } });
    expect(sms.channel).toBe("SMS");
    const code = sms.body.match(/\b(\d{6})\b/)![1];
    const wrong = code === "000000" ? "111111" : "000000";
    await admin.post(`/pages/${pageId}/makers/${makerId}/assist/confirm`).send({ grantId: req.body.grantId, code: wrong }).expect(400);
    const ok = await admin.post(`/pages/${pageId}/makers/${makerId}/assist/confirm`).send({ grantId: req.body.grantId, code }).expect(201);
    expect(ok.body).toMatchObject({ status: "ACTIVE", method: "SMS_CODE" });
    expect((await prisma.consentRecord.findFirst({ where: { userId: makerUserId, purpose: `ASSISTED_MODE:${pageId}` }, orderBy: { createdAt: "desc" } }))?.granted).toBe(true);

    const p = await admin.post(`/pages/${pageId}/assist/${makerId}/products`).send(product).expect(201);
    const created = await prisma.product.findUniqueOrThrow({ where: { id: p.body.id }, include: { makers: true } });
    expect(created.submittedById).toBe(makerUserId);
    expect(created.makers.map((m) => m.coopMemberId)).toEqual([makerId]);
    const log = await prisma.auditLog.findFirst({ where: { action: "coop.assist.product_create", pageId }, orderBy: { createdAt: "desc" } });
    expect(log?.data).toMatchObject({ grantId: req.body.grantId, makerId, productId: p.body.id, onBehalfOf: makerUserId });

    // A different coop's admin (or a shopper) can't act for this maker.
    const stranger = await login(`0786${uniq}9`);
    await stranger.post(`/pages/${pageId}/assist/${makerId}/products`).send(product).expect(403);

    await admin.post(`/pages/${pageId}/makers/${makerId}/assist/revoke`).expect(201);
    expect((await admin.post(`/pages/${pageId}/assist/${makerId}/products`).send(product).expect(403)).body.code).toBe("ASSIST_NO_CONSENT");
    expect((await prisma.consentRecord.findFirst({ where: { userId: makerUserId, purpose: `ASSISTED_MODE:${pageId}` }, orderBy: { createdAt: "desc" } }))?.granted).toBe(false);
  });

  it("lets the maker approve help from a feature phone over USSD", async () => {
    const req = await admin.post(`/pages/${pageId}/makers/${makerId}/assist/request`).send({}).expect(201);
    const root = await request(app.getHttpServer()).post("/ussd").send({ sessionId: "t1", phoneNumber: "+250788100004", text: "" }).expect(201);
    expect(root.text).toMatch(/^CON /);
    expect(root.text).toContain("4.");
    const sales = await request(app.getHttpServer()).post("/ussd").send({ sessionId: "t1", phoneNumber: "0788100004", text: "1" }).expect(201);
    expect(sales.text).toMatch(/^END /);
    const yes = await request(app.getHttpServer()).post("/ussd").send({ sessionId: "t2", phoneNumber: "0788100004", text: "4*1" }).expect(201);
    expect(yes.text).toMatch(/^END /);
    expect((await prisma.assistGrant.findUniqueOrThrow({ where: { id: req.body.grantId } })).method).toBe("USSD");
    await admin.get(`/pages/${pageId}/assist/${makerId}`).expect(200);
    await admin.post(`/pages/${pageId}/makers/${makerId}/assist/revoke`).expect(201);
    const unknown = await request(app.getHttpServer()).post("/ussd").send({ phoneNumber: "0780000000", text: "" }).expect(201);
    expect(unknown.text).toMatch(/^END /);
  });

  it("maker statement is readable by the maker and the admin only", async () => {
    const maker = await login("0788100004");
    const s = await maker.get(`/pages/${pageId}/makers/${makerId}/statement?locale=rw`).expect(200);
    expect(s.body.spoken).toContain("wagurishije");
    const other = await login(`0786${uniq}8`);
    await other.get(`/pages/${pageId}/makers/${makerId}/statement`).expect(403);
  });
});

describe("full-network wave: concurrency window and rollback-all (E21)", () => {
  it("imports two pages of one new owner at the same time (owner upsert race)", async () => {
    const { MigrationController, LegacyPage } = await import("../src/modules/migration/migration.module");
    const importer = app.get(MigrationController);
    const host = await prisma.user.findUniqueOrThrow({ where: { phone: "+250788900001" } });
    const wave = await prisma.migrationWave.create({ data: { name: `IT race ${uniq}`, createdBy: host.id } });
    const ownerPhone = `0789${uniq}`;
    const src = (i: number) => LegacyPage.parse({ legacyUrl: `https://old.nyambika.rw/shop/race-${uniq}-${i}`, handle: `race-${uniq}-${i}`, name: `Race ${i}`, memberType: "SELLER", ownerPhone });
    // Several rounds so the find-then-create window is hit deterministically, not by luck.
    for (let round = 0; round < 3; round++) {
      await prisma.user.deleteMany({ where: { phone: e164(ownerPhone) } }).catch(() => undefined);
      const rs = await Promise.allSettled([0, 1, 2, 3].map((i) => importer.importPage(wave.id, src(round * 10 + i))));
      expect(rs.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))).toEqual(["ok", "ok", "ok", "ok"]);
      expect(await prisma.page.count({ where: { handle: { startsWith: `race-${uniq}-` }, roles: { some: { user: { phone: e164(ownerPhone) } } } } })).toBe(4);
      await prisma.migrationItem.deleteMany({ where: { waveId: wave.id } });
      await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: `/shop/race-${uniq}-` } } });
      await prisma.page.deleteMany({ where: { handle: { startsWith: `race-${uniq}-` } } });
    }
  });

  it("imports on the queue within the window, chases unsigned owners and rolls the whole wave back", async () => {
    const host = await login("0788900001");
    // `.slice(0, 10)` cuts the index off, so all pages share one new owner and concurrent imports race on that user.
    const page = (i: number) => ({ legacyUrl: `https://old.nyambika.rw/shop/net-${uniq}-${i}`, handle: `net-${uniq}-${i}`, name: `Net Shop ${i}`, memberType: "SELLER", ownerPhone: `0787${uniq}${i}`.slice(0, 10), story: "A short story about this synthetic shop and its kitenge." });
    const pages = Array.from({ length: 8 }, (_, i) => page(i));
    pages.push({ ...page(0), legacyUrl: `https://old.nyambika.rw/shop/net-${uniq}-dup` }); // duplicate handle → fails
    const start = await host.post("/admin/migration/network/waves?concurrency=2").send({ wave: `IT wave ${uniq}`, pages }).expect(201);
    const waveId = start.body.waveId as string;

    let d: { run: { status: string; done: number; failed: number; maxRunning: number; concurrency: number } } = { run: { status: "", done: 0, failed: 0, maxRunning: 0, concurrency: 0 } };
    // Wait for the terminal state, not a fixed number of polls: under a loaded machine 9 imports can take > 15 s.
    for (const until = Date.now() + 75_000; d.run.status !== "IMPORTED" && Date.now() < until; ) {
      await wait(250);
      d = (await host.get(`/admin/migration/network/${waveId}`).expect(200)).body;
    }
    expect(d.run).toMatchObject({ status: "IMPORTED", done: 8, failed: 1, concurrency: 2 });
    expect(d.run.maxRunning).toBeGreaterThan(0);
    expect(d.run.maxRunning).toBeLessThanOrEqual(2);

    expect((await host.post(`/admin/migration/network/${waveId}/outreach`).expect(201)).body.sent).toBe(8);
    expect((await host.post(`/admin/migration/network/${waveId}/outreach`).expect(201)).body.sent).toBe(0); // idempotent
    expect((await host.post(`/admin/migration/network/${waveId}/chase`).send({}).expect(201)).body.sent).toBe(0); // not due yet
    const asOf = new Date(Date.now() + 3 * 86400_000).toISOString();
    expect((await host.post(`/admin/migration/network/${waveId}/chase`).send({ asOf }).expect(201)).body.sent).toBe(8);
    expect((await host.post(`/admin/migration/network/${waveId}/chase`).send({ asOf }).expect(201)).body.sent).toBe(0);

    const csv = await host.get(`/admin/migration/network/${waveId}/redirects?format=csv`).expect(200);
    expect(csv.text.split("\n")).toHaveLength(9);
    expect(csv.text).toContain(`/shop/net-${uniq}-3`);

    const rb = await host.post(`/admin/migration/network/${waveId}/rollback-all`).expect(201);
    expect(rb.body.rolledBack).toBe(8);
    const items = await prisma.migrationItem.findMany({ where: { waveId } });
    expect(items.every((i) => i.status === "ROLLED_BACK")).toBe(true);
    expect(await prisma.page.count({ where: { id: { in: items.map((i) => i.pageId) }, status: { not: "DRAFT" } } })).toBe(0);
    expect(await prisma.redirect.count({ where: { fromPath: { startsWith: `/shop/net-${uniq}` }, active: true } })).toBe(0);
    const after = (await host.get(`/admin/migration/network/${waveId}`).expect(200)).body;
    expect(after.run.status).toBe("ROLLED_BACK");
    expect(after.checklist.find((c: { key: string }) => c.key === "rollback_rehearsed").done).toBe(true);
    expect(after.checklist.find((c: { key: string }) => c.key === "redirect_map").done).toBe(true);

    const shopper = await login(`0784${uniq}7`);
    await shopper.get(`/admin/migration/network/${waveId}`).expect(403);
  }, 120_000);
});
