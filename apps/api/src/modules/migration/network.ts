import { BadRequestException, Body, Controller, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type { Response } from "express";
import { z } from "zod";
import { Access, AuthUser, CurrentUser } from "../../common/auth";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { CatalogueModule, CatalogueService } from "../catalogue/catalogue.module";
import { LegacyPage, legacyPath, MigrationController } from "./migration.module";
import { cutoverChecklist, defectCategory, dueReminder, isFinished, planDispatch, rollbackTargets } from "./network-rules";

const QUEUE = "migration-import";
/** Global cap across all waves on this instance; each wave also has its own window (MigrationRun.concurrency). */
const WORKER_CONCURRENCY = Number(process.env.MIGRATION_WORKER_CONCURRENCY ?? 6);
const NetworkBundle = z.object({ wave: z.string().min(1).max(80), pages: z.array(z.unknown()).min(1).max(2000) });
type Page = z.infer<typeof LegacyPage>;

const REVIEW_TEXT = (name: string, url: string) => `Muraho! Your page ${name} has moved to the new Nyambika. Please check it and sign off: ${url}`;
const REMINDER_TEXT = (name: string, url: string, n: number, of: number) =>
  `Kwibutsa (${n}/${of}): your new Nyambika page ${name} is waiting for your OK. Your old page stays live until you sign off: ${url}`;

/**
 * Full-network migration (E21): whole-network waves on a BullMQ queue with a per-wave concurrency window,
 * progress dashboard, bulk owner outreach with reminder cadence, auto-chasing, cut-over checklist,
 * redirect-map export and rollback-all.
 */
@Injectable()
export class NetworkMigrationService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("NetworkMigration");
  private queue!: Queue;
  private worker?: Worker;
  private importer: MigrationController;
  private bundles = new Map<string, unknown[]>();
  private sweep?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private access: Access,
    private messaging: MessagingService,
    private storage: StorageService,
    catalogue: CatalogueService,
  ) {
    // Reuse the E17 single-page import (checksums, readiness pipeline, hidden page, defects, redirect row).
    this.importer = new MigrationController(prisma, access, catalogue, messaging, storage);
  }

  onModuleInit() {
    const connection = { url: config.redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue(QUEUE, { connection });
    if (process.env.MIGRATION_WORKER !== "0") {
      this.worker = new Worker(QUEUE, (job) => this.run(job), { connection, concurrency: WORKER_CONCURRENCY });
      this.worker.on("failed", (job, err) => job && void this.fail(job.data.waveId, job.data.index, err.message));
    }
    // Auto-chase unsigned pages (reminder cadence) every 10 minutes.
    this.sweep = setInterval(() => void this.chaseAll(new Date()).catch((e) => this.log.warn(`chase: ${(e as Error).message}`)), 10 * 60_000);
    this.sweep.unref();
    void this.resume().catch(() => undefined);
  }

  async onModuleDestroy() {
    if (this.sweep) clearInterval(this.sweep);
    await this.worker?.close();
    await this.queue?.close();
  }

  private async resume() {
    const runs = await this.prisma.migrationRun.findMany({ where: { status: { in: ["QUEUED", "RUNNING"] } } });
    for (const r of runs) await this.dispatch(r.waveId);
  }

  async start(userId: string, raw: unknown, concurrency: number) {
    const bundle = parse(NetworkBundle, raw);
    const wave = await this.prisma.migrationWave.create({ data: { name: bundle.wave, createdBy: userId, status: "IMPORTING" } });
    const bundlePath = `private/migration/${wave.id}.json`;
    await this.storage.put(bundlePath, Buffer.from(JSON.stringify(bundle.pages)));
    this.bundles.set(wave.id, bundle.pages);
    const handle = (p: unknown) => (typeof p === "object" && p && "handle" in p ? String((p as { handle: unknown }).handle).slice(0, 60) : "?");
    await this.prisma.migrationRun.create({ data: { waveId: wave.id, concurrency, total: bundle.pages.length, bundlePath, createdBy: userId } });
    await this.prisma.migrationJob.createMany({ data: bundle.pages.map((p, index) => ({ waveId: wave.id, index, handle: handle(p) })) });
    await this.access.audit(userId, "migration.network_start", { waveId: wave.id, wave: wave.name, pages: bundle.pages.length, concurrency });
    await this.dispatch(wave.id);
    return { waveId: wave.id, total: bundle.pages.length };
  }

  /** Top up the wave's window. The advisory lock makes concurrent dispatches safe (no window overshoot). */
  async dispatch(waveId: string) {
    const toEnqueue = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${waveId}))`;
      const run = await tx.migrationRun.findUnique({ where: { waveId } });
      if (!run || run.status === "ROLLED_BACK" || run.status === "IMPORTED") return [];
      const jobs = await tx.migrationJob.findMany({ where: { waveId }, select: { index: true, status: true } });
      if (isFinished(jobs)) {
        await tx.migrationRun.update({ where: { waveId }, data: { status: "IMPORTED", finishedAt: new Date() } });
        await tx.migrationWave.update({ where: { id: waveId }, data: { status: "IMPORTED" } });
        return [];
      }
      const next = planDispatch(jobs, run.concurrency);
      if (next.length) {
        await tx.migrationJob.updateMany({ where: { waveId, index: { in: next }, status: "PENDING" }, data: { status: "ENQUEUED" } });
        if (run.status === "QUEUED") await tx.migrationRun.update({ where: { waveId }, data: { status: "RUNNING", startedAt: new Date() } });
      }
      return next;
    });
    for (const index of toEnqueue) await this.queue.add("import-page", { waveId, index }, { jobId: `${waveId}-${index}`, attempts: 1, removeOnComplete: 2000, removeOnFail: 2000 });
  }

  private async page(waveId: string, index: number) {
    let pages = this.bundles.get(waveId);
    if (!pages) {
      const run = await this.prisma.migrationRun.findUniqueOrThrow({ where: { waveId } });
      pages = JSON.parse((await this.storage.read(run.bundlePath)).toString("utf8")) as unknown[];
      this.bundles.set(waveId, pages);
    }
    return pages[index];
  }

  private async run(job: Job) {
    const { waveId, index } = job.data as { waveId: string; index: number };
    const claimed = await this.prisma.migrationJob.updateMany({ where: { waveId, index, status: "ENQUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
    if (!claimed.count) return; // cancelled by a rollback, or a duplicate delivery
    await this.prisma.$executeRaw`UPDATE "MigrationRun" SET "maxRunning" = GREATEST("maxRunning", (SELECT COUNT(*) FROM "MigrationJob" WHERE "waveId" = ${waveId} AND status = 'RUNNING')::int) WHERE "waveId" = ${waveId}`;
    try {
      const src: Page = LegacyPage.parse(await this.page(waveId, index));
      await this.importer.importPage(waveId, src);
      const page = await this.prisma.page.findUnique({ where: { handle: src.handle }, select: { id: true } });
      const item = page ? await this.prisma.migrationItem.findUnique({ where: { pageId: page.id }, select: { id: true } }) : null;
      await this.prisma.migrationJob.updateMany({ where: { waveId, index }, data: { status: "DONE", finishedAt: new Date(), itemId: item?.id } });
      await this.prisma.migrationRun.update({ where: { waveId }, data: { done: { increment: 1 } } });
    } catch (e) {
      // Leave nothing half-imported: a page created by this attempt without its migration item is removed, so a re-run can import it cleanly.
      const h = (await this.page(waveId, index).catch(() => null)) as { handle?: unknown } | null;
      if (typeof h?.handle === "string") {
        const half = await this.prisma.page.findUnique({ where: { handle: h.handle }, select: { id: true, createdAt: true } });
        const job = await this.prisma.migrationJob.findUnique({ where: { waveId_index: { waveId, index } } });
        if (half && job?.startedAt && half.createdAt >= job.startedAt && !(await this.prisma.migrationItem.count({ where: { pageId: half.id } }))) {
          await this.prisma.page.delete({ where: { id: half.id } }).catch(() => undefined);
        }
      }
      const msg = e instanceof z.ZodError ? `Invalid page: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` : (e as Error).message;
      await this.fail(waveId, index, msg);
      return;
    }
    await this.dispatch(waveId);
  }

  private async fail(waveId: string, index: number, error: string) {
    const n = await this.prisma.migrationJob.updateMany({ where: { waveId, index, status: { in: ["RUNNING", "ENQUEUED"] } }, data: { status: "FAILED", error: error.slice(0, 500), finishedAt: new Date() } });
    if (n.count) await this.prisma.migrationRun.update({ where: { waveId }, data: { failed: { increment: 1 } } });
    await this.dispatch(waveId);
  }

  private async items(waveId: string) {
    const items = await this.prisma.migrationItem.findMany({ where: { waveId }, orderBy: { createdAt: "asc" } });
    const pages = await this.prisma.page.findMany({ where: { id: { in: items.map((i) => i.pageId) } }, select: { id: true, name: true, handle: true, roles: { where: { role: { in: ["PAGE_OWNER", "COOP_ADMIN"] } }, select: { user: { select: { phone: true } } } } } });
    const byId = new Map(pages.map((p) => [p.id, p]));
    return items.map((i) => ({ ...i, page: byId.get(i.pageId) }));
  }

  /** Bulk owner outreach: a WhatsApp review link to every owner not invited yet. */
  async invite(userId: string, waveId: string) {
    const items = await this.items(waveId);
    const invited = new Set((await this.prisma.migrationOutreach.findMany({ where: { waveId, kind: "INVITE" }, select: { itemId: true } })).map((o) => o.itemId));
    let sent = 0;
    for (const i of items) {
      if (invited.has(i.id) || !["IMPORTED", "CHANGES_REQUESTED"].includes(i.status)) continue;
      const phone = i.page?.roles[0]?.user.phone;
      if (!phone) continue;
      await this.messaging.send("WHATSAPP", phone, "migration_review", REVIEW_TEXT(i.page!.name, `${config.webUrl}/migrate/${i.reviewToken}`), i.id);
      await this.prisma.migrationOutreach.create({ data: { itemId: i.id, waveId, kind: "INVITE" } });
      if (i.status === "IMPORTED") await this.prisma.migrationItem.update({ where: { id: i.id }, data: { status: "IN_REVIEW" } });
      sent++;
    }
    await this.access.audit(userId, "migration.network_outreach", { waveId, sent });
    return { sent };
  }

  /** Auto-chase unsigned pages on the reminder cadence. `now` may be moved forward in dev to rehearse the cadence. */
  async chase(waveId: string, now: Date) {
    const run = await this.prisma.migrationRun.findUnique({ where: { waveId } });
    if (!run || run.status === "ROLLED_BACK") return { sent: 0 };
    const items = (await this.items(waveId)).filter((i) => i.status === "IN_REVIEW");
    const log = await this.prisma.migrationOutreach.findMany({ where: { waveId } });
    let sent = 0;
    for (const i of items) {
      const mine = log.filter((o) => o.itemId === i.id);
      const invite = mine.find((o) => o.kind === "INVITE");
      if (!invite) continue;
      const n = dueReminder(invite.sentAt, mine.filter((o) => o.kind === "REMINDER").length, run.cadenceDays, now);
      const phone = i.page?.roles[0]?.user.phone;
      if (!n || !phone) continue;
      await this.messaging.send("WHATSAPP", phone, "migration_reminder", REMINDER_TEXT(i.page!.name, `${config.webUrl}/migrate/${i.reviewToken}`, n, run.cadenceDays.length), i.id);
      await this.prisma.migrationOutreach.create({ data: { itemId: i.id, waveId, kind: "REMINDER", seq: n, sentAt: now } });
      sent++;
    }
    return { sent };
  }

  async chaseAll(now: Date) {
    const runs = await this.prisma.migrationRun.findMany({ where: { status: { in: ["RUNNING", "IMPORTED"] } } });
    for (const r of runs) await this.chase(r.waveId, now);
  }

  async goLiveSigned(userId: string, waveId: string) {
    const items = await this.prisma.migrationItem.findMany({ where: { waveId, status: "SIGNED_OFF" } });
    for (const item of items) {
      const page = await this.prisma.page.update({ where: { id: item.pageId }, data: { status: "PUBLISHED", verified: true } });
      await this.prisma.product.updateMany({ where: { pageId: page.id, status: "DRAFT" }, data: { status: "PUBLISHED" } });
      await this.prisma.redirect.updateMany({ where: { toPath: `/m/${page.handle}` }, data: { active: true } });
      await this.prisma.migrationItem.update({ where: { id: item.id }, data: { status: "LIVE", liveAt: new Date() } });
    }
    await this.access.audit(userId, "migration.network_go_live", { waveId, pages: items.length });
    return { live: items.length };
  }

  /** Rollback-all: stop importing, hide every page of the wave and switch its redirects off (legacy stays live). */
  async rollbackAll(userId: string, waveId: string) {
    const run = await this.prisma.migrationRun.findUnique({ where: { waveId } });
    if (!run) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${waveId}))`;
      await tx.migrationRun.update({ where: { waveId }, data: { status: "ROLLED_BACK", finishedAt: new Date() } });
      await tx.migrationJob.updateMany({ where: { waveId, status: { in: ["PENDING", "ENQUEUED"] } }, data: { status: "CANCELLED" } });
    });
    const items = rollbackTargets(await this.prisma.migrationItem.findMany({ where: { waveId } }));
    const pages = await this.prisma.page.findMany({ where: { id: { in: items.map((i) => i.pageId) } }, select: { id: true, handle: true } });
    await this.prisma.page.updateMany({ where: { id: { in: pages.map((p) => p.id) } }, data: { status: "DRAFT" } });
    await this.prisma.redirect.updateMany({ where: { toPath: { in: pages.map((p) => `/m/${p.handle}`) } }, data: { active: false } });
    await this.prisma.migrationItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { status: "ROLLED_BACK" } });
    await this.prisma.migrationWave.update({ where: { id: waveId }, data: { status: "ROLLED_BACK" } });
    const checklist = { ...((run.checklist as Record<string, boolean>) ?? {}), rollback_rehearsed: true };
    await this.prisma.migrationRun.update({ where: { waveId }, data: { checklist } });
    await this.access.audit(userId, "migration.network_rollback_all", { waveId, pages: items.length });
    return { rolledBack: items.length };
  }

  async dashboard(waveId: string) {
    const [wave, run] = await Promise.all([this.prisma.migrationWave.findUnique({ where: { id: waveId } }), this.prisma.migrationRun.findUnique({ where: { waveId } })]);
    if (!wave || !run) throw new NotFoundException();
    const [jobs, items, outreach] = await Promise.all([
      this.prisma.migrationJob.findMany({ where: { waveId }, select: { index: true, handle: true, status: true, error: true } }),
      this.items(waveId),
      this.prisma.migrationOutreach.findMany({ where: { waveId }, select: { itemId: true, kind: true, seq: true, sentAt: true } }),
    ]);
    const redirects = await this.prisma.redirect.findMany({ where: { toPath: { in: items.map((i) => `/m/${i.page?.handle}`) } } });
    const jobCounts: Record<string, number> = {};
    for (const j of jobs) jobCounts[j.status] = (jobCounts[j.status] ?? 0) + 1;
    const status: Record<string, number> = {};
    for (const i of items) status[i.status] = (status[i.status] ?? 0) + 1;
    const defects: Record<string, number> = { payments: 0, photos: 0, catalogue: 0, story: 0, other: 0 };
    let pagesWithDefects = 0;
    for (const i of items) {
      const ds = (i.defects as { severity: string; message: string }[]) ?? [];
      if (ds.some((d) => d.severity !== "info")) pagesWithDefects++;
      for (const d of ds) defects[defectCategory(d.message)]++;
    }
    const invited = new Set(outreach.filter((o) => o.kind === "INVITE").map((o) => o.itemId));
    const reviewed = items.filter((i) => invited.has(i.id) || ["SIGNED_OFF", "LIVE"].includes(i.status)).length;
    const signedOff = items.filter((i) => i.status === "SIGNED_OFF" || i.status === "LIVE").length;
    const manual = (run.checklist as Record<string, boolean>) ?? {};
    const failedJobs = jobs.filter((j) => j.status === "FAILED");
    return {
      wave: { id: wave.id, name: wave.name, createdAt: wave.createdAt, status: wave.status },
      run: {
        status: run.status,
        total: run.total,
        done: run.done,
        failed: run.failed,
        concurrency: run.concurrency,
        maxRunning: run.maxRunning,
        running: jobCounts.RUNNING ?? 0,
        queued: (jobCounts.ENQUEUED ?? 0) + (jobCounts.PENDING ?? 0),
        cancelled: jobCounts.CANCELLED ?? 0,
        cadenceDays: run.cadenceDays,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
      },
      funnel: { imported: items.length, reviewed, signedOff, live: status.LIVE ?? 0 },
      status,
      defects,
      pagesWithDefects,
      failures: failedJobs.slice(0, 20).map((j) => ({ handle: j.handle, error: j.error })),
      redirects: {
        total: redirects.length,
        active: redirects.filter((r) => r.active).length,
        hits: redirects.reduce((s, r) => s + r.hits, 0),
        top: redirects
          .filter((r) => r.hits > 0)
          .sort((a, b) => b.hits - a.hits)
          .slice(0, 5)
          .map((r) => ({ from: r.fromPath, to: r.toPath, hits: r.hits, active: r.active })),
      },
      outreach: { invites: invited.size, reminders: outreach.filter((o) => o.kind === "REMINDER").length, byReminder: run.cadenceDays.map((_, k) => outreach.filter((o) => o.kind === "REMINDER" && o.seq === k + 1).length) },
      checklist: cutoverChecklist({
        total: run.total,
        done: run.done,
        failed: run.failed,
        running: run.status === "RUNNING" || run.status === "QUEUED",
        items: items.map((i) => ({ status: i.status, invited: invited.has(i.id), blockers: ((i.defects as { severity: string }[]) ?? []).filter((d) => d.severity === "blocker").length })),
        manual,
      }),
    };
  }

  async redirectMap(waveId: string) {
    const items = await this.items(waveId);
    const redirects = await this.prisma.redirect.findMany({ where: { toPath: { in: items.map((i) => `/m/${i.page?.handle}`) } } });
    const byTo = new Map(redirects.map((r) => [r.toPath, r]));
    return items.map((i) => {
      const r = byTo.get(`/m/${i.page?.handle}`);
      let host = "";
      try {
        host = new URL(i.legacyUrl).host;
      } catch {
        /* path-only legacy URL */
      }
      return { legacyHost: host, legacyPath: legacyPath(i.legacyUrl), target: `${config.webUrl}/m/${i.page?.handle}`, status: i.status, active: r?.active ?? false, hits: r?.hits ?? 0 };
    });
  }

  async setChecklist(waveId: string, key: string, done: boolean) {
    const run = await this.prisma.migrationRun.findUniqueOrThrow({ where: { waveId } });
    const checklist = { ...((run.checklist as Record<string, boolean>) ?? {}), [key]: done };
    await this.prisma.migrationRun.update({ where: { waveId }, data: { checklist } });
    return checklist;
  }
}

