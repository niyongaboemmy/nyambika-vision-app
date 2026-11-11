import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { TailorServiceInput } from "@nyambika/contracts";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { LooksModule } from "../looks/looks.module";
import { CustomOrdersController, CustomOrdersService } from "./custom-orders";
import { MeasurementsController, MeasurementsService } from "./measurements";
import { MorphController, MorphService } from "./morph";

const SlotInput = z.object({
  startsAt: z.coerce.date(),
  durationMin: z.number().int().min(15).max(240).default(45),
  location: z.string().max(120).default(""),
});

/** Tailor services (FR-CAT-07) and fitting slots (FR-SIZE-07). */
@Injectable()
export class TailorDeskService {
  constructor(
    private prisma: PrismaService,
    private access: Access,
  ) {}

  async services(pageId: string, userId: string | null) {
    const manager = userId ? await this.access.requirePage(userId, pageId, MANAGE).then(() => true, () => false) : false;
    return this.prisma.tailorService.findMany({ where: { pageId, ...(manager ? {} : { active: true }) }, orderBy: { createdAt: "asc" } });
  }

  async createService(userId: string, pageId: string, body: unknown) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    if (page.memberType !== "TAILOR") throw new BadRequestException("Services are for tailor pages");
    const s = await this.prisma.tailorService.create({ data: { pageId, ...parse(TailorServiceInput, body) } });
    await this.access.audit(userId, "TAILOR_SERVICE_CREATED", { serviceId: s.id, title: s.title }, pageId);
    return s;
  }

  async updateService(userId: string, pageId: string, id: string, body: unknown) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const s = await this.prisma.tailorService.findFirst({ where: { id, pageId } });
    if (!s) throw new NotFoundException();
    return this.prisma.tailorService.update({ where: { id }, data: parse(TailorServiceInput.partial(), body) });
  }

  async removeService(userId: string, pageId: string, id: string) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const r = await this.prisma.tailorService.deleteMany({ where: { id, pageId } });
    if (!r.count) throw new NotFoundException();
    await this.access.audit(userId, "TAILOR_SERVICE_REMOVED", { serviceId: id }, pageId);
    return { removed: true };
  }

  /** Manager view: all slots from `from` (default today) for 7 days, with who booked them. */
  async slots(userId: string, pageId: string, from?: string) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const start = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
    if (Number.isNaN(start.getTime())) throw new BadRequestException("Bad date");
    const end = new Date(start.getTime() + 7 * 86400_000);
    const rows = await this.prisma.appointmentSlot.findMany({ where: { pageId, startsAt: { gte: start, lt: end } }, orderBy: { startsAt: "asc" } });
    const orders = await this.prisma.customOrder.findMany({ where: { id: { in: rows.map((r) => r.customOrderId).filter((x): x is string => !!x) } }, select: { id: true, code: true, title: true, shopperId: true } });
    const users = await this.prisma.user.findMany({ where: { id: { in: orders.map((o) => o.shopperId) } }, select: { id: true, name: true, phone: true, deletedAt: true } });
    const oById = new Map(orders.map((o) => [o.id, o]));
    const uById = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => {
      const o = r.customOrderId ? oById.get(r.customOrderId) : undefined;
      const u = o ? uById.get(o.shopperId) : undefined;
      return {
        id: r.id,
        startsAt: r.startsAt,
        durationMin: r.durationMin,
        location: r.location,
        booked: Boolean(r.bookedById),
        customOrder: o ? { id: o.id, code: o.code, title: o.title } : null,
        customer: u ? (u.deletedAt ? { name: "Deleted account", phone: "" } : { name: u.name, phone: u.phone }) : null,
      };
    });
  }

  async addSlots(userId: string, pageId: string, body: unknown) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const { slots } = parse(z.object({ slots: z.array(SlotInput).min(1).max(50) }), body);
    if (slots.some((s) => s.startsAt.getTime() < Date.now())) throw new BadRequestException("Slots must be in the future");
    const r = await this.prisma.appointmentSlot.createMany({ data: slots.map((s) => ({ pageId, ...s })) });
    return { created: r.count };
  }

  async removeSlot(userId: string, pageId: string, id: string) {
    await this.access.requirePage(userId, pageId, MANAGE);
    const r = await this.prisma.appointmentSlot.deleteMany({ where: { id, pageId, bookedById: null } });
    if (!r.count) throw new BadRequestException("Booked slots can't be removed. Message the customer to move it.");
    return { removed: true };
  }
}

@Controller("pages/:pageId")
export class TailorDeskController {
  constructor(private desk: TailorDeskService) {}

  @Public()
  @Get("services")
  services(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser | null) {
    return this.desk.services(pageId, user?.id ?? null);
  }

  @Post("services")
  create(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    return this.desk.createService(user.id, pageId, body);
  }

  @Patch("services/:id")
  update(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("id") id: string, @Body() body: unknown) {
    return this.desk.updateService(user.id, pageId, id, body);
  }

  @Delete("services/:id")
  remove(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("id") id: string) {
    return this.desk.removeService(user.id, pageId, id);
  }

  @Get("slots")
  slots(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Query("from") from?: string) {
    return this.desk.slots(user.id, pageId, from);
  }

  @Post("slots")
  addSlots(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    return this.desk.addSlots(user.id, pageId, body);
  }

  @Delete("slots/:id")
  removeSlot(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("id") id: string) {
    return this.desk.removeSlot(user.id, pageId, id);
  }
}

/** E23 Live morph · E24 Tailor custom orders · E32 Size recommendation. */
@Module({
  imports: [LooksModule],
  controllers: [MeasurementsController, MorphController, CustomOrdersController, TailorDeskController],
  providers: [MeasurementsService, MorphService, CustomOrdersService, TailorDeskService],
  exports: [MeasurementsService, CustomOrdersService],
})
export class TailorModule {}
