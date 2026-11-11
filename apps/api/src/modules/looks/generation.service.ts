import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import { ConsentService } from "../../common/consent.service";
import { aiSpend, firstLook, generationDuration, generations, queueDepth } from "../../common/metrics";
import { config } from "../../config";
import type { Generation } from "@prisma/client";
import { AiClient } from "../../common/ai.client";
import { MeteringService } from "../../common/metering.service";
import { PrismaService } from "../../common/prisma.service";
import { PushService } from "../../common/push/push.service";
import { StorageService } from "../../common/storage.service";
import { TwinService } from "../twin/twin.module";

interface TryOnResult {
  status: "DELIVERED" | "WITHHELD";
  image_b64: string | null;
  guard: { passed: boolean; identity_similarity: number; skin_tone_delta: number; garment_fidelity: number; reasons: string[] };
  c2pa: { manifest: Record<string, unknown>; signature: string; sha256: string } | null;
  model_version: string;
  latency_ms: number;
}

/** Live morph (E23): render a morphed cut-out instead of the variant's own; part of the cache key. */
export interface MorphRender {
  key: string;
  cutoutPath: string;
  frame: number[];
}

const CONCURRENCY = Number(process.env.GENERATION_CONCURRENCY ?? 2);
const QUEUE = "look-generation";

/**
 * Look generation (SRS B1, plan §4.4, ADR-0004).
 * QUEUED → GENERATING → GUARDING → DELIVERED | WITHHELD | FAILED. Billing only on DELIVERED.
 * Jobs run on a BullMQ queue in Redis so several API instances can share the work and jobs survive restarts.
 */
