import type { PushMessage } from "@nyambika/contracts";
import { createHash, createSign } from "node:crypto";
import webpush from "web-push";

/**
 * Push transports (messaging module, next to the WhatsApp/SMS outbox adapters, SI-03/04).
 *
 * - `DevOutboxPushProvider`: default outside production. Nothing leaves the machine; every push is a
 *   row in the outbox (`Notification`, channel PUSH) so crawls and tests can assert on it.
 * - `FcmPushProvider`: Firebase Cloud Messaging HTTP v1 for Android and iOS (APNs via FCM),
 *   including iOS Live Activity updates through `apns.live_activity_token`.
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
  /** iOS live-activity tokens are delivered through FCM together with this installation's FCM token. */
  fcmToken?: string | null;
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

// ── FCM HTTP v1 ──────────────────────────────────────────────────────────────

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

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

/** Builds the FCM v1 `message` for one target. Pure, so the payload shape is unit-tested. */
export function fcmMessage(t: PushTarget, msg: PushMessage, nowSec = Math.floor(Date.now() / 1000)): Record<string, unknown> {
  const data: Record<string, string> = { event: msg.event, url: msg.url, tag: msg.tag, title: msg.title, body: msg.body, alert: msg.alert ? "1" : "0" };
  if (msg.order) {
    data.order = JSON.stringify(msg.order.attributes);
    data.state = JSON.stringify(msg.order.state);
  }

  if (t.kind === "LIVE_ACTIVITY" || t.kind === "LIVE_ACTIVITY_START") {
    if (!msg.order) throw new Error("Live activity pushes need an order state");
    const ended = msg.order.state.phase === "DONE" || msg.order.state.phase === "STOPPED";
    const start = t.kind === "LIVE_ACTIVITY_START";
    return {
      token: t.fcmToken,
      apns: {
        live_activity_token: t.token,
        headers: { "apns-priority": msg.alert || start ? "10" : "5" },
        payload: {
          aps: {
            timestamp: nowSec,
            event: start ? "start" : ended ? "end" : "update",
            "content-state": msg.order.state,
            ...(start ? { "attributes-type": "OrderActivityAttributes", attributes: msg.order.attributes } : {}),
            ...(ended ? { "dismissal-date": nowSec + 4 * 3600 } : {}),
            ...(msg.alert || start ? { alert: { title: msg.title, body: msg.body } } : {}),
          },
        },
      },
    };
  }

  if (t.platform === "ANDROID") {
    // Order updates are data-only: the app's messaging service renders the ongoing Live Update and
    // refreshes the widget itself. Other events carry a display notification for the system tray.
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

  // iOS app (FCM token, APNs underneath).
  return {
    token: t.token,
    data,
    ...(msg.alert ? { notification: { title: msg.title, body: msg.body } } : {}),
    apns: {
      headers: {
        "apns-collapse-id": msg.tag.slice(0, 64),
        "apns-priority": msg.alert ? "10" : "5",
        "apns-push-type": msg.alert ? "alert" : "background",
      },
      payload: { aps: msg.alert ? { sound: "default", "thread-id": msg.tag, "mutable-content": 1 } : { "content-available": 1 } },
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
    if ((t.kind !== "DEVICE") && !t.fcmToken) return { ok: false, error: "No FCM token for this installation" };
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

// ── Web Push ─────────────────────────────────────────────────────────────────

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

type WebPushSend = typeof webpush.sendNotification;

/** The JSON the service worker receives (`public/sw.js` push handler). */
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
