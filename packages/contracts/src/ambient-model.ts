// Ambient order model without zod, for browser bundles (`@nyambika/contracts/ambient-model`).
// The zod schemas live in `ambient.ts`, which re-exports all of this.

// ==== E38 Native shell · push · live activities / widgets (the "ambient moment") ====
//
// One state model drives every ambient surface: the web order timeline, Web Push notifications,
// the iOS Live Activity (ActivityKit ContentState), the Android ongoing notification / Live Update
// and the home-screen widget. The API computes it from the order lifecycle and ships it in push
// payloads already localised, so the native code never re-implements order logic.

type AmbientLocale = "rw" | "en" | "fr";
/** Any UI locale; copy exists for RW/EN/FR, others (e.g. the E41 Swahili starter) fall back to English. */
type AnyLocale = AmbientLocale | (string & {});
const loc = (l: AnyLocale): AmbientLocale => (l === "rw" ? "rw" : l === "fr" ? "fr" : "en");

// ── push events, categories and preferences ─────────────────────────────────

export const PUSH_CATEGORIES = ["ORDERS", "LOOKS", "CIRCLE", "CUSTOM", "WARDROBE"] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Every event the API can push. `alert: false` events update silently (live activity / tag replace). */
export const PUSH_EVENTS = {
  "order.paid": { category: "ORDERS", alert: true },
  "order.progress": { category: "ORDERS", alert: false },
  "order.shipped": { category: "ORDERS", alert: true },
  "order.delivered": { category: "ORDERS", alert: true },
  "look.ready": { category: "LOOKS", alert: true },
  "circle.vote": { category: "CIRCLE", alert: true },
  "custom.quote": { category: "CUSTOM", alert: true },
  "wardrobe.reminder": { category: "WARDROBE", alert: true },
} as const satisfies Record<string, { category: PushCategory; alert: boolean }>;
export type PushEvent = keyof typeof PUSH_EVENTS;

/** Mirrors the `NotificationPrefs` schema in ambient.ts. */
export interface NotificationPrefs {
  orders: boolean;
  looks: boolean;
  circle: boolean;
  custom: boolean;
  wardrobe: boolean;
  /** Lock-screen live activity / ongoing notification for orders in progress. */
  liveActivity: boolean;
}
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { orders: true, looks: true, circle: true, custom: true, wardrobe: true, liveActivity: true };

const PREF_KEY: Record<PushCategory, keyof NotificationPrefs> = { ORDERS: "orders", LOOKS: "looks", CIRCLE: "circle", CUSTOM: "custom", WARDROBE: "wardrobe" };

/** Should this event reach a device of this kind, given the user's preferences? */
export function pushAllowed(prefs: NotificationPrefs, event: PushEvent, kind: PushDeviceKind = "DEVICE"): boolean {
  const cat = PUSH_EVENTS[event].category;
  if (!prefs[PREF_KEY[cat]]) return false;
  if (kind !== "DEVICE") return cat === "ORDERS" && prefs.liveActivity;
  return true;
}

// ── device registration ──────────────────────────────────────────────────────

export const PUSH_PLATFORMS = ["IOS", "ANDROID", "WEB"] as const;
export const PUSH_TRANSPORTS = ["FCM", "APNS", "WEBPUSH"] as const;
/** DEVICE = normal alerts; LIVE_ACTIVITY = per-activity APNs token (one order); LIVE_ACTIVITY_START = iOS 17.2+ push-to-start token. */
export const PUSH_DEVICE_KINDS = ["DEVICE", "LIVE_ACTIVITY", "LIVE_ACTIVITY_START"] as const;
export type PushDeviceKind = (typeof PUSH_DEVICE_KINDS)[number];

// ── ambient order state ──────────────────────────────────────────────────────

export const CRAFT_STAGES = ["CUTTING", "SEWING", "FITTING", "FINISHING"] as const;
export type CraftStage = (typeof CRAFT_STAGES)[number];
export type AmbientPhase = "AWAITING_PAYMENT" | "ACTIVE" | "DONE" | "STOPPED";
export type AmbientKind = "READY_MADE" | "CUSTOM";
export type AmbientStep = "PAID" | "MAKING" | "CUTTING" | "SEWING" | "ON_THE_WAY" | "READY" | "DELIVERED";

