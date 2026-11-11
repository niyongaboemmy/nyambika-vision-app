import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PRESENCE, PRESENCE_CLOSE, PRESENCE_LIMITS, PresenceClientMsg, synthIdentity, TokenBucket, type PresenceRole, type PresenceServerMsg } from "@nyambika/contracts";
import { createHmac, randomBytes } from "node:crypto";
import { Access } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { config } from "../../config";
import { MemoryPresenceBus, RedisPresenceBus, type BusMsg, type PresenceBus } from "./presence-bus";
import { publicMember, PresenceRoom, type MemberRecord } from "./presence-room";

export const PRESENCE_FLAG = "vr.multiuser_spike";

/** Minimal socket surface (ws.WebSocket in production, fakes in tests and the load test). */
export interface PresenceSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount?: number;
}

export interface TicketClaims {
  sub: string;
  room: string;
  role: PresenceRole;
  pageId: string | null;
  seated?: boolean;
}

interface Conn {
  sid: string;
  room: string;
  userId: string;
  socket: PresenceSocket;
  buckets: Record<"pose" | "react" | "host" | "report" | "ping", TokenBucket>;
  drops: number[];
  bytesIn: number;
  bytesOut: number;
}

/** Skip pose snapshots to a socket whose send buffer is this full (slow phone / network): it catches up next tick. */
const BACKPRESSURE_BYTES = 256 * 1024;

const env = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

