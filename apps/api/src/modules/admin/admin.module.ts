import { Body, Controller, Get, Module, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthUser, CurrentUser } from "../../common/auth";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";

const COMPLETED = ["DELIVERED", "COMPLETED"] as const;
const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

/** Host administration (FR-ADM-01..07, FR-PLAN-08). Every route requires a host role. */
@Controller("admin")
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private messaging: MessagingService,
  ) {}

  @Get("overview")
  async overview(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const [pages, products, shoppers, twins, gens, gensToday, withheld, cost, costToday, orders, completed, paidOrders, unreconciled, openModeration] = await Promise.all([
      this.prisma.page.groupBy({ by: ["status"], _count: true }),
      this.prisma.product.count({ where: { status: "PUBLISHED" } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.twin.count({ where: { deletedAt: null } }),
      this.prisma.generation.count({ where: { status: { in: ["DELIVERED", "WITHHELD"] } } }),
      this.prisma.generation.count({ where: { createdAt: { gte: day } } }),
      this.prisma.generation.count({ where: { status: "WITHHELD" } }),
      this.prisma.usageEvent.aggregate({ where: { kind: "TRYON" }, _sum: { costRwf: true }, _count: true }),
      this.prisma.usageEvent.aggregate({ where: { kind: "TRYON", createdAt: { gte: day } }, _sum: { costRwf: true } }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: { in: [...COMPLETED] } } }),
      this.prisma.order.aggregate({ where: { status: { in: [...PAID] } }, _sum: { totalRwf: true }, _count: true }),
      this.prisma.payment.count({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
      this.prisma.moderationItem.count({ where: { status: "OPEN" } }),
    ]);
    const billed = cost._count;
    const totalCost = cost._sum.costRwf ?? 0;
    return {
      pages: Object.fromEntries(pages.map((p) => [p.status, p._count])),
      products,
      shoppers,
      twins,
      orders,
      gmvDirectToMakersRwf: paidOrders._sum.totalRwf ?? 0,
      ai: {
        generationsToday: gensToday,
        guardFailureRate: gens ? withheld / gens : 0,
        costTodayRwf: costToday._sum.costRwf ?? 0,
        costPerGenerationRwf: billed ? Math.round(totalCost / billed) : 0,
        // Plan KPIs §21: generations per completed order ≤ 15; cost/order trigger RWF 1,600 (IR-01).
        generationsPerPaidOrder: paidOrders._count ? +(billed / paidOrders._count).toFixed(1) : null,
        costPerPaidOrderRwf: paidOrders._count ? Math.round(totalCost / paidOrders._count) : null,
      },
      completedOrders: completed,
      unreconciledPayments: unreconciled,
      openModeration,
    };
  }

  @Get("verifications")
  async verifications(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.prisma.page.findMany({
      where: { status: { in: ["PENDING_VERIFICATION", "SUSPENDED"] } },
      orderBy: { createdAt: "asc" },
      include: { roles: { include: { user: { select: { phone: true, name: true } } } }, _count: { select: { products: true } } },
    });
  }

  /** FR-ACC-06/07: verify (badge + publish), reject, suspend, reinstate. */
  @Post("pages/:id/:action")
  async pageAction(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("action") action: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { note } = parse(z.object({ note: z.string().max(300).optional() }), body ?? {});
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id }, include: { roles: { include: { user: true } } } });
    const data =
      action === "verify" ? { verified: true, status: "PUBLISHED" as const }
      : action === "reject" ? { status: "DRAFT" as const }
      : action === "suspend" ? { status: "SUSPENDED" as const }
      : action === "reinstate" ? { status: "PUBLISHED" as const }
      : null;
    if (!data) return { error: "unknown action" };
    await this.prisma.page.update({ where: { id }, data });
    await this.prisma.moderationItem.updateMany({ where: { refId: id, kind: "PAGE_VERIFICATION", status: "OPEN" }, data: { status: "RESOLVED", resolvedBy: user.id, resolvedAt: new Date() } });
    await this.access.audit(user.id, `admin.page_${action}`, { note }, id);
    const owner = page.roles.find((r) => r.role === "PAGE_OWNER" || r.role === "COOP_ADMIN")?.user;
    if (owner) {
      const msg = action === "verify" ? `Your page ${page.name} is verified and live on Nyambika ✓` : `Update on your page ${page.name}: ${action}${note ? `: ${note}` : ""}`;
      await this.messaging.send("WHATSAPP", owner.phone, `page_${action}`, msg, id);
    }
    return { ok: true };
  }

  @Get("moderation")
  async moderation(@CurrentUser() user: AuthUser, @Query("status") status = "OPEN") {
    await this.access.requireHost(user.id);
    return this.prisma.moderationItem.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  @Post("moderation/:id/resolve")
  async resolve(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { resolution } = parse(z.object({ resolution: z.string().max(300).default("resolved") }), body ?? {});
    const item = await this.prisma.moderationItem.update({ where: { id }, data: { status: "RESOLVED", resolvedBy: user.id, resolvedAt: new Date() } });
    if (item.kind === "ORDER_DISPUTE") {
      await this.prisma.order.update({ where: { id: item.refId }, data: { status: "RESOLVED" } });
      await this.prisma.orderEvent.create({ data: { orderId: item.refId, status: "RESOLVED", note: `Mediated by Nyambika: ${resolution}`, actorId: user.id } });
    }
    await this.access.audit(user.id, "admin.moderation_resolve", { id, kind: item.kind, resolution }, item.pageId ?? undefined);
    return item;
  }

  @Get("flags")
  async flags(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  }

  @Patch("flags/:key")
  async setFlag(@CurrentUser() user: AuthUser, @Param("key") key: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const input = parse(z.object({ enabled: z.boolean().optional(), rollout: z.number().int().min(0).max(1000).optional() }), body);
    const f = await this.prisma.featureFlag.update({ where: { key }, data: input });
    await this.access.audit(user.id, "admin.flag", { key, ...input });
    return f;
  }

  /** Model registry (AI-GW, AI-BM): activate/retire provider model versions. */
  @Get("models")
  async models(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const models = await this.prisma.modelVersion.findMany({ orderBy: { createdAt: "asc" } });
    const stats = await this.prisma.generation.groupBy({ by: ["modelVersion", "status"], _count: true, _avg: { latencyMs: true } });
    return models.map((m) => {
      const s = stats.filter((x) => x.modelVersion === m.id);
      const delivered = s.find((x) => x.status === "DELIVERED");
      const withheld = s.find((x) => x.status === "WITHHELD");
      const total = (delivered?._count ?? 0) + (withheld?._count ?? 0);
      return { ...m, generations: total, guardFailureRate: total ? (withheld?._count ?? 0) / total : 0, avgLatencyMs: Math.round(delivered?._avg.latencyMs ?? 0) };
    });
  }

  @Patch("models/:id")
  async setModel(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { status } = parse(z.object({ status: z.enum(["ACTIVE", "RETIRED"]) }), body);
    await this.access.audit(user.id, "admin.model_status", { id, status });
    return this.prisma.modelVersion.update({ where: { id }, data: { status } });
  }

  @Get("notifications")
  async notifications(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  @Get("audit")
  async audit(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 80 });
  }
}

@Module({ controllers: [AdminController] })
export class AdminModule {}
