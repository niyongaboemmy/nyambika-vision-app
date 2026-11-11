import { Body, Controller, ForbiddenException, Get, HttpException, Module, NotFoundException, Param, Post } from "@nestjs/common";
import { parseRoom, PRESENCE, PRESENCE_LABEL, TicketInput } from "@nyambika/contracts";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { MemoryCounterStore } from "../circle/guards";
import { PresenceGateway, signTicket } from "./presence.gateway";
import { PRESENCE_FLAG, PresenceService } from "./presence.service";

const wsUrl = () => process.env.PRESENCE_WS_URL ?? `${config.selfUrl.replace(/^http/, "ws")}/vr/presence`;

/** R4 spike: tickets for the shared-presence socket, live counts and instance stats (flag `vr.multiuser_spike`). */
@Controller("vr/presence")
export class PresenceController {
  private tickets = new MemoryCounterStore();
  constructor(
    private svc: PresenceService,
    private prisma: PrismaService,
    private access: Access,
  ) {}

  /** Which room a ticket opens: a published Maker Space with its showroom open, or a scheduled show. */
  private async resolve(room: string) {
    const r = parseRoom(room);
    if (!r) throw new NotFoundException("Unknown room");
    if (r.kind === "showroom") {
      const page = await this.prisma.page.findUnique({ where: { handle: r.key } });
      if (!page || page.status !== "PUBLISHED") throw new NotFoundException("This showroom isn't available");
      const booth = await this.prisma.showroomBooth.findUnique({ where: { pageId: page.id } });
      if (booth && !booth.enabled) throw new NotFoundException("This maker's showroom is closed right now");
      return { room: `showroom:${page.handle}`, pageId: page.id };
    }
    const show = await this.prisma.fashionShow.findUnique({ where: { id: r.key } });
    if (!show || show.status === "CANCELLED") throw new NotFoundException("This show isn't available");
    return { room: `show:${show.id}`, pageId: show.pageId };
  }

  @Post("tickets")
  async ticket(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(TicketInput, body);
    if (!(await this.svc.enabled())) throw new ForbiddenException({ message: "Shared rooms are not switched on", code: "FLAG_OFF" });
    if ((await this.tickets.incr(`t:${user.id}`, 60)) > 10) throw new HttpException({ message: "Too many joins in a minute. Wait a moment.", code: "RATE_LIMIT" }, 429);
    const { room, pageId } = await this.resolve(input.room);
    if (await this.svc.bus.isBanned(room, user.id)) throw new ForbiddenException({ message: "The host removed you from this room for a while", code: "BANNED" });
    const manager = (await this.access.isHost(user.id)) || (await this.prisma.roleAssignment.count({ where: { userId: user.id, pageId, role: { in: MANAGE } } })) > 0;
    const role = manager ? "host" : "guest";
    return { ticket: signTicket({ sub: user.id, room, role, pageId, seated: input.seated }), url: wsUrl(), room, role, expiresInSec: PRESENCE.ticketTtlSec, label: PRESENCE_LABEL };
  }

  @Public()
  @Get("rooms/:room")
  async room(@Param("room") room: string) {
    if (!(await this.svc.enabled())) return { enabled: false };
    const { room: id } = await this.resolve(room);
    return { enabled: true, ...(await this.svc.counts(id)) };
  }

  /** This instance's presence metrics (host admins; the load test reads them). */
  @Get("stats")
  async stats(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return { flag: PRESENCE_FLAG, ...this.svc.metrics() };
  }
}

@Module({
  controllers: [PresenceController],
  providers: [PresenceService, PresenceGateway],
})
export class PresenceModule {}
