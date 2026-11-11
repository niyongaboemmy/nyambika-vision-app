import "dotenv/config";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: req("JWT_SECRET", "dev-only-change-me"),
  twinKey: Buffer.from(req("TWIN_KEY", "0".repeat(63) + "1"), "hex"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  /** BullMQ key prefix ("bull" is BullMQ's own default) and a key prefix for rate-limit counters. Tests set both per file. */
  queuePrefix: process.env.QUEUE_PREFIX || "bull",
  redisKeyPrefix: process.env.REDIS_KEY_PREFIX ?? "",
  aiUrl: req("AI_GATEWAY_URL", "http://localhost:8100"),
  webUrl: req("PUBLIC_WEB_URL", "http://localhost:3000"),
  selfUrl: process.env.SELF_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  webhookSecret: req("MOMO_WEBHOOK_SECRET", "dev-webhook-secret"),
  paymentsProvider: req("PAYMENTS_PROVIDER", "mock"),
  mockAutoApproveMs: Number(process.env.MOCK_AUTO_APPROVE_MS ?? 8000),
  devExposeOtp: process.env.DEV_EXPOSE_OTP === "1" && process.env.NODE_ENV !== "production",
  storageDir: req("STORAGE_DIR", "./storage"),
  freeWeeklyLooks: Number(process.env.FREE_WEEKLY_LOOKS ?? 30),
  signedUrlTtlSec: 300,
  otpMaxPer15m: Number(process.env.OTP_MAX_PER_15M ?? 5),
};
