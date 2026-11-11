import { z } from "zod";

/**
 * Phase 2 pilot contracts (implementation plan §8, §21, Gate 3).
 * Product analytics are pseudonymised: the client never sends a user id, and props never carry PII.
 */
export const ANALYTICS_EVENTS = [
  "muse_ask",
  "intent_parsed",
  "look_viewed",
  "look_saved",
  "buy_sheet_opened",
  "hold_started",
  "order_paid",
  "twin_created",
  "maker_space_viewed",
  "maker_contacted",
  "circle_poll_created",
  "twin_nudge_shown",
  "twin_nudge_clicked",
  "survey_shown",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** The ordered shopper funnel shown on the pilot dashboard. */
export const FUNNEL_STEPS = ["muse_ask", "intent_parsed", "look_viewed", "look_saved", "buy_sheet_opened", "hold_started", "order_paid"] as const;

/** Prop keys a client may send. Anything else is dropped server-side. Values: short strings, numbers, booleans. */
export const ANALYTICS_PROP_KEYS = [
  "source",
  "lookId",
  "sessionId",
  "productId",
  "variantId",
  "pageId",
  "orderId",
  "pollId",
  "index",
  "count",
  "total",
  "parser",
  "hasOccasion",
  "onTwin",
  "channel",
  "place",
  "arm",
  "locale",
  "trigger",
] as const;

const PropValue = z.union([z.string().max(64), z.number().finite(), z.boolean()]);

export const AnalyticsEventInput = z.object({
  name: z.enum(ANALYTICS_EVENTS),
  props: z.record(z.string().max(32), PropValue).default({}),
  /** Client time; clamped server-side to [now − 24 h, now]. */
  at: z.string().datetime().optional(),
});
export const AnalyticsBatch = z.object({
  /** Random per-device id for signed-out events (hashed server-side, never stored raw). */
  anonId: z.string().min(8).max(64).optional(),
  events: z.array(AnalyticsEventInput).min(1).max(50),
});
export type AnalyticsBatch = z.infer<typeof AnalyticsBatch>;

export const SURVEY_TRIGGERS = ["ORDER_PAID", "LOOKS_5"] as const;
export type SurveyTrigger = (typeof SURVEY_TRIGGERS)[number];

export const SurveyAnswer = z.object({
  trigger: z.enum(SURVEY_TRIGGERS),
  helped: z.boolean().nullable().optional(),
  nps: z.number().int().min(0).max(10).nullable().optional(),
  dismissed: z.boolean().default(false),
});
export type SurveyAnswer = z.infer<typeof SurveyAnswer>;

export const ExperimentVariant = z.object({ key: z.string().min(1).max(32), weight: z.number().min(0).max(100) });
export const EXPERIMENT_STATUSES = ["DRAFT", "RUNNING", "PAUSED", "STOPPED"] as const;
export const ExperimentPatch = z.object({
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  variants: z.array(ExperimentVariant).min(2).max(4).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

/** The three pilot experiments (plan §8.1). */
export const EXPERIMENTS = {
  initialLooks: "looks.initial_count",
  twinNudge: "twin.nudge",
  museVoice: "muse.voice",
} as const;

export const PilotJoin = z.object({ code: z.string().trim().min(4).max(32) });
export const PilotInviteCreate = z.object({
  kind: z.enum(["SHOPPER", "PAGE"]),
  count: z.number().int().min(1).max(50).default(1),
  maxUses: z.number().int().min(1).max(500).default(1),
  note: z.string().max(120).default(""),
});
export const PilotIncidentCreate = z.object({
  kind: z.enum(["PRIVACY", "P1", "OTHER"]),
  summary: z.string().min(4).max(500),
});
