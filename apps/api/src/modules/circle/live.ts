import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import { config } from "../../config";

type Listener = () => void;
const CHANNEL = "circle:poll";

/**
 * Live poll fan-out. A vote publishes the poll id on Redis so every API instance can push
 * a fresh snapshot to the Server-Sent-Event clients it holds. Falls back to in-process only
 * when Redis is unreachable (single-instance dev).
 */
@Injectable()
export class CircleLive implements OnModuleDestroy {
  private log = new Logger("CircleLive");
  private listeners = new Map<string, Set<Listener>>();
  private pending = new Map<string, NodeJS.Timeout>();
  private pub?: Redis;
  private sub?: Redis;
  private redisOk = false;

  private connect() {
    if (this.pub) return;
    const opts = { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: false };
    this.pub = new Redis(config.redisUrl, opts);
    this.sub = new Redis(config.redisUrl, opts);
    for (const c of [this.pub, this.sub]) c.on("error", () => (this.redisOk = false));
    this.sub.on("ready", () => {
      this.redisOk = true;
      void this.sub!.subscribe(CHANNEL).catch(() => (this.redisOk = false));
    });
    this.sub.on("message", (_ch, pollId: string) => this.fire(pollId));
  }

  /** Subscribe to a poll; returns an unsubscribe function. */
  on(pollId: string, fn: Listener) {
    this.connect();
    let set = this.listeners.get(pollId);
    if (!set) this.listeners.set(pollId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.listeners.delete(pollId);
    };
  }

  watchers(pollId: string) {
    return this.listeners.get(pollId)?.size ?? 0;
  }

  async publish(pollId: string) {
    this.connect();
    if (this.redisOk && this.pub) {
      try {
        await this.pub.publish(CHANNEL, pollId);
        return;
      } catch (e) {
        this.log.warn(`publish fell back to local: ${(e as Error).message}`);
      }
    }
    this.fire(pollId);
  }

  /** Coalesce bursts of votes into one snapshot per poll every 250 ms. */
  private fire(pollId: string) {
    if (!this.listeners.has(pollId) || this.pending.has(pollId)) return;
    this.pending.set(
      pollId,
      setTimeout(() => {
        this.pending.delete(pollId);
        for (const fn of this.listeners.get(pollId) ?? []) fn();
      }, 250),
    );
  }

  async onModuleDestroy() {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pub?.disconnect();
    this.sub?.disconnect();
  }
}