@Controller("admin/migration/network")
export class NetworkMigrationController {
  constructor(
    private access: Access,
    private svc: NetworkMigrationService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const runs = await this.prisma.migrationRun.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    const waves = await this.prisma.migrationWave.findMany({ where: { id: { in: runs.map((r) => r.waveId) } } });
    const name = new Map(waves.map((w) => [w.id, w.name]));
    return runs.map((r) => ({ waveId: r.waveId, name: name.get(r.waveId) ?? "", status: r.status, total: r.total, done: r.done, failed: r.failed, concurrency: r.concurrency, createdAt: r.createdAt }));
  }

  @Post("waves")
  async start(@CurrentUser() user: AuthUser, @Body() body: unknown, @Query("concurrency") c?: string) {
    await this.access.requireHost(user.id);
    const concurrency = Math.min(16, Math.max(1, Number(c ?? 4) || 4));
    return this.svc.start(user.id, body, concurrency);
  }

  @Get(":waveId")
  async dashboard(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string) {
    await this.access.requireHost(user.id);
    return this.svc.dashboard(waveId);
  }

  @Patch(":waveId")
  async update(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { concurrency, cadenceDays } = parse(z.object({ concurrency: z.number().int().min(1).max(16).optional(), cadenceDays: z.array(z.number().int().min(1).max(60)).min(1).max(6).optional() }), body);
    await this.prisma.migrationRun.update({ where: { waveId }, data: { ...(concurrency ? { concurrency } : {}), ...(cadenceDays ? { cadenceDays: [...cadenceDays].sort((a, b) => a - b) } : {}) } });
    await this.access.audit(user.id, "migration.network_settings", { waveId, concurrency, cadenceDays });
    await this.svc.dispatch(waveId);
    return this.svc.dashboard(waveId);
  }

