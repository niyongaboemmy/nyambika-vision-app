import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, NotFoundException, Param, Post, Put, Query } from "@nestjs/common";
import {
  MeasurementsInput,
  recommendSize,
  shareActive,
  shareExpiry,
  twinSizeRecommendation,
  TWIN_SIZE_PREFILL,
  type Measurements,
  type SizeChartRow,
} from "@nyambika/contracts";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { openMeasurements, sealMeasurements } from "./crypto";

/** Consent purposes recorded in the ledger (not user-toggleable from the Trust centre list). */
export const MEASUREMENT_PROFILE = "MEASUREMENT_PROFILE";
export const MEASUREMENT_SHARE = "MEASUREMENT_SHARE";

/**
 * Measurement profile (FR-SIZE-01/04/08): private, field-level encrypted, consent-recorded.
 * Tailors read it only through an active, time-limited share for one custom order; every read is audited.
 */
@Injectable()
export class MeasurementsService {
  constructor(
    private prisma: PrismaService,
    private consent: ConsentService,
    private access: Access,
  ) {}

  async profile(userId: string): Promise<Measurements | null> {
    const row = await this.prisma.measurementProfile.findUnique({ where: { userId } });
    return row ? openMeasurements(row.fields) : null;
  }

  async view(userId: string) {
    const [row, twin, shares] = await Promise.all([
      this.prisma.measurementProfile.findUnique({ where: { userId } }),
      this.prisma.twin.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
      this.shares(userId),
    ]);
    const twinSize = twin?.size ?? null;
    return {
      profile: row ? openMeasurements(row.fields) : null,
      source: row?.source ?? null,
      updatedAt: row?.updatedAt ?? null,
      twinSize,
      prefill: twinSize ? (TWIN_SIZE_PREFILL[twinSize] ?? null) : null,
      shares,
    };
  }