export interface AmbientInput {
  orderId: string;
  code: string;
  status: string;
  makerName: string;
  itemTitle?: string;
  craft?: CraftStage | null;
  /** Custom (tailor) orders show Paid · Cutting · Sewing · Delivery like the prototype. */
  custom?: boolean;
  deliveryMode?: "PICKUP" | "DELIVERY" | string;
  readyBy?: string | Date | null;
  updatedAt?: string | Date;
}

export interface AmbientOrderState {
  v: 1;
  orderId: string;
  code: string;
  status: string;
  kind: AmbientKind;
  phase: AmbientPhase;
  craft: CraftStage | null;
  /** Always four visible steps (lock-screen width). */
  steps: [AmbientStep, AmbientStep, AmbientStep, AmbientStep];
  stepIndex: number;
  /** 0..1, finer than the steps so the bar moves on every update. */
  progress: number;
  makerName: string;
  itemTitle: string;
  readyBy: string | null;
  updatedAt: string;
}

const READY_MADE_PROGRESS: Record<string, [number, number]> = {
  NEW: [-1, 0],
  AWAITING_PAYMENT: [-1, 0.04],
  PAID: [0, 0.14],
  ACCEPTED: [1, 0.32],
  IN_PREPARATION: [1, 0.52],
  READY: [2, 0.8],
  SHIPPED: [2, 0.8],
  DELIVERED: [3, 1],
  COMPLETED: [3, 1],
  RESOLVED: [3, 1],
};
const CRAFT_PROGRESS: Record<CraftStage, [number, number]> = { CUTTING: [1, 0.32], SEWING: [2, 0.55], FITTING: [2, 0.64], FINISHING: [2, 0.72] };
const STOPPED = new Set(["DECLINED", "CANCELLED", "DISPUTED"]);

const iso = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export function orderAmbient(i: AmbientInput): AmbientOrderState {
  const craft = i.craft ?? null;
  const custom = Boolean(i.custom || craft);
  const pickup = i.deliveryMode === "PICKUP";
  const steps: AmbientOrderState["steps"] = custom ? ["PAID", "CUTTING", "SEWING", "DELIVERED"] : ["PAID", "MAKING", pickup ? "READY" : "ON_THE_WAY", "DELIVERED"];
  let [stepIndex, progress] = READY_MADE_PROGRESS[i.status] ?? [0, 0];
  if (custom) {
    if (i.status === "ACCEPTED") [stepIndex, progress] = [0, 0.2]; // deposit paid, about to cut
    if (i.status === "IN_PREPARATION" && craft) [stepIndex, progress] = CRAFT_PROGRESS[craft];
    if (i.status === "READY") [stepIndex, progress] = [3, 0.86];
  }
  const phase: AmbientPhase = STOPPED.has(i.status)
    ? "STOPPED"
    : ["NEW", "AWAITING_PAYMENT"].includes(i.status)
      ? "AWAITING_PAYMENT"
      : progress >= 1
        ? "DONE"
        : "ACTIVE";
  return {
    v: 1,
    orderId: i.orderId,
    code: i.code,
    status: i.status,
    kind: custom ? "CUSTOM" : "READY_MADE",
    phase,
    craft,
    steps,
    stepIndex,
    progress,
    makerName: i.makerName,
    itemTitle: i.itemTitle ?? "",
    readyBy: phase === "ACTIVE" ? iso(i.readyBy) : null,
    updatedAt: iso(i.updatedAt) ?? new Date().toISOString(),
  };
}

/** Custom orders mirror their craft stage onto the order timeline as "cutting: …", "sewing: …" notes. */
export function craftFromEvents(events: { status: string; note?: string | null }[]): { craft: CraftStage | null; custom: boolean } {
  let craft: CraftStage | null = null;
  let custom = false;
  for (const e of events) {
    const head = (e.note ?? "").split(":")[0].trim().toUpperCase().replace(/ /g, "_");
    if (head === "DEPOSIT_PAID") custom = true;
    if ((CRAFT_STAGES as readonly string[]).includes(head)) {
      craft = head as CraftStage;
      custom = true;
    }
  }
  return { craft, custom };
}

