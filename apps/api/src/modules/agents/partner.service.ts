import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PARTNER_MODELS, PartnerTryonRequest } from "@nyambika/contracts";
import { Prisma, type PartnerTryonJob } from "@prisma/client";
import { Queue, Worker, type Job } from "bullmq";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { AiClient } from "../../common/ai.client";
import { MeteringService } from "../../common/metering.service";
import { aiSpend } from "../../common/metrics";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { decryptField, encryptField } from "../tailor/crypto";
import type { AgentContext } from "./access";
import { monthRange } from "./keys";
import { admit, statementCsv, type ContractTerms } from "./metering";
import { WEBHOOK_ATTEMPTS, WEBHOOK_BACKOFF_MS, signWebhook } from "./webhook";

const QUEUE = "partner-tryon";
const RESULT_TTL_SEC = 300;
const MAX_GARMENT_BYTES = 10 * 1024 * 1024;

interface TryOnResult {
  status: "DELIVERED" | "WITHHELD";
  image_b64: string | null;
  guard: { passed: boolean; reasons: string[] } & Record<string, unknown>;
  c2pa: { manifest: Record<string, unknown>; signature: string; sha256: string } | null;
  model_version: string;
}

/** Diagonal "SANDBOX" watermark for partner sandbox keys (results are not for production use). */
export async function sandboxWatermark(image: Buffer) {
  const meta = await sharp(image).metadata();
  const w = meta.width ?? 512;
  const h = meta.height ?? 512;
  const fs = Math.round(Math.min(w, h) / 9);
  const rows = Array.from({ length: 7 }, (_, i) => `<text x="${-w * 0.2}" y="${(i + 0.5) * (h / 5)}" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="${fs}" fill="#fff" fill-opacity=".28" stroke="#000" stroke-opacity=".18">SANDBOX · NYAMBIKA · SANDBOX</text>`).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g transform="rotate(-28 ${w / 2} ${h / 2})">${rows}</g></svg>`);
  return sharp(image).composite([{ input: svg, left: 0, top: 0 }]).png().toBuffer();
}

/** Webhook targets must be public HTTPS in production (no SSRF into the private network). */
export function webhookUrlAllowed(url: string, production = process.env.NODE_ENV === "production") {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!production) return u.protocol === "https:" || u.protocol === "http:";
  if (u.protocol !== "https:") return false;
  const h = u.hostname;
  return !(h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h === "[::1]");
}

/**
 * Try-on as a Service (E37, FR-AGT-06). Async jobs on BullMQ: garment check → try-on on a synthetic
 * model → guard → C2PA → (sandbox watermark) → metering against the partner contract → signed webhook.
 */
@Injectable()
export class PartnerService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("PartnerTryon");
  private queue!: Queue;
  private worker?: Worker;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private metering: MeteringService,
  ) {}

  onModuleInit() {
    const connection = { url: config.redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue(QUEUE, { connection });
    if (process.env.GENERATION_WORKER !== "0") {
      this.worker = new Worker(QUEUE, (job) => (job.name === "webhook" ? this.deliverWebhook(job) : this.run(job.data.id as string)), { connection, concurrency: 2 });
      this.worker.on("failed", (job, err) => {
        if (job?.name === "webhook" && job.attemptsMade >= (job.opts.attempts ?? 1)) {
          void this.prisma.partnerTryonJob.update({ where: { id: job.data.id }, data: { webhookStatus: "FAILED" } }).catch(() => undefined);
        }
        this.log.warn(`${job?.name} ${job?.data?.id} failed: ${err.message}`);
      });
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  async contract(clientId: string): Promise<ContractTerms | null> {
    return this.prisma.partnerContract.findUnique({ where: { clientId } });
  }

  /** Jobs that count against the month's quota: live, not withheld or failed. */
  async usedThisMonth(clientId: string, now = new Date()) {
    const { start, end } = monthRange(now.toISOString().slice(0, 7));
    return this.prisma.partnerTryonJob.count({ where: { clientId, sandbox: false, status: { notIn: ["WITHHELD", "FAILED"] }, createdAt: { gte: start, lt: end } } });
  }

  async create(agent: AgentContext, body: unknown, idempotencyKey?: string) {
    const clientId = agent.client!.id;
    if (idempotencyKey) {
      const prior = await this.prisma.partnerTryonJob.findUnique({ where: { clientId_idempotencyKey: { clientId, idempotencyKey } } });
      if (prior) return this.view(prior);
    }
    const req = parse(PartnerTryonRequest, body);
    if (req.webhook_url && !webhookUrlAllowed(req.webhook_url)) throw new BadRequestException({ message: "webhook_url must be a public https URL", code: "WEBHOOK_URL_NOT_ALLOWED" });
    const sandbox = agent.key!.env === "SANDBOX";
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const [used, sandboxToday] = await Promise.all([this.usedThisMonth(clientId), this.prisma.partnerTryonJob.count({ where: { clientId, sandbox: true, createdAt: { gte: day } } })]);
    const a = admit(await this.contract(clientId), sandbox, used, sandboxToday);
    if (!a.allowed) throw new HttpException({ message: a.message, code: a.code }, a.code === "QUOTA_EXCEEDED" || a.code === "SANDBOX_DAILY_CAP" ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.PAYMENT_REQUIRED);
    await this.metering.assertBudgetOpen();

    const garment = Buffer.from(req.garment_image_b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (garment.length > MAX_GARMENT_BYTES) throw new BadRequestException({ message: "Garment image over 10 MB", code: "IMAGE_TOO_LARGE" });
    const meta = await sharp(garment).metadata().catch(() => null);
    if (!meta || !["png", "jpeg", "webp"].includes(meta.format ?? "") || (meta.width ?? 0) < 128 || (meta.height ?? 0) < 128) {
      throw new BadRequestException({ message: "Send a PNG, JPEG or WebP garment photo of at least 128×128 px", code: "BAD_IMAGE" });
    }
    const id = `ptj_${randomBytes(10).toString("hex")}`;
    const garmentPath = await this.storage.put(`private/partner/${clientId}/${id}-garment.png`, await sharp(garment).rotate().png().toBuffer());
    let job: PartnerTryonJob;
    try {
      job = await this.prisma.partnerTryonJob.create({
        data: {
          id,
          clientId,
          keyId: agent.key!.id,
          sandbox,
          modelId: req.model_id,
          category: req.garment_category,
          garmentPath,
          clientReference: req.client_reference ?? null,
          webhookUrl: req.webhook_url ?? null,
          webhookStatus: req.webhook_url ? "PENDING" : "NONE",
          overage: a.overage,
          priceRwf: a.priceRwf,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
    } catch (e) {
      if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return this.view(await this.prisma.partnerTryonJob.findUniqueOrThrow({ where: { clientId_idempotencyKey: { clientId, idempotencyKey } } }));
      }
      throw e;
    }
    await this.queue.add("render", { id }, { jobId: id, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 });
    return this.view(job);
  }

  async get(clientId: string, id: string) {
    const j = await this.prisma.partnerTryonJob.findFirst({ where: { id, clientId } });
    if (!j) throw new NotFoundException({ message: "No such job", code: "NOT_FOUND" });
    return j;
  }

  private async model(tier: "HD") {
    const m = await this.prisma.modelVersion.findFirst({ where: { tier, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    return m ?? { id: "local-compositor@1.0-hd", costRwf: 110 };
  }

  /** Worker: the full guarded pipeline. Only DELIVERED jobs are billed. */
  async run(id: string) {
    const job = await this.prisma.partnerTryonJob.update({ where: { id }, data: { status: "GENERATING" } });
    const started = Date.now();
    try {
      const persona = PARTNER_MODELS.find((m) => m.id === job.modelId)?.persona ?? 2;
      const model = await readFile(join(this.storage.root, "personas", `persona-${persona}.png`));
      const garment = await this.storage.read(job.garmentPath);
      const assess = await this.ai.post<{ readiness: string; notes: string[]; cutout_b64: string }>("/v1/garment/assess", { image_b64: garment.toString("base64"), category: job.category });
      if (assess.readiness === "NOT_SUPPORTED" || !assess.cutout_b64) {
        await this.prisma.partnerTryonJob.update({ where: { id }, data: { status: "FAILED", error: `Garment not supported: ${assess.notes.join("; ") || "try a flat, well-lit photo"}`, latencyMs: Date.now() - started, overage: false, priceRwf: 0 } });
        return this.queueWebhook(id);
      }
      const hd = await this.model("HD");
      const r = await this.ai.post<TryOnResult>("/v1/tryon", { twin_b64: model.toString("base64"), garment_b64: assess.cutout_b64, garment_category: job.category, tier: "HD", request_id: id });
      await this.prisma.partnerTryonJob.update({ where: { id }, data: { status: "GUARDING", modelVersion: r.model_version } });
      if (r.status !== "DELIVERED" || !r.image_b64) {
        // Guard failed: never returned, never billed; logged for AI quality review like shopper looks.
        await this.prisma.partnerTryonJob.update({ where: { id }, data: { status: "WITHHELD", guard: r.guard as Prisma.InputJsonValue, latencyMs: Date.now() - started, overage: false, priceRwf: 0 } });
        await this.prisma.moderationItem.create({ data: { kind: "PARTNER_GUARD_WITHHELD", refId: id, reason: r.guard.reasons.join("; ") || "Guard failed" } });
        return this.queueWebhook(id);
      }
      let image = Buffer.from(r.image_b64, "base64");
      if (job.sandbox) image = await sandboxWatermark(image);
      const outputPath = await this.storage.put(`private/partner/${job.clientId}/${id}.png`, image);
      const c2pa = r.c2pa ? { sha256: r.c2pa.sha256, signature: r.c2pa.signature, manifest: r.c2pa.manifest, ...(job.sandbox ? { derivative: "sandbox-watermark" } : {}) } : null;
      await this.prisma.partnerTryonJob.update({
        where: { id },
        data: { status: "DELIVERED", outputPath, guard: r.guard as Prisma.InputJsonValue, c2pa: c2pa as Prisma.InputJsonValue, billable: !job.sandbox, costRwf: hd.costRwf, latencyMs: Date.now() - started, deliveredAt: new Date() },
      });
      await this.metering.record("PARTNER_TRYON", job.sandbox ? "SANDBOX" : job.overage ? "PARTNER_OVERAGE" : "PARTNER_CONTRACT", hd.costRwf, null, null, id);
      aiSpend.inc({ kind: "PARTNER_TRYON" }, hd.costRwf);
    } catch (e) {
      await this.prisma.partnerTryonJob.update({ where: { id }, data: { status: "FAILED", error: (e as Error).message.slice(0, 300), latencyMs: Date.now() - started, overage: false, priceRwf: 0 } });
    }
    return this.queueWebhook(id);
  }

  private async queueWebhook(id: string) {
    const j = await this.prisma.partnerTryonJob.findUniqueOrThrow({ where: { id } });
    if (!j.webhookUrl) return;
    await this.queue.add("webhook", { id }, { jobId: `wh-${id}`, attempts: WEBHOOK_ATTEMPTS, backoff: { type: "exponential", delay: WEBHOOK_BACKOFF_MS }, removeOnComplete: 1000, removeOnFail: 5000 });
  }

  /** POST the signed result to the partner. Throws (→ BullMQ retry with backoff) on non-2xx. */
  async deliverWebhook(job: Job) {
    const j = await this.prisma.partnerTryonJob.findUniqueOrThrow({ where: { id: job.data.id as string } });
    const client = await this.prisma.apiClient.findUniqueOrThrow({ where: { id: j.clientId } });
    if (!j.webhookUrl) return;
    if (!client.webhookSecretSealed) {
      await this.prisma.partnerTryonJob.update({ where: { id: j.id }, data: { webhookStatus: "FAILED", error: j.error ?? "No webhook secret configured" } });
      return;
    }
    const body = JSON.stringify({ id: `evt_${j.id}`, type: "tryon.finished", created: Math.floor(Date.now() / 1000), data: this.view(j) });
    await this.prisma.partnerTryonJob.update({ where: { id: j.id }, data: { webhookAttempts: { increment: 1 }, webhookLastAt: new Date() } });
    const res = await fetch(j.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "nyambika-signature": signWebhook(body, decryptField(client.webhookSecretSealed)), "user-agent": "Nyambika-Webhooks/1.0" },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
    await this.prisma.partnerTryonJob.update({ where: { id: j.id }, data: { webhookStatus: "DELIVERED" } });
  }

  // ── Views, signed result links, statements ───────────────────────────────────────────────────

  signResult(id: string, exp = Math.floor(Date.now() / 1000) + RESULT_TTL_SEC) {
    const sig = createHmac("sha256", config.jwtSecret).update(`partner-result:${id}:${exp}`).digest("hex");
    return { exp, sig, path: `/v1/partner/results/${id}?exp=${exp}&sig=${sig}` };
  }

  verifyResult(id: string, exp: string, sig: string) {
    if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return false;
    const expected = createHmac("sha256", config.jwtSecret).update(`partner-result:${id}:${exp}`).digest();
    const given = Buffer.from(sig ?? "", "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async resultImage(id: string) {
    const j = await this.prisma.partnerTryonJob.findUnique({ where: { id } });
    if (!j?.outputPath || j.status !== "DELIVERED") throw new NotFoundException();
    return this.storage.read(j.outputPath);
  }

  view(j: PartnerTryonJob, base = config.selfUrl) {
    const signed = j.status === "DELIVERED" && j.outputPath ? this.signResult(j.id) : null;
    const guard = j.guard as { passed?: boolean; reasons?: string[] } | null;
    const c2pa = j.c2pa as { sha256?: string } | null;
    return {
      id: j.id,
      object: "tryon_job" as const,
      status: j.status.toLowerCase() as "queued" | "generating" | "guarding" | "delivered" | "withheld" | "failed",
      environment: (j.sandbox ? "sandbox" : "live") as "sandbox" | "live",
      model_id: j.modelId,
      client_reference: j.clientReference,
      result: signed
        ? {
            image_url: `${base}${signed.path}`,
            expires_at: new Date(signed.exp * 1000).toISOString(),
            watermarked: j.sandbox,
            ai_label: "AI preview" as const,
            c2pa: { signed: Boolean(c2pa?.sha256), sha256: c2pa?.sha256 ?? null, model: j.modelVersion },
          }
        : null,
      guard: guard && typeof guard.passed === "boolean" ? { passed: guard.passed, reasons: guard.reasons ?? [] } : null,
      billing: { billable: j.billable, band: (j.billable ? (j.overage ? "overage" : "included") : "none") as "included" | "overage" | "none", price: { amount: j.billable ? j.priceRwf : 0, currency: "RWF" as const } },
      webhook: j.webhookUrl ? { status: j.webhookStatus.toLowerCase(), attempts: j.webhookAttempts } : null,
      error: j.status === "FAILED" ? j.error : null,
      created_at: j.createdAt.toISOString(),
      delivered_at: j.deliveredAt?.toISOString() ?? null,
    };
  }

  async statement(clientId: string, month?: string) {
    const client = await this.prisma.apiClient.findUniqueOrThrow({ where: { id: clientId } });
    const r = monthRange(month);
    const jobs = await this.prisma.partnerTryonJob.findMany({ where: { clientId, createdAt: { gte: r.start, lt: r.end } }, orderBy: { createdAt: "asc" } });
    return { month: r.month, client, ...statementCsv(client.name, r.month, await this.contract(clientId), jobs) };
  }

  /** Rotate the webhook secret; the plain secret is returned once and stored sealed. */
  async rotateWebhookSecret(clientId: string) {
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    await this.prisma.apiClient.update({ where: { id: clientId }, data: { webhookSecretSealed: encryptField(secret) } });
    return secret;
  }
}
