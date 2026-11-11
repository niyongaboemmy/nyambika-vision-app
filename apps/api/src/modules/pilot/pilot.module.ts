import { BadRequestException, Body, Controller, Get, Global, Module, NotFoundException, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import {
  AnalyticsBatch,
  EXPERIMENTS,
  ExperimentPatch,
  PilotIncidentCreate,
  PilotInviteCreate,
  PilotJoin,
  SurveyAnswer,
  type AnalyticsEventName,
  type SurveyTrigger,
} from "@nyambika/contracts";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, Public, readUser } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { gate3Markdown } from "./gate3";
import { ExperimentsService, PilotService, pseudonymise, sanitizeProps } from "./pilot.service";
import { PilotReportService } from "./report.service";

const PAID = ["PAID", "ACCEPTED", "IN_PREPARATION", "READY", "SHIPPED", "DELIVERED", "COMPLETED"] as const;
/** Facts the server records itself (payments, twin creation); client copies are ignored to avoid double counting. */
const SERVER_ONLY = new Set<AnalyticsEventName>(["order_paid", "twin_created"]);
const LOOKS_FOR_SURVEY = 5;

@Controller()
export class PilotController {
  constructor(
    private prisma: PrismaService,
    private pilot: PilotService,
    private experiments: ExperimentsService,
  ) {}

  /** Batch ingestion of pseudonymised product analytics (allow-listed names and props, no PII). */
  @Public()
  @Post("events")
  async events(@Req() req: Request, @Body() body: unknown) {
    const batch = parse(AnalyticsBatch, typeof body === "string" ? safeJson(body) : body);
    const user = readUser(req);
    if (!user && !batch.anonId) throw new BadRequestException("anonId required when signed out");
    const pseudoId = user ? pseudonymise(user.id) : pseudonymise(`anon:${batch.anonId}`);
    const now = Date.now();
    const data = batch.events
      .filter((e) => !SERVER_ONLY.has(e.name))
      .map((e) => {
        const at = e.at ? Date.parse(e.at) : now;
        const occurredAt = new Date(Math.min(now, Math.max(now - 86_400_000, Number.isFinite(at) ? at : now)));
        return { name: e.name, pseudoId, authed: Boolean(user), props: sanitizeProps(e.props), occurredAt };
      });
    if (data.length) await this.prisma.event.createMany({ data });
    return { accepted: data.length };
  }

  /** The signed-in shopper's experiment arms (null = experiment not running → default experience). */
  @Get("experiments/mine")
  async mine(@CurrentUser() user: AuthUser, @Query("keys") keys?: string) {
    const wanted = (keys ?? Object.values(EXPERIMENTS).join(",")).split(",").filter((k) => (Object.values(EXPERIMENTS) as string[]).includes(k));
    const hasTwin = (await this.prisma.twin.count({ where: { userId: user.id, deletedAt: null } })) > 0;
    const out: Record<string, string | null> = {};
    for (const k of wanted) {
      // The twin nudge only applies to shoppers who don't have a twin yet: peek without exposing the others.
      out[k] = await this.experiments.variant(user.id, k, { expose: !(k === EXPERIMENTS.twinNudge && hasTwin) });
    }
    return out;
  }