  async save(userId: string, m: Measurements, source: "MANUAL" | "TWIN_ESTIMATE") {
    if (!Object.keys(m).length) throw new BadRequestException("Add at least one measurement");
    const locale = (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale;
    const consent = await this.consent.record(userId, MEASUREMENT_PROFILE, true, locale);
    const fields = sealMeasurements(m);
    await this.prisma.measurementProfile.upsert({
      where: { userId },
      update: { fields, source, consentId: consent.id },
      create: { userId, fields, source, consentId: consent.id },
    });
    return this.view(userId);
  }

  async remove(userId: string) {
    const locale = (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale;
    const deleted = await this.prisma.measurementProfile.deleteMany({ where: { userId } });
    const revoked = await this.prisma.measurementShare.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (deleted.count) await this.consent.record(userId, MEASUREMENT_PROFILE, false, locale);
    if (revoked.count) await this.access.audit(userId, "MEASUREMENT_SHARES_REVOKED", { count: revoked.count, reason: "profile deleted" });
    return { deleted: deleted.count, sharesRevoked: revoked.count };
  }

  async shares(userId: string) {
    const rows = await this.prisma.measurementShare.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 });
    const pages = await this.prisma.page.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.pageId))] } }, select: { id: true, name: true, handle: true } });
    const byId = new Map(pages.map((p) => [p.id, p]));
    const orders = await this.prisma.customOrder.findMany({ where: { id: { in: rows.map((r) => r.customOrderId).filter((x): x is string => !!x) } }, select: { id: true, code: true, title: true } });
    const oById = new Map(orders.map((o) => [o.id, o]));
    return rows.map((r) => ({
      id: r.id,
      page: byId.get(r.pageId) ?? null,
      customOrder: r.customOrderId ? (oById.get(r.customOrderId) ?? null) : null,
      expiresAt: r.expiresAt,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
      active: shareActive(r),
    }));
  }

  /** Explicit, time-limited share with one tailor for one custom order (exception to OP-5 by choice). */
  async grant(userId: string, pageId: string, customOrderId: string, days: number) {
    if (!(await this.prisma.measurementProfile.findUnique({ where: { userId } }))) {
      throw new BadRequestException({ message: "Save your measurements first, then share them.", code: "NO_PROFILE" });
    }
    const locale = (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale;
    const consent = await this.consent.record(userId, MEASUREMENT_SHARE, true, locale);
    const share = await this.prisma.measurementShare.create({
      data: { userId, pageId, customOrderId, consentId: consent.id, expiresAt: shareExpiry(new Date(), days) },
    });
    await this.access.audit(userId, "MEASUREMENT_SHARE_GRANTED", { shareId: share.id, customOrderId, expiresAt: share.expiresAt }, pageId);
    return share;
  }

  async revoke(userId: string, shareId: string) {
    const share = await this.prisma.measurementShare.findFirst({ where: { id: shareId, userId } });
    if (!share) throw new NotFoundException();
    if (!share.revokedAt) {
      await this.prisma.measurementShare.update({ where: { id: shareId }, data: { revokedAt: new Date() } });
      const locale = (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).locale;
      await this.consent.record(userId, MEASUREMENT_SHARE, false, locale);
      await this.access.audit(userId, "MEASUREMENT_SHARE_REVOKED", { shareId, customOrderId: share.customOrderId }, share.pageId);
    }
    return this.shares(userId);
  }

  activeShareFor(userId: string, pageId: string, customOrderId: string) {
    return this.prisma.measurementShare.findFirst({
      where: { userId, pageId, customOrderId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** What the tailor sees: values only while the share is active; each read is audit-logged. */
  async forTailor(actorId: string, customOrderId: string) {
    const co = await this.prisma.customOrder.findUnique({ where: { id: customOrderId } });
    if (!co) throw new NotFoundException();
    await this.access.requirePage(actorId, co.pageId, MANAGE);
    const share = await this.activeShareFor(co.shopperId, co.pageId, co.id);
    if (!share) throw new ForbiddenException({ message: "The customer hasn't shared measurements, or the share has ended.", code: "NO_ACTIVE_SHARE" });
    const m = await this.profile(co.shopperId);
    if (!m) throw new ForbiddenException({ message: "The customer removed their measurements.", code: "NO_PROFILE" });
    await this.access.audit(actorId, "MEASUREMENT_VIEWED", { customOrderId, shareId: share.id, shopperId: co.shopperId }, co.pageId);
    return { measurements: m, expiresAt: share.expiresAt, sharedAt: share.createdAt };
  }

  async exportFor(userId: string) {
    const row = await this.prisma.measurementProfile.findUnique({ where: { userId } });
    const shares = await this.prisma.measurementShare.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    return { profile: row ? { ...openMeasurements(row.fields), source: row.source, updatedAt: row.updatedAt } : null, shares };
  }

  async deleteFor(userId: string) {
    const r = await this.remove(userId);
    await this.prisma.measurementShare.deleteMany({ where: { userId } });
    return r;
  }

  /** FR-SIZE-02: profile → product size chart, falling back to the twin's estimate. */
  async recommend(userId: string | null, productId: string, variantId?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { sizeChart: true, variants: true } });
    if (!product) throw new NotFoundException();
    const v = product.variants.find((x) => x.id === variantId) ?? product.variants[0];
    const sizes = v?.sizes ?? [];
    if (!userId) return { recommendation: null, sizes };
    const m = await this.profile(userId);
    const rows = (product.sizeChart?.rows ?? []) as unknown as SizeChartRow[];
    const fromProfile = m ? recommendSize(m, rows, product.category, sizes) : null;
    if (fromProfile) return { recommendation: fromProfile, sizes };
    const twin = await this.prisma.twin.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    return { recommendation: twinSizeRecommendation(twin?.size ?? null, sizes), sizes, hasProfile: Boolean(m) };
  }
}

@Controller()
export class MeasurementsController {
  constructor(private measurements: MeasurementsService) {}

  @Get("measurements")
  get(@CurrentUser() user: AuthUser) {
    return this.measurements.view(user.id);
  }

  @Put("measurements")
  save(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { measurements, consent, source } = parse(
      z.object({ measurements: MeasurementsInput, consent: z.literal(true), source: z.enum(["MANUAL", "TWIN_ESTIMATE"]).default("MANUAL") }),
      body,
    );
    void consent;
    return this.measurements.save(user.id, measurements as Measurements, source);
  }

  @Delete("measurements")
  remove(@CurrentUser() user: AuthUser) {
    return this.measurements.remove(user.id);
  }

  @Post("measurements/shares/:id/revoke")
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.measurements.revoke(user.id, id);
  }

  @Get("custom-orders/:id/measurements")
  forTailor(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.measurements.forTailor(user.id, id);
  }

  /** Size recommendation for the hold-to-buy sheet. Works signed out (returns no recommendation). */
  @Public()
  @Get("size/recommend")
  recommend(@CurrentUser() user: AuthUser | null, @Query("productId") productId: string, @Query("variantId") variantId?: string) {
    if (!productId) throw new BadRequestException("productId required");
    return this.measurements.recommend(user?.id ?? null, productId, variantId);
  }
}
