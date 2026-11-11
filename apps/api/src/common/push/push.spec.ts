import {
  ambientCopy,
  craftFromEvents,
  DEFAULT_NOTIFICATION_PREFS,
  LiveActivityContentState,
  liveActivityState,
  orderAmbient,
  orderPushEvent,
  pushAllowed,
  PushDeviceRegister,
  type PushMessage,
} from "@nyambika/contracts";
import { createECDH, createVerify, generateKeyPairSync, randomBytes, verify as cryptoVerify } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it, vi } from "vitest";
import { ApnsPushProvider, apnsJwt, apnsRequest, fcmMessage, FcmPushProvider, serviceAccountAssertion, WebPushProvider, webPushPayload, type PushTarget } from "./providers";

const base = { orderId: "o1", code: "NY-ABC123", makerName: "Uwase Couture", itemTitle: "dress", readyBy: "2026-11-19T10:00:00Z", updatedAt: "2026-11-14T08:24:00Z" };

describe("ambient order state (shared contract)", () => {
  it("walks a ready-made delivery order through four steps with growing progress", () => {
    const seq = ["PAID", "ACCEPTED", "IN_PREPARATION", "SHIPPED", "DELIVERED"].map((status) => orderAmbient({ ...base, status, deliveryMode: "DELIVERY" }));
    expect(seq.map((s) => s.stepIndex)).toEqual([0, 1, 1, 2, 3]);
    for (let i = 1; i < seq.length; i++) expect(seq[i].progress).toBeGreaterThan(seq[i - 1].progress);
    expect(seq[0].steps).toEqual(["PAID", "MAKING", "ON_THE_WAY", "DELIVERED"]);
    expect(seq[4]).toMatchObject({ phase: "DONE", readyBy: null });
    expect(seq[1].readyBy).toBe("2026-11-19T10:00:00.000Z");
  });

  it("uses Ready instead of On the way for pickup, and stops on cancel/decline/dispute", () => {
    expect(orderAmbient({ ...base, status: "READY", deliveryMode: "PICKUP" }).steps[2]).toBe("READY");
    for (const status of ["CANCELLED", "DECLINED", "DISPUTED"]) expect(orderAmbient({ ...base, status }).phase).toBe("STOPPED");
    expect(orderAmbient({ ...base, status: "AWAITING_PAYMENT" })).toMatchObject({ phase: "AWAITING_PAYMENT", stepIndex: -1 });
  });

  it("matches the prototype for tailor orders: Paid · Cutting · Sewing · Delivery, ready Thursday", () => {
    const s = orderAmbient({ ...base, status: "IN_PREPARATION", craft: "SEWING" });
    expect(s.kind).toBe("CUSTOM");
    expect(s.steps).toEqual(["PAID", "CUTTING", "SEWING", "DELIVERED"]);
    expect(s.stepIndex).toBe(2);
    const en = ambientCopy(s, "en");
    expect(en.headline).toBe("Uwase Couture is sewing your dress");
    expect(en.detail).toBe("sewing · ready Thursday");
    expect(en.stepLabels).toEqual(["Paid", "Cutting", "Sewing", "Delivery"]);
    expect(ambientCopy(s, "rw").headline).toBe("Uwase Couture arimo kudoda dress");
    expect(ambientCopy(s, "fr").detail).toBe("couture · prêt jeudi");
  });

  it("reads the craft stage back from mirrored order events", () => {
    const events = [
      { status: "ACCEPTED", note: "deposit paid: Deposit RWF 9,000 paid directly to Uwase" },
      { status: "IN_PREPARATION", note: "cutting" },
      { status: "IN_PREPARATION", note: "sewing: hem tomorrow" },
    ];
    expect(craftFromEvents(events)).toEqual({ craft: "SEWING", custom: true });
    expect(craftFromEvents([{ status: "PAID", note: "Paid directly to X" }])).toEqual({ craft: null, custom: false });
  });

  it("produces a ContentState that matches the Swift/Kotlin wire schema", () => {
    const la = liveActivityState(orderAmbient({ ...base, status: "IN_PREPARATION", craft: "CUTTING" }), "en");
    expect(LiveActivityContentState.parse(la)).toEqual(la);
    expect(la.readyBy).toBe(Math.floor(Date.parse(base.readyBy) / 1000));
    expect(Number.isInteger(la.updatedAt)).toBe(true);
  });

  it("alerts only on the moments the shopper waits for", () => {
    expect(["PAID", "ACCEPTED", "IN_PREPARATION", "SHIPPED", "READY", "DELIVERED"].map(orderPushEvent)).toEqual([
      "order.paid",
      "order.progress",
      "order.progress",
      "order.shipped",
      "order.shipped",
      "order.delivered",
    ]);
  });
});

