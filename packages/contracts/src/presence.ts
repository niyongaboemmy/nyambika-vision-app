import { z } from "zod";
import { REACTIONS } from "./vr";

/**
 * R4 spike (not committed): multi-user VR presence in the E35 showroom / fashion show.
 * Pure protocol rules shared by the API gateway, the web client and the headless load-test clients.
 *
 * Wire format: small JSON frames over one WebSocket per participant. Positions are integer centimetres and
 * yaw is integer milliradians, so a pose entry is ~30 bytes. Clients send their pose at most PRESENCE.hz;
 * the server batches everything it learned in one tick into one snapshot per recipient (interest-filtered).
 *
 * Privacy (OP-3): a participant is a stylised synthetic avatar with a pseudonym derived per room. No name,
 * phone, photo, twin or measurement ever enters this protocol. No free text, no voice.
 */

export const PRESENCE = {
  /** Pose updates per second (client send rate and server tick rate). */
  hz: 10,
  /** Spectators (over the avatar cap) receive snapshots at this lower rate and are not rendered. */
  spectatorHz: 2,
  /** Rendered avatars per room (spike target ~20). Above this new joiners become spectators. */
  avatarCap: 20,
  /** Hard ceiling per room (avatars + spectators); beyond this the ticket is refused. */
  roomCap: 200,
  /** Interest management: each viewer receives at most this many nearest avatars (+ the host)... */
  interestK: 12,
  /** ...within this radius (metres). Everyone else is only counted. */
  interestRadiusM: 12,
  /** Personal-space bubble: other avatars closer than this fade out and cannot be targeted. */
  bubbleM: 0.9,
  /** Room bounds (metres) – poses outside are clamped (the showroom walk radius is 6.6 m). */
  boundsM: 9,
  maxHeightM: 2.6,
  /** Largest client frame accepted (bytes). */
  maxFrameBytes: 512,
  /** Ticket lifetime (seconds): only used to open the socket. */
  ticketTtlSec: 60,
  /** Kicked participants cannot rejoin the same room for this long. */
  kickBanSec: 600,
  /** Poses older than this are dropped from snapshots (client stalled). */
  staleMs: 5000,
} as const;

/** Token-bucket limits per socket: `rate` tokens per second, bursts up to `burst`. */
export const PRESENCE_LIMITS = {
  pose: { rate: 15, burst: 20 },
  react: { rate: 1, burst: 4 },
  host: { rate: 0.5, burst: 5 },
  report: { rate: 1 / 20, burst: 3 },
  ping: { rate: 1, burst: 3 },
  /** Dropped frames tolerated per 10 s before the socket is closed for flooding. */
  floodDrops: 150,
} as const;

/** WebSocket close codes the client turns into plain-language messages. */
export const PRESENCE_CLOSE = {
  kicked: 4003,
  banned: 4004,
  full: 4005,
  badTicket: 4001,
  flood: 4008,
  replaced: 4009,
  disabled: 4010,
} as const;

export type PresenceRole = "host" | "guest";
export type PresenceSeat = "avatar" | "spectator";

/** Room ids: one presence room per Maker Space showroom, one per fashion show. */
export const PresenceRoomId = z.string().regex(/^(showroom|show):[a-z0-9][a-z0-9_-]{1,63}$/i, "Unknown room");
export function parseRoom(room: string): { kind: "showroom" | "show"; key: string } | null {
  if (!PresenceRoomId.safeParse(room).success) return null;
  const [kind, key] = room.split(":") as ["showroom" | "show", string];
  return { kind, key };
}

export const TicketInput = z.object({
  room: PresenceRoomId,
  /** 18+ self-attestation (spike minors policy: adults only, no age data is stored). */
  adult: z.literal(true, { message: "Multi-user rooms are for adults (18+) during this test" }),
  seated: z.boolean().optional(),
});

const int = (min: number, max: number) => z.number().int().min(min).max(max);
export const PresenceClientMsg = z.discriminatedUnion("t", [
  /** Pose: x/y/z in cm, yaw in mrad, client clock ms (for latency measurement). */
  z.object({ t: z.literal("p"), x: int(-5000, 5000), y: int(-500, 500), z: int(-5000, 5000), yw: int(-7000, 7000), ts: z.number().int().nonnegative().optional() }),
  z.object({ t: z.literal("r"), e: z.enum(REACTIONS) }),
  z.object({ t: z.literal("h"), a: z.enum(["mute", "unmute", "kick", "runway"]), sid: z.string().max(16).optional(), show: z.string().max(40).optional() }),
  z.object({ t: z.literal("rep"), sid: z.string().min(1).max(16), why: z.enum(["harassment", "spam", "impersonation", "inappropriate", "minor", "other"]) }),
  z.object({ t: z.literal("ping"), ts: z.number().int().nonnegative() }),
]);
export type PresenceClientMsg = z.infer<typeof PresenceClientMsg>;

export interface PresenceMember {
  sid: string;
  nick: string;
  /** Avatar style: palette index + shape (synthetic, random per room, never from a photo). */
  hue: number;
  shape: number;
  role: PresenceRole;
  seat: PresenceSeat;
  muted: boolean;
  seated: boolean;
}

/** [sid, x, y, z, yaw, senderTs % 1e6] */
export type PoseEntry = [string, number, number, number, number, number];

