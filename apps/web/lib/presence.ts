"use client";

import { PRESENCE, PRESENCE_CLOSE, poseMoved, quantize, type PoseEntry, type PresenceClientMsg, type PresenceMember, type PresenceServerMsg } from "@nyambika/contracts";
import { api } from "./api";

/** R4 spike: browser side of the shared-presence socket (flag `vr.multiuser_spike`). No three.js here. */

export interface Ticket {
  ticket: string;
  url: string;
  room: string;
  role: "host" | "guest";
  label: string;
}

export type PresenceEvent =
  | { kind: "welcome"; you: PresenceMember; roster: PresenceMember[] }
  | { kind: "join"; m: PresenceMember }
  | { kind: "leave"; sid: string }
  | { kind: "poses"; p: PoseEntry[]; n: number }
  | { kind: "react"; sid: string; e: string }
  | { kind: "mute"; sid: string; muted: boolean }
  | { kind: "runway"; show?: string; by: string }
  | { kind: "reported"; id?: string }
  | { kind: "error"; code: string; msg: string }
  | { kind: "closed"; code: number; reason: string };

export const CLOSE_TEXT: Record<number, string> = {
  [PRESENCE_CLOSE.kicked]: "The host removed you from this shared room. You can keep browsing on your own.",
  [PRESENCE_CLOSE.banned]: "The host removed you from this room for a while.",
  [PRESENCE_CLOSE.full]: "This shared room is full right now. You can still browse on your own.",
  [PRESENCE_CLOSE.badTicket]: "Your pass to the room expired. Join again.",
  [PRESENCE_CLOSE.flood]: "Too many messages from this device, so the room disconnected you.",
  [PRESENCE_CLOSE.replaced]: "You opened this room on another tab or device.",
  [PRESENCE_CLOSE.disabled]: "Shared rooms were switched off.",
};

export class PresenceClient {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: { x: number; y: number; z: number; yw: number } | null = null;
  private lastAt = 0;
  sid: string | null = null;

  constructor(
    private room: string,
    private getPose: () => { x: number; y: number; z: number; yaw: number } | null,
    private on: (e: PresenceEvent) => void,
  ) {}

  async join(seated: boolean) {
    const t = await api<Ticket>("/vr/presence/tickets", { method: "POST", json: { room: this.room, adult: true, seated } });
    const ws = new WebSocket(`${t.url}?t=${encodeURIComponent(t.ticket)}`);
    this.ws = ws;
    ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)) as PresenceServerMsg);
    ws.onclose = (ev) => {
      this.stopPoses();
      if (this.ws === ws) this.on({ kind: "closed", code: ev.code, reason: ev.reason });
      this.ws = null;
    };
    return t;
  }

  private handle(m: PresenceServerMsg) {
    switch (m.t) {
      case "w":
        this.sid = m.sid;
        this.on({ kind: "welcome", you: m.you, roster: m.roster });
        if (m.you.seat === "avatar") this.startPoses();
        return;
      case "j":
        return this.on({ kind: "join", m: m.m });
      case "l":
        return this.on({ kind: "leave", sid: m.sid });
      case "s":
        return this.on({ kind: "poses", p: m.p, n: m.n });
      case "r":
        return this.on({ kind: "react", sid: m.sid, e: m.e });
      case "m":
        return this.on({ kind: "mute", sid: m.sid, muted: m.muted });
      case "h":
        return this.on({ kind: "runway", show: m.show, by: m.by });
      case "ok":
        return this.on({ kind: "reported", id: m.id });
      case "e":
        return this.on({ kind: "error", code: m.code, msg: m.msg });
    }
  }

  /** 10 Hz while moving, a keep-alive pose every second when still (setInterval keeps running in XR). */
  private startPoses() {
    this.stopPoses();
    this.timer = setInterval(() => {
      const p = this.getPose();
      if (!p) return;
      const q = quantize(p.x, p.y, p.z, p.yaw);
      const now = Date.now();
      if (!poseMoved(this.last, q) && now - this.lastAt < 1000) return;
      this.last = q;
      this.lastAt = now;
      this.send({ t: "p", ...q, ts: now % 1_000_000 });
    }, 1000 / PRESENCE.hz);
  }

  private stopPoses() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  send(m: PresenceClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  leave() {
    this.stopPoses();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "left");
  }
}
