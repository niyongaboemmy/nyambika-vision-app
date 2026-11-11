import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Redis } from "ioredis";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AuthUser, CurrentUser, Public } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { LooksModule, LooksService } from "../looks/looks.module";
import {
  type CounterStore,
  DEVICE_COOKIE,
  hashId,
  issueDevice,
  MemoryCounterStore,
  overLimit,
  pollState,
  REACTIONS,
  readDevice,
  RedisCounterStore,
  VOTE_LIMITS,
} from "./guards";
import { CircleLive } from "./live";
import { ogCard, watermark } from "./watermark";

/** Poll lifetime (FR-SOC-03). Configurable per deployment; the owner may shorten it per poll. */
export const POLL_TTL_HOURS = Number(process.env.POLL_TTL_HOURS ?? 72);
export const CONSENT_PURPOSE = "CIRCLE_SHARE";

const CreatePoll = z.object({
  lookIds: z.array(z.string()).min(2).max(4),
  question: z.string().trim().min(3).max(120),
  occasion: z.string().max(40).optional(),
  hours: z.number().int().min(1).max(168).optional(),
  consent: z.literal(true, { message: "Confirm what will be shared to create the poll" }),
});

const Vote = z.object({
  optionId: z.string(),
  name: z.string().trim().max(40).optional(),
  comment: z.string().trim().max(140).optional(),
  emoji: z.enum(REACTIONS).optional(),
});

export interface Snapshot {
  state: "OPEN" | "EXPIRED" | "REVOKED";
  total: number;
  options: { id: string; votes: number; pct: number }[];
  comments: { id: string; name: string; comment: string | null; emoji: string | null; option: string; at: Date }[];
}

const clientIp = (req: Request) => (String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "unknown");