  @Post(":waveId/outreach")
  async outreach(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string) {
    await this.access.requireHost(user.id);
    return this.svc.invite(user.id, waveId);
  }

  /** Run the reminder sweep now. `asOf` (dev only) moves the clock forward to rehearse the cadence. */
  @Post(":waveId/chase")
  async chase(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { asOf } = parse(z.object({ asOf: z.string().datetime().optional() }), body ?? {});
    if (asOf && process.env.NODE_ENV === "production") throw new BadRequestException("asOf is a rehearsal tool, not available in production");
    const r = await this.svc.chase(waveId, asOf ? new Date(asOf) : new Date());
    await this.access.audit(user.id, "migration.network_chase", { waveId, sent: r.sent, asOf });
    return r;
  }

  @Post(":waveId/go-live-signed")
  async goLive(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string) {
    await this.access.requireHost(user.id);
    return this.svc.goLiveSigned(user.id, waveId);
  }

  @Post(":waveId/rollback-all")
  async rollbackAll(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string) {
    await this.access.requireHost(user.id);
    return this.svc.rollbackAll(user.id, waveId);
  }

  @Post(":waveId/checklist")
  async checklist(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { key, done } = parse(z.object({ key: z.enum(["failures", "redirect_map", "dns", "rollback_rehearsed", "support"]), done: z.boolean() }), body);
    await this.access.audit(user.id, "migration.network_checklist", { waveId, key, done });
    return this.svc.setChecklist(waveId, key, done);
  }

