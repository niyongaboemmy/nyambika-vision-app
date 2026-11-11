import { Injectable, Logger } from "@nestjs/common";
import {
  craftFromEvents,
  DEFAULT_NOTIFICATION_PREFS,
  eventCopy,
  liveActivityState,
  orderAmbient,
  orderPushEvent,
  PUSH_EVENTS,
  pushAllowed,
  PushDeviceRegister,
  type CraftStage,
  type NotificationPrefs,
  type PushDeviceKind,
  type PushEvent,
  type PushMessage,
} from "@nyambika/contracts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import webpush from "web-push";
import { config } from "../../config";
import { PrismaService } from "../prisma.service";
import { parse } from "../zod";
import { DevOutboxPushProvider, FcmPushProvider, WebPushProvider, type PushProvider, type PushResult, type PushTarget, type VapidKeys } from "./providers";

type Locale = "rw" | "en" | "fr";
const asLocale = (l: string | null | undefined): Locale => (l === "rw" || l === "fr" ? l : "en");

export interface FanOutResult {
  sent: number;
  failed: number;
  skipped: number;
  revoked: number;
  targets: { deviceId: string; kind: string; transport: string; ok: boolean }[];
}

/**
 * Push fan-out (FR-ORD-05 "in-app", FR-TRY-06 "notification when ready", E38 ambient moment).
 * Resolves the user's preferences and live devices, builds one localised message and hands it to
 * the transport for each device. Push never breaks the business flow that triggered it.
 */
@Injectable()
export class PushService {
  private log = new Logger("Push");
  private vapidKeys: VapidKeys | null = null;
  /** Overridable in tests. */
  providers: { fcm: PushProvider; webpush: PushProvider; mode: "dev" | "live" };

  constructor(private prisma: PrismaService) {
    const live = (process.env.PUSH_PROVIDER ?? (process.env.NODE_ENV === "production" ? "live" : "dev")) === "live";
    const dev = new DevOutboxPushProvider();
    let fcm: PushProvider = dev;
    if (live) {
      try {
        fcm = FcmPushProvider.fromEnv() ?? dev;
      } catch (e) {
        this.log.error(`FCM disabled: ${(e as Error).message}`);
      }
      if (fcm === dev) this.log.warn("PUSH_PROVIDER=live but no FCM_SERVICE_ACCOUNT_JSON: native pushes go to the outbox only");
    }
    this.providers = { fcm, webpush: live ? new WebPushProvider(this.vapid()) : dev, mode: live ? "live" : "dev" };
  }