export type PresenceServerMsg =
  | { t: "w"; sid: string; you: PresenceMember; roster: PresenceMember[]; cfg: { hz: number; bubbleM: number; avatarCap: number }; counts: { avatars: number; spectators: number } }
  | { t: "j"; m: PresenceMember }
  | { t: "l"; sid: string }
  | { t: "s"; ts: number; p: PoseEntry[]; n: number }
  | { t: "r"; sid: string; e: string }
  | { t: "m"; sid: string; muted: boolean }
  | { t: "h"; a: "runway"; show?: string; by: string }
  | { t: "ok"; what: "report"; id?: string }
  | { t: "pong"; ts: number }
  | { t: "e"; code: string; msg: string };

// ── rate limiting ─────────────────────────────────────────────────────────────────────────────────────────
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(
    private rate: number,
    private burst: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.at = now();
  }
  take(n = 1) {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.rate);
    this.at = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

// ── poses ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface Pose {
  x: number;
  y: number;
  z: number;
  yw: number;
  ts: number;
  /** Server receive time (ms). */
  at: number;
}

/** Clamp a client pose into the room (cm / mrad). Wraps yaw into [-π, π]. */
export function clampPose(p: { x: number; y: number; z: number; yw: number }) {
  const b = PRESENCE.boundsM * 100;
  const r = Math.hypot(p.x, p.z);
  const k = r > b ? b / r : 1;
  let yw = p.yw;
  while (yw > 3142) yw -= 6283;
  while (yw < -3142) yw += 6283;
  return { x: Math.round(p.x * k), y: Math.max(0, Math.min(PRESENCE.maxHeightM * 100, p.y)), z: Math.round(p.z * k), yw };
}

/** Metres/radians → wire units. */
export function quantize(x: number, y: number, z: number, yaw: number) {
  return { x: Math.round(x * 100), y: Math.round(y * 100), z: Math.round(z * 100), yw: Math.round(yaw * 1000) };
}

/** Worth sending? (≥ 2 cm or ≥ 1° change; the client also sends a keep-alive pose every second). */
export function poseMoved(a: { x: number; y: number; z: number; yw: number } | null | undefined, b: { x: number; y: number; z: number; yw: number }) {
  if (!a) return true;
  return Math.abs(a.x - b.x) >= 2 || Math.abs(a.y - b.y) >= 2 || Math.abs(a.z - b.z) >= 2 || Math.abs(a.yw - b.yw) >= 17;
}

// ── interest management ───────────────────────────────────────────────────────────────────────────────────
/**
 * Which avatars one viewer receives: the host always, then the nearest others within the radius up to K.
 * Spectators get nothing per-avatar (they see the count and the host/runway events only).
 */
export function interestSet(
  viewer: { sid: string; x: number; z: number },
  others: { sid: string; x: number; z: number; host?: boolean }[],
  k: number = PRESENCE.interestK,
  radiusM: number = PRESENCE.interestRadiusM,
): Set<string> {
  const r2 = (radiusM * 100) ** 2;
  const out = new Set<string>();
  const cand: { sid: string; d: number }[] = [];
  for (const o of others) {
    if (o.sid === viewer.sid) continue;
    if (o.host) {
      out.add(o.sid);
      continue;
    }
    const d = (o.x - viewer.x) ** 2 + (o.z - viewer.z) ** 2;
    if (d <= r2) cand.push({ sid: o.sid, d });
  }
  cand.sort((a, b) => a.d - b.d);
  for (const c of cand.slice(0, k)) out.add(c.sid);
  return out;
}

/** Inside someone's personal-space bubble (cm inputs)? */
export function inBubble(a: { x: number; z: number }, b: { x: number; z: number }, bubbleM: number = PRESENCE.bubbleM) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < (bubbleM * 100) ** 2;
}

// ── synthetic identity ────────────────────────────────────────────────────────────────────────────────────
const ADJ = ["Amber", "Indigo", "Jade", "Coral", "Ivory", "Saffron", "Teal", "Plum", "Sienna", "Cobalt", "Ochre", "Mint"];
const ANIMAL = ["Egret", "Crane", "Gazelle", "Heron", "Ibis", "Kudu", "Okapi", "Zebra", "Impala", "Weaver", "Sunbird", "Oryx"];
export const AVATAR_HUES = ["#e5395f", "#f0b429", "#2dd4bf", "#8b5cf6", "#38bdf8", "#f97316", "#a3e635", "#f472b6"] as const;
export const AVATAR_SHAPES = 3;

/** Pseudonym + style from a per-room 32-bit seed (an HMAC of user + room on the server): stable on reconnect, unlinkable across rooms. */
export function synthIdentity(seed: number) {
  const s = seed >>> 0;
  return {
    nick: `${ADJ[s % ADJ.length]} ${ANIMAL[Math.floor(s / ADJ.length) % ANIMAL.length]} ${10 + (Math.floor(s / 144) % 90)}`,
    hue: Math.floor(s / 12960) % AVATAR_HUES.length,
    shape: Math.floor(s / 103680) % AVATAR_SHAPES,
  };
}

export const PRESENCE_LABEL = "Experimental: shared room test. Everyone appears as a synthetic avatar with a made-up name.";
