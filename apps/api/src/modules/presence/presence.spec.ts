import { clampPose, interestSet, parseRoom, PRESENCE, PRESENCE_CLOSE, PresenceClientMsg, synthIdentity, TokenBucket, type PresenceServerMsg } from "@nyambika/contracts";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "../../config";
import { MemoryPresenceBus } from "./presence-bus";
import { readTicket, signTicket } from "./presence.gateway";
import { PresenceService, type PresenceSocket, type TicketClaims } from "./presence.service";

class FakeSocket implements PresenceSocket {
  sent: PresenceServerMsg[] = [];
  closed: { code?: number; reason?: string } | null = null;
  bufferedAmount = 0;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  of<T extends PresenceServerMsg["t"]>(t: T) {
    return this.sent.filter((m) => m.t === t) as Extract<PresenceServerMsg, { t: T }>[];
  }
  clear() {
    this.sent = [];
  }
}

function makeService(opts: { flag?: boolean; store?: typeof MemoryPresenceBus.shared } = {}) {
  const reports: { kind: string; refId: string; pageId: string | null; reason: string }[] = [];
  const audits: { action: string; data: object }[] = [];
  const prisma = {
    featureFlag: { findUnique: async () => ({ key: "vr.multiuser_spike", enabled: opts.flag ?? true }) },
    moderationItem: { create: async ({ data }: { data: (typeof reports)[number] }) => (reports.push(data), { id: `mod${reports.length}`, ...data }) },
  };
  const access = { audit: async (_a: string | null, action: string, data: object) => void audits.push({ action, data }) };
  const svc = new PresenceService(prisma as never, access as never);
  const store = opts.store ?? MemoryPresenceBus.fresh();
  svc.useBus(new MemoryPresenceBus(svc.instance, store));
  return { svc, reports, audits, store };
}

const ROOM = "showroom:umurage-wear";
const claims = (sub: string, role: "host" | "guest" = "guest"): TicketClaims => ({ sub, room: ROOM, role, pageId: "page1" });
const msg = (o: object) => JSON.stringify(o);

async function join(svc: PresenceService, sub: string, role: "host" | "guest" = "guest") {
  const s = new FakeSocket();
  const sid = await svc.connect(s, claims(sub, role));
  return { s, sid: sid! };
}

describe("presence protocol (contracts)", () => {
  it("accepts small typed frames and rejects anything else", () => {
    expect(PresenceClientMsg.safeParse({ t: "p", x: 10, y: 160, z: -40, yw: 1200, ts: 5 }).success).toBe(true);
    expect(PresenceClientMsg.safeParse({ t: "r", e: "🔥" }).success).toBe(true);
    expect(PresenceClientMsg.safeParse({ t: "r", e: "💩" }).success).toBe(false); // whitelist only, no free text
    expect(PresenceClientMsg.safeParse({ t: "chat", text: "hi" }).success).toBe(false);
    expect(PresenceClientMsg.safeParse({ t: "p", x: 1.5, y: 0, z: 0, yw: 0 }).success).toBe(false); // integer cm only
    expect(PresenceClientMsg.safeParse({ t: "rep", sid: "abc", why: "harassment" }).success).toBe(true);
  });

  it("clamps poses into the room and wraps yaw", () => {
    expect(clampPose({ x: 3000, y: 900, z: 0, yw: 7000 })).toEqual({ x: PRESENCE.boundsM * 100, y: PRESENCE.maxHeightM * 100, z: 0, yw: 7000 - 6283 });
    expect(clampPose({ x: 100, y: -5, z: 100, yw: -4000 }).y).toBe(0);
  });

  it("derives a stable synthetic pseudonym from the per-room seed", () => {
    expect(synthIdentity(12345)).toEqual(synthIdentity(12345));
    expect(synthIdentity(12345).nick).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
    expect(synthIdentity(1).nick).not.toBe(synthIdentity(2).nick);
  });

  it("parses room ids", () => {
    expect(parseRoom("showroom:umurage-wear")).toEqual({ kind: "showroom", key: "umurage-wear" });
    expect(parseRoom("show:cm123")).toEqual({ kind: "show", key: "cm123" });
    expect(parseRoom("lobby:x")).toBeNull();
    expect(parseRoom("showroom:../etc")).toBeNull();
  });

  it("token bucket refills at its rate and caps bursts", () => {
    let t = 0;
    const b = new TokenBucket(2, 3, () => t);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    t = 500;
    expect([b.take(), b.take()]).toEqual([true, false]);
    t = 60_000;
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });

  it("interest: the host always, then the K nearest within the radius", () => {
    const others = Array.from({ length: 30 }, (_, i) => ({ sid: `a${i}`, x: i * 50, z: 0 }));
    others.push({ sid: "host", x: 5000, z: 0, host: true } as never);
    const set = interestSet({ sid: "me", x: 0, z: 0 }, others, 5, 12);
    expect(set.has("host")).toBe(true);
    expect([...set].filter((s) => s !== "host")).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(interestSet({ sid: "me", x: 0, z: 0 }, [{ sid: "far", x: 2000, z: 0 }]).size).toBe(0);
  });

  it("tickets are short-lived, audience-bound JWTs", () => {
    const t = signTicket({ sub: "u1", room: ROOM, role: "host", pageId: "p1" });
    expect(readTicket(t)).toMatchObject({ sub: "u1", room: ROOM, role: "host", pageId: "p1" });
    const session = jwt.sign({ sub: "u1", room: ROOM }, config.jwtSecret, { expiresIn: "15m" }); // an access token is not a ticket
    expect(readTicket(session)).toBeNull();
    expect(readTicket("garbage")).toBeNull();
  });
});