  /** VAPID keys from env; in development a pair is generated once and kept under storage/private. */
  vapid(): VapidKeys {
    if (this.vapidKeys) return this.vapidKeys;
    const subject = process.env.VAPID_SUBJECT ?? "mailto:privacy@nyambika.rw";
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      return (this.vapidKeys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject });
    }
    if (process.env.NODE_ENV === "production") throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are required in production");
    const file = resolve(config.storageDir, "private/vapid-dev.json");
    if (existsSync(file)) return (this.vapidKeys = { ...JSON.parse(readFileSync(file, "utf8")), subject });
    const k = webpush.generateVAPIDKeys();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(k), { mode: 0o600 });
    return (this.vapidKeys = { ...k, subject });
  }

  // ── devices ────────────────────────────────────────────────────────────────

  async register(userId: string, body: unknown) {
    const d = parse(PushDeviceRegister, body);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { locale: true } });
    const data = {
      userId,
      installationId: d.installationId,
      platform: d.platform,
      transport: d.transport,
      kind: d.kind,
      p256dh: d.keys?.p256dh ?? null,
      auth: d.keys?.auth ?? null,
      orderId: d.orderId ?? null,
      locale: d.locale ?? user.locale,
      appVersion: d.appVersion ?? null,
      lastSeenAt: new Date(),
      revokedAt: null,
      failures: 0,
    };
    // A token belongs to whoever registered it last (shared phones, account switch).
    const device = await this.prisma.pushDevice.upsert({ where: { token: d.token }, create: { ...data, token: d.token }, update: data });
    if (d.kind === "DEVICE") {
      // Tokens rotate: an installation keeps one live DEVICE token per transport.
      await this.prisma.pushDevice.updateMany({
        where: { installationId: d.installationId, transport: d.transport, kind: "DEVICE", id: { not: device.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { device: this.deviceView(device) };
  }

  /** Sign-out on this device: drop every token of the installation for this user. */
  async revokeInstallation(userId: string | null, installationId: string) {
    const r = await this.prisma.pushDevice.updateMany({ where: { installationId, revokedAt: null, ...(userId ? { userId } : {}) }, data: { revokedAt: new Date() } });
    return { revoked: r.count };
  }

  async revokeDevice(userId: string, id: string) {
    const r = await this.prisma.pushDevice.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: r.count };
  }

  async devices(userId: string) {
    const rows = await this.prisma.pushDevice.findMany({ where: { userId, revokedAt: null, kind: "DEVICE" }, orderBy: { lastSeenAt: "desc" } });
    return rows.map((d) => this.deviceView(d));
  }

  private deviceView(d: { id: string; platform: string; transport: string; kind: string; appVersion: string | null; createdAt: Date; lastSeenAt: Date; installationId: string }) {
    return { id: d.id, platform: d.platform, transport: d.transport, kind: d.kind, appVersion: d.appVersion, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, installationId: d.installationId };
  }

  // ── preferences ────────────────────────────────────────────────────────────

  async prefs(userId: string): Promise<NotificationPrefs> {
    const p = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (!p) return { ...DEFAULT_NOTIFICATION_PREFS };
    return { orders: p.orders, looks: p.looks, circle: p.circle, custom: p.custom, wardrobe: p.wardrobe, liveActivity: p.liveActivity };
  }

  async setPrefs(userId: string, patch: Partial<NotificationPrefs>) {
    const next = { ...(await this.prefs(userId)), ...patch };
    await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...next }, update: next });
    return next;
  }

  // ── privacy ────────────────────────────────────────────────────────────────

  async exportFor(userId: string) {
    const [prefs, devices] = await Promise.all([
      this.prefs(userId),
      this.prisma.pushDevice.findMany({ where: { userId }, select: { platform: true, transport: true, kind: true, appVersion: true, locale: true, createdAt: true, lastSeenAt: true, revokedAt: true, orderId: true } }),
    ]);
    // Raw tokens are credentials to reach the phone: they are never exported.
    return { notificationPreferences: prefs, pushDevices: devices };
  }

  async deleteFor(userId: string) {
    const [d] = await Promise.all([this.prisma.pushDevice.deleteMany({ where: { userId } }), this.prisma.notificationPreference.deleteMany({ where: { userId } })]);
    return d.count;
  }

  // ── fan-out ────────────────────────────────────────────────────────────────

  /**
   * Send `event` to every live device of `userId` that the preferences allow. `build` is called once
   * per locale. `throttleMs` drops the push if the same event/ref already reached this user recently.
   */
  async notify(userId: string, event: PushEvent, build: (l: Locale) => PushMessage, opts: { throttleMs?: number } = {}): Promise<FanOutResult> {
    const res: FanOutResult = { sent: 0, failed: 0, skipped: 0, revoked: 0, targets: [] };
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true, deletedAt: true } });
      if (!user || user.deletedAt) return res;
      const prefs = await this.prefs(userId);
      const all = await this.prisma.pushDevice.findMany({ where: { userId, revokedAt: null } });
      if (!all.length) return res;
      const msg = build(asLocale(user.locale));
      if (opts.throttleMs && msg.refId) {
        const recent = await this.prisma.notification.count({ where: { channel: "PUSH", template: event, refId: msg.refId, to: { startsWith: `user:${userId}/` }, createdAt: { gte: new Date(Date.now() - opts.throttleMs) } } });
        if (recent) {
          res.skipped = all.length;
          return res;
        }
      }
      const orderId = msg.order?.attributes.orderId;
      const hasActivity = orderId ? all.some((d) => d.kind === "LIVE_ACTIVITY" && d.orderId === orderId) : false;
      for (const d of all) {
        const kind = d.kind as PushDeviceKind;
        const eligible =
          pushAllowed(prefs, event, kind) &&
          (kind === "DEVICE" ||
            (kind === "LIVE_ACTIVITY" && !!orderId && d.orderId === orderId) ||
            // Push-to-start (iOS 17.2+): only once, when payment lands and no activity exists yet.
            (kind === "LIVE_ACTIVITY_START" && event === "order.paid" && !hasActivity));
        if (!eligible) {
          res.skipped++;
          continue;
        }
        const fcmToken = kind === "DEVICE" ? null : all.find((x) => x.installationId === d.installationId && x.kind === "DEVICE" && x.transport === "FCM")?.token ?? null;
        const target: PushTarget = { ...d, fcmToken };
        const r = await this.deliver(userId, target, event, msg);
        res.targets.push({ deviceId: d.id, kind: d.kind, transport: d.transport, ok: r.ok });
        if (r.ok) res.sent++;
        else res.failed++;
        if (r.gone) res.revoked++;
      }
    } catch (e) {
      this.log.error(`push ${event} → ${userId} failed: ${(e as Error).message}`);
    }
    return res;
  }

  private async deliver(userId: string, t: PushTarget, event: PushEvent, msg: PushMessage): Promise<PushResult> {
    const provider = t.transport === "WEBPUSH" ? this.providers.webpush : this.providers.fcm;
    let r: PushResult;
    try {
      r = await provider.send(t, msg);
    } catch (e) {
      r = { ok: false, error: (e as Error).message };
    }
    if (r.gone) await this.prisma.pushDevice.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
    else if (!r.ok) await this.prisma.pushDevice.update({ where: { id: t.id }, data: { failures: { increment: 1 } } });
    // Outbox row: the dev adapter's delivery, and the audit trail for live providers. No raw tokens.
    await this.prisma.notification.create({
      data: {
        channel: "PUSH",
        to: `user:${userId}/${t.platform}/${t.kind}/${t.id}`,
        template: event,
        body: JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag, alert: msg.alert, ...(msg.order ? { state: msg.order.state } : {}), provider: provider.name }),
        status: r.ok ? "SENT" : r.gone ? "GONE" : "FAILED",
        refId: msg.refId,
      },
    });
    if (!r.ok) this.log.warn(`push ${event} via ${provider.name} failed: ${r.error}`);
    return r;
  }

  // ── domain events ──────────────────────────────────────────────────────────

  /** Order lifecycle → ambient state → alert (paid/shipped/delivered) or silent live-activity update. */
  async orderUpdate(orderId: string, opts: { craft?: CraftStage | null } = {}): Promise<FanOutResult | null> {
    try {
      const o = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true, page: true, events: { orderBy: { createdAt: "asc" } } } });
      if (!o || o.status === "NEW" || o.status === "AWAITING_PAYMENT") return null;
      const derived = craftFromEvents(o.events);
      const craft = opts.craft !== undefined ? opts.craft : derived.craft;
      const state = orderAmbient({
        orderId: o.id,
        code: o.code,
        status: o.status,
        makerName: o.page.name,
        itemTitle: o.items[0]?.title,
        craft: o.status === "IN_PREPARATION" ? craft : null,
        custom: derived.custom || !!craft,
        deliveryMode: o.deliveryMode,
        readyBy: o.readyBy,
        updatedAt: o.events.at(-1)?.createdAt ?? new Date(),
      });
      const event = orderPushEvent(o.status);
      const alert = PUSH_EVENTS[event].alert || state.phase === "STOPPED";
      return await this.notify(o.shopperId, event, (l) => {
        const la = liveActivityState(state, l);
        return {
          event,
          title: la.headline,
          body: [o.code, la.detail].filter(Boolean).join(" · "),
          url: `/orders/${o.id}`,
          tag: `order-${o.id}`,
          alert,
          refId: o.id,
          order: { attributes: { orderId: o.id, code: o.code, makerName: o.page.name, itemTitle: o.items[0]?.title ?? "" }, state: la },
        };
      });
    } catch (e) {
      this.log.error(`order push ${orderId}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Simple alert for the non-order events. */
  async event(userId: string, event: Exclude<PushEvent, `order.${string}`>, p: { url: string; refId: string; vars: Record<string, string>; tag?: string; throttleMs?: number }) {
    return this.notify(
      userId,
      event,
      (l) => {
        const c = eventCopy(event, l, p.vars);
        return { event, title: c.title, body: c.body, url: p.url, tag: p.tag ?? `${event}-${p.refId}`, alert: true, refId: p.refId };
      },
      { throttleMs: p.throttleMs },
    );
  }
}
