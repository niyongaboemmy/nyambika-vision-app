import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Partner webhook signatures (E37). Header `Nyambika-Signature: t=<unix seconds>,v1=<hex HMAC-SHA-256>`
 * over `<t>.<raw body>` with the partner's webhook secret. Receivers should reject timestamps older
 * than 5 minutes to stop replays.
 */
export const SIGNATURE_HEADER = "nyambika-signature";
export const TOLERANCE_SEC = 300;

export function signWebhook(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

export function verifyWebhook(body: string, header: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(now - t) > TOLERANCE_SEC) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"), "hex");
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Retry schedule for undelivered webhooks (BullMQ exponential backoff from 2 s, 6 attempts ≈ 1 min). */
export const WEBHOOK_ATTEMPTS = 6;
export const WEBHOOK_BACKOFF_MS = 2000;
