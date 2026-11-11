import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Prisma, VideoTryOn } from "@prisma/client";
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
import { personaFromCacheKey } from "../xr/xr-rules";
import { mapGatewayStatus, residencyRegion, servedByActivatedModel, validateClip, VIDEO_JOB, VIDEO_RENDERING, VIDEO_TRYON, videoAvailable, videoCostRwf, videoEligibility, videoQuote } from "./video-rules";

interface GatewayJob {
  status: string;
  progress: number;
  error?: string;
  result?: {
    status: "DELIVERED" | "WITHHELD";
    guard: { passed: boolean; reasons: string[]; identity_stability: number; sampled_frames: number[] };
    frames: number;
    fps: number;
    duration_ms: number;
    width: number;
    height: number;
    model_version: string;
    routing?: Record<string, unknown> | null;
    webp_b64?: string;
    mp4_b64?: string | null;
    poster_b64?: string;
    c2pa?: { manifest: Record<string, unknown>; signature: string; sha256: string };
  };
}

export interface StartInput {
  source: "CLIP" | "TURNAROUND";
  frames?: string[];
  consent?: boolean;
  locale?: string;
}

/**
 * E39 "See it on video" (FR-VID-03/04/05): only while a VIDEO_TRYON model is ACTIVE in the registry (which the
 * NLB gate allows only after a passing eval). Premium credits like E28, guarded on sampled frames by the gateway,
 * C2PA, private signed URLs. A shopper clip needs VIDEO_CLIP_UPLOAD consent and is deleted when processing ends.
 */
