import type { PushMessage } from "@nyambika/contracts";
import { createHash, createPrivateKey, createSign, sign as cryptoSign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import webpush from "web-push";

/**
 * Push transports (messaging module, next to the WhatsApp/SMS outbox adapters, SI-03/04).
 *
 * - `DevOutboxPushProvider`: default outside production. Nothing leaves the machine; every push is a
 *   row in the outbox (`Notification`, channel PUSH) so crawls and tests can assert on it.
 * - `FcmPushProvider`: Firebase Cloud Messaging HTTP v1 for Android (FCM registration tokens).
 * - `ApnsPushProvider`: Apple Push Notification service over HTTP/2 with a token (.p8) key, for iOS
 *   alerts and ActivityKit Live Activity start/update/end. No Firebase SDK ships in the iOS app.
 * - `WebPushProvider`: RFC 8030/8291 Web Push with VAPID for the PWA.
 */

export interface PushTarget {
  id: string;
  platform: "IOS" | "ANDROID" | "WEB" | string;
  transport: "FCM" | "APNS" | "WEBPUSH" | string;
  kind: "DEVICE" | "LIVE_ACTIVITY" | "LIVE_ACTIVITY_START" | string;
  token: string;
  p256dh?: string | null;
  auth?: string | null;
}

export interface PushResult {
  ok: boolean;
  /** The endpoint no longer exists: revoke the device. */
  gone?: boolean;
  error?: string;
  providerId?: string;
}

export interface PushProvider {
  readonly name: string;
  send(target: PushTarget, msg: PushMessage): Promise<PushResult>;
}

export class DevOutboxPushProvider implements PushProvider {
  readonly name = "dev-outbox";
  async send(): Promise<PushResult> {
    return { ok: true, providerId: "outbox" };
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// ── FCM HTTP v1 (Android) ────────────────────────────────────────────────────

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;

/** Google OAuth2 service-account assertion (RFC 7523), signed RS256. */
export function serviceAccountAssertion(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(sa.private_key).toString("base64url")}`;
}

/** Builds the FCM v1 `message` for one Android target. Pure, so the payload shape is unit-tested. */
export function fcmMessage(t: PushTarget, msg: PushMessage): Record<string, unknown> {
  const data: Record<string, string> = { event: msg.event, url: msg.url, tag: msg.tag, title: msg.title, body: msg.body, alert: msg.alert ? "1" : "0" };
  if (msg.order) {
    data.order = JSON.stringify(msg.order.attributes);
    data.state = JSON.stringify(msg.order.state);
  }
  // Order updates are data-only: the app's messaging service (NyambikaMessagingService.kt) renders the
  // ongoing Live Update and refreshes the widget. Other events carry a tray notification.
  return {
    token: t.token,
    data,
    android: {
      priority: msg.alert || msg.order ? "HIGH" : "NORMAL",
      collapse_key: msg.tag,
      ttl: "86400s",
      ...(msg.order ? {} : { notification: { title: msg.title, body: msg.body, tag: msg.tag, channel_id: "general", icon: "ic_stat_nyambika" } }),
    },
  };
}

export class FcmPushProvider implements PushProvider {
  readonly name = "fcm";
  private cached: { token: string; exp: number } | null = null;
  constructor(
    private sa: ServiceAccount,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  static fromEnv(raw = process.env.FCM_SERVICE_ACCOUNT_JSON): FcmPushProvider | null {
    if (!raw) return null;
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(json) as ServiceAccount;
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error("FCM_SERVICE_ACCOUNT_JSON is missing fields");
    return new FcmPushProvider(sa);
  }

  async accessToken(nowSec = Math.floor(Date.now() / 1000)) {
    if (this.cached && this.cached.exp - 60 > nowSec) return this.cached.token;
    const res = await this.fetchImpl(this.sa.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountAssertion(this.sa, nowSec) }).toString(),
    });
    if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: body.access_token, exp: nowSec + (body.expires_in ?? 3600) };
    return body.access_token;
  }

  async send(t: PushTarget, msg: PushMessage): Promise<PushResult> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: fcmMessage(t, msg) }),
    });
    if (res.ok) {
      const body = (await res.json()) as { name?: string };
      return { ok: true, providerId: body.name };
    }
    const text = await res.text();
    // https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
    const gone = res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text);
    return { ok: false, gone, error: `${res.status} ${text.slice(0, 200)}` };
  }
}

// ── APNs (iOS alerts + Live Activities) ──────────────────────────────────────

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** Contents of the AuthKey_XXXX.p8 file. */
  key: string;
  /** App bundle id, e.g. rw.nyambika.app. */
  topic: string;
  production: boolean;
}

export interface ApnsRequest {
  path: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

/** Provider authentication token (ES256, raw r||s signature), valid for up to an hour. */
export function apnsJwt(c: Pick<ApnsConfig, "keyId" | "teamId" | "key">, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: c.keyId }));
  const claims = b64url(JSON.stringify({ iss: c.teamId, iat: nowSec }));
  const sig = cryptoSign("sha256", Buffer.from(`${header}.${claims}`), { key: createPrivateKey(c.key), dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${sig.toString("base64url")}`;
}

/**
 * Builds the APNs request for one iOS target. Live Activity tokens use the `liveactivity` push type
 * and the `<bundle>.push-type.liveactivity` topic; `content-state` decodes into
 * `OrderActivityAttributes.ContentState` (apps/native/ios/App/NyambikaWidgets/OrderActivityAttributes.swift).
 */
export function apnsRequest(t: PushTarget, msg: PushMessage, topic: string, nowSec = Math.floor(Date.now() / 1000)): ApnsRequest {
  const path = `/3/device/${t.token}`;
  if (t.kind === "LIVE_ACTIVITY" || t.kind === "LIVE_ACTIVITY_START") {
    if (!msg.order) throw new Error("Live activity pushes need an order state");
    const ended = msg.order.state.phase === "DONE" || msg.order.state.phase === "STOPPED";
    const start = t.kind === "LIVE_ACTIVITY_START";
    const loud = msg.alert || start;
    return {
      path,
      headers: { "apns-topic": `${topic}.push-type.liveactivity`, "apns-push-type": "liveactivity", "apns-priority": loud ? "10" : "5", "apns-expiration": String(nowSec + 8 * 3600) },
      payload: {
        aps: {
          timestamp: nowSec,
          event: start ? "start" : ended ? "end" : "update",
          "content-state": msg.order.state,
          ...(start ? { "attributes-type": "OrderActivityAttributes", attributes: msg.order.attributes } : {}),
          ...(ended ? { "dismissal-date": nowSec + 4 * 3600 } : { "stale-date": nowSec + 24 * 3600 }),
          ...(loud ? { alert: { title: msg.title, body: msg.body }, sound: "default" } : {}),
        },
      },
    };
  }
  const custom: Record<string, unknown> = { event: msg.event, url: msg.url };
  if (msg.order) custom.order = { attributes: msg.order.attributes, state: msg.order.state };
  return {
    path,
    headers: {
      "apns-topic": topic,
      "apns-push-type": msg.alert ? "alert" : "background",
      "apns-priority": msg.alert ? "10" : "5",
      "apns-collapse-id": msg.tag.slice(0, 64),
      "apns-expiration": String(nowSec + 86400),
    },
    payload: {
      aps: msg.alert
        ? { alert: { title: msg.title, body: msg.body }, sound: "default", "thread-id": msg.tag, "mutable-content": 1, "relevance-score": msg.order ? 1 : 0.5 }
        : { "content-available": 1 },
      ...custom,
    },
  };
}

export type ApnsTransport = (req: { authority: string; path: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; body: string; apnsId?: string }>;

/** Default HTTP/2 transport with one reused session per authority. */
export function http2Transport(): ApnsTransport {
  const sessions = new Map<string, ClientHttp2Session>();
  const session = (authority: string) => {
    let s = sessions.get(authority);
    if (!s || s.closed || s.destroyed) {
      s = connect(authority);
      s.on("error", () => sessions.delete(authority));
      s.on("close", () => sessions.delete(authority));
      s.unref();
      sessions.set(authority, s);
    }
    return s;
  };
  return (r) =>
    new Promise((resolve, reject) => {
      const req = session(r.authority).request({ ":method": "POST", ":path": r.path, "content-type": "application/json", ...r.headers });
      let status = 0;
      let apnsId: string | undefined;
      let body = "";
      req.setEncoding("utf8");
      req.on("response", (h) => {
        status = Number(h[":status"]);
        apnsId = h["apns-id"] as string | undefined;
      });
      req.on("data", (c: string) => (body += c));
      req.on("end", () => resolve({ status, body, apnsId }));
      req.on("error", reject);
      req.setTimeout(10_000, () => req.close());
      req.end(r.body);
    });
}

export class ApnsPushProvider implements PushProvider {
  readonly name = "apns";
  private cached: { jwt: string; at: number } | null = null;
  constructor(
    private c: ApnsConfig,
    private transport: ApnsTransport = http2Transport(),
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ApnsPushProvider | null {
    if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_KEY_P8) return null;
    const raw = env.APNS_KEY_P8;
    const key = raw.includes("BEGIN PRIVATE KEY") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
    return new ApnsPushProvider({ keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, key, topic: env.APNS_TOPIC ?? "rw.nyambika.app", production: env.APNS_ENV !== "sandbox" });
  }

  token(nowSec = Math.floor(Date.now() / 1000)) {
    // APNs rejects tokens older than an hour and throttles refreshes more often than every 20 minutes.
    if (this.cached && nowSec - this.cached.at < 40 * 60) return this.cached.jwt;
    this.cached = { jwt: apnsJwt(this.c, nowSec), at: nowSec };
    return this.cached.jwt;
  }

  async send(t: PushTarget, msg: PushMessage): Promise<PushResult> {
    const r = apnsRequest(t, msg, this.c.topic);
    const res = await this.transport({
      authority: this.c.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com",
      path: r.path,
      headers: { authorization: `bearer ${this.token()}`, ...r.headers },
      body: JSON.stringify(r.payload),
    });
    if (res.status === 200) return { ok: true, providerId: res.apnsId };
    // https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
    let reason = "";
    try {
      reason = (JSON.parse(res.body) as { reason?: string }).reason ?? "";
    } catch {}
    const gone = res.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"].includes(reason);
    return { ok: false, gone, error: `${res.status} ${reason}`.trim() };
  }
}

// ── Web Push ─────────────────────────────────────────────────────────────────

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

type WebPushSend = typeof webpush.sendNotification;

/** The JSON the service worker receives (`apps/web/public/sw.js` push handler). */
export function webPushPayload(msg: PushMessage) {
  return {
    title: msg.title,
    body: msg.body,
    url: msg.url,
    tag: msg.tag,
    event: msg.event,
    renotify: msg.alert,
    silent: !msg.alert,
    ...(msg.order ? { progress: msg.order.state.progress, steps: msg.order.state.stepLabels, stepIndex: msg.order.state.stepIndex } : {}),
  };
}

export class WebPushProvider implements PushProvider {
  readonly name = "webpush";
  constructor(
    private vapid: VapidKeys,
    private sendImpl: WebPushSend = webpush.sendNotification.bind(webpush),
  ) {}

  async send(t: PushTarget, msg: PushMessage): Promise<PushResult> {
    if (!t.p256dh || !t.auth) return { ok: false, gone: true, error: "Subscription has no keys" };
    try {
      const r = await this.sendImpl({ endpoint: t.token, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(webPushPayload(msg)), {
        vapidDetails: this.vapid,
        TTL: msg.alert ? 86400 : 3600,
        urgency: msg.alert ? "high" : "normal",
        // Topic: a newer message replaces an undelivered older one for the same order (max 32 url-safe chars).
        topic: createHash("sha256").update(msg.tag).digest("base64url").slice(0, 32),
      });
      return { ok: true, providerId: String(r.statusCode) };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410, error: `${status ?? ""} ${(e as Error).message}`.trim() };
    }
  }
}