  /** Which micro-survey (if any) to show now: once after a paid order, once after 5 looks viewed. */
  @Get("survey/pending")
  async pending(@CurrentUser() user: AuthUser) {
    const done = new Set((await this.prisma.surveyResponse.findMany({ where: { userId: user.id }, select: { trigger: true } })).map((r) => r.trigger));
    let trigger: SurveyTrigger | null = null;
    if (!done.has("ORDER_PAID")) {
      const paid = await this.prisma.order.count({ where: { shopperId: user.id, status: { in: [...PAID] } } });
      if (paid) trigger = "ORDER_PAID";
    }
    if (!trigger && !done.has("LOOKS_5")) {
      const viewed = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT props->>'lookId') AS n FROM "Event" WHERE "pseudoId" = ${pseudonymise(user.id)} AND name = 'look_viewed'`;
      if (Number(viewed[0]?.n ?? 0) >= LOOKS_FOR_SURVEY) trigger = "LOOKS_5";
    }
    return { trigger };
  }

  @Post("survey")
  async answer(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const a = parse(SurveyAnswer, body);
    const existing = await this.prisma.surveyResponse.findUnique({ where: { userId_trigger: { userId: user.id, trigger: a.trigger } } });
    if (existing) return { ok: true, already: true };
    await this.prisma.surveyResponse.create({
      data: { userId: user.id, trigger: a.trigger, helped: a.dismissed ? null : (a.helped ?? null), nps: a.dismissed ? null : (a.nps ?? null), dismissed: a.dismissed },
    });
    return { ok: true };
  }

  @Post("pilot/join")
  async join(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.pilot.join(user.id, parse(PilotJoin, body).code);
  }

  @Public()
  @Get("pilot/me")
  async me(@CurrentUser() user: AuthUser | null) {
    const [allowlist, cohort] = await Promise.all([this.pilot.allowlistOn(), this.pilot.cohort()]);
    return { allowlist, cohort: cohort?.name ?? null, member: user ? await this.pilot.isMember("SHOPPER", user.id) : false };
  }
}

@Controller("admin/pilot")
export class PilotAdminController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private report: PilotReportService,
  ) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const [s, synthetic, allowlist] = await Promise.all([
      this.report.summary(),
      this.prisma.pilotMember.count({ where: { synthetic: true } }),
      this.prisma.featureFlag.findUnique({ where: { key: "pilot.allowlist" } }),
    ]);
    return { ...s, synthetic: synthetic > 0, allowlist: Boolean(allowlist?.enabled) };
  }

  /** Gate 3 export (plan §8.3): Markdown or JSON download. */
  @Get("gate3")
  async gate3(@CurrentUser() user: AuthUser, @Query("format") format: string | undefined, @Res() res: Response) {
    await this.access.requireHost(user.id);
    const s = await this.report.summary();
    const synthetic = (await this.prisma.pilotMember.count({ where: { synthetic: true } })) > 0;
    await this.access.audit(user.id, "pilot.gate3_export", { format: format ?? "md", decision: s.recommendation.decision });
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      res.setHeader("content-disposition", `attachment; filename="gate3-report-${stamp}.json"`);
      res.json({ ...s, synthetic });
      return;
    }
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="gate3-report-${stamp}.md"`);
    res.send(gate3Markdown(s, synthetic));
  }

  @Patch("experiments/:key")
  async patchExperiment(@CurrentUser() user: AuthUser, @Param("key") key: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const p = parse(ExperimentPatch, body);
    const e = await this.prisma.experiment.findUnique({ where: { key } });
    if (!e) throw new NotFoundException();
    const data: Record<string, unknown> = {};
    if (p.status) {
      data.status = p.status;
      if (p.status === "RUNNING" && !e.startsAt && p.startsAt === undefined) data.startsAt = new Date();
      if (p.status === "STOPPED" && !e.endsAt && p.endsAt === undefined) data.endsAt = new Date();
    }
    if (p.variants) {
      const before = (e.variants as { key: string }[]).map((v) => v.key).join(",");
      if (p.variants.map((v) => v.key).join(",") !== before) throw new BadRequestException("Arms can't be renamed or reordered; change weights only.");
      data.variants = p.variants;
    }
    if (p.startsAt !== undefined) data.startsAt = p.startsAt ? new Date(p.startsAt) : null;
    if (p.endsAt !== undefined) data.endsAt = p.endsAt ? new Date(p.endsAt) : null;
    const updated = await this.prisma.experiment.update({ where: { key }, data });
    await this.access.audit(user.id, "pilot.experiment", { key, ...p });
    return updated;
  }

  @Get("cohort")
  async cohort(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const cohort = await this.prisma.pilotCohort.findFirst({ orderBy: { startsAt: "desc" } });
    if (!cohort) return { cohort: null, pages: [], shoppers: 0, invites: [] };
    const [members, pages, shoppers, invites] = await Promise.all([
      this.prisma.pilotMember.findMany({ where: { cohortId: cohort.id, kind: "PAGE" }, select: { subjectId: true } }),
      this.prisma.page.findMany({ where: { status: { notIn: ["CLOSED"] } }, select: { id: true, name: true, handle: true, status: true, memberType: true }, orderBy: { name: "asc" } }),
      this.prisma.pilotMember.count({ where: { cohortId: cohort.id, kind: "SHOPPER" } }),
      this.prisma.pilotInvite.findMany({ where: { cohortId: cohort.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    const ids = new Set(members.map((m) => m.subjectId));
    return { cohort, pages: pages.map((p) => ({ ...p, member: ids.has(p.id) })), shoppers, invites };
  }

  @Post("cohort/pages")
  async setPage(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { pageId, member } = parse(z.object({ pageId: z.string(), member: z.boolean() }), body);
    const cohort = await this.prisma.pilotCohort.findFirstOrThrow({ orderBy: { startsAt: "desc" } });
    if (member) {
      await this.prisma.pilotMember.createMany({ data: [{ cohortId: cohort.id, kind: "PAGE", subjectId: pageId, source: "ADMIN" }], skipDuplicates: true });
    } else {
      await this.prisma.pilotMember.deleteMany({ where: { cohortId: cohort.id, kind: "PAGE", subjectId: pageId } });
    }
    await this.access.audit(user.id, "pilot.cohort_page", { member }, pageId);
    return { ok: true };
  }

  @Post("invites")
  async invites(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const i = parse(PilotInviteCreate, body);
    const cohort = await this.prisma.pilotCohort.findFirstOrThrow({ orderBy: { startsAt: "desc" } });
    const codes = Array.from({ length: i.count }, () => `${i.kind === "PAGE" ? "MBR" : "NYA"}-${randomBytes(3).toString("hex").toUpperCase()}`);
    await this.prisma.pilotInvite.createMany({ data: codes.map((code) => ({ code, cohortId: cohort.id, kind: i.kind, maxUses: i.maxUses, note: i.note, createdBy: user.id })) });
    await this.access.audit(user.id, "pilot.invites", { kind: i.kind, count: i.count, maxUses: i.maxUses });
    return { codes };
  }

  @Post("incidents")
  async incident(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const i = parse(PilotIncidentCreate, body);
    const row = await this.prisma.pilotIncident.create({ data: { ...i, createdBy: user.id } });
    await this.access.audit(user.id, "pilot.incident", { id: row.id, kind: i.kind });
    return row;
  }

  @Post("incidents/:id/resolve")
  async resolve(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.access.requireHost(user.id);
    const row = await this.prisma.pilotIncident.update({ where: { id }, data: { resolvedAt: new Date() } });
    await this.access.audit(user.id, "pilot.incident_resolved", { id });
    return row;
  }
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Experiments, cohort allowlist and analytics are used by Muse, Looks, Twin and Payments: provided globally. */
@Global()
@Module({
  controllers: [PilotController, PilotAdminController],
  providers: [PilotService, ExperimentsService, PilotReportService],
  exports: [PilotService, ExperimentsService],
})
export class PilotModule {}
