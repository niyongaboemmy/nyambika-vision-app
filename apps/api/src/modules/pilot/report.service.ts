import { Injectable } from "@nestjs/common";
import { FUNNEL_STEPS } from "@nyambika/contracts";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma.service";
import type { Variant } from "./assign";
import { buildKpis, recomputeEconomics, recommend, type PilotRaw } from "./kpis";
import { pseudonymise } from "./pilot.service";
import { zTest } from "./stats";

const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] as const;
const DAY = 86_400_000;
export const OUTCOMES = ["twin_created", "hold_started", "order_paid", "look_saved"] as const;
export type Outcome = (typeof OUTCOMES)[number];

interface ArmRow {
  variant: string;
  n: bigint;
  twin_created: bigint;
  hold_started: bigint;
  order_paid: bigint;
  look_saved: bigint;
  gens: bigint;
}

/** Pilot dashboard + Gate 3 report assembly (plan §8.3, §21). All outputs are aggregates. */
@Injectable()
export class PilotReportService {
  constructor(private prisma: PrismaService) {}

  async window() {
    const cohort = await this.prisma.pilotCohort.findFirst({ orderBy: { startsAt: "desc" } });
    const start = cohort?.startsAt ?? new Date(Date.now() - 26 * DAY);
    const end = new Date(Math.min(Date.now(), (cohort?.endsAt ?? new Date()).getTime()));
    return { cohort, start, end, days: Math.max(0, Math.ceil((end.getTime() - start.getTime()) / DAY)) };
  }

  private async members(cohortId: string | undefined, kind: "PAGE" | "SHOPPER") {
    if (!cohortId) return [];
    const rows = await this.prisma.pilotMember.findMany({ where: { cohortId, kind }, select: { subjectId: true } });
    return rows.map((r) => r.subjectId);
  }

