import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { MotionClip } from "@prisma/client";
import { createHmac } from "node:crypto";
import { AiClient } from "../../common/ai.client";
import { ConsentService } from "../../common/consent.service";
import { aiSpend } from "../../common/metrics";
import { MeteringService } from "../../common/metering.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { config } from "../../config";
import { GenerationService } from "../looks/generation.service";
import { TwinService } from "../twin/twin.module";
import { motionCostRwf, motionEligibility, MOTION, personaFromCacheKey, pickVideoSource, quoteLabel, RENDERING, type UsageSource } from "./xr-rules";

export const MOTION_JOB = "motion";
export const MOTION_LABEL = "AI motion preview";

interface MotionResult {
  status: "DELIVERED" | "WITHHELD";
  guard: { passed: boolean; reasons: string[]; identity_similarity: number; sampled_frames: number[] };
  frames: number;
  fps: number;
  duration_ms: number;
  width: number;
  height: number;
  model_version: string;
  webp_b64?: string;
  mp4_b64?: string | null;
  poster_b64?: string;
  c2pa?: { manifest: Record<string, unknown>; signature: string; sha256: string };
}

/**
 * E28 "See it move" (FR-VID-01/04/05/06): a short sway loop made from a delivered look.
 * Premium credit (VIDEO usage, FR-PLAN-03 source order), guarded on sampled frames, C2PA-labelled,
 * private to the shopper via short-lived signed URLs, generated on the shared BullMQ queue.
 */