@Injectable()
export class VideoTryOnService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("VideoTryOn");
  private sweeper?: NodeJS.Timeout;
  pollMs = 1000;

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
    this.generations.handle(VIDEO_JOB, (job) => this.process(job.data.id as string));
    if (process.env.NODE_ENV !== "test") this.sweeper = setInterval(() => void this.sweepClips().catch(() => undefined), 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  async activeModel() {
    return this.prisma.modelVersion.findFirst({ where: { tier: VIDEO_TRYON.tier, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  }

  async available() {
    const [flag, model] = await Promise.all([this.prisma.featureFlag.findUnique({ where: { key: VIDEO_TRYON.flag } }), this.activeModel()]);
    return { available: videoAvailable(flag?.enabled, model), model };
  }

  private async quote(pageId: string) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, include: { subscription: true } });
    const sub = page?.subscription ?? null;
    const used = sub
      ? ((await this.prisma.usageEvent.aggregate({ where: { pageId, source: "PAGE_ALLOWANCE", createdAt: { gte: sub.periodStart } }, _sum: { units: true } }))._sum.units ?? 0)
      : 0;
    return videoQuote({ pageAllowanceOn: Boolean(page?.allowanceOn), pageCap: sub?.monthlyCap ?? null, pageUnitsUsed: used });
  }

  private async todayCount(userId: string) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return this.prisma.videoTryOn.count({ where: { userId, createdAt: { gte: d }, status: { notIn: ["FAILED", "WITHHELD"] } } });
  }

  private async lookFor(userId: string, lookId: string) {
    const look = await this.prisma.look.findFirst({ where: { id: lookId, userId }, include: { generation: true } });
    if (!look) throw new NotFoundException("Look not found");
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: look.productId } });
    return { look, product };
  }

  async state(userId: string, lookId: string) {
    const { available, model } = await this.available();
    const { look, product } = await this.lookFor(userId, lookId);
    const job = await this.prisma.videoTryOn.findFirst({ where: { userId, lookId, variantId: look.variantId }, orderBy: { createdAt: "desc" } });
    const eligible = videoEligibility(look.generation?.status ?? null, await this.todayCount(userId));
    return {
      available,
      model: available && model ? { id: model.id, name: model.name } : null,
      eligible: available && eligible.ok,
      reason: !available ? "Video try-on is not available yet." : eligible.ok ? null : eligible.reason,
      quote: await this.quote(product.pageId),
      clipConsent: await this.consent.has(userId, VIDEO_TRYON.consent),
      onTwin: Boolean(await this.twins.current(userId)),
      job: job ? this.view(job) : null,
    };
  }

  async start(userId: string, lookId: string, input: StartInput) {
    const { available, model } = await this.available();
    if (!available || !model) throw new ConflictException({ message: "Video try-on is not available yet.", code: "VIDEO_UNAVAILABLE" });
    const { look, product } = await this.lookFor(userId, lookId);
    const gen = look.generation;
    const ok = videoEligibility(gen?.status ?? null, await this.todayCount(userId));
    if (!ok.ok) throw new HttpException({ message: ok.reason, code: "VIDEO_NOT_ALLOWED" }, HttpStatus.TOO_MANY_REQUESTS);
    if ((await this.twins.current(userId)) && !(await this.consent.has(userId, "TRYON_GENERATION"))) {
      throw new ForbiddenException({ message: "You paused looks on your twin. Turn them back on in the Trust centre.", code: "CONSENT_WITHDRAWN" });
    }
    await this.metering.assertBudgetOpen();
    let consentId: string | null = null;
    if (input.source === "CLIP") {
      const errs = validateClip(input.frames);
      if (errs.length) throw new BadRequestException({ message: errs[0], issues: errs });
      if (input.consent) {
        consentId = (await this.consent.record(userId, VIDEO_TRYON.consent, true, input.locale ?? "en")).id;
      } else if (!(await this.consent.has(userId, VIDEO_TRYON.consent))) {
        throw new ForbiddenException({ message: "Please agree to how we use your clip first.", code: "CONSENT_REQUIRED" });
      } else {
        consentId = (await this.prisma.consentRecord.findFirst({ where: { userId, purpose: VIDEO_TRYON.consent, granted: true }, orderBy: { createdAt: "desc" } }))?.id ?? null;
      }
    }
    const row = await this.prisma.videoTryOn.create({
      data: {
        userId, lookId, generationId: gen!.id, variantId: look.variantId, pageId: product.pageId, source: input.source,
        status: "QUEUED", progress: 5, modelId: model.id, provider: model.provider, consentId, clipFrames: input.frames?.length ?? 0,
      },
    });
    if (input.source === "CLIP") {
      const path = `private/video/${userId}/${row.id}/clip.enc`;
      const { iv, authTag } = await this.storage.putEncrypted(path, Buffer.from(JSON.stringify(input.frames)));
      await this.prisma.videoTryOn.update({ where: { id: row.id }, data: { clipPath: path, clipIv: iv, clipTag: authTag } });
    }
    await this.generations.enqueue(VIDEO_JOB, { id: row.id }, `video-${row.id}`);
    return this.view(row);
  }

  async get(userId: string, id: string) {
    const row = await this.prisma.videoTryOn.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException();
    return this.view(row);
  }

  /** E41 region of the shopper (else the page) → the router keeps self-hosted/hosted inference in that region. */
  private async region(userId: string, pageId: string) {
    const [prefs, page] = await Promise.all([
      this.prisma.shopperPrefs.findUnique({ where: { userId } }).catch(() => null),
      this.prisma.pageRegion.findUnique({ where: { pageId } }).catch(() => null),
    ]);
    return residencyRegion(prefs?.country, page?.region);
  }

  private async deleteClip(row: Pick<VideoTryOn, "id" | "clipPath" | "clipDeletedAt">) {
    if (!row.clipPath || row.clipDeletedAt) return;
    await this.storage.remove(row.clipPath);
    await this.prisma.videoTryOn.update({ where: { id: row.id }, data: { clipDeletedAt: new Date(), clipIv: null, clipTag: null } });
  }

  /** Worker: input (clip or twin) + garment → gateway async job → private storage → meter. Clip deleted at the end. */
  async process(id: string) {
    const row = await this.prisma.videoTryOn.update({ where: { id }, data: { status: "GENERATING", progress: 12 } });
    try {
      const gen = row.generationId ? await this.prisma.generation.findUnique({ where: { id: row.generationId }, include: { variant: { include: { product: true } } } }) : null;
      if (!gen || gen.status !== "DELIVERED") throw new Error("The look is no longer available");
      if (!gen.variant.cutoutPath) throw new Error("Variant has no try-on cut-out");
      const active = await this.activeModel();
      if (!active || active.id !== row.modelId) throw new Error("The video model was retired before this job ran");
      const body: Record<string, unknown> = {
        provider: row.provider,
        source: row.source,
        garment_b64: (await this.storage.read(gen.variant.cutoutPath)).toString("base64"),
        garment_category: gen.variant.product.category,
        request_id: `video-${id}`,
        region: await this.region(row.userId, row.pageId),
      };
      if (row.source === "CLIP") {
        if (!row.clipPath || !row.clipIv || !row.clipTag) throw new Error("Clip missing");
        body.frames_b64 = JSON.parse((await this.storage.readEncrypted(row.clipPath, row.clipIv, row.clipTag)).toString()) as string[];
      } else {
        body.twin_b64 = (await this.twins.renderSource(row.userId, personaFromCacheKey(gen.cacheKey))).image.toString("base64");
      }
      const { job_id } = await this.ai.post<{ job_id: string }>("/v1/video/tryon", body, 60_000);
      delete body.frames_b64;
      delete body.twin_b64;
      await this.prisma.videoTryOn.update({ where: { id }, data: { gatewayJob: job_id } });
      // The gateway holds the frames only in memory for the length of the job; our sealed copy goes now.
      await this.deleteClip(row);
      let job: GatewayJob = { status: "QUEUED", progress: 0 };
      const deadline = Date.now() + 5 * 60_000;
      while (mapGatewayStatus(job.status) === "GENERATING") {
        if (Date.now() > deadline) throw new Error("Video job timed out");
        await new Promise((r) => setTimeout(r, this.pollMs));
        job = await this.ai.get<GatewayJob>(`/v1/video/jobs/${job_id}`);
        if (mapGatewayStatus(job.status) === "GENERATING") {
          await this.prisma.videoTryOn.update({ where: { id }, data: { progress: Math.max(15, Math.min(85, job.progress)) } });
        }
      }
      if (job.status === "FAILED" || !job.result) throw new Error(job.error ?? "Video job failed");
      const r = job.result;
      if (!servedByActivatedModel(row.modelId, r.model_version)) throw new Error(`Served by ${r.model_version}, which is not the activated model ${row.modelId}`);
      await this.prisma.videoTryOn.update({ where: { id }, data: { status: "GUARDING", progress: 90 } });
      const meta = {
        frames: r.frames, durationMs: r.duration_ms, width: r.width, height: r.height, modelVersion: r.model_version,
        guard: r.guard as unknown as Prisma.InputJsonValue, routing: (r.routing ?? undefined) as Prisma.InputJsonValue | undefined,
      };
      if (r.status !== "DELIVERED" || !r.webp_b64) {
        await this.prisma.videoTryOn.update({ where: { id }, data: { ...meta, status: "WITHHELD", progress: 100 } });
        await this.prisma.moderationItem.create({ data: { kind: "GUARD_WITHHELD", refId: id, pageId: row.pageId, reason: `video: ${r.guard.reasons.join("; ") || "guard failed"}` } });
        return;
      }
      const base = `private/video/${row.userId}/${id}`;
      const webpPath = await this.storage.put(`${base}/clip.webp`, Buffer.from(r.webp_b64, "base64"));
      const mp4Path = r.mp4_b64 ? await this.storage.put(`${base}/clip.mp4`, Buffer.from(r.mp4_b64, "base64")) : null;
      const posterPath = r.poster_b64 ? await this.storage.put(`${base}/poster.webp`, Buffer.from(r.poster_b64, "base64")) : null;
      const q = await this.quote(row.pageId);
      await this.prisma.usageEvent.create({
        data: { kind: VIDEO_TRYON.kind, source: q.source, units: VIDEO_TRYON.credits, costRwf: videoCostRwf(), userId: row.userId, pageId: q.source === "PAGE_ALLOWANCE" ? row.pageId : null, refId: id },
      });
      aiSpend.inc({ kind: VIDEO_TRYON.kind }, videoCostRwf());
      await this.prisma.videoTryOn.update({
        where: { id },
        data: {
          ...meta, status: "DELIVERED", progress: 100, webpPath, mp4Path, posterPath, billing: q.source, credits: VIDEO_TRYON.credits, costRwf: videoCostRwf(),
          c2pa: r.c2pa ? { sha256: r.c2pa.sha256, signature: r.c2pa.signature, manifest: r.c2pa.manifest as object } : undefined,
          deliveredAt: new Date(),
        },
      });
    } catch (e) {
      this.log.warn(`video ${id} failed: ${(e as Error).message}`);
      await this.prisma.videoTryOn.update({ where: { id }, data: { status: "FAILED", progress: 100, error: (e as Error).message.slice(0, 300) } });
    } finally {
      const fresh = await this.prisma.videoTryOn.findUnique({ where: { id } });
      if (fresh) await this.deleteClip(fresh).catch(() => undefined);
    }
  }

  /** Belt and braces: any sealed clip older than 30 minutes is deleted whatever happened to its job. */
  async sweepClips() {
    const stale = await this.prisma.videoTryOn.findMany({ where: { clipPath: { not: null }, clipDeletedAt: null, createdAt: { lt: new Date(Date.now() - 30 * 60_000) } } });
    for (const r of stale) await this.deleteClip(r);
    return stale.length;
  }

  sign(rel: string) {
    const exp = Math.floor(Date.now() / 1000) + config.signedUrlTtlSec;
    const sig = createHmac("sha256", config.jwtSecret).update(`video:${rel}:${exp}`).digest("hex");
    return `/api/video/file?p=${encodeURIComponent(rel)}&exp=${exp}&sig=${sig}`;
  }

  view(v: VideoTryOn) {
    const delivered = v.status === "DELIVERED";
    const c2pa = v.c2pa as { sha256?: string } | null;
    const guard = v.guard as { identity_stability?: number; sampled_frames?: number[] } | null;
    return {
      id: v.id,
      lookId: v.lookId,
      source: v.source,
      status: v.status,
      rendering: VIDEO_RENDERING.has(v.status),
      progress: v.progress,
      webp: delivered && v.webpPath ? this.sign(v.webpPath) : null,
      mp4: delivered && v.mp4Path ? this.sign(v.mp4Path) : null,
      poster: delivered && v.posterPath ? this.sign(v.posterPath) : null,
      frames: v.frames,
      durationMs: v.durationMs,
      credits: v.credits,
      billing: v.billing,
      clipDeleted: v.source === "CLIP" ? Boolean(v.clipDeletedAt) : null,
      guard: guard ? { identityStability: guard.identity_stability ?? null, sampledFrames: guard.sampled_frames?.length ?? 0 } : null,
      c2pa: c2pa?.sha256 ? { signed: true, sha256: c2pa.sha256.slice(0, 16), model: v.modelVersion } : null,
      error: v.status === "FAILED" ? "We couldn't make this video. You were not charged." : null,
      label: VIDEO_TRYON.label,
    };
  }
}
