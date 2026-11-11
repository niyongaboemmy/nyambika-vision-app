import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import type { Avatar3d, AvatarFit3d, Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AiClient } from "../../common/ai.client";
import { ConsentService } from "../../common/consent.service";
import { kigaliDayStart, nextKigaliMidnight } from "../../common/kigali-day";
import { aiSpend } from "../../common/metrics";
import { MeteringService } from "../../common/metering.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { config } from "../../config";
import { GenerationService } from "../looks/generation.service";
import { MeasurementsService } from "../tailor/measurements";
import { decryptField, encryptField } from "../tailor/crypto";
import { PERSONA_COUNT, TwinService } from "../twin/twin.module";
import {
  AVATAR_3D,
  AVATAR_COST,
  AVATAR_LABEL,
  avatarBase,
  BUILDING,
  canBuild,
  FIT_COST,
  FIT_DISCLAIMER,
  fitBase,
  fitSizes,
  mapJobStatus,
  nextVersion,
  progressFor,
  supports3dTryOn,
  validateCapture,
  type AvatarSource,
  type AvatarStatus,
} from "./twin3d-rules";

export const AVATAR_JOB = "avatar3d";
export const FIT_JOB = "avatarfit";
const POLL_MS = 400;
const JOB_TIMEOUT_MS = 120_000;

interface GatewayJob {
  job_id?: string;
  status: string;
  progress: number;
  error?: string;
  result?: BuildResult;
}
interface BuildResult {
  status: "DONE" | "REJECTED" | "WITHHELD";
  glb_b64?: string;
  poster_b64?: string;
  triangles?: number;
  joints?: number;
  bytes?: number;
  skin_rgb?: number[];
  skin_hex?: string;
  measurements_used?: Record<string, number>;
  measurement_sources?: string[];
  size_estimate?: string;
  body_size?: string;
  eval?: Record<string, unknown> & { passed: boolean };
  checks?: { ok: boolean; checks: Record<string, { pass: boolean; note: string }> } | null;
  model_version: string;
}
interface DressResult {
  glb_b64: string;
  poster_b64: string;
  fit: Record<string, unknown>;
  triangles: number;
  bytes: number;
  model_version: string;
}

export interface AvatarParams {
  measurements?: Record<string, number>;
  skin_rgb?: number[];
  size_estimate?: string;
  body_size?: string;
  skin_hex?: string;
}

interface CaptureBundle {
  yaws: number[];
  frames: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 3D twin (E33, FR-AVA-01..06) and 3D try-on (E34, FR-FIT-01/04).
 * Separate AVATAR_3D consent, encrypted capture/params/GLB at rest, owner-only signed URLs, versioned builds on the
 * shared BullMQ generation queue (job "avatar3d"), fits on job "avatarfit", metered as AVATAR_3D / TRYON_3D.
 * Capture frames are deleted as soon as the build finishes (only the body parameters are kept).
 */
@Injectable()
export class Twin3dService implements OnModuleInit {
  private log = new Logger("Twin3d");

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private consent: ConsentService,
    private metering: MeteringService,
    private generations: GenerationService,
    private twins: TwinService,
    private measurements: MeasurementsService,
  ) {}

  onModuleInit() {
    this.generations.handle(AVATAR_JOB, (job) => this.process(job.data.id as string));
    this.generations.handle(FIT_JOB, (job) => this.processFit(job.data.id as string));
  }

  // ── reads ─────────────────────────────────────────────────────────────────
  current(userId: string) {
    return this.prisma.avatar3d.findFirst({ where: { userId, deletedAt: null }, orderBy: { version: "desc" } });
  }

  async ready(userId: string) {
    return this.prisma.avatar3d.findFirst({ where: { userId, deletedAt: null, status: "READY" }, orderBy: { version: "desc" } });
  }

