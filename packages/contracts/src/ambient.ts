import { z } from "zod";
import { PUSH_DEVICE_KINDS, PUSH_PLATFORMS, PUSH_TRANSPORTS } from "./ambient-model";

// ==== E38 Native shell · push · live activities / widgets ====
// zod schemas (API validation). The state model and copy live in ambient-model.ts, re-exported here unchanged.
export * from "./ambient-model";

export const NotificationPrefs = z.object({
  orders: z.boolean(),
  looks: z.boolean(),
  circle: z.boolean(),
  custom: z.boolean(),
  wardrobe: z.boolean(),
  /** Lock-screen live activity / ongoing notification for orders in progress. */
  liveActivity: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

export const PushDeviceRegister = z
  .object({
    installationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    platform: z.enum(PUSH_PLATFORMS),
    transport: z.enum(PUSH_TRANSPORTS),
    kind: z.enum(PUSH_DEVICE_KINDS).default("DEVICE"),
    /** FCM registration token, APNs hex token, or the Web Push endpoint URL. */
    token: z.string().min(16).max(4096),
    keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }).optional(),
    orderId: z.string().max(40).optional(),
    appVersion: z.string().max(40).optional(),
    locale: z.enum(["rw", "en", "fr"]).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.transport === "WEBPUSH") {
      if (d.platform !== "WEB") ctx.addIssue({ code: "custom", message: "Web Push is for the web platform", path: ["platform"] });
      if (!d.keys) ctx.addIssue({ code: "custom", message: "Web Push subscriptions need keys", path: ["keys"] });
      if (!/^https:\/\//.test(d.token)) ctx.addIssue({ code: "custom", message: "Web Push endpoint must be https", path: ["token"] });
    } else if (d.platform === "WEB") ctx.addIssue({ code: "custom", message: "The web uses Web Push", path: ["transport"] });
    if (d.transport === "APNS" && d.platform !== "IOS") ctx.addIssue({ code: "custom", message: "APNs tokens come from iOS", path: ["transport"] });
    if (d.kind === "LIVE_ACTIVITY" && !d.orderId) ctx.addIssue({ code: "custom", message: "Live activity tokens belong to an order", path: ["orderId"] });
    if (d.kind !== "DEVICE" && (d.platform !== "IOS" || d.transport !== "APNS")) ctx.addIssue({ code: "custom", message: "Live activity tokens are iOS APNs tokens", path: ["kind"] });
  });
export type PushDeviceRegister = z.input<typeof PushDeviceRegister>;

export const LiveActivityContentState = z.object({
  status: z.string(),
  phase: z.enum(["AWAITING_PAYMENT", "ACTIVE", "DONE", "STOPPED"]),
  stepIndex: z.number().int().min(-1).max(3),
  progress: z.number().min(0).max(1),
  headline: z.string(),
  detail: z.string(),
  stepLabels: z.array(z.string()).length(4),
  readyBy: z.number().int().nullable(),
  updatedAt: z.number().int(),
});
export type LiveActivityContentState = z.infer<typeof LiveActivityContentState>;

export const LiveActivityAttributes = z.object({ orderId: z.string(), code: z.string(), makerName: z.string(), itemTitle: z.string() });
export type LiveActivityAttributes = z.infer<typeof LiveActivityAttributes>;
