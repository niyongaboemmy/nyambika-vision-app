import { BadRequestException, Body, Controller, Get, Module, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";

const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

@Controller()
export class AnalyticsController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
  ) {}

  /** Member analytics v1 (FR-ANL-01/02/04/05): last 30 days, aggregates only. */
  @Get("pages/:pageId/analytics")
  async page(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const since = new Date(Date.now() - 30 * 86400_000);
    const [looks, saves, orders, followers, sub, allowanceUsed, products] = await Promise.all([
      this.prisma.generation.findMany({
        where: { status: "DELIVERED", createdAt: { gte: since }, variant: { product: { pageId } } },
        select: { variant: { select: { productId: true } } },
      }),
      this.prisma.look.count({ where: { savedAt: { gte: since }, generation: { variant: { product: { pageId } } } } }),
      this.prisma.order.findMany({ where: { pageId, createdAt: { gte: since } }, include: { items: true } }),
      this.prisma.follow.count({ where: { pageId } }),
      this.prisma.subscription.findUnique({ where: { pageId }, include: { plan: true } }),
      this.prisma.usageEvent.count({ where: { pageId, source: "PAGE_ALLOWANCE", createdAt: { gte: since } } }),
      this.prisma.product.findMany({ where: { pageId, status: { not: "ARCHIVED" } }, select: { id: true, title: true } }),
    ]);
    const paid = orders.filter((o) => (PAID as readonly string[]).includes(o.status));
    const byProduct = new Map<string, { looks: number; orders: number }>();
    for (const l of looks) {
      const k = l.variant.productId;
      byProduct.set(k, { looks: (byProduct.get(k)?.looks ?? 0) + 1, orders: byProduct.get(k)?.orders ?? 0 });
    }
    for (const o of paid) {
      const k = o.items[0]?.productId;
      if (k) byProduct.set(k, { looks: byProduct.get(k)?.looks ?? 0, orders: (byProduct.get(k)?.orders ?? 0) + 1 });
    }
    const titles = new Map(products.map((p) => [p.id, p.title]));
    return {
      periodDays: 30,
      looks: looks.length,
      saves,
      orders: paid.length,
      revenueRwf: paid.reduce((s, o) => s + o.totalRwf, 0),
      conversion: looks.length ? paid.length / looks.length : 0,
      followers,
      plan: sub ? { code: sub.planCode, name: sub.plan.name, monthlyCap: sub.monthlyCap, allowanceUsed } : null,
      topProducts: [...byProduct.entries()]
        .map(([id, v]) => ({ id, title: titles.get(id) ?? "—", ...v }))
        .sort((a, b) => b.looks - a.looks)
        .slice(0, 5),
    };
  }

  @Public()
  @Get("plans")
  plans() {
    return this.prisma.plan.findMany({ orderBy: { priceRwf: "asc" } });
  }

  /** FR-PLAN-01/04: change plan and set the monthly allowance cap. */
  @Post("pages/:pageId/plan")
  async setPlan(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, ["PAGE_OWNER", "COOP_ADMIN"]);
    const { planCode, monthlyCap } = parse(z.object({ planCode: z.string(), monthlyCap: z.number().int().min(0).optional() }), body);
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) throw new BadRequestException("Unknown plan");
    const cap = Math.min(monthlyCap ?? plan.tryOnAllowance, plan.tryOnAllowance);
    const sub = await this.prisma.subscription.upsert({
      where: { pageId },
      update: { planCode, monthlyCap: cap, periodStart: new Date() },
      create: { pageId, planCode, monthlyCap: cap },
    });
    await this.access.audit(user.id, "billing.plan_change", { planCode, monthlyCap: cap, priceRwf: plan.priceRwf }, pageId);
    return sub;
  }
}

@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