@Injectable()
export class MotionService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Motion");
  private sweeper?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private metering: MeteringService,
    private consent: ConsentService,
    private twins: TwinService,
    private generations: GenerationService,
  ) {}

  onModuleInit() {
    this.generations.handle(MOTION_JOB, (job) => this.process(job.data.id as string));
    // Clips follow their look: when a twin or account is deleted the generations go, so do the clips.
    if (process.env.NODE_ENV !== "test") this.sweeper = setInterval(() => void this.sweepOrphans().catch(() => undefined), 10 * 60_000);
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  private weekAgo() {
    return new Date(Date.now() - 7 * 86400_000);
  }

  async quote(userId: string, pageId: string): Promise<{ source: UsageSource; credits: number; costRwf: number; label: string }> {
    const freeUsedThisWeek = await this.prisma.usageEvent.count({
      where: { userId, kind: MOTION.kind, source: "FREE_QUOTA", createdAt: { gte: this.weekAgo() } },
    });
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, include: { subscription: true } });
    const sub = page?.subscription ?? null;
    const pageUnitsUsed = sub
      ? ((await this.prisma.usageEvent.aggregate({ where: { pageId, source: "PAGE_ALLOWANCE", createdAt: { gte: sub.periodStart } }, _sum: { units: true } }))._sum.units ?? 0)
      : 0;
    const source = pickVideoSource({ freeUsedThisWeek, pageAllowanceOn: Boolean(page?.allowanceOn), pageCap: sub?.monthlyCap ?? null, pageUnitsUsed });
    return { source, credits: MOTION.credits, costRwf: source === "CREDITS" ? motionCostRwf() : 0, label: quoteLabel(source) };
  }

  private async todayCount(userId: string) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return this.prisma.motionClip.count({ where: { userId, createdAt: { gte: d }, status: { notIn: ["FAILED", "WITHHELD"] } } });
  }

  private async lookFor(userId: string, lookId: string) {
    const look = await this.prisma.look.findFirst({ where: { id: lookId, userId }, include: { generation: true } });
    if (!look) throw new NotFoundException("Look not found");
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: look.productId } });
    return { look, product };
  }

  /** Status for the look's rail button: existing clip (if any), eligibility and the price before confirming. */
  async state(userId: string, lookId: string) {
    const { look, product } = await this.lookFor(userId, lookId);
    const clip = look.generationId ? await this.prisma.motionClip.findUnique({ where: { generationId: look.generationId } }) : null;
    const eligible = motionEligibility({ generationStatus: look.generation?.status ?? null }, await this.todayCount(userId));
    return { clip: clip ? this.view(clip) : null, eligible: eligible.ok, reason: eligible.ok ? null : eligible.reason, quote: await this.quote(userId, product.pageId) };
  }

  async start(userId: string, lookId: string) {
    const { look, product } = await this.lookFor(userId, lookId);
    const gen = look.generation;
    const existing = gen ? await this.prisma.motionClip.findUnique({ where: { generationId: gen.id } }) : null;
    if (existing && existing.status !== "FAILED" && existing.status !== "WITHHELD") return this.view(existing);
    const ok = motionEligibility({ generationStatus: gen?.status ?? null }, await this.todayCount(userId));
    if (!ok.ok) throw new HttpException({ message: ok.reason, code: "MOTION_NOT_ALLOWED" }, HttpStatus.TOO_MANY_REQUESTS);
    if ((await this.twins.current(userId)) && !(await this.consent.has(userId, "TRYON_GENERATION"))) {
      throw new ForbiddenException({ message: "You paused looks on your twin. Turn them back on in the Trust centre.", code: "CONSENT_WITHDRAWN", purpose: "TRYON_GENERATION" });
    }
    await this.metering.assertBudgetOpen();
    if (existing) await this.prisma.motionClip.delete({ where: { id: existing.id } });
    const clip = await this.prisma.motionClip.create({
      data: { userId, lookId, generationId: gen!.id, variantId: look.variantId, pageId: product.pageId, status: "QUEUED", progress: 5 },
    });
    await this.generations.enqueue(MOTION_JOB, { id: clip.id }, `motion-${clip.id}`);
    return this.view(clip);
  }

  async get(userId: string, id: string) {
    const clip = await this.prisma.motionClip.findFirst({ where: { id, userId } });
    if (!clip) throw new NotFoundException();
    return this.view(clip);
  }

  /** Worker: twin + garment → gateway (frames, guard, C2PA) → private storage → meter → DELIVERED. */
  async process(id: string) {
    const clip = await this.prisma.motionClip.update({ where: { id }, data: { status: "GENERATING", progress: 20 } });
    try {
      const gen = await this.prisma.generation.findUnique({ where: { id: clip.generationId }, include: { variant: { include: { product: true } } } });
      if (!gen || gen.status !== "DELIVERED") throw new Error("The look is no longer available");
      if (!gen.variant.cutoutPath) throw new Error("Variant has no try-on cut-out");
      const src = await this.twins.renderSource(clip.userId, personaFromCacheKey(gen.cacheKey));
      const garment = await this.storage.read(gen.variant.cutoutPath);
      const r = await this.ai.post<MotionResult>(
        "/v1/motion",
        { twin_b64: src.image.toString("base64"), garment_b64: garment.toString("base64"), garment_category: gen.variant.product.category, request_id: `motion-${id}` },
        120_000,
      );
      await this.prisma.motionClip.update({ where: { id }, data: { status: "GUARDING", progress: 85 } });
      const meta = { frames: r.frames, durationMs: r.duration_ms, width: r.width, height: r.height, guard: r.guard, modelVersion: r.model_version };
      if (r.status !== "DELIVERED" || !r.webp_b64) {
        await this.prisma.motionClip.update({ where: { id }, data: { ...meta, status: "WITHHELD", progress: 100 } });
        await this.prisma.moderationItem.create({
          data: { kind: "GUARD_WITHHELD", refId: id, pageId: clip.pageId, reason: `motion: ${r.guard.reasons.join("; ") || "guard failed"}` },
        });
        return;
      }
      const base = `private/motion/${clip.userId}/${id}`;
      const webpPath = await this.storage.put(`${base}.webp`, Buffer.from(r.webp_b64, "base64"));
      const mp4Path = r.mp4_b64 ? await this.storage.put(`${base}.mp4`, Buffer.from(r.mp4_b64, "base64")) : null;
      const posterPath = r.poster_b64 ? await this.storage.put(`${base}-poster.webp`, Buffer.from(r.poster_b64, "base64")) : null;
      const q = await this.quote(clip.userId, clip.pageId);
      await this.prisma.usageEvent.create({
        data: { kind: MOTION.kind, source: q.source, units: MOTION.credits, costRwf: motionCostRwf(), userId: clip.userId, pageId: q.source === "PAGE_ALLOWANCE" ? clip.pageId : null, refId: id },
      });
      aiSpend.inc({ kind: MOTION.kind }, motionCostRwf());
      await this.prisma.motionClip.update({
        where: { id },
        data: {
          ...meta,
          status: "DELIVERED",
          progress: 100,
          webpPath,
          mp4Path,
          posterPath,
          source: q.source,
          credits: MOTION.credits,
          costRwf: motionCostRwf(),
          c2pa: r.c2pa ? { sha256: r.c2pa.sha256, signature: r.c2pa.signature, manifest: r.c2pa.manifest as object } : undefined,
          deliveredAt: new Date(),
        },
      });
    } catch (e) {
      this.log.warn(`motion ${id} failed: ${(e as Error).message}`);
      await this.prisma.motionClip.update({ where: { id }, data: { status: "FAILED", progress: 100, error: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }

  /** Delete clips whose look generation was purged (twin deletion, account deletion, retention). */
  async sweepOrphans() {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM "MotionClip" m LEFT JOIN "Generation" g ON g.id = m."generationId" WHERE g.id IS NULL`;
    for (const { id } of rows) {
      const c = await this.prisma.motionClip.findUnique({ where: { id } });
      if (!c) continue;
      for (const p of [c.webpPath, c.mp4Path, c.posterPath]) if (p) await this.storage.remove(p);
      await this.prisma.motionClip.delete({ where: { id } });
    }
    return rows.length;
  }

  /** Signed, short-lived URL served by XrController.motionFile (range requests for video). */
  sign(rel: string) {
    const exp = Math.floor(Date.now() / 1000) + config.signedUrlTtlSec;
    const sig = createHmac("sha256", config.jwtSecret).update(`motion:${rel}:${exp}`).digest("hex");
    return `/api/xr/motion-file?p=${encodeURIComponent(rel)}&exp=${exp}&sig=${sig}`;
  }

  view(c: MotionClip) {
    const delivered = c.status === "DELIVERED";
    const c2pa = c.c2pa as { sha256?: string } | null;
    return {
      id: c.id,
      lookId: c.lookId,
      status: c.status,
      rendering: RENDERING.has(c.status),
      progress: c.progress,
      webp: delivered && c.webpPath ? this.sign(c.webpPath) : null,
      mp4: delivered && c.mp4Path ? this.sign(c.mp4Path) : null,
      poster: delivered && c.posterPath ? this.sign(c.posterPath) : null,
      frames: c.frames,
      durationMs: c.durationMs,
      width: c.width,
      height: c.height,
      source: c.source,
      credits: c.credits,
      c2pa: c2pa?.sha256 ? { signed: true, sha256: c2pa.sha256.slice(0, 16), model: c.modelVersion } : null,
      label: MOTION_LABEL,
    };
  }
}