@Injectable()
export class GenerationService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Generation");
  private queue!: Queue;
  private worker?: Worker;
  private handlers = new Map<string, (job: Job) => Promise<unknown>>();

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private twins: TwinService,
    private metering: MeteringService,
    private consent: ConsentService,
    private push: PushService,
  ) {}

  onModuleInit() {
    const connection = { url: config.redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue(QUEUE, { connection, prefix: config.queuePrefix });
    if (process.env.GENERATION_WORKER !== "0") {
      this.worker = new Worker(
        QUEUE,
        (job) =>
          job.name === "render"
            ? this.run(job.data.id as string, job.data.persona as number, job.data.morph as MorphRender | undefined)
            : (this.handlers.get(job.name)?.(job) ?? Promise.reject(new Error(`No handler for job ${job.name}`))),
        { connection, prefix: config.queuePrefix, concurrency: CONCURRENCY },
      );
      this.worker.on("failed", (job, err) => this.log.error(`generation ${job?.data?.id} failed: ${err.message}`));
    }
  }

  /** Other generation kinds (E27 3D garment, E28 motion) run on this same queue under their own job name. */
  handle(name: string, fn: (job: Job) => Promise<unknown>) {
    this.handlers.set(name, fn);
  }

  /** jobId makes enqueueing idempotent, like look renders. */
  enqueue(name: string, data: object, jobId: string) {
    return this.queue.add(name, data, { jobId, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async refreshQueueGauge() {
    const counts = await this.queue.getJobCounts("waiting", "active", "delayed", "failed");
    for (const [state, n] of Object.entries(counts)) queueDepth.set({ state }, n);
  }

  async model(tier: "PREVIEW" | "HD") {
    const m = await this.prisma.modelVersion.findFirst({ where: { tier, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    return m ?? { id: tier === "HD" ? "local-compositor@1.0-hd" : "local-compositor@1.0-preview", costRwf: tier === "HD" ? 110 : 40 };
  }

  /** Return a cached generation or queue a new one. Re-views are free (cache key includes twin version). */
  async ensure(userId: string, variantId: string, tier: "PREVIEW" | "HD" = "PREVIEW", persona = 2, morph?: MorphRender): Promise<Generation> {
    const twin = await this.twins.current(userId);
    if (twin && !(await this.consent.has(userId, "TRYON_GENERATION"))) {
      throw new ForbiddenException({ message: "You paused looks on your twin. Turn them back on in the Trust centre.", code: "CONSENT_WITHDRAWN" });
    }
    const twinKey = twin ? `${twin.id}:v${twin.version}` : `persona-${persona}:v0`;
    const model = await this.model(tier);
    const cacheKey = `${twinKey}|${variantId}|${model.id}${morph ? `|morph:${morph.key}` : ""}`;
    const existing = await this.prisma.generation.findUnique({ where: { cacheKey } });
    if (existing && existing.status !== "FAILED") return existing;
    if (existing) await this.prisma.generation.delete({ where: { id: existing.id } });

    await this.metering.assertBudgetOpen();
    await this.metering.assertDailyCap(userId);
    const gen = await this.prisma.generation.create({
      data: { userId, variantId, twinVersion: twin?.version ?? 0, modelVersion: model.id, tier, cacheKey, status: "QUEUED" },
    });
    // jobId = generation id: enqueueing the same generation twice is a no-op.
    await this.queue.add("render", { id: gen.id, persona, morph }, { jobId: gen.id, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 });
    return gen;
  }

  private async run(id: string, persona: number, morph?: MorphRender) {
    const gen = await this.prisma.generation.update({
      where: { id },
      data: { status: "GENERATING" },
      include: { variant: { include: { product: true } } },
    });
    try {
      const src = await this.twins.renderSource(gen.userId, persona);
      const cutoutPath = morph?.cutoutPath ?? gen.variant.cutoutPath;
      if (!cutoutPath) throw new Error("Variant has no try-on cut-out");
      const garment = await this.storage.read(cutoutPath);
      const started = Date.now();
      const r = await this.ai.post<TryOnResult>("/v1/tryon", {
        twin_b64: src.image.toString("base64"),
        garment_b64: garment.toString("base64"),
        garment_category: gen.variant.product.category,
        tier: gen.tier,
        request_id: gen.id,
        ...(morph ? { garment_frame: morph.frame } : {}),
      });
      await this.prisma.generation.update({ where: { id }, data: { status: "GUARDING" } });

      if (r.status !== "DELIVERED" || !r.image_b64) {
        // Guard failed: never shown, never charged; logged for the AI quality review (plan §15.2).
        await this.prisma.generation.update({ where: { id }, data: { status: "WITHHELD", guard: r.guard, latencyMs: Date.now() - started } });
        generations.inc({ status: "WITHHELD", model: gen.modelVersion });
        generationDuration.observe({ tier: gen.tier, status: "WITHHELD" }, (Date.now() - gen.createdAt.getTime()) / 1000);
        await this.prisma.moderationItem.create({
          data: { kind: "GUARD_WITHHELD", refId: id, pageId: gen.variant.product.pageId, reason: r.guard.reasons.join("; ") || "Guard failed" },
        });
        return;
      }
      const outputPath = await this.storage.put(`private/looks/${gen.userId}/${id}.png`, Buffer.from(r.image_b64, "base64"));
      const model = await this.model(gen.tier as "PREVIEW" | "HD");
      const source = await this.metering.resolveSource(gen.userId, gen.variant.product.pageId);
      await this.metering.record("TRYON", source, model.costRwf, gen.userId, source === "PAGE_ALLOWANCE" ? gen.variant.product.pageId : null, id);
      await this.prisma.generation.update({
        where: { id },
        data: {
          status: "DELIVERED",
          outputPath,
          guard: r.guard,
          c2pa: r.c2pa ? { sha256: r.c2pa.sha256, signature: r.c2pa.signature, manifest: r.c2pa.manifest as object } : undefined,
          costRwf: model.costRwf,
          latencyMs: Date.now() - started,
          deliveredAt: new Date(),
          modelVersion: r.model_version || gen.modelVersion,
        },
      });
      generations.inc({ status: "DELIVERED", model: gen.modelVersion });
      aiSpend.inc({ kind: "TRYON" }, model.costRwf);
      generationDuration.observe({ tier: gen.tier, status: "DELIVERED" }, (Date.now() - gen.createdAt.getTime()) / 1000);
      const first = await this.prisma.look.findFirst({ where: { generationId: id, rank: 0 }, include: { intentSession: true } });
      if (first) firstLook.observe((Date.now() - first.intentSession.createdAt.getTime()) / 1000);
      // E38 / FR-TRY-06: HD renders (hold-to-buy, full detail) take long enough to deserve a ping.
      if (gen.tier === "HD") {
        const look = await this.prisma.look.findFirst({ where: { generationId: id }, select: { id: true, intentSessionId: true } });
        await this.push.event(gen.userId, "look.ready", { url: look ? `/looks/${look.intentSessionId}?look=${look.id}` : "/saved", refId: id, vars: { item: gen.variant.product.title } });
      }
    } catch (e) {
      await this.prisma.generation.update({ where: { id }, data: { status: "FAILED", guard: { error: (e as Error).message } } });
      generations.inc({ status: "FAILED", model: gen.modelVersion });
      throw e;
    }
  }
}
