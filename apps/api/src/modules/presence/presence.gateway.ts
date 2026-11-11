import { Logger } from "@nestjs/common";
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from "@nestjs/websockets";
import { PRESENCE, PRESENCE_CLOSE } from "@nyambika/contracts";
import jwt from "jsonwebtoken";
import type { IncomingMessage } from "node:http";
import { config } from "../../config";
import { PresenceService, type PresenceSocket, type TicketClaims } from "./presence.service";

export const TICKET_AUD = "vr-presence";

/** ws.WebSocket surface we use (kept local so the gateway does not need @types/ws). */
interface WsClient extends PresenceSocket {
  on(ev: "message", fn: (data: Buffer, isBinary: boolean) => void): void;
  _sid?: string;
  _closed?: boolean;
}

export function signTicket(c: TicketClaims) {
  return jwt.sign({ room: c.room, role: c.role, pageId: c.pageId, seated: c.seated ?? false }, config.jwtSecret, { subject: c.sub, audience: TICKET_AUD, expiresIn: PRESENCE.ticketTtlSec });
}

export function readTicket(token: string | null): TicketClaims | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret, { audience: TICKET_AUD }) as jwt.JwtPayload;
    if (!p.sub || typeof p.room !== "string") return null;
    return { sub: p.sub, room: p.room, role: p.role === "host" ? "host" : "guest", pageId: (p.pageId as string | null) ?? null, seated: Boolean(p.seated) };
  } catch {
    return null;
  }
}

/** Browsers send Origin on WebSocket upgrades: accept the web app (and native shells), refuse other sites. */
function originOk(origin: string | undefined) {
  if (!origin) return true; // non-browser clients (load test, native) still need a valid ticket
  if (origin === config.webUrl || origin === "capacitor://localhost" || origin === "https://localhost") return true;
  return process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(origin);
}

/**
 * R4 spike gateway: one WebSocket per participant at /vr/presence?t=<ticket>. The ticket (60 s JWT from
 * POST /vr/presence/tickets) carries the user, room and role; the socket itself carries only pseudonymous
 * presence frames. Cross-instance fan-out goes through the Redis presence bus.
 */
@WebSocketGateway({ path: "/vr/presence" })
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private log = new Logger("PresenceGateway");
  constructor(private svc: PresenceService) {}

  async handleConnection(client: WsClient, req: IncomingMessage) {
    if (!originOk(req.headers.origin)) return client.close(PRESENCE_CLOSE.badTicket, "Origin not allowed");
    const url = new URL(req.url ?? "/", "http://x");
    const claims = readTicket(url.searchParams.get("t"));
    if (!claims) return client.close(PRESENCE_CLOSE.badTicket, "Ticket expired, rejoin the room");
    // Frames that arrive while the seat is being claimed are queued, then replayed.
    const early: Buffer[] = [];
    client.on("message", (data) => {
      if (client._sid) void this.svc.message(client._sid, data).catch((e: Error) => this.log.warn(e.message));
      else if (early.length < 20) early.push(data);
    });
    const sid = await this.svc.connect(client, claims).catch((e: Error) => {
      this.log.warn(`connect failed: ${e.message}`);
      client.close(1011, "Try again");
      return null;
    });
    if (!sid) return;
    client._sid = sid;
    if (client._closed) return void this.svc.disconnect(sid); // went away while joining
    for (const d of early) await this.svc.message(sid, d);
  }

  handleDisconnect(client: WsClient) {
    client._closed = true;
    if (client._sid) void this.svc.disconnect(client._sid);
  }
}