/**
 * R4 spike: shared presence in the E35 showroom / fashion show (flag `vr.multiuser_spike`).
 * Holds this instance's sockets, a replica of every room it serves, a 10 Hz tick that publishes local poses
 * to the bus and sends each local participant an interest-filtered snapshot, plus reactions, host controls
 * (mute / kick / start runway), moderation reports and per-socket rate limits.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Presence");
  readonly instance = randomBytes(5).toString("hex");
  bus: PresenceBus;
  rooms = new Map<string, PresenceRoom>();
  conns = new Map<string, Conn>();
  avatarCap = env("PRESENCE_AVATAR_CAP", PRESENCE.avatarCap);
  roomCap = env("PRESENCE_ROOM_CAP", PRESENCE.roomCap);
  /** Tests drive `tick()` by hand. */
  autoTick = !process.env.VITEST;
  private timer?: NodeJS.Timeout;
  private flag = { on: false, at: 0 };
  private reportSeen = new Map<string, number>();
  // metrics (GET /vr/presence/stats; the load test samples these)
  stats = { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, drops: 0, closedFlood: 0, backpressureSkips: 0, ticks: 0 };
  private tickMs: number[] = [];

  constructor(
    private prisma: PrismaService,
    private access: Access,
  ) {
    this.bus = process.env.VITEST || process.env.PRESENCE_BUS === "memory" ? new MemoryPresenceBus(this.instance) : new RedisPresenceBus(config.redisUrl, this.instance);
    this.bus.onMessage((m) => this.onBus(m));
  }

  /** Tests swap the bus (e.g. two services on one MemoryPresenceBus = two API instances). */
  useBus(bus: PresenceBus) {
    this.bus = bus;
    bus.onMessage((m) => this.onBus(m));
  }

  onModuleInit() {
    if (this.autoTick) this.timer = setInterval(() => void this.tick(), 1000 / PRESENCE.hz);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    for (const c of [...this.conns.values()]) await this.disconnect(c.sid);
    await this.bus.close();
  }

  async enabled() {
    if (Date.now() - this.flag.at < 10_000) return this.flag.on;
    const f = await this.prisma.featureFlag.findUnique({ where: { key: PRESENCE_FLAG } }).catch(() => null);
    this.flag = { on: Boolean(f?.enabled), at: Date.now() };
    return this.flag.on;
  }

  /** Stable per (user, room), unlinkable across rooms: pseudonym + avatar style only. */
  seed(userId: string, room: string) {
    return createHmac("sha256", config.jwtSecret).update(`presence|${room}|${userId}`).digest().readUInt32BE(0);
  }

  // ── connections ──
  async connect(socket: PresenceSocket, c: TicketClaims): Promise<string | null> {
    if (!(await this.enabled())) {
      socket.close(PRESENCE_CLOSE.disabled, "Shared rooms are switched off");
      return null;
    }
    if (await this.bus.isBanned(c.room, c.sub)) {
      socket.close(PRESENCE_CLOSE.banned, "The host removed you from this room for a while");
      return null;
    }
    const sid = randomBytes(5).toString("base64url").slice(0, 7);
    const id = synthIdentity(this.seed(c.sub, c.room));
    const rec: MemberRecord = { sid, ...id, role: c.role, seat: "avatar", muted: false, seated: Boolean(c.seated), userId: c.sub, instance: this.instance, joinedAt: Date.now() };
    const seat = await this.bus.claimSeat(c.room, rec, this.avatarCap, this.roomCap);
    if (seat === "full") {
      socket.close(PRESENCE_CLOSE.full, "This room is full");
      return null;
    }
    rec.seat = seat;
    // One socket per user per room: a second tab / device replaces the first.
    const prev = await this.bus.claimUser(c.room, c.sub, sid);
    if (prev && prev !== sid) await this.drop(c.room, prev, PRESENCE_CLOSE.replaced, "Opened in another tab");

    let room = this.rooms.get(c.room);
    if (!room) {
      room = new PresenceRoom(c.room, c.pageId);
      this.rooms.set(c.room, room);
      await this.bus.watch(c.room);
      for (const m of await this.bus.roster(c.room)) if (m.sid !== sid) room.add(m);
    }
    room.add(rec);
    room.log("join", sid);
    const L = PRESENCE_LIMITS;
    this.conns.set(sid, {
      sid,
      room: c.room,
      userId: c.sub,
      socket,
      buckets: { pose: new TokenBucket(L.pose.rate, L.pose.burst), react: new TokenBucket(L.react.rate, L.react.burst), host: new TokenBucket(L.host.rate, L.host.burst), report: new TokenBucket(L.report.rate, L.report.burst), ping: new TokenBucket(L.ping.rate, L.ping.burst) },
      drops: [],
      bytesIn: 0,
      bytesOut: 0,
    });
    this.send(sid, { t: "w", sid, you: publicMember(rec), roster: [...room.members.values()].map(publicMember), cfg: { hz: PRESENCE.hz, bubbleM: PRESENCE.bubbleM, avatarCap: this.avatarCap }, counts: room.counts() });
    this.toRoom(room, { t: "j", m: publicMember(rec) }, sid);
    await this.bus.publish({ k: "join", room: c.room, from: this.instance, m: rec });
    return sid;
  }

  async disconnect(sid: string) {
    const c = this.conns.get(sid);
    if (!c) return;
    this.conns.delete(sid);
    const room = this.rooms.get(c.room);
    room?.log("leave", sid);
    room?.remove(sid);
    await Promise.all([this.bus.releaseSeat(c.room, sid), this.bus.releaseUser(c.room, c.userId, sid)]).catch(() => undefined);
    if (room) {
      this.toRoom(room, { t: "l", sid });
      await this.bus.publish({ k: "leave", room: c.room, from: this.instance, sid }).catch(() => undefined);
      if (![...this.conns.values()].some((x) => x.room === c.room)) {
        this.rooms.delete(c.room);
        await this.bus.unwatch(c.room).catch(() => undefined);
      }
    }
  }

  // ── inbound frames ──
  async message(sid: string, raw: string | Buffer) {
    const c = this.conns.get(sid);
    if (!c) return;
    const size = typeof raw === "string" ? Buffer.byteLength(raw) : raw.length;
    this.stats.msgsIn++;
    this.stats.bytesIn += size;
    c.bytesIn += size;
    if (size > PRESENCE.maxFrameBytes) return this.dropFrame(c);
    let msg: PresenceClientMsg;
    try {
      const r = PresenceClientMsg.safeParse(JSON.parse(raw.toString()));
      if (!r.success) return this.dropFrame(c);
      msg = r.data;
    } catch {
      return this.dropFrame(c);
    }
    const room = this.rooms.get(c.room);
    if (!room) return;
    const me = room.members.get(sid)!;
    switch (msg.t) {
      case "p":
        if (!c.buckets.pose.take()) return this.dropFrame(c);
        room.applyLocal(sid, msg);
        return;
      case "r":
        if (!c.buckets.react.take()) return this.dropFrame(c);
        if (me.muted) return this.send(sid, { t: "e", code: "muted", msg: "The host paused your reactions" });
        room.log(`react ${msg.e}`, sid);
        this.toRoom(room, { t: "r", sid, e: msg.e });
        await this.bus.publish({ k: "react", room: c.room, from: this.instance, sid, e: msg.e });
        return;
      case "ping":
        if (!c.buckets.ping.take()) return this.dropFrame(c);
        return this.send(sid, { t: "pong", ts: msg.ts });
      case "h":
        if (!c.buckets.host.take()) return this.dropFrame(c);
        return this.hostAction(c, room, me, msg);
      case "rep":
        if (!c.buckets.report.take()) return this.send(sid, { t: "e", code: "slow", msg: "You've sent several reports. Give it a minute." });
        return this.report(c, room, msg.sid, msg.why);
    }
  }

  private dropFrame(c: Conn) {
    this.stats.drops++;
    const now = Date.now();
    c.drops.push(now);
    while (c.drops.length && now - c.drops[0] > 10_000) c.drops.shift();
    if (c.drops.length > PRESENCE_LIMITS.floodDrops) {
      this.stats.closedFlood++;
      c.socket.close(PRESENCE_CLOSE.flood, "Too many messages");
      void this.disconnect(c.sid);
    }
  }

  private async hostAction(c: Conn, room: PresenceRoom, me: MemberRecord, msg: Extract<PresenceClientMsg, { t: "h" }>) {
    if (me.role !== "host") return this.send(c.sid, { t: "e", code: "forbidden", msg: "Only the host can do that" });
    if (msg.a === "runway") {
      room.log("runway", c.sid);
      this.toRoom(room, { t: "h", a: "runway", show: msg.show, by: me.nick });
      await this.bus.publish({ k: "runway", room: room.id, from: this.instance, by: me.nick, show: msg.show });
      await this.access.audit(c.userId, "vr.presence_runway", { room: room.id, show: msg.show ?? null }, room.pageId ?? undefined).catch(() => undefined);
      return;
    }
    const target = msg.sid ? room.members.get(msg.sid) : undefined;
    if (!target || target.sid === me.sid) return this.send(c.sid, { t: "e", code: "unknown", msg: "That person has left" });
    if (target.role === "host") return this.send(c.sid, { t: "e", code: "forbidden", msg: "Hosts can't remove each other here" });
    if (msg.a === "kick") {
      await this.bus.ban(room.id, target.userId, PRESENCE.kickBanSec);
      room.log("kick", target.sid);
      await this.drop(room.id, target.sid, PRESENCE_CLOSE.kicked, "The host removed you from this room");
      await this.access.audit(c.userId, "vr.presence_kick", { room: room.id, target: target.userId, nick: target.nick, banSec: PRESENCE.kickBanSec }, room.pageId ?? undefined).catch(() => undefined);
      return;
    }
    const muted = msg.a === "mute";
    target.muted = muted;
    room.log(muted ? "mute" : "unmute", target.sid);
    await this.bus.updateSeat(room.id, target);
    this.toRoom(room, { t: "m", sid: target.sid, muted });
    await this.bus.publish({ k: "mute", room: room.id, from: this.instance, sid: target.sid, muted });
    await this.access.audit(c.userId, muted ? "vr.presence_mute" : "vr.presence_unmute", { room: room.id, target: target.userId }, room.pageId ?? undefined).catch(() => undefined);
  }

  /** Moderation hook: a report lands in the existing host moderation queue with the recent room context. */
  async report(c: Conn, room: PresenceRoom, targetSid: string, why: string) {
    const target = room.members.get(targetSid);
    if (!target) return this.send(c.sid, { t: "e", code: "unknown", msg: "That person has left. Report from the room page if it continues." });
    const key = `${c.userId}|${room.id}|${target.userId}`;
    if (Date.now() - (this.reportSeen.get(key) ?? 0) < 10 * 60_000) return this.send(c.sid, { t: "ok", what: "report" });
    this.reportSeen.set(key, Date.now());
    const context = room.events
      .slice(-15)
      .map((e) => `${new Date(e.at).toISOString().slice(11, 19)} ${e.nick ?? "-"} ${e.what}`)
      .join(" | ");
    const item = await this.prisma.moderationItem.create({
      data: {
        kind: "VR_PRESENCE_REPORT",
        refId: room.id,
        pageId: room.pageId,
        reason: `${why}: "${target.nick}" (user ${target.userId}, ${target.role}) reported by user ${c.userId}. Recent room events: ${context}`.slice(0, 2000),
      },
    });
    room.log(`report ${why}`, target.sid);
    this.send(c.sid, { t: "ok", what: "report", id: item.id });
  }

  // ── fan-out ──
  private send(sid: string, msg: PresenceServerMsg) {
    const c = this.conns.get(sid);
    if (!c) return;
    const s = JSON.stringify(msg);
    this.stats.msgsOut++;
    this.stats.bytesOut += s.length;
    c.bytesOut += s.length;
    try {
      c.socket.send(s);
    } catch {
      /* socket closing */
    }
  }

  private toRoom(room: PresenceRoom, msg: PresenceServerMsg, except?: string) {
    for (const c of this.conns.values()) if (c.room === room.id && c.sid !== except) this.send(c.sid, msg);
  }

  /** Close a participant wherever it is connected (kick / replaced). */
  private async drop(roomId: string, sid: string, code: number, why: string) {
    const local = this.conns.get(sid);
    if (local) {
      local.socket.close(code, why);
      await this.disconnect(sid);
    } else await this.bus.publish({ k: "drop", room: roomId, from: this.instance, sid, code, why });
  }

  private onBus(m: BusMsg) {
    if (m.from === this.instance) return;
    const room = this.rooms.get(m.room);
    if (!room) return;
    switch (m.k) {
      case "join":
        room.add(m.m);
        room.log("join", m.m.sid);
        return this.toRoom(room, { t: "j", m: publicMember(m.m) });
      case "leave":
        room.log("leave", m.sid);
        room.remove(m.sid);
        return this.toRoom(room, { t: "l", sid: m.sid });
      case "poses":
        return room.applyRemote(m.p);
      case "react":
        room.log(`react ${m.e}`, m.sid);
        return this.toRoom(room, { t: "r", sid: m.sid, e: m.e });
      case "mute": {
        const t = room.members.get(m.sid);
        if (t) t.muted = m.muted;
        return this.toRoom(room, { t: "m", sid: m.sid, muted: m.muted });
      }
      case "runway":
        return this.toRoom(room, { t: "h", a: "runway", show: m.show, by: m.by });
      case "drop": {
        const c = this.conns.get(m.sid);
        if (c) {
          c.socket.close(m.code, m.why);
          void this.disconnect(m.sid);
        }
      }
    }
  }

  /** One 10 Hz tick: publish local poses, then send every local participant its due snapshot. */
  async tick(now = Date.now()) {
    const t0 = performance.now();
    this.stats.ticks++;
    if (this.stats.ticks % 100 === 0 && this.conns.size && !(await this.enabled())) {
      for (const c of [...this.conns.values()]) {
        c.socket.close(PRESENCE_CLOSE.disabled, "Shared rooms were switched off");
        await this.disconnect(c.sid);
      }
      return;
    }
    const pubs: Promise<void>[] = [];
    for (const room of this.rooms.values()) {
      const p = room.drainOutbox();
      if (p.length) pubs.push(this.bus.publish({ k: "poses", room: room.id, from: this.instance, p }).catch(() => undefined));
    }
    for (const c of this.conns.values()) {
      const room = this.rooms.get(c.room);
      if (!room) continue;
      if ((c.socket.bufferedAmount ?? 0) > BACKPRESSURE_BYTES) {
        this.stats.backpressureSkips++;
        continue;
      }
      const f = room.frameFor(c.sid, now);
      if (f) this.send(c.sid, { t: "s", ts: now, p: f.p, n: f.n });
    }
    await Promise.all(pubs);
    this.tickMs.push(performance.now() - t0);
    if (this.tickMs.length > 600) this.tickMs.shift();
  }

  async counts(room: string) {
    const all = await this.bus.roster(room);
    const avatars = all.filter((m) => m.seat === "avatar").length;
    return { room, avatars, spectators: all.length - avatars, avatarCap: this.avatarCap, roomCap: this.roomCap };
  }

  metrics() {
    const s = [...this.tickMs].sort((a, b) => a - b);
    const q = (p: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100 : 0);
    return { instance: this.instance, connections: this.conns.size, rooms: this.rooms.size, ...this.stats, tickMsP50: q(0.5), tickMsP95: q(0.95), tickMsMax: q(1), cpu: process.cpuUsage(), rssMB: Math.round(process.memoryUsage().rss / 1048576) };
  }
}