describe("preferences and device registration", () => {
  it("filters by category and keeps live activities to orders", () => {
    const p = { ...DEFAULT_NOTIFICATION_PREFS };
    expect(pushAllowed(p, "look.ready")).toBe(true);
    expect(pushAllowed({ ...p, looks: false }, "look.ready")).toBe(false);
    expect(pushAllowed({ ...p, orders: false }, "order.paid", "LIVE_ACTIVITY")).toBe(false);
    expect(pushAllowed({ ...p, liveActivity: false }, "order.progress", "LIVE_ACTIVITY")).toBe(false);
    expect(pushAllowed({ ...p, liveActivity: false }, "order.progress", "DEVICE")).toBe(true);
    expect(pushAllowed(p, "circle.vote", "LIVE_ACTIVITY")).toBe(false);
  });

  it("validates tokens per transport", () => {
    const ok = (b: object) => PushDeviceRegister.safeParse(b).success;
    const inst = "inst_12345678";
    expect(ok({ installationId: inst, platform: "WEB", transport: "WEBPUSH", token: "https://fcm.googleapis.com/fcm/send/abc123456789", keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) } })).toBe(true);
    expect(ok({ installationId: inst, platform: "WEB", transport: "WEBPUSH", token: "https://push.example/abc123456789" })).toBe(false); // no keys
    expect(ok({ installationId: inst, platform: "WEB", transport: "FCM", token: "x".repeat(40) })).toBe(false);
    expect(ok({ installationId: inst, platform: "ANDROID", transport: "FCM", token: "x".repeat(40) })).toBe(true);
    expect(ok({ installationId: inst, platform: "IOS", transport: "APNS", kind: "LIVE_ACTIVITY", token: "ab".repeat(32) })).toBe(false); // no order
    expect(ok({ installationId: inst, platform: "ANDROID", transport: "FCM", kind: "LIVE_ACTIVITY", orderId: "o", token: "x".repeat(40) })).toBe(false);
    expect(ok({ installationId: inst, platform: "ANDROID", transport: "APNS", token: "x".repeat(40) })).toBe(false);
    expect(ok({ installationId: inst, platform: "IOS", transport: "APNS", token: "ab".repeat(32) })).toBe(true);
    expect(ok({ installationId: "bad id!", platform: "ANDROID", transport: "FCM", token: "x".repeat(40) })).toBe(false);
  });
});

const orderMsg = (status: string, alert: boolean): PushMessage => {
  const state = liveActivityState(orderAmbient({ ...base, status }), "en");
  return { event: orderPushEvent(status), title: state.headline, body: state.detail, url: "/orders/o1", tag: "order-o1", alert, refId: "o1", order: { attributes: { orderId: "o1", code: base.code, makerName: base.makerName, itemTitle: "dress" }, state } };
};
const target = (over: Partial<PushTarget>): PushTarget => ({ id: "d1", platform: "ANDROID", transport: "FCM", kind: "DEVICE", token: "fcm-token-123", ...over });

describe("FCM HTTP v1 payloads", () => {
  it("sends Android order updates as data-only (the app renders the Live Update)", () => {
    const m = fcmMessage(target({}), orderMsg("SHIPPED", true)) as { data: Record<string, string>; android: Record<string, unknown>; notification?: unknown };
    expect(m.notification).toBeUndefined();
    expect(m.android).toMatchObject({ priority: "HIGH", collapse_key: "order-o1" });
    expect(m.android.notification).toBeUndefined();
    expect(Object.values(m.data).every((v) => typeof v === "string")).toBe(true);
    expect(JSON.parse(m.data.state)).toMatchObject({ status: "SHIPPED", stepIndex: 2 });
  });

  it("gives non-order Android events a tray notification", () => {
    const m = fcmMessage(target({}), { event: "look.ready", title: "Ready", body: "b", url: "/x", tag: "t", alert: true }) as { android: { notification: { channel_id: string } } };
    expect(m.android.notification.channel_id).toBe("general");
  });

});