@Injectable()
export class CircleService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Circle");
  private sweepTimer?: NodeJS.Timeout;
  private memo = new Map<string, { at: number; p: Promise<Snapshot> }>();
  private redis?: Redis;
  counters: CounterStore = new MemoryCounterStore();

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private consent: ConsentService,
    private looks: LooksService,
    private live: CircleLive,
  ) {}

  onModuleInit() {
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on("error", () => undefined);
    this.redis.on("ready", () => (this.counters = new RedisCounterStore(this.redis!)));
    this.redis.on("end", () => (this.counters = new MemoryCounterStore()));
    // Expired polls lose their shared copies within minutes (originals were never shared).
    this.sweepTimer = setInterval(() => void this.sweep().catch((e) => this.log.warn(e.message)), 5 * 60_000);
    this.sweepTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweepTimer);
    this.redis?.disconnect();
  }

  shareUrl(token: string) {
    return `${config.webUrl}/c/${token}`;
  }

  /** Looks the shopper can put in a poll: same Muse session first, then saved, then recent. */
  async candidates(userId: string, lookId?: string) {
    const anchor = lookId ? await this.prisma.look.findFirst({ where: { id: lookId, userId } }) : null;
    const rows = await this.looks.rows(
      { userId, generation: { status: "DELIVERED" } },
      { createdAt: "desc" },
    );
    const score = (r: (typeof rows)[number]) =>
      (r.id === anchor?.id ? 1000 : 0) + (r.intentSessionId === anchor?.intentSessionId ? 100 : 0) + (r.savedAt ? 10 : 0);
    const seen = new Set<string>();
    const unique = rows
      .sort((a, b) => score(b) - score(a))
      .filter((r) => {
        const k = r.generationId ?? r.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 12);
    return this.looks.views(unique);
  }

  async create(userId: string, body: unknown) {
    const req = parse(CreatePoll, body);
    const ids = [...new Set(req.lookIds)];
    if (ids.length < 2) throw new BadRequestException("Pick at least two different looks");
    const looks = await this.prisma.look.findMany({ where: { id: { in: ids }, userId }, include: { generation: true } });
    if (looks.length !== ids.length || looks.some((l) => l.generation?.status !== "DELIVERED" || !l.generation.outputPath)) {
      throw new BadRequestException("Only your finished looks can go in a poll");
    }
    const variants = await this.prisma.variant.findMany({ where: { id: { in: looks.map((l) => l.variantId) } }, include: { product: true } });
    const vById = new Map(variants.map((v) => [v.id, v]));
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const consent = await this.consent.record(userId, CONSENT_PURPOSE, true, user.locale);
    const token = randomBytes(9).toString("base64url");
    const hours = Math.min(req.hours ?? POLL_TTL_HOURS, POLL_TTL_HOURS);
    const poll = await this.prisma.circlePoll.create({
      data: { ownerId: userId, token, question: req.question, occasion: req.occasion, consentId: consent.id, expiresAt: new Date(Date.now() + hours * 3600_000) },
    });
    const colourCount = new Map<string, number>();
    for (const l of looks) colourCount.set(vById.get(l.variantId)!.colourName, (colourCount.get(vById.get(l.variantId)!.colourName) ?? 0) + 1);
    const copies: Buffer[] = [];
    const ordered = ids.map((id) => looks.find((l) => l.id === id)!);
    for (const [i, l] of ordered.entries()) {
      const v = vById.get(l.variantId)!;
      const copy = await watermark(await this.storage.read(l.generation!.outputPath!));
      copies.push(copy);
      const imagePath = await this.storage.put(`private/polls/${userId}/${poll.id}/${i}.webp`, copy);
      const label = colourCount.get(v.colourName)! > 1 ? v.product.title : v.colourName;
      await this.prisma.circleOption.create({
        data: { pollId: poll.id, position: i, lookId: l.id, productId: l.productId, variantId: l.variantId, label, imagePath },
      });
    }
    const ogPath = await this.storage.put(`private/polls/${userId}/${poll.id}/og.jpg`, await ogCard(req.question, copies));
    await this.prisma.circlePoll.update({ where: { id: poll.id }, data: { ogPath } });
    return this.ownerView(userId, poll.id);
  }

  private async poll(token: string) {
    const p = await this.prisma.circlePoll.findUnique({ where: { token }, include: { options: { orderBy: { position: "asc" } } } });
    if (!p) throw new NotFoundException("This poll doesn't exist");
    return p;
  }

  async owned(userId: string, id: string) {
    const p = await this.prisma.circlePoll.findUnique({ where: { id }, include: { options: { orderBy: { position: "asc" } } } });
    // Only the shopper who created the poll may see it: makers, hosts and other users get 404.
    if (!p || p.ownerId !== userId) throw new NotFoundException("Poll not found");
    return p;
  }

  /** Aggregate results + recent comments; memoised briefly so a burst of SSE clients costs one query. */
  snapshot(pollId: string): Promise<Snapshot> {
    const hit = this.memo.get(pollId);
    if (hit && Date.now() - hit.at < 200) return hit.p;
    const p = this.computeSnapshot(pollId);
    this.memo.set(pollId, { at: Date.now(), p });
    if (this.memo.size > 500) this.memo.delete(this.memo.keys().next().value!);
    return p;
  }

  private async computeSnapshot(pollId: string): Promise<Snapshot> {
    const poll = await this.prisma.circlePoll.findUniqueOrThrow({ where: { id: pollId }, include: { options: { orderBy: { position: "asc" } } } });
    const counts = await this.prisma.circleVote.groupBy({ by: ["optionId"], where: { pollId }, _count: { _all: true } });
    const total = counts.reduce((s, c) => s + c._count._all, 0);
    const recent = await this.prisma.circleVote.findMany({
      where: { pollId, OR: [{ comment: { not: null } }, { emoji: { not: null } }, { name: { not: null } }] },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });
    const label = new Map(poll.options.map((o) => [o.id, o.label]));
    return {
      state: pollState(poll),
      total,
      options: poll.options.map((o) => {
        const votes = counts.find((c) => c.optionId === o.id)?._count._all ?? 0;
        return { id: o.id, votes, pct: total ? Math.round((votes / total) * 100) : 0 };
      }),
      comments: recent.map((v) => ({ id: v.id, name: v.name || "A friend", comment: v.comment, emoji: v.emoji, option: label.get(v.optionId) ?? "", at: v.updatedAt })),
    };
  }

  device(req: Request, res: Response) {
    const existing = readDevice(config.jwtSecret, req.cookies?.[DEVICE_COOKIE]);
    if (existing) return existing;
    const cookie = issueDevice(config.jwtSecret);
    res.cookie(DEVICE_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 365 * 86400_000, path: "/" });
    return readDevice(config.jwtSecret, cookie)!;
  }

  async publicView(token: string, deviceId: string | null) {
    const p = await this.poll(token);
    const state = pollState(p);
    if (state !== "OPEN") return { state, question: p.question, options: [], total: 0, comments: [], myVote: null, expiresAt: p.expiresAt };
    const snap = await this.snapshot(p.id);
    const mine = deviceId
      ? await this.prisma.circleVote.findUnique({ where: { pollId_deviceHash: { pollId: p.id, deviceHash: hashId(config.jwtSecret, "device", deviceId) } } })
      : null;
    return {
      state,
      question: p.question,
      occasion: p.occasion,
      expiresAt: p.expiresAt,
      total: snap.total,
      comments: snap.comments,
      myVote: mine ? { optionId: mine.optionId, name: mine.name, comment: mine.comment, emoji: mine.emoji } : null,
      options: p.options.map((o) => ({ ...snap.options.find((x) => x.id === o.id)!, label: o.label, image: `/api/c/${token}/img/${o.id}` })),
    };
  }

  async meta(token: string) {
    const p = await this.poll(token);
    const state = pollState(p);
    return {
      state,
      question: p.question,
      expiresAt: p.expiresAt,
      options: state === "OPEN" ? p.options.map((o) => ({ id: o.id, label: o.label, image: `/api/c/${token}/img/${o.id}` })) : [],
    };
  }

  async vote(token: string, deviceId: string, ip: string, body: unknown) {
    const req = parse(Vote, body);
    const p = await this.poll(token);
    const state = pollState(p);
    if (state !== "OPEN") throw new HttpException({ message: state === "EXPIRED" ? "This poll has closed" : "This poll was taken down by its owner", state }, 410);
    if (!p.options.some((o) => o.id === req.optionId)) throw new BadRequestException("Pick one of the looks");
    const deviceHash = hashId(config.jwtSecret, "device", deviceId);
    const ipHash = hashId(config.jwtSecret, "ip", ip);
    const hit = await overLimit(this.counters, VOTE_LIMITS(p.id, ipHash, deviceHash));
    if (hit) throw new HttpException({ message: "Too many votes from this connection. Try again in a few minutes.", code: "RATE_LIMITED" }, 429);
    // One vote per device: voting again changes your choice, it never adds a second vote.
    // Changing your pick keeps the name and comment you already left unless you send new ones.
    const extras = { ...(req.name ? { name: req.name } : {}), ...(req.comment ? { comment: req.comment } : {}), ...(req.emoji ? { emoji: req.emoji } : {}) };
    await this.prisma.circleVote.upsert({
      where: { pollId_deviceHash: { pollId: p.id, deviceHash } },
      create: { pollId: p.id, deviceHash, optionId: req.optionId, ipHash, ...extras },
      update: { optionId: req.optionId, ipHash, ...extras },
    });
    this.memo.delete(p.id);
    await this.live.publish(p.id);
    return this.publicView(token, deviceId);
  }

  async image(token: string, optionId: string, kind: "option" | "og") {
    const p = await this.poll(token);
    if (pollState(p) !== "OPEN") throw new NotFoundException("This poll has closed");
    const path = kind === "og" ? p.ogPath : p.options.find((o) => o.id === optionId)?.imagePath;
    if (!path) throw new NotFoundException();
    return this.storage.read(path);
  }

  async ownerView(userId: string, id: string) {
    const p = await this.owned(userId, id);
    const snap = { ...(await this.snapshot(p.id)), state: pollState(p) };
    const views = await this.looks.views(await this.looks.rows({ id: { in: p.options.map((o) => o.lookId) }, userId }));
    const winner = snap.total ? [...snap.options].sort((a, b) => b.votes - a.votes)[0] : null;
    const tied = winner ? snap.options.filter((o) => o.votes === winner.votes).length > 1 : false;
    return {
      id: p.id,
      token: p.token,
      question: p.question,
      occasion: p.occasion,
      shareUrl: this.shareUrl(p.token),
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      ...snap,
      winner: winner && !tied ? p.options.find((o) => o.id === winner.id)!.lookId : null,
      options: p.options.map((o) => {
        const look = views.find((v) => v.id === o.lookId) ?? null;
        return {
          ...snap.options.find((x) => x.id === o.id)!,
          label: o.label,
          lookId: o.lookId,
          // Owner sees the watermarked copy while open (exactly what friends see), the private original afterwards.
          image: snap.state === "OPEN" ? `/api/c/${p.token}/img/${o.id}` : look?.image ?? null,
          look,
        };
      }),
    };
  }

  async mine(userId: string) {
    const polls = await this.prisma.circlePoll.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { votes: true } } } });
    return polls.map((p) => ({ id: p.id, question: p.question, state: pollState(p), votes: p._count.votes, expiresAt: p.expiresAt, createdAt: p.createdAt }));
  }

  async revoke(userId: string, id: string) {
    const p = await this.owned(userId, id);
    if (!p.revokedAt) await this.prisma.circlePoll.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.purgeFiles(p.id);
    this.memo.delete(p.id);
    await this.live.publish(p.id);
    return this.ownerView(userId, id);
  }

  /** Delete the shared (watermarked) copies of a poll; votes stay for the owner's own history. */
  async purgeFiles(pollId: string) {
    const p = await this.prisma.circlePoll.findUniqueOrThrow({ where: { id: pollId }, include: { options: true } });
    for (const o of p.options) await this.storage.remove(o.imagePath);
    if (p.ogPath) await this.storage.remove(p.ogPath);
    await this.prisma.circlePoll.update({ where: { id: pollId }, data: { purgedAt: new Date() } });
    this.memo.delete(pollId);
  }

  async sweep(now = new Date()) {
    const due = await this.prisma.circlePoll.findMany({ where: { purgedAt: null, OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] }, select: { id: true } });
    for (const p of due) {
      await this.purgeFiles(p.id);
      await this.live.publish(p.id);
    }
    return due.length;
  }

  /** Privacy centre: export (FR-PRV) */
  async exportFor(userId: string) {
    const polls = await this.prisma.circlePoll.findMany({
      where: { ownerId: userId },
      include: { options: { select: { label: true, lookId: true, productId: true, variantId: true } }, votes: { select: { optionId: true, name: true, comment: true, emoji: true, createdAt: true } } },
    });
    return polls.map((p) => ({ question: p.question, createdAt: p.createdAt, expiresAt: p.expiresAt, revokedAt: p.revokedAt, consentId: p.consentId, options: p.options, votes: p.votes }));
  }

  /** Privacy centre: deletion cascade. Removes copies, votes and polls. */
  async deleteFor(userId: string) {
    const polls = await this.prisma.circlePoll.findMany({ where: { ownerId: userId }, select: { id: true } });
    for (const p of polls) {
      await this.purgeFiles(p.id);
      await this.live.publish(p.id);
    }
    await this.prisma.circlePoll.deleteMany({ where: { ownerId: userId } });
    return polls.length;
  }
}