// ── localised copy (server-side for push; the web uses the same strings) ─────

type Vars = { maker: string; item: string; day?: string };
const STEP_LABELS: Record<AmbientLocale, Record<AmbientStep, string>> = {
  en: { PAID: "Paid", MAKING: "Making", CUTTING: "Cutting", SEWING: "Sewing", ON_THE_WAY: "On the way", READY: "Ready", DELIVERED: "Delivery" },
  rw: { PAID: "Byishyuwe", MAKING: "Birakorwa", CUTTING: "Gukata", SEWING: "Kudoda", ON_THE_WAY: "Mu nzira", READY: "Byiteguye", DELIVERED: "Kugezwa" },
  fr: { PAID: "Payé", MAKING: "Fabrication", CUTTING: "Coupe", SEWING: "Couture", ON_THE_WAY: "En route", READY: "Prêt", DELIVERED: "Livraison" },
};
const WEEKDAYS: Record<AmbientLocale, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  rw: ["ku cyumweru", "ku wa mbere", "ku wa kabiri", "ku wa gatatu", "ku wa kane", "ku wa gatanu", "ku wa gatandatu"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
};
type HeadKey = "await" | "paid" | "accepted" | "preparing" | CraftStage | "ready" | "shipped" | "delivered" | "cancelled" | "declined" | "disputed";
const HEAD: Record<AmbientLocale, Record<HeadKey, (v: Vars) => string>> = {
  en: {
    await: () => "Approve the Mobile Money request",
    paid: (v) => `Paid directly to ${v.maker}`,
    accepted: (v) => `${v.maker} accepted your order`,
    preparing: (v) => `${v.maker} is preparing your ${v.item}`,
    CUTTING: (v) => `${v.maker} is cutting your ${v.item}`,
    SEWING: (v) => `${v.maker} is sewing your ${v.item}`,
    FITTING: () => "Time for your fitting",
    FINISHING: (v) => `${v.maker} is finishing your ${v.item}`,
    ready: (v) => `Your ${v.item} is ready`,
    shipped: (v) => `Your ${v.item} is on the way`,
    delivered: () => "Delivered. Enjoy it!",
    cancelled: () => "Order cancelled. No money was taken",
    declined: (v) => `${v.maker} couldn't take this order`,
    disputed: () => "Issue raised. We're on it",
  },
  rw: {
    await: () => "Emeza ubusabe bwa Mobile Money",
    paid: (v) => `Wishyuye ${v.maker} nta muhuza`,
    accepted: (v) => `${v.maker} yakiriye komande yawe`,
    preparing: (v) => `${v.maker} arimo gutegura ${v.item}`,
    CUTTING: (v) => `${v.maker} arimo gukata ${v.item}`,
    SEWING: (v) => `${v.maker} arimo kudoda ${v.item}`,
    FITTING: () => "Igihe cyo gupima kirageze",
    FINISHING: (v) => `${v.maker} arimo kunoza ${v.item}`,
    ready: (v) => `${v.item} yawe yiteguye`,
    shipped: (v) => `${v.item} yawe iri mu nzira`,
    delivered: () => "Byakugezeho. Uryoherwe!",
    cancelled: () => "Komande yahagaritswe. Nta mafaranga yakuweho",
    declined: (v) => `${v.maker} ntiyabashije kwakira iyi komande`,
    disputed: () => "Ikibazo cyakiriwe. Turimo kugikurikirana",
  },
  fr: {
    await: () => "Validez la demande Mobile Money",
    paid: (v) => `Payé directement à ${v.maker}`,
    accepted: (v) => `${v.maker} a accepté votre commande`,
    preparing: (v) => `${v.maker} prépare votre ${v.item}`,
    CUTTING: (v) => `${v.maker} coupe votre ${v.item}`,
    SEWING: (v) => `${v.maker} coud votre ${v.item}`,
    FITTING: () => "C'est l'heure de l'essayage",
    FINISHING: (v) => `${v.maker} finit votre ${v.item}`,
    ready: (v) => `Votre ${v.item} est prêt`,
    shipped: (v) => `Votre ${v.item} est en route`,
    delivered: () => "Livré. Profitez-en !",
    cancelled: () => "Commande annulée. Aucun argent prélevé",
    declined: (v) => `${v.maker} ne peut pas prendre cette commande`,
    disputed: () => "Problème signalé. Nous nous en occupons",
  },
};
const READY_BY: Record<AmbientLocale, (day: string) => string> = { en: (d) => `ready ${d}`, rw: (d) => `bizaba byiteguye ${d}`, fr: (d) => `prêt ${d}` };
const ITEM_FALLBACK: Record<AmbientLocale, string> = { en: "order", rw: "komande", fr: "commande" };