  async state(userId: string) {
    const [consented, latest, ready, twin, profile, flag] = await Promise.all([
      this.consent.has(userId, AVATAR_3D),
      this.current(userId),
      this.ready(userId),
      this.twins.current(userId),
      this.measurements.profile(userId),
      this.prisma.featureFlag.findUnique({ where: { key: "ar.mirror_pilot" } }),
    ]);
    return {
      consent: consented,
      avatar: latest ? this.view(latest) : null,
      ready: ready && ready.id !== latest?.id ? this.view(ready) : null,
      hasPhotoTwin: Boolean(twin),
      twinSize: twin?.size ?? null,
      hasProfile: Boolean(profile && Object.keys(profile).length),
      personas: process.env.NODE_ENV === "production" ? 0 : PERSONA_COUNT,
      arMirrorPilot: Boolean(flag?.enabled),
      label: AVATAR_LABEL,
      disclaimer: FIT_DISCLAIMER,
    };
  }

  // ── consent ───────────────────────────────────────────────────────────────
  async setConsent(userId: string, granted: boolean, locale: string) {
    await this.consent.record(userId, AVATAR_3D, granted, locale);
    // Withdrawing the 3D twin consent deletes the 3D twin (FR-AVA-02: deletable; nothing kept without consent).
    const removed = granted ? 0 : await this.deleteFor(userId);
    return { ...(await this.state(userId)), removed };
  }

  private async requireConsent(userId: string) {
    if (!(await this.consent.has(userId, AVATAR_3D))) {
      throw new ForbiddenException({ message: "Turn on the 3D twin consent first.", code: "CONSENT_REQUIRED", purpose: AVATAR_3D });
    }
  }

