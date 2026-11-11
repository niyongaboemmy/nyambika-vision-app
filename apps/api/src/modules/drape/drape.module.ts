import { BadRequestException, Body, Controller, Get, HttpException, Injectable, Module, NotFoundException, Param, Post } from "@nestjs/common";
import { Access, AuthUser, CurrentUser, Public } from "../../common/auth";
import { AiClient } from "../../common/ai.client";
import { MeteringService } from "../../common/metering.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { MeasurementsService } from "../tailor/measurements";
import { TailorModule } from "../tailor/tailor.module";
import { Twin3dModule } from "../twin3d/twin3d.module";
import { Twin3dService } from "../twin3d/twin3d.service";
import {
  bodyFields,
  DRAPE_SPIKE,
  EvalInput,
  garmentForCategory,
  paramsFromSpec,
  PatternPreviewInput,
  toEvalRecord,
  TwinDrapeInput,
  type DrapeEvalReport,
} from "./drape-rules";

interface SimResult {
  glb_b64: string;
  heatmap_glb_b64: string;
  poster_b64?: string;
  heatmap_poster_b64?: string;
  fit: Record<string, unknown>;
  metrics: Record<string, unknown>;
  pattern: Record<string, unknown>;
  legend: { band: string; rgb: number[] }[];
  latency_s: number;
  model_id: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * R4 spike (not committed). Nothing here is stored: GLBs go straight back to the caller and are dropped.
 * Shopper: drape on their own 3D twin body (AVATAR_3D consent, own view only).
 * Tailor: drape on a synthetic, neutral-tone body sized from the shopper's measurements, only while the
 * measurement share for that custom order is active (MeasurementsService.forTailor enforces + audits it).
 */
@Injectable()
export class DrapeSpikeService {
  constructor(
    private prisma: PrismaService,
    private ai: AiClient,
    private access: Access,
    private metering: MeteringService,
    private twin3d: Twin3dService,
    private measurements: MeasurementsService,
  ) {}

  async enabled() {
    const f = await this.prisma.featureFlag.findUnique({ where: { key: DRAPE_SPIKE.flag } });
    return Boolean(f?.enabled);
  }

  private async requireEnabled() {
    if (!(await this.enabled())) throw new NotFoundException({ message: "This experiment is off.", code: "SPIKE_OFF" });
    await this.metering.assertBudgetOpen();
  }

  private view(r: SimResult) {
    return {
      glb: `data:model/gltf-binary;base64,${r.glb_b64}`,
      heatmapGlb: `data:model/gltf-binary;base64,${r.heatmap_glb_b64}`,
      poster: r.poster_b64 ? `data:image/png;base64,${r.poster_b64}` : null,
      heatmapPoster: r.heatmap_poster_b64 ? `data:image/png;base64,${r.heatmap_poster_b64}` : null,
      fit: r.fit,
      metrics: r.metrics,
      pattern: r.pattern,
      legend: r.legend,
      latencyS: r.latency_s,
      modelId: r.model_id,
      experimental: true,
      disclaimer: DRAPE_SPIKE.disclaimer,
    };
  }

  async status() {
    const enabled = await this.enabled();
    return { enabled, flag: DRAPE_SPIKE.flag, modelId: DRAPE_SPIKE.modelId, disclaimer: DRAPE_SPIKE.disclaimer };
  }

  async twin(userId: string, body: unknown) {
    await this.requireEnabled();
    const input = parse(TwinDrapeInput, body);
    const st = await this.twin3d.state(userId);
    if (!st.consent) throw new BadRequestException({ message: "Turn on your 3D twin first.", code: "NO_CONSENT" });
    const avatar = await this.twin3d.ready(userId);
    if (!avatar) throw new BadRequestException({ message: "Build your 3D twin first.", code: "NO_AVATAR" });
    const p = this.twin3d.params(avatar);
    const size = input.size ?? (p.body_size && ["S", "M", "L", "XL", "XXL", "3XL"].includes(p.body_size) ? p.body_size : "M");
    const r = await this.ai.post<SimResult>(
      "/v1/drape/simulate",
      { garment: input.garment, size, fabric: input.fabric, params: input.params, body_measurements: p.measurements ?? {}, body_size: p.body_size ?? null, skin_rgb: p.skin_rgb ?? null, request_id: `drape-twin-${userId}-${Date.now()}` },
      DRAPE_SPIKE.timeoutMs,
    );
    return { ...this.view(r), size, garment: input.garment };
  }

