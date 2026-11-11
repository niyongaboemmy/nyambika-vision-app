import { Logger } from "@nestjs/common";
import type { PoseEntry } from "@nyambika/contracts";
import { Redis } from "ioredis";
import type { MemberRecord } from "./presence-room";

/** Cross-instance messages for one room. `from` is the publishing instance (it ignores its own echo). */
export type BusMsg =
  | { k: "join"; room: string; from: string; m: MemberRecord }
  | { k: "leave"; room: string; from: string; sid: string }
  | { k: "poses"; room: string; from: string; p: PoseEntry[] }
  | { k: "react"; room: string; from: string; sid: string; e: string }
  | { k: "mute"; room: string; from: string; sid: string; muted: boolean }
  | { k: "drop"; room: string; from: string; sid: string; code: number; why: string }
  | { k: "runway"; room: string; from: string; by: string; show?: string };

export type SeatResult = "avatar" | "spectator" | "full";

/**
 * The "Redis adapter" of the presence gateway: per-room pub/sub channels for fan-out between API instances,
 * Redis hashes for the room roster (so the avatar cap holds across instances), and kick bans.
 * `MemoryPresenceBus` is the single-instance / test version with the same semantics.
 */
export interface PresenceBus {
  readonly instance: string;
  publish(msg: BusMsg): Promise<void>;
  /** Start / stop receiving a room's channel (only while this instance holds a participant there). */
  watch(room: string): Promise<void>;
  unwatch(room: string): Promise<void>;
  onMessage(fn: (msg: BusMsg) => void): void;
  claimSeat(room: string, m: MemberRecord, avatarCap: number, roomCap: number): Promise<SeatResult>;
  releaseSeat(room: string, sid: string): Promise<void>;
  updateSeat(room: string, m: MemberRecord): Promise<void>;
  roster(room: string): Promise<MemberRecord[]>;
  ban(room: string, userId: string, sec: number): Promise<void>;
  isBanned(room: string, userId: string): Promise<boolean>;
  /** The sid this user currently holds in the room (one socket per user per room). */
  claimUser(room: string, userId: string, sid: string): Promise<string | null>;
  releaseUser(room: string, userId: string, sid: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryPresenceBus implements PresenceBus {
  /** Shared across "instances" in one process so tests can simulate two API nodes on one bus. */
  static shared = { seats: new Map<string, Map<string, MemberRecord>>(), bans: new Map<string, number>(), users: new Map<string, string>(), subs: new Set<MemoryPresenceBus>() };
  private fns: ((m: BusMsg) => void)[] = [];
  private rooms = new Set<string>();
  constructor(
    readonly instance: string,
    private s = MemoryPresenceBus.shared,
    private now: () => number = Date.now,
  ) {
    s.subs.add(this);
  }
  static fresh() {
    return { seats: new Map(), bans: new Map(), users: new Map(), subs: new Set<MemoryPresenceBus>() } as typeof MemoryPresenceBus.shared;
  }
  async publish(msg: BusMsg) {
    for (const b of this.s.subs) if (b !== this && b.rooms.has(msg.room)) for (const fn of b.fns) fn(msg);
  }
  async watch(room: string) {
    this.rooms.add(room);
  }
  async unwatch(room: string) {
    this.rooms.delete(room);
  }
  onMessage(fn: (m: BusMsg) => void) {
    this.fns.push(fn);
  }
  async claimSeat(room: string, m: MemberRecord, avatarCap: number, roomCap: number): Promise<SeatResult> {
    let seats = this.s.seats.get(room);
    if (!seats) this.s.seats.set(room, (seats = new Map()));
    if (seats.size >= roomCap) return "full";
    const avatars = [...seats.values()].filter((x) => x.seat === "avatar").length;
    const seat = avatars < avatarCap ? "avatar" : "spectator";
    seats.set(m.sid, { ...m, seat });
    return seat;
  }
  async releaseSeat(room: string, sid: string) {
    this.s.seats.get(room)?.delete(sid);
  }
  async updateSeat(room: string, m: MemberRecord) {
    if (this.s.seats.get(room)?.has(m.sid)) this.s.seats.get(room)!.set(m.sid, m);
  }
  async roster(room: string) {
    return [...(this.s.seats.get(room)?.values() ?? [])];
  }
  async ban(room: string, userId: string, sec: number) {
    this.s.bans.set(`${room}|${userId}`, this.now() + sec * 1000);
  }
  async isBanned(room: string, userId: string) {
    return (this.s.bans.get(`${room}|${userId}`) ?? 0) > this.now();
  }
  async claimUser(room: string, userId: string, sid: string) {
    const k = `${room}|${userId}`;
    const prev = this.s.users.get(k) ?? null;
    this.s.users.set(k, sid);
    return prev;
  }
  async releaseUser(room: string, userId: string, sid: string) {
    const k = `${room}|${userId}`;
    if (this.s.users.get(k) === sid) this.s.users.delete(k);
  }
  async close() {
    this.s.subs.delete(this);
  }
}

const K = {
  chan: (room: string) => `vrp:c:${room}`,
  avatars: (room: string) => `vrp:a:${room}`,
  spectators: (room: string) => `vrp:s:${room}`,
  ban: (room: string, userId: string) => `vrp:ban:${room}:${userId}`,
  user: (room: string, userId: string) => `vrp:u:${room}:${userId}`,
  alive: (instance: string) => `vrp:i:${instance}`,
};

/** Atomic seat claim: refuse at the room cap, avatar seat while under the avatar cap, else spectator. */
const CLAIM = `
local a = redis.call('HLEN', KEYS[1])
local s = redis.call('HLEN', KEYS[2])
if a + s >= tonumber(ARGV[4]) then return 'full' end
if a < tonumber(ARGV[3]) then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]); redis.call('EXPIRE', KEYS[1], 21600); return 'avatar'
end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[5]); redis.call('EXPIRE', KEYS[2], 21600); return 'spectator'`;

export class RedisPresenceBus implements PresenceBus {
  private log = new Logger("PresenceBus");
  private pub: Redis;
  private sub: Redis;
  private fns: ((m: BusMsg) => void)[] = [];
  private beat: NodeJS.Timeout;
  constructor(
    url: string,
    readonly instance: string,
  ) {
    const opts = { maxRetriesPerRequest: 2, enableOfflineQueue: true };
    this.pub = new Redis(url, opts);
    this.sub = new Redis(url, opts);
    for (const c of [this.pub, this.sub]) c.on("error", (e) => this.log.warn(`redis: ${e.message}`));
    this.sub.on("message", (_ch, raw: string) => {
      let msg: BusMsg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.from === this.instance) return;
      for (const fn of this.fns) fn(msg);
    });
    // Liveness key: rosters drop members of instances that stopped beating (crash without a clean leave).
    const alive = () => void this.pub.set(K.alive(instance), "1", "EX", 15).catch(() => undefined);
    alive();
    this.beat = setInterval(alive, 5000);
  }
  async publish(msg: BusMsg) {
    await this.pub.publish(K.chan(msg.room), JSON.stringify(msg));
  }
  async watch(room: string) {
    await this.sub.subscribe(K.chan(room));
  }
  async unwatch(room: string) {
    await this.sub.unsubscribe(K.chan(room));
  }
  onMessage(fn: (m: BusMsg) => void) {
    this.fns.push(fn);
  }
  async claimSeat(room: string, m: MemberRecord, avatarCap: number, roomCap: number) {
    await this.sweep(room);
    const r = (await this.pub.eval(CLAIM, 2, K.avatars(room), K.spectators(room), m.sid, JSON.stringify({ ...m, seat: "avatar" }), avatarCap, roomCap, JSON.stringify({ ...m, seat: "spectator" }))) as SeatResult;
    return r;
  }
  async releaseSeat(room: string, sid: string) {
    await this.pub.multi().hdel(K.avatars(room), sid).hdel(K.spectators(room), sid).exec();
  }
  async updateSeat(room: string, m: MemberRecord) {
    const key = m.seat === "avatar" ? K.avatars(room) : K.spectators(room);
    if (await this.pub.hexists(key, m.sid)) await this.pub.hset(key, m.sid, JSON.stringify(m));
  }
  async roster(room: string) {
    const [a, s] = await Promise.all([this.pub.hvals(K.avatars(room)), this.pub.hvals(K.spectators(room))]);
    return [...a, ...s].map((x) => JSON.parse(x) as MemberRecord);
  }
  /** Remove seats held by instances whose liveness key expired. */
  private async sweep(room: string) {
    const all = await this.roster(room);
    const insts = [...new Set(all.map((m) => m.instance))];
    if (!insts.length) return;
    const alive = await this.pub.mget(...insts.map(K.alive));
    const dead = new Set(insts.filter((_, i) => !alive[i]));
    const gone = all.filter((m) => dead.has(m.instance));
    if (gone.length) await Promise.all(gone.map((m) => this.releaseSeat(room, m.sid)));
  }
  async ban(room: string, userId: string, sec: number) {
    await this.pub.set(K.ban(room, userId), "1", "EX", sec);
  }
  async isBanned(room: string, userId: string) {
    return (await this.pub.exists(K.ban(room, userId))) === 1;
  }
  async claimUser(room: string, userId: string, sid: string) {
    const prev = await this.pub.set(K.user(room, userId), sid, "EX", 21600, "GET");
    return prev ?? null;
  }
  async releaseUser(room: string, userId: string, sid: string) {
    const k = K.user(room, userId);
    if ((await this.pub.get(k)) === sid) await this.pub.del(k);
  }
  async close() {
    clearInterval(this.beat);
    await this.pub.del(K.alive(this.instance)).catch(() => 0);
    this.pub.disconnect();
    this.sub.disconnect();
  }
}