describe("APNs requests (iOS)", () => {
  it("maps iOS alerts and silent updates to APNs headers", () => {
    const ios = target({ platform: "IOS", transport: "APNS", token: "ab".repeat(32) });
    const alert = apnsRequest(ios, orderMsg("PAID", true), "rw.nyambika.app", 1000);
    expect(alert.path).toBe(`/3/device/${"ab".repeat(32)}`);
    expect(alert.headers).toMatchObject({ "apns-topic": "rw.nyambika.app", "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": "order-o1" });
    expect(alert.payload).toMatchObject({ aps: { alert: { title: "Paid directly to Uwase Couture" }, "thread-id": "order-o1" }, url: "/orders/o1" });
    const silent = apnsRequest(ios, orderMsg("ACCEPTED", false), "rw.nyambika.app", 1000);
    expect(silent.headers["apns-push-type"]).toBe("background");
    expect(silent.payload.aps).toEqual({ "content-available": 1 });
  });

  it("updates, ends and push-starts Live Activities with the liveactivity push type", () => {
    const la = target({ platform: "IOS", transport: "APNS", kind: "LIVE_ACTIVITY", token: "la-token" });
    const upd = apnsRequest(la, orderMsg("IN_PREPARATION", false), "rw.nyambika.app", 1000);
    expect(upd.headers).toMatchObject({ "apns-topic": "rw.nyambika.app.push-type.liveactivity", "apns-push-type": "liveactivity", "apns-priority": "5" });
    const aps = upd.payload.aps as Record<string, unknown>;
    expect(aps).toMatchObject({ event: "update", timestamp: 1000, "stale-date": 1000 + 86400 });
    expect(aps.alert).toBeUndefined();
    expect(LiveActivityContentState.parse(aps["content-state"])).toBeTruthy();
    const end = apnsRequest(la, orderMsg("DELIVERED", true), "rw.nyambika.app", 1000);
    expect(end.payload.aps).toMatchObject({ event: "end", "dismissal-date": 1000 + 4 * 3600, alert: { title: "Delivered. Enjoy it!" } });
    const start = apnsRequest({ ...la, kind: "LIVE_ACTIVITY_START" }, orderMsg("PAID", true), "rw.nyambika.app", 1000);
    expect(start.headers["apns-priority"]).toBe("10");
    expect(start.payload.aps).toMatchObject({ event: "start", "attributes-type": "OrderActivityAttributes", attributes: { orderId: "o1", code: "NY-ABC123" } });
  });
});