function sse(res: Response) {
  res.status(200);
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();
  // 2 KB padding comment defeats proxies that buffer the first chunk.
  res.write(`: ${" ".repeat(2048)}\nretry: 3000\n\n`);
}

function stream(res: Response, req: Request, live: CircleLive, pollId: string, push: () => Promise<unknown>) {
  sse(res);
  let closed = false;
  const send = async () => {
    if (closed) return;
    try {
      res.write(`event: snapshot\ndata: ${JSON.stringify(await push())}\n\n`);
    } catch {
      /* client went away mid-write */
    }
  };
  void send();
  const off = live.on(pollId, () => void send());
  const beat = setInterval(() => res.write(`: ping\n\n`), 20_000);
  req.on("close", () => {
    closed = true;
    off();
    clearInterval(beat);
  });
}

/** Shopper side (auth): create, watch, revoke. */
@Controller("circle")
export class CircleController {
  constructor(
    private circle: CircleService,
    private live: CircleLive,
  ) {}

  @Get("candidates")
  candidates(@CurrentUser() user: AuthUser, @Query("lookId") lookId?: string) {
    return this.circle.candidates(user.id, lookId);
  }

  @Post("polls")
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.circle.create(user.id, body);
  }

  @Get("polls")
  mine(@CurrentUser() user: AuthUser) {
    return this.circle.mine(user.id);
  }

  @Get("polls/:id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.circle.ownerView(user.id, id);
  }

  @Post("polls/:id/revoke")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.circle.revoke(user.id, id);
  }

  @Get("polls/:id/stream")
  async ownerStream(@CurrentUser() user: AuthUser, @Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    const p = await this.circle.owned(user.id, id);
    stream(res, req, this.live, p.id, () => this.circle.snapshot(p.id));
  }
}

