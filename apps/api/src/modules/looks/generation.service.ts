import { Injectable, Logger } from "@nestjs/common";
import type { Generation } from "@prisma/client";
import { AiClient } from "../../common/ai.client";
import { MeteringService } from "../../common/metering.service";
import { PrismaService } from "../../common/prisma.service";
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

const CONCURRENCY = 2;

/**
 * Look generation (SRS B1, plan §4.4, ADR-0004).
 * QUEUED → GENERATING → GUARDING → DELIVERED | WITHHELD | FAILED. Billing only on DELIVERED.
 */
@Injectable()
export class GenerationService {
  private log = new Logger("Generation");
  private queue: string[] = [];
  private running = 0;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private twins: TwinService,
    private metering: MeteringService,
  ) {}

  async model(tier: "PREVIEW" | "HD") {
    const m = await this.prisma.modelVersion.findFirst({ where: { tier, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    return m ?? { id: tier === "HD" ? "local-compositor@1.0-hd" : "local-compositor@1.0-preview", costRwf: tier === "HD" ? 110 : 40 };
  }

  /** Return a cached generation or queue a new one. Re-views are free (cache key includes twin version). */
  async ensure(userId: string, variantId: string, tier: "PREVIEW" | "HD" = "PREVIEW", persona = 2): Promise<Generation> {
    const twin = await this.twins.current(userId);
    const twinKey = twin ? `${twin.id}:v${twin.version}` : `persona-${persona}:v0`;
    const model = await this.model(tier);
    const cacheKey = `${twinKey}|${variantId}|${model.id}`;
    const existing = await this.prisma.generation.findUnique({ where: { cacheKey } });
    if (existing && existing.status !== "FAILED") return existing;
    if (existing) await this.prisma.generation.delete({ where: { id: existing.id } });

    await this.metering.assertBudgetOpen();
    await this.metering.assertDailyCap(userId);
    const gen = await this.prisma.generation.create({
      data: { userId, variantId, twinVersion: twin?.version ?? 0, modelVersion: model.id, tier, cacheKey, status: "QUEUED" },
    });
    this.queue.push(gen.id);
    this.pump(persona);
    return gen;
  }

  private pump(persona: number) {
    while (this.running < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      this.run(id, persona)
        .catch((e) => this.log.error(`generation ${id} failed: ${(e as Error).message}`))
        .finally(() => {
          this.running--;
          this.pump(persona);
        });
    }
  }

  private async run(id: string, persona: number) {
    const gen = await this.prisma.generation.update({
      where: { id },
      data: { status: "GENERATING" },
      include: { variant: { include: { product: true } } },
    });
    try {
      const src = await this.twins.renderSource(gen.userId, persona);
      if (!gen.variant.cutoutPath) throw new Error("Variant has no try-on cut-out");
      const garment = await this.storage.read(gen.variant.cutoutPath);
      const started = Date.now();
      const r = await this.ai.post<TryOnResult>("/v1/tryon", {
        twin_b64: src.image.toString("base64"),
        garment_b64: garment.toString("base64"),
        garment_category: gen.variant.product.category,
        tier: gen.tier,
        request_id: gen.id,
      });
      await this.prisma.generation.update({ where: { id }, data: { status: "GUARDING" } });

      if (r.status !== "DELIVERED" || !r.image_b64) {
        // Guard failed: never shown, never charged; logged for the AI quality review (plan §15.2).
        await this.prisma.generation.update({ where: { id }, data: { status: "WITHHELD", guard: r.guard, latencyMs: Date.now() - started } });
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
    } catch (e) {
      await this.prisma.generation.update({ where: { id }, data: { status: "FAILED", guard: { error: (e as Error).message } } });
      throw e;
    }
  }
}