function headKey(s: AmbientOrderState): HeadKey {
  switch (s.status) {
    case "NEW":
    case "AWAITING_PAYMENT":
      return "await";
    case "PAID":
      return "paid";
    case "ACCEPTED":
      return "accepted";
    case "IN_PREPARATION":
      return s.craft ?? "preparing";
    case "READY":
      return "ready";
    case "SHIPPED":
      return "shipped";
    case "DECLINED":
      return "declined";
    case "CANCELLED":
      return "cancelled";
    case "DISPUTED":
      return "disputed";
    default:
      return "delivered";
  }
}

/** Kigali is UTC+2 all year (no DST). */
export function kigaliWeekday(d: string | Date, anyLocale: AnyLocale): string {
  const locale = loc(anyLocale);
  const t = new Date(new Date(d).getTime() + 2 * 3600_000);
  return WEEKDAYS[locale][t.getUTCDay()];
}

export interface AmbientCopy {
  headline: string;
  detail: string;
  stepLabels: [string, string, string, string];
}

export function ambientCopy(s: AmbientOrderState, anyLocale: AnyLocale): AmbientCopy {
  const locale = loc(anyLocale);
  const v: Vars = { maker: s.makerName, item: s.itemTitle || ITEM_FALLBACK[locale] };
  const stepLabels = s.steps.map((k) => STEP_LABELS[locale][k]) as AmbientCopy["stepLabels"];
  const current = s.stepIndex >= 0 ? (s.craft ? STEP_LABELS[locale][s.craft === "CUTTING" ? "CUTTING" : "SEWING"] : stepLabels[s.stepIndex]) : "";
  const detail = [current.toLowerCase(), s.readyBy ? READY_BY[locale](kigaliWeekday(s.readyBy, locale)) : ""].filter(Boolean).join(" · ");
  return { headline: HEAD[locale][headKey(s)](v), detail, stepLabels };
}

// ── wire formats ─────────────────────────────────────────────────────────────

/**
 * iOS ActivityKit `ContentState` / Android Live Update / widget payload. Field names and types are
 * mirrored 1:1 by `OrderActivityAttributes.ContentState` (Swift) and `OrderProgress` (Kotlin).
 * Dates are UNIX seconds so Swift's default `Date` decoding strategy is not needed.
 */

/** Mirrors the `LiveActivityContentState` schema in ambient.ts (Swift/Kotlin ContentState). */
export interface LiveActivityContentState {
  status: string;
  phase: AmbientPhase;
  stepIndex: number;
  progress: number;
  headline: string;
  detail: string;
  stepLabels: string[];
  readyBy: number | null;
  updatedAt: number;
}

/** Mirrors the `LiveActivityAttributes` schema in ambient.ts. */
export interface LiveActivityAttributes {
  orderId: string;
  code: string;
  makerName: string;
  itemTitle: string;
}

export function liveActivityState(s: AmbientOrderState, locale: AnyLocale): LiveActivityContentState {
  const c = ambientCopy(s, locale);
  const secs = (d: string | null) => (d ? Math.floor(new Date(d).getTime() / 1000) : null);
  return {
    status: s.status,
    phase: s.phase,
    stepIndex: s.stepIndex,
    progress: Math.round(s.progress * 100) / 100,
    headline: c.headline,
    detail: c.detail,
    stepLabels: c.stepLabels,
    readyBy: secs(s.readyBy),
    updatedAt: secs(s.updatedAt) ?? 0,
  };
}

/** What every transport carries (FCM `data` is string-only, so `state` is JSON-encoded there). */
export interface PushMessage {
  event: PushEvent;
  title: string;
  body: string;
  /** Path inside the app (deep link), e.g. /orders/<id>. */
  url: string;
  /** Collapse key: a newer message with the same tag replaces the older one. */
  tag: string;
  alert: boolean;
  refId?: string;
  order?: { attributes: LiveActivityAttributes; state: LiveActivityContentState };
}