/** Public poll (no account): `/c/<token>` in the web app. */
@Controller("c")
export class CirclePublicController {
  constructor(
    private circle: CircleService,
    private prisma: PrismaService,
    private live: CircleLive,
  ) {}

  @Public()
  @Get(":token")
  async view(@Param("token") token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("cache-control", "private, no-store");
    return this.circle.publicView(token, this.circle.device(req, res));
  }

  /** Light, cookie-free shell data for server rendering and the WhatsApp link preview. */
  @Public()
  @Get(":token/meta")
  async meta(@Param("token") token: string) {
    return this.circle.meta(token);
  }

  @Public()
  @Post(":token/vote")
  async vote(@Param("token") token: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.circle.vote(token, this.circle.device(req, res), clientIp(req), body);
  }

  @Public()
  @Get(":token/img/:optionId")
  async img(@Param("token") token: string, @Param("optionId") optionId: string, @Res() res: Response) {
    const data = await this.circle.image(token, optionId, "option");
    res.setHeader("content-type", "image/webp");
    // Short private cache: revocation must take effect quickly.
    res.setHeader("cache-control", "private, max-age=300");
    res.setHeader("x-robots-tag", "noindex");
    res.send(data);
  }

  @Public()
  @Get(":token/og.jpg")
  async og(@Param("token") token: string, @Res() res: Response) {
    const data = await this.circle.image(token, "", "og");
    res.setHeader("content-type", "image/jpeg");
    res.setHeader("cache-control", "public, max-age=600");
    res.setHeader("x-robots-tag", "noindex");
    res.send(data);
  }

  @Public()
  @Get(":token/stream")
  async stream(@Param("token") token: string, @Req() req: Request, @Res() res: Response) {
    const p = await this.prisma.circlePoll.findUnique({ where: { token } });
    if (!p) throw new NotFoundException();
    if (this.live.watchers(p.id) > 300) throw new ForbiddenException("Too many viewers right now. Results refresh every few seconds instead.");
    stream(res, req, this.live, p.id, () => this.circle.snapshot(p.id));
  }
}

@Module({
  imports: [LooksModule],
  controllers: [CircleController, CirclePublicController],
  providers: [CircleService, CircleLive],
  exports: [CircleService],
})
export class CircleModule {}
