import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "../../config";
import { type CounterStore, MemoryCounterStore, RedisCounterStore } from "../circle/guards";

type Listener = () => void;
const CHANNEL = "vr:show";
const VIEWERS = (showId: string) => `vr:viewers:${showId}`;

/**
 * Live fan-out for virtual fashion shows (as the E25 circle polls): reactions and viewer joins/leaves publish
 * the show id on Redis; every API instance pushes a fresh snapshot to the SSE clients it holds (coalesced to
 * one per 250 ms). Viewer counts are a Redis hash of per-instance connection counts, so N instances add up;
 * without Redis (single-instance dev, tests) everything stays in process.
 */
@Injectable()
export class ShowLive implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("ShowLive");
  private listeners = new Map<string, Set<Listener>>();
  private local = new Map<string, number>();
  private pending = new Map<string, NodeJS.Timeout>();
  private pub?: Redis;
  private sub?: Redis;
  private redisOk = false;
  private instance = randomBytes(6).toString("hex");
  /** Tests swap this for a MemoryCounterStore. */
  counters: CounterStore = new MemoryCounterStore();
  /** Tests can turn Redis off entirely. */
  useRedis = process.env.NODE_ENV !== "test" && !process.env.VITEST;

  onModuleInit() {
    // Connect up front so the first viewer is already counted in the shared hash.
    this.connect();
  }

  private connect() {
    if (this.pub || !this.useRedis) return;
    const opts = { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: false };
    this.pub = new Redis(config.redisUrl, opts);
    this.sub = new Redis(config.redisUrl, opts);
    for (const c of [this.pub, this.sub]) c.on("error", () => (this.redisOk = false));
    this.pub.on("ready", () => (this.counters = new RedisCounterStore(this.pub!)));
    this.sub.on("ready", () => {
      this.redisOk = true;
      void this.sub!.subscribe(CHANNEL).catch(() => (this.redisOk = false));
    });
    this.sub.on("message", (_ch, showId: string) => this.fire(showId));
  }

  on(showId: string, fn: Listener) {
    this.connect();
    let set = this.listeners.get(showId);
    if (!set) this.listeners.set(showId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.listeners.delete(showId);
    };
  }

  /** A viewer connected (SSE). Returns the total across instances. */
  async join(showId: string) {
    this.local.set(showId, (this.local.get(showId) ?? 0) + 1);
    await this.bump(showId, 1);
    await this.publish(showId);
    return this.viewers(showId);
  }

  async leave(showId: string) {
    const n = Math.max(0, (this.local.get(showId) ?? 0) - 1);
    if (n) this.local.set(showId, n);
    else this.local.delete(showId);
    await this.bump(showId, -1);
    await this.publish(showId);
  }

  private async bump(showId: string, by: number) {
    if (!this.redisOk || !this.pub) return;
    try {
      await this.pub.multi().hincrby(VIEWERS(showId), this.instance, by).expire(VIEWERS(showId), 6 * 3600).exec();
    } catch {
      /* local count still works */
    }
  }

  async viewers(showId: string) {
    if (this.redisOk && this.pub) {
      try {
        const all = await this.pub.hvals(VIEWERS(showId));
        // Never fewer than the streams this instance holds (covers joins made before Redis was ready).
        return Math.max(this.localViewers(showId), all.reduce((s, v) => s + Math.max(0, Number(v) || 0), 0));
      } catch {
        /* fall through */
      }
    }
    return this.local.get(showId) ?? 0;
  }

  /** Connections this instance holds (guards against floods per instance). */
  localViewers(showId: string) {
    return this.local.get(showId) ?? 0;
  }

  async publish(showId: string) {
    this.connect();
    if (this.redisOk && this.pub) {
      try {
        await this.pub.publish(CHANNEL, showId);
        return;
      } catch (e) {
        this.log.warn(`publish fell back to local: ${(e as Error).message}`);
      }
    }
    this.fire(showId);
  }

  private fire(showId: string) {
    if (!this.listeners.has(showId) || this.pending.has(showId)) return;
    this.pending.set(
      showId,
      setTimeout(() => {
        this.pending.delete(showId);
        for (const fn of this.listeners.get(showId) ?? []) fn();
      }, 250),
    );
  }

  async onModuleDestroy() {
    for (const t of this.pending.values()) clearTimeout(t);
    if (this.redisOk && this.pub) {
      // Drop this instance's share of every viewer count it held.
      await Promise.all([...this.local.keys()].map((id) => this.pub!.hdel(VIEWERS(id), this.instance).catch(() => 0)));
    }
    this.pub?.disconnect();
    this.sub?.disconnect();
  }
}