// ── alert copy for the non-order events ──────────────────────────────────────

const EVENT_COPY: Record<AmbientLocale, Record<"look.ready" | "circle.vote" | "custom.quote" | "wardrobe.reminder", (p: Record<string, string>) => { title: string; body: string }>> = {
  en: {
    "look.ready": (p) => ({ title: "Your look is ready ✨", body: `${p.item} on you, in full detail.` }),
    "circle.vote": (p) => ({ title: "Your circle is voting", body: `${p.votes} vote${p.votes === "1" ? "" : "s"} on “${p.question}”` }),
    "custom.quote": (p) => ({ title: `${p.maker} sent a quote`, body: `${p.item}: RWF ${p.price}. Tap to accept.` }),
    "wardrobe.reminder": (p) => ({ title: `${p.event} ${p.when}`, body: "Your outfit is ready ✨" }),
  },
  rw: {
    "look.ready": (p) => ({ title: "Imyambarire yawe yiteguye ✨", body: `${p.item} ikuriho, mu buryo burambuye.` }),
    "circle.vote": (p) => ({ title: "Inshuti zawe ziratora", body: `Amajwi ${p.votes} kuri “${p.question}”` }),
    "custom.quote": (p) => ({ title: `${p.maker} yohereje igiciro`, body: `${p.item}: RWF ${p.price}. Kanda wemeze.` }),
    "wardrobe.reminder": (p) => ({ title: `${p.event} ${p.when}`, body: "Imyambaro yawe yiteguye ✨" }),
  },
  fr: {
    "look.ready": (p) => ({ title: "Votre look est prêt ✨", body: `${p.item} sur vous, en détail.` }),
    "circle.vote": (p) => ({ title: "Votre cercle vote", body: `${p.votes} vote${p.votes === "1" ? "" : "s"} sur « ${p.question} »` }),
    "custom.quote": (p) => ({ title: `${p.maker} a envoyé un devis`, body: `${p.item} : RWF ${p.price}. Touchez pour accepter.` }),
    "wardrobe.reminder": (p) => ({ title: `${p.event} ${p.when}`, body: "Votre tenue est prête ✨" }),
  },
};

/** "today / tomorrow / in N days" for the wardrobe reminder (hardening pass 1: was English in every locale). */
const WHEN: Record<AmbientLocale | "sw", (days: number) => string> = {
  en: (d) => (d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`),
  rw: (d) => (d <= 0 ? "uyu munsi" : d === 1 ? "ejo" : `mu minsi ${d}`),
  fr: (d) => (d <= 0 ? "aujourd'hui" : d === 1 ? "demain" : `dans ${d} jours`),
  sw: (d) => (d <= 0 ? "leo" : d === 1 ? "kesho" : `baada ya siku ${d}`),
};
/** Swahili push copy (machine-drafted, needs native review); events without it fall back to English. */
const SW_EVENT_COPY: Partial<Record<keyof (typeof EVENT_COPY)["en"], (p: Record<string, string>) => { title: string; body: string }>> = {
  "wardrobe.reminder": (p) => ({ title: `${p.event} ${p.when}`, body: "Mavazi yako yako tayari ✨" }),
};

export function eventCopy(event: keyof (typeof EVENT_COPY)["en"], locale: AnyLocale, p: Record<string, string>) {
  const sw = locale === "sw" ? SW_EVENT_COPY[event] : undefined;
  // `days` (wardrobe reminder) is localised here; a pre-rendered `when` is kept for older callers.
  const vars = p.days != null && p.days !== "" ? { ...p, when: WHEN[sw ? "sw" : loc(locale)](Number(p.days)) } : p;
  return sw ? sw(vars) : EVENT_COPY[loc(locale)][event](vars);
}

/** Order event → push event (alerts only on the moments the shopper waits for). */
export function orderPushEvent(status: string): PushEvent {
  if (status === "PAID") return "order.paid";
  if (status === "SHIPPED" || status === "READY") return "order.shipped";
  if (status === "DELIVERED") return "order.delivered";
  return "order.progress";
}