  /** Legacy-domain redirect map for the edge (CSV, or an nginx `map` block). */
  @Get(":waveId/redirects")
  async redirects(@CurrentUser() user: AuthUser, @Param("waveId") waveId: string, @Query("format") format: string | undefined, @Res() res: Response) {
    await this.access.requireHost(user.id);
    const rows = await this.svc.redirectMap(waveId);
    await this.svc.setChecklist(waveId, "redirect_map", true);
    await this.access.audit(user.id, "migration.network_redirect_map", { waveId, rows: rows.length, format: format ?? "csv" });
    if (format === "nginx") {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="redirects-${waveId}.conf"`);
      res.send(["# Nyambika legacy → Maker Space (301). Generated " + new Date().toISOString(), "map $uri $nyambika_new {", "  default \"\";", ...rows.map((r) => `  ${r.legacyPath} ${r.target};`), "}", ""].join("\n"));
      return;
    }
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="redirects-${waveId}.csv"`);
    res.send([["legacy_host", "legacy_path", "target", "status", "redirect_active", "hits"].join(","), ...rows.map((r) => [r.legacyHost, r.legacyPath, r.target, r.status, r.active, r.hits].map(esc).join(","))].join("\n"));
  }
}

@Module({ imports: [CatalogueModule], controllers: [NetworkMigrationController], providers: [NetworkMigrationService] })
export class NetworkMigrationModule {}
