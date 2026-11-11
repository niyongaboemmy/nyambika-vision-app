import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PushMessage } from "@nyambika/contracts";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PushProvider, PushResult, PushTarget } from "../src/common/push/providers";

process.env.DEV_EXPOSE_OTP = "1";
process.env.OTP_MAX_PER_15M = "100";
process.env.MOCK_AUTO_APPROVE_MS = "0";

let app: INestApplication;
let prisma: import("../src/common/prisma.service").PrismaService;
let push: import("../src/common/push/push.service").PushService;
let payments: import("../src/modules/payments/payments.module").PaymentsService;
const uniq = String(Date.now()).slice(-6);

/** Records every delivery; tokens listed in `gone` answer like an uninstalled app. */
class Recorder implements PushProvider {
  readonly name = "recorder";
  sent: { target: PushTarget; msg: PushMessage }[] = [];
  gone = new Set<string>();
  async send(target: PushTarget, msg: PushMessage): Promise<PushResult> {
    if (this.gone.has(target.token)) return { ok: false, gone: true, error: "410" };
    this.sent.push({ target, msg });
    return { ok: true };
  }
}
const rec = new Recorder();

async function login(phone: string) {
  const agent = request.agent(app.getHttpServer());
  const r = await agent.post("/auth/otp/request").send({ phone }).expect(200);
  const v = await agent.post("/auth/otp/verify").send({ phone, code: r.body.devCode }).expect(200);
  return { agent, userId: v.body.user.id as string };
}
const e164 = (p: string) => `+250${p.slice(1)}`;
const webSub = (n: string) => ({ installationId: `web_${uniq}_${n}`, platform: "WEB", transport: "WEBPUSH", token: `https://push.example.test/send/${uniq}-${n}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });
const android = (n: string) => ({ installationId: `and_${uniq}_${n}`, platform: "ANDROID", transport: "FCM", token: `fcm-android-${uniq}-${n}-xxxxxxxx`, appVersion: "1.0.0" });

beforeAll(async () => {
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/common/prisma.service");
  const { PushService } = await import("../src/common/push/push.service");
  const { PaymentsService } = await import("../src/modules/payments/payments.module");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.use(cookieParser());
  await app.init();
  prisma = app.get(PrismaService);
  push = app.get(PushService);
  payments = app.get(PaymentsService);
  push.providers = { fcm: rec, apns: rec, webpush: rec, mode: "dev" };
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  rec.sent = [];
});

async function freshProduct(tag: string) {
  const { agent: owner } = await login(`0785${tag}${uniq.slice(-5)}`);
  const page = await owner.post("/pages").send({ handle: `push-${tag}-${uniq}`, name: `Uwase ${tag}`, memberType: "TAILOR", momoMerchant: "0788555001" }).expect(201);
  await prisma.page.update({ where: { id: page.body.id }, data: { status: "PUBLISHED" } });
  const p = await owner
    .post(`/pages/${page.body.id}/products`)
    .send({ title: "Kitenge dress", category: "dress", priceRwf: 30000, madeToOrder: true, variants: [{ colourName: "Indigo", colourHex: "#2B4EA2", sizes: ["M"], stock: 0 }] })
    .expect(201);
  await prisma.product.update({ where: { id: p.body.id }, data: { status: "PUBLISHED" } });
  return { owner, variantId: p.body.variants[0].id as string };
}

describe("device token lifecycle", () => {
  it("public VAPID key, register, rotate, move to another user, revoke on sign-out", async () => {
    const vapid = await request(app.getHttpServer()).get("/push/vapid").expect(200);
    expect(vapid.body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);

    const a = await login(`0786${uniq}1`);
    await a.agent.post("/push/devices").send({ ...webSub("1"), token: "http://insecure.example/x1234567890" }).expect(400);
    const d1 = await a.agent.post("/push/devices").send(android("1")).expect(201);
    expect(d1.body.device).toMatchObject({ platform: "ANDROID", kind: "DEVICE" });
    expect(JSON.stringify(d1.body)).not.toContain("fcm-android"); // tokens never echoed

    // FCM token rotation on the same installation keeps one live token.
    await a.agent.post("/push/devices").send({ ...android("1"), token: `fcm-android-${uniq}-rotated-xxxxxxxx` }).expect(201);
    const live = await prisma.pushDevice.findMany({ where: { installationId: `and_${uniq}_1`, revokedAt: null } });
    expect(live.map((d) => d.token)).toEqual([`fcm-android-${uniq}-rotated-xxxxxxxx`]);

    // A shared phone: the token follows whoever signed in last.
    const b = await login(`0786${uniq}2`);
    await b.agent.post("/push/devices").send({ ...android("1"), token: `fcm-android-${uniq}-rotated-xxxxxxxx` }).expect(201);
    expect((await a.agent.get("/push").expect(200)).body.devices).toHaveLength(0);
    expect((await b.agent.get("/push").expect(200)).body.devices).toHaveLength(1);

    await b.agent.post("/push/devices").send(webSub("2")).expect(201);
    expect((await b.agent.get("/push").expect(200)).body.devices).toHaveLength(2);
    // Someone else cannot revoke b's installation while signed in as themselves.
    expect((await a.agent.post("/push/devices/revoke").send({ installationId: `web_${uniq}_2` }).expect(200)).body.revoked).toBe(0);
    expect((await b.agent.post("/push/devices/revoke").send({ installationId: `web_${uniq}_2` }).expect(200)).body.revoked).toBe(1);
    const [left] = (await b.agent.get("/push").expect(200)).body.devices;
    await b.agent.delete(`/push/devices/${left.id}`).expect(200);
    expect((await b.agent.get("/push").expect(200)).body.devices).toHaveLength(0);
  });

  it("validates live-activity tokens (iOS only, tied to an order)", async () => {
    const a = await login(`0786${uniq}3`);
    await a.agent.post("/push/devices").send({ installationId: `ios_${uniq}_3`, platform: "IOS", transport: "APNS", kind: "LIVE_ACTIVITY", token: "ab".repeat(32) }).expect(400);
    await a.agent.post("/push/devices").send({ installationId: `ios_${uniq}_3`, platform: "IOS", transport: "APNS", kind: "LIVE_ACTIVITY", orderId: "o-1", token: "ab".repeat(32) }).expect(201);
  });
});

describe("order lifecycle fan-out", () => {
  it("pushes paid → progress → shipped → delivered to web, Android and the iOS live activity", async () => {
    const { owner, variantId } = await freshProduct("1");
    const s = await login(`0787${uniq}1`);
    await s.agent.post("/push/devices").send(webSub("o1")).expect(201);
    await s.agent.post("/push/devices").send(android("o1")).expect(201);
    const ios = { installationId: `ios_${uniq}_o1`, platform: "IOS" };
    await s.agent.post("/push/devices").send({ ...ios, transport: "APNS", token: `apns-ios-${uniq}-xxxxxxxxxxxx` }).expect(201);
    await s.agent.post("/push/devices").send({ ...ios, transport: "APNS", kind: "LIVE_ACTIVITY_START", token: "cd".repeat(32) }).expect(201);

    const order = await s.agent.post("/orders").set("idempotency-key", `push-${uniq}-1`).send({ variantId, size: "M", delivery: "DELIVERY", address: "KG 11 Ave, Kigali", wallet: "MTN_MOMO", payerPhone: e164(`0787${uniq}1`) }).expect(201);
    expect(rec.sent).toHaveLength(0); // nothing while waiting for the PIN
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.body.id } });
    await payments.settle(pay.providerRef, "SUCCESSFUL", {});

    const paid = rec.sent.filter((x) => x.msg.event === "order.paid");
    expect(paid.map((x) => `${x.target.platform}/${x.target.kind}`).sort()).toEqual(["ANDROID/DEVICE", "IOS/DEVICE", "IOS/LIVE_ACTIVITY_START", "WEB/DEVICE"]);
    expect(paid.find((x) => x.target.kind === "LIVE_ACTIVITY_START")!.target.transport).toBe("APNS");
    expect(paid[0].msg).toMatchObject({ alert: true, url: `/orders/${order.body.id}`, tag: `order-${order.body.id}` });
    expect(paid[0].msg.order!.state).toMatchObject({ status: "PAID", stepIndex: 0, phase: "ACTIVE" });
    expect(paid[0].msg.title).toBe("Paid directly to Uwase 1");

    // The activity started on the phone reports its own token → updates go to it, not push-to-start.
    await s.agent.post("/push/devices").send({ ...ios, transport: "APNS", kind: "LIVE_ACTIVITY", orderId: order.body.id, token: "ef".repeat(32) }).expect(201);
    rec.sent = [];
    await owner.post(`/orders/${order.body.id}/transition`).send({ to: "ACCEPTED" }).expect(201);
    const acc = rec.sent;
    expect(acc.every((x) => x.msg.event === "order.progress" && !x.msg.alert)).toBe(true);
    expect(acc.map((x) => x.target.kind).sort()).toEqual(["DEVICE", "DEVICE", "DEVICE", "LIVE_ACTIVITY"]);

    rec.sent = [];
    await owner.post(`/orders/${order.body.id}/transition`).send({ to: "IN_PREPARATION" }).expect(201);
    await owner.post(`/orders/${order.body.id}/transition`).send({ to: "SHIPPED" }).expect(201);
    const shipped = rec.sent.filter((x) => x.msg.event === "order.shipped");
    expect(shipped).toHaveLength(4);
    expect(shipped[0].msg.order!.state).toMatchObject({ stepIndex: 2, headline: "Your Kitenge dress is on the way" });

    rec.sent = [];
    await owner.post(`/orders/${order.body.id}/transition`).send({ to: "DELIVERED" }).expect(201);
    const done = rec.sent.find((x) => x.target.kind === "LIVE_ACTIVITY")!;
    expect(done.msg.order!.state).toMatchObject({ phase: "DONE", progress: 1 });

    // Outbox rows (dev adapter / audit) carry the state but never the raw token.
    const rows = await prisma.notification.findMany({ where: { channel: "PUSH", refId: order.body.id } });
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.some((r) => r.body.includes("cd".repeat(32)) || r.to.includes("fcm-"))).toBe(false);
  });

  it("respects preferences: orders off silences alerts; live activity off keeps phone alerts only", async () => {
    const { variantId } = await freshProduct("2");
    const s = await login(`0787${uniq}2`);
    await s.agent.post("/push/devices").send(webSub("p2")).expect(201);
    const ios = { installationId: `ios_${uniq}_p2`, platform: "IOS" };
    await s.agent.post("/push/devices").send({ ...ios, transport: "APNS", token: `apns-ios-${uniq}-p2-xxxxxxxx` }).expect(201);
    await s.agent.post("/push/devices").send({ ...ios, transport: "APNS", kind: "LIVE_ACTIVITY_START", token: "aa".repeat(32) }).expect(201);
    expect((await s.agent.put("/push/prefs").send({ liveActivity: false }).expect(200)).body.prefs).toMatchObject({ liveActivity: false, orders: true });
    await s.agent.put("/push/prefs").send({ orders: "yes" }).expect(400);

    const o = await s.agent.post("/orders").set("idempotency-key", `push-${uniq}-2`).send({ variantId, size: "M", delivery: "PICKUP", wallet: "MTN_MOMO", payerPhone: e164(`0787${uniq}2`) }).expect(201);
    await payments.settle((await prisma.payment.findFirstOrThrow({ where: { orderId: o.body.id } })).providerRef, "SUCCESSFUL", {});
    expect(rec.sent.map((x) => x.target.kind).sort()).toEqual(["DEVICE", "DEVICE"]);

    rec.sent = [];
    await s.agent.put("/push/prefs").send({ orders: false }).expect(200);
    const r = await push.orderUpdate(o.body.id);
    expect(r).toMatchObject({ sent: 0, skipped: 3 });
    expect(rec.sent).toHaveLength(0);
  });

  it("revokes endpoints the provider reports as gone", async () => {
    const s = await login(`0787${uniq}3`);
    await s.agent.post("/push/devices").send(webSub("g3")).expect(201);
    rec.gone.add(webSub("g3").token);
    const r = await push.event(s.userId, "look.ready", { url: "/saved", refId: `g-${uniq}`, vars: { item: "Dress" } });
    expect(r).toMatchObject({ sent: 0, revoked: 1 });
    expect((await prisma.pushDevice.findUniqueOrThrow({ where: { token: webSub("g3").token } })).revokedAt).not.toBeNull();
    const row = await prisma.notification.findFirstOrThrow({ where: { channel: "PUSH", refId: `g-${uniq}` } });
    expect(row.status).toBe("GONE");
  });
});

describe("other events", () => {
  it("look ready, wardrobe reminder and quote are localised; poll votes are throttled; categories filter", async () => {
    const s = await login(`0787${uniq}4`);
    await s.agent.post("/push/devices").send(webSub("e4")).expect(201);
    await s.agent.patch("/auth/me").send({ locale: "rw" }).expect(200);

    await push.event(s.userId, "look.ready", { url: "/looks/x", refId: `l-${uniq}`, vars: { item: "Uruziga" } });
    expect(rec.sent.at(-1)!.msg).toMatchObject({ event: "look.ready", title: "Imyambarire yawe yiteguye ✨" });
    await push.event(s.userId, "custom.quote", { url: "/custom/x", refId: `q-${uniq}`, vars: { maker: "Uwase", item: "Dress", price: "45,000" } });
    expect(rec.sent.at(-1)!.msg.body).toBe("Dress: RWF 45,000. Kanda wemeze.");

    rec.sent = [];
    for (let i = 1; i <= 3; i++) await push.event(s.userId, "circle.vote", { url: "/circle/p", refId: `poll-${uniq}`, vars: { votes: String(i), question: "Which one?" }, throttleMs: 600_000 });
    expect(rec.sent).toHaveLength(1);

    await s.agent.put("/push/prefs").send({ wardrobe: false }).expect(200);
    rec.sent = [];
    await push.event(s.userId, "wardrobe.reminder", { url: "/wardrobe/events/e", refId: `w-${uniq}`, vars: { event: "Ubukwe", when: "tomorrow" } });
    expect(rec.sent).toHaveLength(0);
  });
});

describe("privacy", () => {
  it("exports devices and preferences without tokens, and account deletion removes them", async () => {
    const s = await login(`0787${uniq}5`);
    await s.agent.post("/push/devices").send(android("x5")).expect(201);
    await s.agent.put("/push/prefs").send({ looks: false }).expect(200);
    const ex = await s.agent.get("/privacy/export").expect(200);
    const body = JSON.parse(ex.text);
    expect(body.notificationPreferences).toMatchObject({ looks: false });
    expect(body.pushDevices).toHaveLength(1);
    expect(ex.text).not.toContain(android("x5").token);

    const job = await s.agent.post("/privacy/delete").send({ scope: "ACCOUNT" }).expect(201);
    expect(job.body.steps.some((x: { step: string }) => x.step.startsWith("Push tokens"))).toBe(true);
    expect(await prisma.pushDevice.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.notificationPreference.count({ where: { userId: s.userId } })).toBe(0);
  });
});