describe("presence rooms (service)", () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it("welcomes with a pseudonymous roster and never sends user ids", async () => {
    const a = await join(ctx.svc, "user-a");
    const b = await join(ctx.svc, "user-b");
    const w = b.s.of("w")[0];
    expect(w.roster.map((m) => m.sid).sort()).toEqual([a.sid, b.sid].sort());
    expect(JSON.stringify(b.s.sent)).not.toContain("user-a");
    expect(a.s.of("j")[0].m.sid).toBe(b.sid);
  });

  it("caps avatars: over the cap joiners become spectators, over the room cap they are refused", async () => {
    ctx.svc.avatarCap = 2;
    ctx.svc.roomCap = 3;
    await join(ctx.svc, "u1");
    await join(ctx.svc, "u2");
    const c = await join(ctx.svc, "u3");
    expect(c.s.of("w")[0].you.seat).toBe("spectator");
    const d = new FakeSocket();
    expect(await ctx.svc.connect(d, claims("u4"))).toBeNull();
    expect(d.closed?.code).toBe(PRESENCE_CLOSE.full);
    // A spectator has no body: its pose is ignored.
    await ctx.svc.message(c.sid, msg({ t: "p", x: 0, y: 160, z: 0, yw: 0 }));
    expect(ctx.svc.rooms.get(ROOM)!.poses.has(c.sid)).toBe(false);
  });

  it("refuses everything while the flag is off", async () => {
    const off = makeService({ flag: false });
    const s = new FakeSocket();
    expect(await off.svc.connect(s, claims("u1"))).toBeNull();
    expect(s.closed?.code).toBe(PRESENCE_CLOSE.disabled);
  });

  it("10 Hz snapshots carry only changed, interesting poses; spectators get 2 Hz", async () => {
    ctx.svc.avatarCap = 2;
    const a = await join(ctx.svc, "u1");
    const b = await join(ctx.svc, "u2");
    const spec = await join(ctx.svc, "u3");
    const t0 = Date.now();
    await ctx.svc.message(a.sid, msg({ t: "p", x: 100, y: 160, z: 200, yw: 500, ts: t0 }));
    await ctx.svc.tick(t0 + 100);
    const s1 = b.s.of("s").at(-1)!;
    expect(s1.p).toEqual([[a.sid, 100, 160, 200, 500, t0 % 1_000_000]]);
    expect(a.s.of("s").at(-1)?.p ?? []).toEqual([]); // nobody else has moved
    b.s.clear();
    await ctx.svc.tick(t0 + 200); // unchanged: nothing due (count refresh only once a second)
    expect(b.s.of("s")).toHaveLength(0);
    // Spectator: the first frame, then nothing for the next 400 ms.
    expect(spec.s.of("s").length).toBe(1);
    await ctx.svc.message(a.sid, msg({ t: "p", x: 150, y: 160, z: 200, yw: 500 }));
    await ctx.svc.tick(t0 + 300);
    expect(spec.s.of("s").length).toBe(1);
    await ctx.svc.tick(t0 + 620);
    expect(spec.s.of("s").length).toBe(2);
  });

  it("rate limits poses and reactions, and closes flooding sockets", async () => {
    const a = await join(ctx.svc, "u1");
    const b = await join(ctx.svc, "u2");
    for (let i = 0; i < 40; i++) await ctx.svc.message(a.sid, msg({ t: "p", x: i, y: 160, z: 0, yw: 0 }));
    expect(ctx.svc.stats.drops).toBeGreaterThanOrEqual(40 - 20 - 1);
    for (let i = 0; i < 10; i++) await ctx.svc.message(a.sid, msg({ t: "r", e: "🔥" }));
    expect(b.s.of("r").length).toBeLessThanOrEqual(5);
    await ctx.svc.message(a.sid, "x".repeat(PRESENCE.maxFrameBytes + 1));
    for (let i = 0; i < 200 && !a.s.closed; i++) await ctx.svc.message(a.sid, msg({ t: "nope" }));
    expect(a.s.closed?.code).toBe(PRESENCE_CLOSE.flood);
    expect(ctx.svc.conns.has(a.sid)).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(b.s.of("l").map((l) => l.sid)).toContain(a.sid);
  });

  it("host controls: only the host mutes, kicks (with a rejoin ban) and starts the runway", async () => {
    const host = await join(ctx.svc, "maker", "host");
    const g1 = await join(ctx.svc, "g1");
    const g2 = await join(ctx.svc, "g2");
    await ctx.svc.message(g1.sid, msg({ t: "h", a: "kick", sid: g2.sid }));
    expect(g1.s.of("e")[0].code).toBe("forbidden");
    expect(g2.s.closed).toBeNull();

    await ctx.svc.message(host.sid, msg({ t: "h", a: "mute", sid: g1.sid }));
    expect(g2.s.of("m")[0]).toEqual({ t: "m", sid: g1.sid, muted: true });
    await ctx.svc.message(g1.sid, msg({ t: "r", e: "👏" }));
    expect(g2.s.of("r")).toHaveLength(0);
    expect(g1.s.of("e").at(-1)?.code).toBe("muted");

    await ctx.svc.message(host.sid, msg({ t: "h", a: "runway", show: "show1" }));
    expect(g2.s.of("h")[0]).toMatchObject({ a: "runway", show: "show1" });

    await ctx.svc.message(host.sid, msg({ t: "h", a: "kick", sid: g2.sid }));
    expect(g2.s.closed?.code).toBe(PRESENCE_CLOSE.kicked);
    const again = new FakeSocket();
    expect(await ctx.svc.connect(again, claims("g2"))).toBeNull();
    expect(again.closed?.code).toBe(PRESENCE_CLOSE.banned);
    expect(ctx.audits.map((a) => a.action)).toEqual(["vr.presence_mute", "vr.presence_runway", "vr.presence_kick"]);
  });

  it("moderation hook: a report lands in the moderation queue with room context, deduped and rate limited", async () => {
    const host = await join(ctx.svc, "maker", "host");
    const g1 = await join(ctx.svc, "g1");
    await ctx.svc.message(host.sid, msg({ t: "r", e: "🔥" }));
    await ctx.svc.message(g1.sid, msg({ t: "rep", sid: host.sid, why: "harassment" }));
    expect(ctx.reports).toHaveLength(1);
    expect(ctx.reports[0]).toMatchObject({ kind: "VR_PRESENCE_REPORT", refId: ROOM, pageId: "page1" });
    expect(ctx.reports[0].reason).toContain("user maker");
    expect(ctx.reports[0].reason).toContain("react 🔥");
    expect(g1.s.of("ok")[0]).toMatchObject({ what: "report", id: "mod1" });
    await ctx.svc.message(g1.sid, msg({ t: "rep", sid: host.sid, why: "harassment" }));
    expect(ctx.reports).toHaveLength(1); // same target within 10 min
    const others = await Promise.all(["x1", "x2", "x3", "x4"].map((u) => join(ctx.svc, u)));
    for (const o of others) await ctx.svc.message(g1.sid, msg({ t: "rep", sid: o.sid, why: "spam" }));
    expect(ctx.reports.length).toBe(2); // burst of 3 attempts per reporter (the duplicate counted), then "give it a minute"
    expect(g1.s.of("e").at(-1)?.code).toBe("slow");
  });

  it("one socket per user per room: a second device replaces the first", async () => {
    const a = await join(ctx.svc, "u1");
    const a2 = await join(ctx.svc, "u1");
    expect(a.s.closed?.code).toBe(PRESENCE_CLOSE.replaced);
    expect(ctx.svc.conns.has(a2.sid)).toBe(true);
    expect(ctx.svc.rooms.get(ROOM)!.members.size).toBe(1);
  });

  it("disconnect frees the seat and empties the room", async () => {
    const a = await join(ctx.svc, "u1");
    await ctx.svc.disconnect(a.sid);
    expect(ctx.svc.rooms.size).toBe(0);
    expect(await ctx.svc.counts(ROOM)).toMatchObject({ avatars: 0, spectators: 0 });
  });
});

