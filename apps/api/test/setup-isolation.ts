import { randomBytes } from "node:crypto";
import { afterAll } from "vitest";

/**
 * Per-file Redis isolation. Every integration file boots the whole AppModule, so without this all files (and a dev
 * API on the same Redis db) share the BullMQ queues and rate-limit counters: a job left by one file was picked up by
 * the next file's worker against rows that file never created, and counters leaked between runs. Each file gets its
 * own BullMQ prefix and counter key prefix, removed again when the file ends. Runs before the file imports config.
 */
const ns = `t-${process.pid}-${randomBytes(4).toString("hex")}`;
process.env.QUEUE_PREFIX = ns;
process.env.REDIS_KEY_PREFIX = `${ns}:`;

afterAll(async () => {
  // Registered first, so it runs after the file's own afterAll (app.close()).
  const { Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? (await import("../src/config")).config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", `${ns}:*`, "COUNT", 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // Redis down: nothing to clean.
  } finally {
    redis.disconnect();
  }
});
