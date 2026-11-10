import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";

const MakerInput = z.object({
  name: z.string().min(2).max(80),
  phone: z.string().max(20).optional().default(""),
  momoMerchant: z.string().max(20).optional().default(""),
  attributionConsent: z.boolean().optional().default(true),
});

const toE164 = (p: string) => (p.startsWith("+") ? p : `+250${p.replace(/\D/g, "").replace(/^0/, "")}`);

/** Cooperative makers, attribution and payout destinations (FR-COOP-01..06, 10). */
@Controller("pages/:pageId/makers")
export class CoopsController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
  ) {}

  @Get()
  async list(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser) {
    await this.access.requirePage(user.id, pageId, [...MANAGE, "COOP_MEMBER"]);
    const makers = await this.prisma.coopMember.findMany({
      where: { pageId },
      orderBy: { createdAt: "asc" },
      include: { products: { include: { product: { select: { id: true, status: true } } } } },
    });
    // FR-COOP-06: sales totals per maker from paid orders.
    const items = await this.prisma.orderItem.findMany({
      where: { order: { pageId, status: { in: ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] } } },
    });
    return makers.map((m) => ({
      id: m.id,
      name: m.name,
      phone: m.phone,
      momoMerchant: m.momoMerchant,
      active: m.active,
      attributionConsent: m.attributionConsent,
      productCount: m.products.filter((p) => p.product.status !== "ARCHIVED").length,
      salesRwf: items.filter((i) => i.makerName === m.name).reduce((s, i) => s + i.unitPriceRwf * i.qty, 0),
    }));
  }

  @Post()
  async add(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN"]);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId }, include: { subscription: true } });
    if (page.memberType !== "COOPERATIVE") throw new BadRequestException("Only cooperative pages have makers");
    const count = await this.prisma.coopMember.count({ where: { pageId, active: true } });
    if (count >= 25 && page.subscription?.planCode !== "COOPERATIVE_PLUS") {
      throw new BadRequestException("Standard cooperative plan supports up to 25 makers");
    }
    const input = parse(MakerInput, body);
    let userId: string | null = null;
    if (input.phone) {
      const phone = toE164(input.phone);
      const u = await this.prisma.user.upsert({
        where: { phone },
        update: {},
        create: { phone, name: input.name, roles: { create: { role: "SHOPPER" } } },
      });
      userId = u.id;
      await this.prisma.roleAssignment.upsert({
        where: { userId_role_pageId: { userId: u.id, role: "COOP_MEMBER", pageId } },
        update: {},
        create: { userId: u.id, role: "COOP_MEMBER", pageId },
      });
      input.phone = phone;
    }
    const maker = await this.prisma.coopMember.create({ data: { ...input, pageId, userId } });
    await this.access.audit(user.id, "coop.maker_add", { makerId: maker.id, name: maker.name }, pageId);
    return maker;
  }

  @Patch(":makerId")
  async update(@Param("pageId") pageId: string, @Param("makerId") makerId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["COOP_ADMIN"]);
    const input = parse(MakerInput.partial().extend({ active: z.boolean().optional() }), body);
    const before = await this.prisma.coopMember.findFirstOrThrow({ where: { id: makerId, pageId } });
    const maker = await this.prisma.coopMember.update({ where: { id: makerId }, data: input });
    await this.access.audit(user.id, "coop.maker_update", { makerId, before: { active: before.active, momoMerchant: before.momoMerchant }, after: input }, pageId);
    return maker;
  }
}

@Module({ controllers: [CoopsController] })
export class CoopsModule {}