describe("APNs provider (mocked HTTP/2)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const cfg = { keyId: "ABC123DEFG", teamId: "TEAM123456", key: privateKey, topic: "rw.nyambika.app", production: false };

  it("signs an ES256 provider token with a raw r||s signature", () => {
    const jwt = apnsJwt(cfg, 1_800_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_800_000_000 });
    expect(Buffer.from(s, "base64url")).toHaveLength(64);
    expect(cryptoVerify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("posts to the sandbox, reuses the token and revokes BadDeviceToken / 410", async () => {
    const calls: { authority: string; path: string; headers: Record<string, string>; body: string }[] = [];
    let next = { status: 200, body: "", apnsId: "id-1" };
    const p = new ApnsPushProvider(cfg, async (r) => {
      calls.push(r);
      return next;
    });
    const ios = target({ platform: "IOS", transport: "APNS", token: "ab".repeat(32) });
    expect(await p.send(ios, orderMsg("PAID", true))).toEqual({ ok: true, providerId: "id-1" });
    await p.send(ios, orderMsg("ACCEPTED", false));
    expect(calls[0].authority).toBe("https://api.sandbox.push.apple.com");
    expect(calls[0].headers.authorization).toMatch(/^bearer /);
    expect(calls[0].headers.authorization).toBe(calls[1].headers.authorization);
    expect(JSON.parse(calls[0].body).aps.alert.title).toBe("Paid directly to Uwase Couture");
    next = { status: 400, body: '{"reason":"BadDeviceToken"}', apnsId: "" };
    expect(await p.send(ios, orderMsg("PAID", true))).toMatchObject({ ok: false, gone: true });
    next = { status: 410, body: '{"reason":"Unregistered"}', apnsId: "" };
    expect(await p.send(ios, orderMsg("PAID", true))).toMatchObject({ ok: false, gone: true });
    next = { status: 429, body: '{"reason":"TooManyRequests"}', apnsId: "" };
    expect(await p.send(ios, orderMsg("PAID", true))).toMatchObject({ ok: false, gone: false });
  });

  it("reads its configuration from env and stays off without it", () => {
    expect(ApnsPushProvider.fromEnv({})).toBeNull();
    expect(ApnsPushProvider.fromEnv({ APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_KEY_P8: Buffer.from(privateKey).toString("base64") })).toBeInstanceOf(ApnsPushProvider);
  });
});

describe("FCM provider (mocked HTTP)", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const sa = { project_id: "nyambika-test", client_email: "push@nyambika-test.iam.gserviceaccount.com", private_key: privateKey };

  it("signs a valid RS256 service-account assertion", () => {
    const jwt = serviceAccountAssertion(sa, 1_800_000_000);
    const [h, c, s] = jwt.split(".");
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", exp: 1_800_003_600 });
  });

  it("caches the access token, posts to the v1 endpoint and flags unregistered tokens as gone", async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    let sendStatus = 200;
    const fetchMock = vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: init.body, headers: init.headers });
      if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "ya29.test", expires_in: 3600 }), text: async () => "" };
      return sendStatus === 200
        ? { ok: true, status: 200, json: async () => ({ name: "projects/nyambika-test/messages/1" }), text: async () => "" }
        : { ok: false, status: sendStatus, json: async () => ({}), text: async () => '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' };
    });
    const p = new FcmPushProvider(sa, fetchMock);
    expect(await p.send(target({}), orderMsg("PAID", true))).toMatchObject({ ok: true, providerId: "projects/nyambika-test/messages/1" });
    await p.send(target({}), orderMsg("ACCEPTED", false));
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const send = calls.find((c) => c.url.includes("fcm.googleapis.com"))!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/nyambika-test/messages:send");
    expect(send.headers.authorization).toBe("Bearer ya29.test");
    expect(JSON.parse(send.body).message.token).toBe("fcm-token-123");
    sendStatus = 404;
    expect(await p.send(target({}), orderMsg("PAID", true))).toMatchObject({ ok: false, gone: true });
  });
});

describe("Web Push provider", () => {
  const vapid = { ...webpush.generateVAPIDKeys(), subject: "mailto:test@nyambika.rw" };
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const sub = target({ platform: "WEB", transport: "WEBPUSH", token: "https://push.example.test/send/abc", p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") });

  it("encrypts a real aes128gcm request with VAPID (no network)", () => {
    const req = webpush.generateRequestDetails({ endpoint: sub.token, keys: { p256dh: sub.p256dh!, auth: sub.auth! } }, JSON.stringify(webPushPayload(orderMsg("PAID", true))), { vapidDetails: vapid, TTL: 60 });
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(String(req.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
    expect((req.body as Buffer).length).toBeGreaterThan(100);
  });

  it("sends tag/urgency/topic and revokes on 410", async () => {
    const send = vi.fn(async () => ({ statusCode: 201, body: "", headers: {} }));
    const p = new WebPushProvider(vapid, send as never);
    expect(await p.send(sub, orderMsg("PAID", true))).toMatchObject({ ok: true });
    const [subscription, payload, opts] = send.mock.calls[0] as unknown as [unknown, string, { urgency: string; topic: string }];
    expect(subscription).toMatchObject({ endpoint: sub.token });
    expect(JSON.parse(payload)).toMatchObject({ tag: "order-o1", url: "/orders/o1", renotify: true, stepIndex: 0 });
    expect(opts.urgency).toBe("high");
    expect(opts.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    send.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    expect(await p.send(sub, orderMsg("PAID", true))).toMatchObject({ ok: false, gone: true });
    expect(await p.send({ ...sub, p256dh: null }, orderMsg("PAID", true))).toMatchObject({ ok: false, gone: true });
  });
});
