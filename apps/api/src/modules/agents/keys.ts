import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AgentScope } from "@nyambika/contracts";

/**
 * API keys for agents and partners (FR-AGT-08).
 * Format: `nya_<live|test>_<32 base62 chars>`. Only a peppered HMAC-SHA-256 of the full secret is stored;
 * the first 16 characters (the prefix) identify the key in the admin UI and logs.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const KEY_PATTERN = /^nya_(live|test)_[0-9A-Za-z]{32}$/;
export const PREFIX_LENGTH = 16;

function base62(bytes: Buffer) {
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 62];
  return out;
}

export function generateKey(env: "LIVE" | "SANDBOX") {
  // 32 chars × log2(62) ≈ 190 bits of entropy (the modulo bias is negligible at this length).
  const secret = `nya_${env === "LIVE" ? "live" : "test"}_${base62(randomBytes(32))}`;
  return { secret, prefix: secret.slice(0, PREFIX_LENGTH) };
}

/** Peppered hash: a leaked database alone cannot be used to brute-force or replay keys. */
export function hashKey(secret: string, pepper: string) {
  return createHmac("sha256", `api-key:${pepper}`).update(secret).digest("hex");
}

export function verifyKey(secret: string, storedHash: string, pepper: string) {
  const a = Buffer.from(hashKey(secret, pepper), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Read a key from `Authorization: Bearer` or `X-Api-Key`. Returns null for anything that isn't key-shaped. */
export function extractKey(headers: Record<string, string | string[] | undefined>): string | null {
  const auth = headers["authorization"];
  const a = Array.isArray(auth) ? auth[0] : auth;
  const fromBearer = a?.startsWith("Bearer ") ? a.slice(7).trim() : null;
  const x = headers["x-api-key"];
  const fromHeader = (Array.isArray(x) ? x[0] : x)?.trim() ?? null;
  const k = fromBearer?.startsWith("nya_") ? fromBearer : fromHeader;
  return k && KEY_PATTERN.test(k) ? k : null;
}

export function hasScopes(granted: readonly string[], required: readonly AgentScope[]) {
  return required.every((s) => granted.includes(s));
}

export type KeyState = "OK" | "REVOKED" | "EXPIRED" | "CLIENT_SUSPENDED";
export function keyState(k: { revokedAt: Date | null; expiresAt: Date | null }, clientStatus: string, now = new Date()): KeyState {
  if (k.revokedAt) return "REVOKED";
  if (k.expiresAt && k.expiresAt <= now) return "EXPIRED";
  if (clientStatus !== "ACTIVE") return "CLIENT_SUSPENDED";
  return "OK";
}

/** Monthly quota decision for one more call. `used` already counts this call. */
export function quotaDecision(used: number, quota: number | null) {
  if (quota === null) return { allowed: true, remaining: null as number | null };
  return { allowed: used <= quota, remaining: Math.max(0, quota - used) };
}

export const monthKey = (d = new Date()) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function monthRange(month?: string) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  return { month: m, start: new Date(Date.UTC(y, mo - 1, 1)), end: new Date(Date.UTC(y, mo, 1)) };
}

/** IPs are only ever stored as an HMAC (rate limits and audit, never raw). */
export const ipHash = (ip: string, pepper: string) => createHash("sha256").update(`ip:${pepper}:${ip}`).digest("hex").slice(0, 32);
