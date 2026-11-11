import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Redis } from "ioredis";

/** Fixed-window counter store; Redis in the app (shared across instances), memory in unit tests. */
export interface CounterStore {
  incr(key: string, windowSec: number): Promise<number>;
}

export class MemoryCounterStore implements CounterStore {
  private m = new Map<string, { n: number; until: number }>();
  constructor(private now: () => number = Date.now) {}
  async incr(key: string, windowSec: number) {
    const t = this.now();
    const cur = this.m.get(key);
    if (!cur || cur.until <= t) {
      this.m.set(key, { n: 1, until: t + windowSec * 1000 });
      return 1;
    }
    cur.n += 1;
    return cur.n;
  }
}

export class RedisCounterStore implements CounterStore {
  constructor(private redis: Redis) {}
  async incr(key: string, windowSec: number) {
    const k = `rl:${key}`;
    const [[, n]] = (await this.redis.multi().incr(k).expire(k, windowSec, "NX").exec()) as [[unknown, number]];
    return n;
  }
}

export interface Limit {
  key: string;
  max: number;
  windowSec: number;
}

/** Returns the first limit that was exceeded, or null when the request may go ahead. */
export async function overLimit(store: CounterStore, limits: Limit[]): Promise<Limit | null> {
  for (const l of limits) {
    if ((await store.incr(l.key, l.windowSec)) > l.max) return l;
  }
  return null;
}

/** Basic abuse limits for anonymous poll traffic (FR-SOC-02). */
export const VOTE_LIMITS = (pollId: string, ipHash: string, deviceHash: string): Limit[] => [
  { key: `vote:dev:${pollId}:${deviceHash}`, max: 6, windowSec: 600 },
  { key: `vote:ip:${pollId}:${ipHash}`, max: 30, windowSec: 600 },
  { key: `vote:ip:${ipHash}`, max: 120, windowSec: 3600 },
];

export const DEVICE_COOKIE = "nya_dv";

/** Anonymous per-device id in a signed cookie: `<id>.<hmac>`. No account, no fingerprinting. */
export function issueDevice(secret: string) {
  const id = randomBytes(12).toString("base64url");
  return `${id}.${sign(secret, id)}`;
}

export function readDevice(secret: string, cookie: string | undefined | null): string | null {
  if (!cookie) return null;
  const [id, sig] = cookie.split(".");
  if (!id || !sig) return null;
  const want = Buffer.from(sign(secret, id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

function sign(secret: string, id: string) {
  return createHmac("sha256", secret).update(`device:${id}`).digest("base64url").slice(0, 32);
}

/** Store only salted hashes of devices and IPs, never the raw values. */
export const hashId = (secret: string, kind: string, value: string) =>
  createHash("sha256").update(`${kind}|${secret}|${value}`).digest("hex").slice(0, 32);

export function pollState(p: { expiresAt: Date; revokedAt: Date | null }, now = new Date()): "OPEN" | "EXPIRED" | "REVOKED" {
  if (p.revokedAt) return "REVOKED";
  if (p.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "OPEN";
}

export const REACTIONS = ["❤️", "🔥", "😍", "👏", "💛", "💙", "👑", "✨"] as const;