  async tailorPreview(userId: string, customOrderId: string, body: unknown) {
    await this.requireEnabled();
    const input = parse(PatternPreviewInput, body);
    // Enforces page MANAGE + an active share for exactly this order, and writes MEASUREMENT_VIEWED to the audit log.
    const shared = await this.measurements.forTailor(userId, customOrderId);
    const co = await this.prisma.customOrder.findUniqueOrThrow({ where: { id: customOrderId } });
    const product = co.productId ? await this.prisma.product.findUnique({ where: { id: co.productId }, select: { category: true } }) : null;
    const garment = input.garment ?? garmentForCategory(product?.category);
    const m = bodyFields(shared.measurements as Record<string, unknown>);
    const spec = (co.spec ?? {}) as { length?: string | null; sleeve?: string | null; hue?: number | null };
    const defaults = paramsFromSpec(garment, spec as never, m.heightCm);
    const params = { ...defaults, ...input.params };
    const r = await this.ai.post<SimResult>(
      "/v1/drape/simulate",
      // Made-to-measure: the pattern is graded from the shared measurements; the body is synthetic (neutral tone).
      { garment, garment_measurements: m, body_measurements: m, fabric: input.fabric, params, hue: spec.hue ?? null, request_id: `drape-tailor-${customOrderId}-${Date.now()}` },
      DRAPE_SPIKE.timeoutMs,
    );
    await this.access.audit(userId, "DRAPE_SPIKE_PREVIEW", { customOrderId, garment, params, modelId: r.model_id }, co.pageId);
    return { ...this.view(r), garment, params, defaults, shareExpiresAt: shared.expiresAt };
  }

  /** Host: run the NLB-style harness on the gateway and store the result as a model-registry eval record. */
  async runEval(userId: string, body: unknown) {
    await this.access.requireHost(userId);
    const { scope } = parse(EvalInput, body);
    const started = await this.ai.post<{ job_id: string }>("/v1/drape/eval", { scope }, 10_000);
    const end = Date.now() + DRAPE_SPIKE.evalTimeoutMs[scope];
    let job: { status: string; report?: DrapeEvalReport; error?: string } = { status: "RUNNING" };
    while (Date.now() < end) {
      job = await this.ai.get(`/v1/drape/eval/${started.job_id}`);
      if (job.status !== "RUNNING") break;
      await sleep(1000);
    }
    if (job.status !== "DONE" || !job.report) throw new HttpException({ message: `Drape eval ${job.status.toLowerCase()}: ${job.error ?? "timed out"}`, code: "EVAL_FAILED" }, 502);
    const row = await this.prisma.modelEval.create({ data: toEvalRecord(job.report, userId) });
    await this.access.audit(userId, "admin.drape_spike_eval", { evalId: row.id, scope, passed: row.passed, gate: job.report.gate });
    return { id: row.id, passed: row.passed, summary: row.summary, createdAt: row.createdAt };
  }

  async evals(userId: string) {
    await this.access.requireHost(userId);
    return this.prisma.modelEval.findMany({
      where: { modelId: DRAPE_SPIKE.modelId, kind: DRAPE_SPIKE.evalKind },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, passed: true, summary: true, createdAt: true, modelVersion: true },
    });
  }
}

@Controller("drape-spike")
export class DrapeSpikeController {
  constructor(private svc: DrapeSpikeService) {}

  @Public()
  @Get("status")
  status() {
    return this.svc.status();
  }

  @Post("twin")
  twin(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.svc.twin(user.id, body);
  }

  @Post("custom-orders/:id/preview")
  preview(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    return this.svc.tailorPreview(user.id, id, body);
  }

  @Post("eval")
  runEval(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.svc.runEval(user.id, body);
  }

  @Get("evals")
  evals(@CurrentUser() user: AuthUser) {
    return this.svc.evals(user.id);
  }
}

@Module({ imports: [Twin3dModule, TailorModule], controllers: [DrapeSpikeController], providers: [DrapeSpikeService] })
export class DrapeSpikeModule {}