  private async gate(userId: string) {
    const d = kigaliDayStart();
    const [consented, buildsToday, latest] = await Promise.all([
      this.consent.has(userId, AVATAR_3D),
      this.prisma.avatar3d.count({ where: { userId, createdAt: { gte: d }, status: { notIn: ["REJECTED", "FAILED"] } } }),
      this.current(userId),
    ]);
    const g = canBuild({ consent: consented, buildsToday, building: Boolean(latest && BUILDING.has(latest.status as AvatarStatus)) });
    if (!g.ok) {
      throw new HttpException({ message: g.message, code: g.code, ...(g.code === "CONSENT_REQUIRED" ? { purpose: AVATAR_3D } : g.code === "DAILY_CAP" ? { resetsAt: nextKigaliMidnight().toISOString(), scope: "AVATAR_3D" } : {}) }, g.code === "CONSENT_REQUIRED" ? HttpStatus.FORBIDDEN : HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.metering.assertBudgetOpen();
  }

  // ── builds ────────────────────────────────────────────────────────────────
  private async create(userId: string, source: AvatarSource, opts: { persona?: number; bundle?: CaptureBundle; params?: AvatarParams }) {
    const consentRow = await this.prisma.consentRecord.findFirst({ where: { userId, purpose: AVATAR_3D, granted: true }, orderBy: { createdAt: "desc" } });
    const previous = await this.prisma.avatar3d.findFirst({ where: { userId }, orderBy: { version: "desc" } });
    const version = nextVersion(previous);
    const data: Prisma.Avatar3dUncheckedCreateInput = {
      userId,
      source,
      version,
      persona: opts.persona ?? null,
      consentId: consentRow!.id,
      status: "QUEUED",
      progress: 5,
      paramsSealed: opts.params ? encryptField(JSON.stringify(opts.params)) : null,
    };
    if (opts.bundle) {
      const path = `${avatarBase(userId, version)}/capture.enc`;
      const { iv, authTag } = await this.storage.putEncrypted(path, Buffer.from(JSON.stringify(opts.bundle)));
      Object.assign(data, { framesPath: path, framesIv: iv, framesTag: authTag, frameCount: opts.bundle.frames.length });
    }
    const row = await this.prisma.avatar3d.create({ data });
    await this.generations.enqueue(AVATAR_JOB, { id: row.id }, `avatar3d-${row.id}`);
    return this.view(row);
  }

  async capture(userId: string, frames: { buffer: Buffer; mimetype: string; size: number }[], yaws: number[]) {
    await this.gate(userId);
    const problems = validateCapture(frames.map((f) => ({ bytes: f.size, mime: f.mimetype })), yaws);
    if (problems.length) throw new BadRequestException({ message: problems[0], problems });
    return this.create(userId, "TURNAROUND", { bundle: { yaws, frames: frames.map((f) => f.buffer.toString("base64")) } });
  }

  /** Synthetic persona turnaround frames (dev/testing, plan §4.6). Cached as public synthetic media. */
  async turnaround(n: number) {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    const i = Math.min(Math.max(1, Math.round(n)), PERSONA_COUNT);
    const dir = `public/personas/turnaround/persona-${i}`;
    let meta: { yaws: number[]; count: number } | null = null;
    try {
      meta = JSON.parse((await this.storage.read(`${dir}/meta.json`)).toString());
    } catch {
      const r = await this.ai.post<{ frames_b64: string[]; yaw_deg: number[] }>("/v1/avatar/turnaround", {
        persona_b64: (await readFile(join(this.storage.root, "personas", `persona-${i}.png`))).toString("base64"),
        frames: 24,
      });
      for (const [k, f] of r.frames_b64.entries()) await this.storage.put(`${dir}/${String(k).padStart(2, "0")}.jpg`, Buffer.from(f, "base64"));
      meta = { yaws: r.yaw_deg, count: r.frames_b64.length };
      await this.storage.put(`${dir}/meta.json`, Buffer.from(JSON.stringify(meta)));
    }
    return {
      persona: i,
      synthetic: true,
      yaws: meta!.yaws,
      frames: Array.from({ length: meta!.count }, (_, k) => this.storage.publicUrl(`${dir}/${String(k).padStart(2, "0")}.jpg`)!),
    };
  }

  async persona(userId: string, n: number) {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    await this.gate(userId);
    const t = await this.turnaround(n);
    const frames: string[] = [];
    for (const url of t.frames) frames.push((await this.storage.read(url.replace(/^\/api\/files\//, ""))).toString("base64"));
    return this.create(userId, "PERSONA", { persona: t.persona, bundle: { yaws: t.yaws, frames } });
  }

  /** FR-AVA-06: body-shape avatar from measurements only (profile, else the photo twin's size), chosen skin tone. */
  async fromMeasurements(userId: string, skinRgb: number[], overrides?: Record<string, number>) {
    await this.gate(userId);
    return this.create(userId, "MEASUREMENTS", { params: { skin_rgb: skinRgb, measurements: overrides } });
  }

  /** FR-AVA-03: adjust body measurements → a new version with the same skin tone (no new capture). */
  async adjust(userId: string, overrides: Record<string, number>) {
    const base = await this.ready(userId);
    if (!base) throw new BadRequestException("Build your 3D twin first.");
    await this.gate(userId);
    const p = this.params(base);
    return this.create(userId, base.source === "MEASUREMENTS" ? "MEASUREMENTS" : (base.source as AvatarSource), {
      persona: base.persona ?? undefined,
      params: { skin_rgb: p.skin_rgb, measurements: { ...(p.measurements ?? {}), ...overrides } },
    });
  }

  params(a: Pick<Avatar3d, "paramsSealed">): AvatarParams {
    return a.paramsSealed ? (JSON.parse(decryptField(a.paramsSealed)) as AvatarParams) : {};
  }

  async get(userId: string, id: string) {
    const a = await this.prisma.avatar3d.findFirst({ where: { id, userId, deletedAt: null } });
    if (!a) throw new NotFoundException();
    return this.view(a);
  }

  /** Worker: decrypt capture → gateway job (poll) → encrypt GLB + poster → meter → READY; frames deleted. */
  async process(id: string) {
    const row = await this.prisma.avatar3d.update({ where: { id }, data: { status: "BUILDING", progress: 10 } });
    try {
      const given = this.params(row);
      const [profile, twin] = await Promise.all([this.measurements.profile(row.userId), this.twins.current(row.userId)]);
      const bundle: CaptureBundle | null = row.framesPath
        ? JSON.parse((await this.storage.readEncrypted(row.framesPath, row.framesIv!, row.framesTag!)).toString())
        : null;
      const started = await this.ai.post<GatewayJob>("/v1/avatar/build", {
        frames_b64: bundle?.frames ?? [],
        yaw_deg: bundle?.yaws ?? [],
        measurements: { ...(profile ?? {}), ...(given.measurements ?? {}) },
        size_estimate: twin?.size ?? undefined,
        skin_rgb: bundle ? undefined : given.skin_rgb,
        request_id: `avatar3d-${id}`,
      });
      await this.prisma.avatar3d.update({ where: { id }, data: { gatewayJob: started.job_id } });
      const job = await this.poll(id, started.job_id!);
      if (row.framesPath) {
        await this.storage.remove(row.framesPath);
        await this.prisma.avatar3d.update({ where: { id }, data: { framesPath: null, framesIv: null, framesTag: null } });
      }
      const r = job.result;
      const status = job.status === "FAILED" || !r ? "FAILED" : mapJobStatus(r.status);
      if (status !== "READY" || !r?.glb_b64) {
        return await this.prisma.avatar3d.update({
          where: { id },
          data: { status, progress: 100, checks: (r?.checks ?? undefined) as Prisma.InputJsonValue | undefined, eval: (r?.eval ?? undefined) as Prisma.InputJsonValue | undefined, modelVersion: r?.model_version ?? "", error: job.error?.slice(0, 300) ?? null },
        });
      }
      const base = avatarBase(row.userId, row.version);
      const glb = await this.storage.putEncrypted(`${base}/avatar.glb.enc`, Buffer.from(r.glb_b64, "base64"));
      const poster = await this.storage.putEncrypted(`${base}/poster.png.enc`, Buffer.from(r.poster_b64!, "base64"));
      const params: AvatarParams = {
        measurements: r.measurements_used,
        skin_rgb: r.skin_rgb,
        skin_hex: r.skin_hex,
        size_estimate: r.size_estimate,
        body_size: r.body_size,
      };
      await this.metering.record(AVATAR_COST.kind, "FREE_QUOTA", AVATAR_COST.costRwf, row.userId, null, id);
      aiSpend.inc({ kind: AVATAR_COST.kind }, AVATAR_COST.costRwf);
      const done = await this.prisma.avatar3d.update({
        where: { id },
        data: {
          status: "READY",
          progress: 100,
          glbPath: `${base}/avatar.glb.enc`,
          glbIv: glb.iv,
          glbTag: glb.authTag,
          posterPath: `${base}/poster.png.enc`,
          posterIv: poster.iv,
          posterTag: poster.authTag,
          bytes: r.bytes,
          triangles: r.triangles,
          joints: r.joints,
          checks: (r.checks ?? undefined) as Prisma.InputJsonValue | undefined,
          eval: { ...r.eval, measurementSources: r.measurement_sources ?? [] } as Prisma.InputJsonValue,
          modelVersion: r.model_version,
          paramsSealed: encryptField(JSON.stringify(params)),
          readyAt: new Date(),
        },
      });
      // Versioning: the new version replaces older ones (bytes and fits purged), like the photo twin.
      const older = await this.prisma.avatar3d.findMany({ where: { userId: row.userId, deletedAt: null, id: { not: id }, version: { lt: row.version } } });
      for (const o of older) await this.purge(o);
      return done;
    } catch (e) {
      this.log.warn(`avatar ${id} failed: ${(e as Error).message}`);
      await this.prisma.avatar3d.update({ where: { id }, data: { status: "FAILED", progress: 100, error: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }

  private async poll(id: string, jobId: string): Promise<GatewayJob> {
    const end = Date.now() + JOB_TIMEOUT_MS;
    let last = -1;
    while (Date.now() < end) {
      const j = await this.ai.get<GatewayJob>(`/v1/avatar/jobs/${jobId}`);
      if (j.status !== "QUEUED" && j.status !== "RUNNING") return j;
      if (j.progress !== last) {
        last = j.progress;
        await this.prisma.avatar3d.update({ where: { id }, data: { progress: progressFor(j.progress) } });
      }
      await sleep(POLL_MS);
    }
    throw new Error("Avatar build timed out");
  }

  // ── 3D try-on ────────────────────────────────────────────────────────────
  private async variant(variantId: string) {
    const v = await this.prisma.variant.findUnique({ where: { id: variantId }, include: { product: { include: { variants: true } } } });
    if (!v || v.product.status !== "PUBLISHED") throw new NotFoundException("Product not found");
    return v;
  }

  /** Product colours + sizes for the 3D viewer's colour switch and size chips. */
  async garment(userId: string | null, variantId: string) {
    const v = await this.variant(variantId);
    const avatar = userId ? await this.ready(userId) : null;
    const body = avatar ? this.params(avatar).body_size : null;
    const { sizes, recommended } = fitSizes(v.sizes, body);
    return {
      productId: v.productId,
      title: v.product.title,
      category: v.product.category,
      supported: supports3dTryOn(v.product.category) && Boolean(v.cutoutPath),
      variantId: v.id,
      sizes,
      recommended,
      colours: v.product.variants
        .filter((x) => x.cutoutPath)
        .map((x) => ({ variantId: x.id, colourName: x.colourName, colourHex: x.colourHex, cutout: this.storage.publicUrl(x.cutoutPath) })),
      cutout: this.storage.publicUrl(v.cutoutPath),
    };
  }

  async fit(userId: string, variantId: string, size?: string) {
    await this.requireConsent(userId);
    const avatar = await this.ready(userId);
    if (!avatar) throw new BadRequestException({ message: "Build your 3D twin first.", code: "NO_AVATAR" });
    const v = await this.variant(variantId);
    if (!supports3dTryOn(v.product.category) || !v.cutoutPath) {
      throw new BadRequestException({ message: "3D try-on isn't available for this piece yet.", code: "UNSUPPORTED" });
    }
    const { sizes, recommended } = fitSizes(v.sizes, this.params(avatar).body_size);
    const chosen = size && sizes.includes(size.toUpperCase()) ? size.toUpperCase() : recommended;
    const key = { avatarId_variantId_size: { avatarId: avatar.id, variantId, size: chosen } };
    const existing = await this.prisma.avatarFit3d.findUnique({ where: key });
    if (existing && existing.status !== "FAILED") return this.fitView(existing);
    await this.metering.assertBudgetOpen();
    const row = existing
      ? await this.prisma.avatarFit3d.update({ where: { id: existing.id }, data: { status: "QUEUED", error: null } })
      : await this.prisma.avatarFit3d.create({ data: { avatarId: avatar.id, userId, variantId, productId: v.productId, size: chosen } });
    await this.generations.enqueue(FIT_JOB, { id: row.id }, `avatarfit-${row.id}-${Date.now()}`);
    return this.fitView(row);
  }

  async getFit(userId: string, id: string) {
    const f = await this.prisma.avatarFit3d.findFirst({ where: { id, userId } });
    if (!f) throw new NotFoundException();
    return this.fitView(f);
  }

  async processFit(id: string) {
    const f = await this.prisma.avatarFit3d.findUniqueOrThrow({ where: { id } });
    try {
      const avatar = await this.prisma.avatar3d.findFirst({ where: { id: f.avatarId, deletedAt: null, status: "READY" } });
      if (!avatar) throw new Error("The 3D twin was replaced or deleted");
      const v = await this.variant(f.variantId);
      const cutout = await this.storage.read(v.cutoutPath!);
      const r = await this.ai.post<DressResult>(
        "/v1/avatar/dress",
        { params: this.params(avatar), cutout_b64: cutout.toString("base64"), category: v.product.category, size: f.size, request_id: `avatarfit-${id}` },
        60_000,
      );
      const base = fitBase(f.userId, avatar.version, f.variantId, f.size);
      const glb = await this.storage.putEncrypted(`${base}.glb.enc`, Buffer.from(r.glb_b64, "base64"));
      const poster = await this.storage.putEncrypted(`${base}-poster.png.enc`, Buffer.from(r.poster_b64, "base64"));
      await this.metering.record(FIT_COST.kind, "FREE_QUOTA", FIT_COST.costRwf, f.userId, null, id);
      aiSpend.inc({ kind: FIT_COST.kind }, FIT_COST.costRwf);
      return await this.prisma.avatarFit3d.update({
        where: { id },
        data: {
          status: "READY",
          glbPath: `${base}.glb.enc`,
          glbIv: glb.iv,
          glbTag: glb.authTag,
          posterPath: `${base}-poster.png.enc`,
          posterIv: poster.iv,
          posterTag: poster.authTag,
          bytes: r.bytes,
          triangles: r.triangles,
          fit: r.fit as object,
          modelVersion: r.model_version,
        },
      });
    } catch (e) {
      this.log.warn(`fit ${id} failed: ${(e as Error).message}`);
      await this.prisma.avatarFit3d.update({ where: { id }, data: { status: "FAILED", error: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }

  /** Pieces to dress the twin with: the shopper's recent looks first, then a few published dresses (new shoppers). */
  async wardrobe(userId: string) {
    const looks = await this.prisma.look.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 40, select: { variantId: true, id: true } });
    const seen = new Set<string>();
    const ids = looks.map((l) => l.variantId).filter((v) => !seen.has(v) && seen.add(v));
    const fromLooks = await this.prisma.variant.findMany({
      where: { id: { in: ids }, cutoutPath: { not: null }, product: { status: "PUBLISHED" } },
      include: { product: { select: { id: true, title: true, category: true } } },
    });
    const ordered = ids.map((id) => fromLooks.find((v) => v.id === id)).filter((v): v is NonNullable<typeof v> => Boolean(v && supports3dTryOn(v.product.category)));
    let items = ordered.slice(0, 8).map((v) => ({ ...v, fromLook: true }));
    if (items.length < 4) {
      const more = await this.prisma.variant.findMany({
        where: { cutoutPath: { not: null }, id: { notIn: items.map((i) => i.id) }, product: { status: "PUBLISHED", category: { in: ["dress", "umushanana", "skirt", "shirt"] } } },
        include: { product: { select: { id: true, title: true, category: true } } },
        orderBy: { id: "asc" },
        take: 24,
      });
      const byProduct = new Map<string, (typeof more)[number]>();
      for (const v of more) if (!byProduct.has(v.productId)) byProduct.set(v.productId, v);
      items = [...items, ...[...byProduct.values()].slice(0, 6 - items.length).map((v) => ({ ...v, fromLook: false }))];
    }
    return items.map((v) => ({
      variantId: v.id,
      productId: v.productId,
      title: v.product.title,
      category: v.product.category,
      colourName: v.colourName,
      colourHex: v.colourHex,
      cutout: this.storage.publicUrl(v.cutoutPath),
      fromLook: v.fromLook,
    }));
  }

  // ── private files ─────────────────────────────────────────────────────────
  sign(rel: string) {
    const exp = Math.floor(Date.now() / 1000) + config.signedUrlTtlSec;
    const sig = createHmac("sha256", config.jwtSecret).update(`avatar:${rel}:${exp}`).digest("hex");
    return `/api/twin3d/file?p=${encodeURIComponent(rel)}&exp=${exp}&sig=${sig}`;
  }

  /** Decrypt one private avatar file for a valid signed link; refused once the consent or the avatar is gone. */
  async file(rel: string): Promise<{ data: Buffer; type: string }> {
    const a = await this.prisma.avatar3d.findFirst({ where: { deletedAt: null, OR: [{ glbPath: rel }, { posterPath: rel }] } });
    const f = a ? null : await this.prisma.avatarFit3d.findFirst({ where: { OR: [{ glbPath: rel }, { posterPath: rel }] } });
    const row = a ?? f;
    if (!row) throw new NotFoundException();
    if (!(await this.consent.has(row.userId, AVATAR_3D))) throw new ForbiddenException("Consent withdrawn");
    const isGlb = row.glbPath === rel;
    const data = await this.storage.readEncrypted(rel, (isGlb ? row.glbIv : row.posterIv)!, (isGlb ? row.glbTag : row.posterTag)!);
    return { data, type: isGlb ? "model/gltf-binary" : "image/png" };
  }

  // ── privacy ───────────────────────────────────────────────────────────────
  private async purge(a: Avatar3d) {
    for (const p of [a.framesPath, a.glbPath, a.posterPath]) if (p) await this.storage.remove(p);
    const fits = await this.prisma.avatarFit3d.findMany({ where: { avatarId: a.id } });
    for (const f of fits) for (const p of [f.glbPath, f.posterPath]) if (p) await this.storage.remove(p);
    await this.prisma.avatarFit3d.deleteMany({ where: { avatarId: a.id } });
    await this.prisma.avatar3d.update({
      where: { id: a.id },
      data: { deletedAt: new Date(), framesPath: null, glbPath: null, posterPath: null, paramsSealed: null, status: BUILDING.has(a.status as AvatarStatus) ? "FAILED" : a.status },
    });
    return fits.length;
  }

  /** Deletion cascade (FR-PRV): every version, its capture frames, parameters, GLBs, posters and fitted garments. */
  async deleteFor(userId: string) {
    const rows = await this.prisma.avatar3d.findMany({ where: { userId, deletedAt: null } });
    for (const a of rows) await this.purge(a);
    return rows.length;
  }

  /** DSAR export: metadata and the body parameters used (decrypted); GLBs are available on request like twin images. */
  async exportFor(userId: string) {
    const rows = await this.prisma.avatar3d.findMany({ where: { userId }, orderBy: { version: "asc" } });
    const fits = await this.prisma.avatarFit3d.findMany({ where: { userId }, select: { variantId: true, size: true, status: true, fit: true, createdAt: true } });
    return {
      avatars: rows.map((a) => ({
        version: a.version,
        source: a.source,
        status: a.status,
        createdAt: a.createdAt,
        deletedAt: a.deletedAt,
        modelVersion: a.modelVersion,
        evaluation: a.eval,
        bodyParameters: a.paramsSealed ? this.params(a) : null,
      })),
      fits,
    };
  }

  // ── views ─────────────────────────────────────────────────────────────────
  view(a: Avatar3d) {
    const ready = a.status === "READY" && a.glbPath;
    const p = ready ? this.params(a) : {};
    return {
      id: a.id,
      version: a.version,
      source: a.source,
      persona: a.persona,
      status: a.status,
      building: BUILDING.has(a.status as AvatarStatus),
      progress: a.progress,
      glb: ready ? this.sign(a.glbPath!) : null,
      poster: ready && a.posterPath ? this.sign(a.posterPath) : null,
      triangles: a.triangles,
      joints: a.joints,
      bytes: a.bytes,
      checks: a.checks,
      eval: a.eval,
      modelVersion: a.modelVersion,
      skinHex: p.skin_hex ?? null,
      bodySize: p.body_size ?? null,
      measurements: p.measurements ?? null,
      error: a.status === "FAILED" ? "Something went wrong building your 3D twin. Please try again." : null,
      createdAt: a.createdAt,
      readyAt: a.readyAt,
      label: AVATAR_LABEL,
    };
  }

  fitView(f: AvatarFit3d) {
    const ready = f.status === "READY" && f.glbPath;
    return {
      id: f.id,
      variantId: f.variantId,
      productId: f.productId,
      size: f.size,
      status: f.status,
      glb: ready ? this.sign(f.glbPath!) : null,
      poster: ready && f.posterPath ? this.sign(f.posterPath) : null,
      triangles: f.triangles,
      fit: f.fit,
      error: f.status === "FAILED" ? "We couldn't dress your twin in this piece. Try another size or colour." : null,
      label: AVATAR_LABEL,
      disclaimer: FIT_DISCLAIMER,
    };
  }
}