  async raw(): Promise<{ raw: PilotRaw; econ: ReturnType<typeof recomputeEconomics>; window: Awaited<ReturnType<PilotReportService["window"]>> }> {
    const w = await this.window();
    const range = { gte: w.start, lte: w.end };
    const [pageIds, shopperIds] = await Promise.all([this.members(w.cohort?.id, "PAGE"), this.members(w.cohort?.id, "SHOPPER")]);
    const pseudo = shopperIds.map(pseudonymise);

    const [pages, subs, roles, audits, twins, tried, usage, gens, orders, survey, incidents, plans] = await Promise.all([
      this.prisma.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, status: true, memberType: true } }),
      this.prisma.subscription.findMany({ where: { pageId: { in: pageIds } }, select: { pageId: true, planCode: true } }),
      this.prisma.roleAssignment.findMany({ where: { pageId: { in: pageIds } }, select: { userId: true, pageId: true } }),
      this.prisma.auditLog.findMany({ where: { pageId: { in: pageIds }, createdAt: range, actorId: { not: null } }, select: { actorId: true, pageId: true } }),
      this.prisma.twin.findMany({ where: { userId: { in: shopperIds } }, select: { userId: true }, distinct: ["userId"] }),
      this.prisma.generation.findMany({ where: { userId: { in: shopperIds }, status: "DELIVERED" }, select: { userId: true }, distinct: ["userId"] }),
      this.prisma.usageEvent.groupBy({ by: ["source"], where: { kind: "TRYON", userId: { in: shopperIds }, createdAt: range }, _count: true, _sum: { costRwf: true } }),
      this.prisma.generation.groupBy({ by: ["status"], where: { userId: { in: shopperIds }, createdAt: range }, _count: true }),
      this.prisma.order.findMany({ where: { shopperId: { in: shopperIds }, createdAt: range }, select: { status: true, totalRwf: true } }),
      this.prisma.surveyResponse.findMany({ where: { userId: { in: shopperIds }, dismissed: false }, select: { helped: true, nps: true } }),
      this.prisma.pilotIncident.count({ where: { kind: "PRIVACY", createdAt: range } }),
      this.prisma.plan.findMany(),
    ]);

    const latencies = shopperIds.length
      ? await this.prisma.$queryRaw<{ ms: number }[]>`
          SELECT EXTRACT(EPOCH FROM (g."deliveredAt" - g."createdAt")) * 1000 AS ms
            FROM "Look" l JOIN "Generation" g ON g.id = l."generationId"
           WHERE l.rank = 0 AND g."deliveredAt" IS NOT NULL
             AND l."userId" IN (${Prisma.join(shopperIds)})
             AND l."createdAt" BETWEEN ${w.start} AND ${w.end}`
      : [];

    const actors = pseudo.length
      ? await this.prisma.event.groupBy({
          by: ["pseudoId", "name"],
          where: { name: { in: ["look_viewed", "hold_started", "maker_contacted"] }, pseudoId: { in: pseudo }, occurredAt: range },
        })
      : [];
    const viewers = new Set(actors.filter((a) => a.name === "look_viewed").map((a) => a.pseudoId));
    const converters = new Set(actors.filter((a) => a.name !== "look_viewed" && viewers.has(a.pseudoId)).map((a) => a.pseudoId));

    const roleSet = new Set(roles.map((r) => `${r.userId}|${r.pageId}`));
    const selfManaging = new Set(audits.filter((a) => roleSet.has(`${a.actorId}|${a.pageId}`)).map((a) => a.pageId));
    const paidPlan = new Set(plans.filter((p) => p.priceRwf > 0).map((p) => p.code));
    const live = pages.filter((p) => p.status === "PUBLISHED");
    const by = (s: string) => usage.find((u) => u.source === s);
    const billed = usage.reduce((s, u) => s + u._count, 0);
    const cost = usage.reduce((s, u) => s + (u._sum.costRwf ?? 0), 0);
    const paid = orders.filter((o) => (PAID as readonly string[]).includes(o.status));
    const answered = survey.filter((s) => s.helped !== null);

    const raw: PilotRaw = {
      cohortPages: pageIds.length,
      activePages: live.length,
      activeCoops: live.filter((p) => p.memberType === "COOPERATIVE").length,
      paidPages: subs.filter((s) => paidPlan.has(s.planCode)).length,
      selfManagingPages: selfManaging.size,
      newShoppers: shopperIds.length,
      shoppersWithTwin: twins.length,
      shoppersWithTryOn: tried.length,
      firstLookLatenciesMs: latencies.map((l) => Number(l.ms)),
      lookViewers: viewers.size,
      lookViewersWhoHeldOrContacted: converters.size,
      billedGenerations: billed,
      generationCostRwf: cost,
      deliveredGenerations: gens.find((g) => g.status === "DELIVERED")?._count ?? 0,
      withheldGenerations: gens.find((g) => g.status === "WITHHELD")?._count ?? 0,
      holdOrders: orders.length,
      paidOrders: paid.length,
      paidOrderValueRwf: paid.reduce((s, o) => s + o.totalRwf, 0),
      surveyAnswered: answered.length,
      surveyHelped: answered.filter((s) => s.helped).length,
      npsScores: survey.filter((s) => s.nps !== null).map((s) => s.nps!),
      privacyIncidents: incidents,
      pageAllowanceGenerations: by("PAGE_ALLOWANCE")?._count ?? 0,
      shopperPaidGenerations: (by("FREE_QUOTA")?._count ?? 0) + (by("CREDITS")?._count ?? 0),
      pilotDays: w.days,
    };

    const plan = (code: string) => plans.find((p) => p.code === code);
    const paidPageCount = raw.paidPages;
    const months = Math.max(w.days, 1) / 30;
    const econ = recomputeEconomics({
      costPerGenRwf: billed ? cost / billed : null,
      proPriceRwf: plan("PRO")?.priceRwf ?? null,
      proAllowance: plan("PRO")?.tryOnAllowance ?? null,
      businessPriceRwf: plan("BUSINESS")?.priceRwf ?? null,
      businessAllowance: plan("BUSINESS")?.tryOnAllowance ?? null,
      allowanceUse:
        paidPageCount && plan("PRO")
          ? Math.min(1, raw.pageAllowanceGenerations / months / paidPageCount / plan("PRO")!.tryOnAllowance)
          : null,
      aovRwf: paid.length ? raw.paidOrderValueRwf / paid.length : null,
      uncoveredTriesPerOrder: paid.length ? raw.shopperPaidGenerations / paid.length : null,
      paidPageConversion: pageIds.length ? paidPageCount / pageIds.length : null,
    });
    return { raw, econ, window: w };
  }

  /** Distinct actors (pseudonymous ids) per funnel step in the window, plus side events. */
  async funnel(start: Date, end: Date) {
    const names = [...FUNNEL_STEPS, "twin_created", "maker_space_viewed", "maker_contacted", "circle_poll_created"];
    const rows = await this.prisma.$queryRaw<{ name: string; actors: bigint; events: bigint }[]>`
      SELECT name, COUNT(DISTINCT "pseudoId") AS actors, COUNT(*) AS events
        FROM "Event" WHERE name IN (${Prisma.join(names)}) AND "occurredAt" BETWEEN ${start} AND ${end}
       GROUP BY name`;
    const get = (n: string) => rows.find((r) => r.name === n);
    return {
      steps: FUNNEL_STEPS.map((name) => ({ name, actors: Number(get(name)?.actors ?? 0), events: Number(get(name)?.events ?? 0) })),
      side: names.slice(FUNNEL_STEPS.length).map((name) => ({ name, actors: Number(get(name)?.actors ?? 0), events: Number(get(name)?.events ?? 0) })),
    };
  }

  /** Daily AI cost and guard failures for the hypercare review (plan §8.2), Kigali days. */
  async hypercare(end: Date, days = 14) {
    const start = new Date(end.getTime() - days * DAY);
    const [cost, guard, incidents] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; cost: bigint; n: bigint }[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Kigali', 'YYYY-MM-DD') AS day, COALESCE(SUM("costRwf"), 0) AS cost, COUNT(*) AS n
          FROM "UsageEvent" WHERE kind = 'TRYON' AND "createdAt" > ${start} AND "createdAt" <= ${end} GROUP BY 1`,
      this.prisma.$queryRaw<{ day: string; delivered: bigint; withheld: bigint }[]>`
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Kigali', 'YYYY-MM-DD') AS day,
               COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered, COUNT(*) FILTER (WHERE status = 'WITHHELD') AS withheld
          FROM "Generation" WHERE "createdAt" > ${start} AND "createdAt" <= ${end} GROUP BY 1`,
      this.prisma.pilotIncident.findMany({ where: { createdAt: { gt: start, lte: end } }, orderBy: { createdAt: "desc" } }),
    ]);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end.getTime() - i * DAY + 2 * 3_600_000).toISOString().slice(0, 10);
      const c = cost.find((x) => x.day === d);
      const g = guard.find((x) => x.day === d);
      const delivered = Number(g?.delivered ?? 0);
      const withheld = Number(g?.withheld ?? 0);
      out.push({
        day: d,
        costRwf: Number(c?.cost ?? 0),
        generations: Number(c?.n ?? 0),
        withheld,
        guardRate: delivered + withheld ? withheld / (delivered + withheld) : 0,
        incidents: incidents.filter((x) => new Date(x.createdAt.getTime() + 2 * 3_600_000).toISOString().slice(0, 10) === d).length,
      });
    }
    return { days: out, incidents: incidents.map((i) => ({ id: i.id, kind: i.kind, summary: i.summary, createdAt: i.createdAt, resolvedAt: i.resolvedAt })) };
  }

  /** Per-arm outcomes since first exposure, with a two-proportion z-test of each arm against the control. */
  async experimentResults() {
    const exps = await this.prisma.experiment.findMany({ orderBy: { key: "asc" } });
    const out = [];
    for (const e of exps) {
      const rows = await this.prisma.$queryRaw<ArmRow[]>`
        SELECT x.variant, COUNT(*) AS n,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Twin" t WHERE t."userId" = x."userId" AND t."createdAt" >= x."createdAt")) AS twin_created,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Order" o WHERE o."shopperId" = x."userId" AND o."createdAt" >= x."createdAt")) AS hold_started,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Order" o WHERE o."shopperId" = x."userId" AND o."createdAt" >= x."createdAt"
                                         AND o.status::text IN (${Prisma.join([...PAID])}))) AS order_paid,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Look" l WHERE l."userId" = x."userId" AND l."savedAt" >= x."createdAt")) AS look_saved,
          COALESCE(SUM((SELECT COUNT(*) FROM "Generation" g WHERE g."userId" = x."userId" AND g."createdAt" >= x."createdAt" AND g.status = 'DELIVERED')), 0) AS gens
        FROM "ExperimentExposure" x WHERE x."experimentKey" = ${e.key} GROUP BY x.variant`;
      const variants = e.variants as unknown as Variant[];
      const arms = variants.map((v) => {
        const r = rows.find((x) => x.variant === v.key);
        const n = Number(r?.n ?? 0);
        const metrics = Object.fromEntries(OUTCOMES.map((m) => [m, Number(r?.[m] ?? 0)])) as Record<Outcome, number>;
        return { key: v.key, weight: v.weight, n, metrics, generationsPerUser: n ? Number(r?.gens ?? 0) / n : 0 };
      });
      const control = arms[0];
      const metric = (OUTCOMES as readonly string[]).includes(e.primaryMetric) ? (e.primaryMetric as Outcome) : "hold_started";
      const tests = arms.slice(1).map((a) => ({
        arm: a.key,
        metric,
        ...zTest(control.metrics[metric], control.n, a.metrics[metric], a.n),
        paid: zTest(control.metrics.order_paid, control.n, a.metrics.order_paid, a.n),
      }));
      out.push({ key: e.key, name: e.name, description: e.description, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt, primaryMetric: metric, variants, arms, tests, exposed: arms.reduce((s, a) => s + a.n, 0) });
    }
    return out;
  }

  async summary() {
    const { raw, econ, window } = await this.raw();
    const kpis = buildKpis(raw);
    const [funnel, hypercare, experiments] = await Promise.all([this.funnel(window.start, window.end), this.hypercare(window.end), this.experimentResults()]);
    const recommendation = recommend(kpis, econ.withinBreakEvenPath);
    return {
      generatedAt: new Date().toISOString(),
      cohort: { name: window.cohort?.name ?? "No cohort", start: window.start, end: window.end, days: window.days, pages: raw.cohortPages, shoppers: raw.newShoppers },
      kpis,
      funnel,
      hypercare,
      experiments,
      economics: econ,
      recommendation,
    };
  }
}
