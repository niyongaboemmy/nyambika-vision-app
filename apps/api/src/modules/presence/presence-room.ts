import { clampPose, interestSet, PRESENCE, type PoseEntry, type PresenceMember, type Pose } from "@nyambika/contracts";

/** A member as the server knows it: the public member plus the internal user id (never sent to clients). */
export interface MemberRecord extends PresenceMember {
  userId: string;
  instance: string;
  joinedAt: number;
}

export const publicMember = ({ userId: _u, instance: _i, joinedAt: _j, ...m }: MemberRecord): PresenceMember => m;

export interface RoomEvent {
  at: number;
  what: string;
  sid?: string;
  nick?: string;
}

/**
 * One presence room as replicated on every API instance that holds at least one of its participants.
 * Pure state + the per-recipient snapshot rule (interest management, delta by pose version, spectator rate);
 * sockets and Redis live in the service.
 */
export class PresenceRoom {
  members = new Map<string, MemberRecord>();
  poses = new Map<string, Pose>();
  /** Monotonic pose version per sid (two poses can land in the same millisecond). */
  private ver = new Map<string, number>();
  private seq = 0;
  /** Per local recipient: pose version last sent for each sid, and when the last snapshot went out. */
  private sent = new Map<string, Map<string, number>>();
  private lastSend = new Map<string, number>();
  /** Recent events (joins, reactions, host actions) attached to moderation reports as context. */
  events: RoomEvent[] = [];
  /** Local pose changes not yet published to other instances. */
  outbox = new Map<string, Pose>();

  constructor(
    readonly id: string,
    readonly pageId: string | null,
  ) {}

  log(what: string, sid?: string) {
    this.events.push({ at: Date.now(), what, sid, nick: sid ? this.members.get(sid)?.nick : undefined });
    if (this.events.length > 30) this.events.shift();
  }

  add(m: MemberRecord) {
    this.members.set(m.sid, m);
  }

  remove(sid: string) {
    this.members.delete(sid);
    this.poses.delete(sid);
    this.ver.delete(sid);
    this.outbox.delete(sid);
    this.sent.delete(sid);
    this.lastSend.delete(sid);
    for (const s of this.sent.values()) s.delete(sid);
  }

  counts() {
    let avatars = 0;
    for (const m of this.members.values()) if (m.seat === "avatar") avatars++;
    return { avatars, spectators: this.members.size - avatars };
  }

  /** A pose from a local socket (validated + clamped); spectators have no rendered body, so no pose. */
  applyLocal(sid: string, p: { x: number; y: number; z: number; yw: number; ts?: number }, now = Date.now()) {
    const m = this.members.get(sid);
    if (!m || m.seat !== "avatar") return false;
    const c = clampPose(p);
    const pose: Pose = { ...c, ts: (p.ts ?? now) % 1_000_000, at: now };
    this.poses.set(sid, pose);
    this.ver.set(sid, ++this.seq);
    this.outbox.set(sid, pose);
    return true;
  }

  /** Poses another instance published. */
  applyRemote(entries: PoseEntry[], now = Date.now()) {
    for (const [sid, x, y, z, yw, ts] of entries) {
      if (this.members.get(sid)?.seat !== "avatar") continue;
      this.poses.set(sid, { x, y, z, yw, ts, at: now });
      this.ver.set(sid, ++this.seq);
    }
  }

  drainOutbox(): PoseEntry[] {
    const out: PoseEntry[] = [];
    for (const [sid, p] of this.outbox) out.push([sid, p.x, p.y, p.z, p.yw, p.ts]);
    this.outbox.clear();
    return out;
  }

  /**
   * The snapshot for one local recipient, or null when nothing is due. Avatars get 10 Hz, spectators 2 Hz;
   * each gets only the host + its K nearest avatars, and only poses that changed since it last heard them.
   * A snapshot with no poses still goes out once a second so the live count stays fresh.
   */
  frameFor(sid: string, now = Date.now()): { p: PoseEntry[]; n: number } | null {
    const me = this.members.get(sid);
    if (!me) return null;
    const last = this.lastSend.get(sid) ?? 0;
    const period = 1000 / (me.seat === "spectator" ? PRESENCE.spectatorHz : PRESENCE.hz);
    if (now - last < period - 15) return null;
    const mine = this.poses.get(sid) ?? { x: 0, z: 320 };
    const others: { sid: string; x: number; z: number; host?: boolean }[] = [];
    for (const [osid, p] of this.poses) {
      if (osid === sid || now - p.at > PRESENCE.staleMs) continue;
      others.push({ sid: osid, x: p.x, z: p.z, host: this.members.get(osid)?.role === "host" });
    }
    const want = interestSet({ sid, x: mine.x, z: mine.z }, others);
    let sent = this.sent.get(sid);
    if (!sent) this.sent.set(sid, (sent = new Map()));
    const p: PoseEntry[] = [];
    for (const osid of want) {
      const pose = this.poses.get(osid)!;
      const v = this.ver.get(osid) ?? 0;
      if (sent.get(osid) === v) continue;
      sent.set(osid, v);
      p.push([osid, pose.x, pose.y, pose.z, pose.yw, pose.ts]);
    }
    // Forget avatars that left interest so they are re-sent in full when they come back.
    for (const k of sent.keys()) if (!want.has(k)) sent.delete(k);
    if (!p.length && now - last < 1000) return null;
    this.lastSend.set(sid, now);
    return { p, n: this.members.size };
  }
}