describe("presence across two API instances (shared bus)", () => {
  it("joins, poses, reactions and kicks cross instances; the avatar cap holds across both", async () => {
    const store = MemoryPresenceBus.fresh();
    const A = makeService({ store });
    const B = makeService({ store });
    A.svc.avatarCap = B.svc.avatarCap = 2;
    const host = await join(B.svc, "maker", "host");
    const a = await join(A.svc, "u1");
    expect(host.s.of("j").map((j) => j.m.sid)).toContain(a.sid);
    const c = await join(B.svc, "u2");
    expect(c.s.of("w")[0].you.seat).toBe("spectator"); // cap counted over both instances

    const t0 = Date.now();
    await A.svc.message(a.sid, msg({ t: "p", x: 50, y: 160, z: 60, yw: 0, ts: t0 }));
    await A.svc.tick(t0 + 100); // A publishes its local pose
    await B.svc.tick(t0 + 110); // B sends it on
    expect(host.s.of("s").at(-1)?.p[0]?.slice(0, 4)).toEqual([a.sid, 50, 160, 60]);

    await A.svc.message(a.sid, msg({ t: "r", e: "✨" }));
    expect(host.s.of("r")[0]).toEqual({ t: "r", sid: a.sid, e: "✨" });

    await B.svc.message(host.sid, msg({ t: "h", a: "kick", sid: a.sid }));
    expect(a.s.closed?.code).toBe(PRESENCE_CLOSE.kicked);
    expect(host.s.of("l").map((l) => l.sid)).toContain(a.sid);
  });
});
