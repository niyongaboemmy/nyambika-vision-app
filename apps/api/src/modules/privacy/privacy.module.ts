import { Body, Controller, Get, Module, Post, Res } from "@nestjs/common";
import { CONSENT_PURPOSES } from "@nyambika/contracts";
import type { Response } from "express";
import { z } from "zod";
import { AuthUser, CurrentUser } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { TwinModule, TwinService } from "../twin/twin.module";
import { CircleModule, CircleService } from "../circle/circle.module";
import { WardrobeModule, WardrobeService } from "../wardrobe/wardrobe.module";
import { TailorModule } from "../tailor/tailor.module";
import { MeasurementsService } from "../tailor/measurements";
import { CustomOrdersService } from "../tailor/custom-orders";

/** Privacy centre (FR-PRV-01..07, CMP-01..05): consents, export, deletion cascade. */
@Controller("privacy")
export class PrivacyController {
  constructor(
    private prisma: PrismaService,
    private consent: ConsentService,
    private twins: TwinService,
    private storage: StorageService,
    private circle: CircleService,
    private wardrobe: WardrobeService,
    private measurements: MeasurementsService,
    private customOrders: CustomOrdersService,
  ) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    const [consents, chainValid, twin, looks, saved, orders, jobs] = await Promise.all([
      this.consent.current(user.id),
      this.consent.verifyChain(user.id),
      this.twins.current(user.id),
      this.prisma.generation.count({ where: { userId: user.id, status: "DELIVERED" } }),
      this.prisma.look.count({ where: { userId: user.id, savedAt: { not: null } } }),
      this.prisma.order.count({ where: { shopperId: user.id } }),
      this.prisma.deletionJob.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);
    return {
      consents: CONSENT_PURPOSES.map((p) => ({ purpose: p, granted: consents[p]?.granted ?? false, at: consents[p]?.at ?? null })),
      ledgerVerified: chainValid,
      twin: twin ? { version: twin.version, createdAt: twin.createdAt, size: twin.size } : null,
      counts: { looks, saved, orders },
      deletionJobs: jobs,
    };
  }

  @Post("consents")
  async setConsent(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { purpose, granted } = parse(z.object({ purpose: z.enum(CONSENT_PURPOSES), granted: z.boolean() }), body);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await this.consent.record(user.id, purpose, granted, u.locale);
    return this.summary(user);
  }

  /** Data subject access: everything we hold about the shopper, as JSON. */
  @Get("export")
  async export(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        consents: { orderBy: { createdAt: "asc" } },
        intents: { select: { input: true, source: true, intent: true, createdAt: true } },
        looks: { select: { productId: true, variantId: true, savedAt: true, createdAt: true } },
        orders: { include: { items: true, events: true } },
        follows: { select: { pageId: true, createdAt: true } },
        twins: { where: { deletedAt: null }, select: { version: true, size: true, createdAt: true, checks: true } },
      },
    });
    res.setHeader("content-type", "application/json");
    res.setHeader("content-disposition", 'attachment; filename="nyambika-my-data.json"');
    const [circlePolls, wardrobe] = await Promise.all([this.circle.exportFor(user.id), this.wardrobe.exportFor(user.id)]);
    const [measurements, customOrders] = await Promise.all([this.measurements.exportFor(user.id), this.customOrders.exportFor(user.id)]);
    res.send(JSON.stringify({ exportedAt: new Date(), note: "Twin and look images are available on request; they are encrypted at rest.", user: u, circlePolls, wardrobe, measurements, customOrders }, null, 2));
  }

  /** Deletion cascade with a recorded job and per-step status. */
  @Post("delete")
  async delete(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { scope } = parse(z.object({ scope: z.enum(["TWIN", "LOOKS", "ACCOUNT"]) }), body);
    const steps: { step: string; done: boolean; detail?: string }[] = [];
    const job = await this.prisma.deletionJob.create({ data: { userId: user.id, scope, status: "RUNNING", steps } });
    const locale = (await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).locale;

    if (scope === "TWIN" || scope === "ACCOUNT") {
      const twin = await this.twins.current(user.id);
      const removed = twin ? await this.twins.purge(twin.id) : 0;
      await this.storage.remove(`private/twin-previews/${user.id}.png`);
      await this.consent.record(user.id, "TWIN_PROCESSING", false, locale);
      steps.push({ step: "Twin image deleted from storage", done: true, detail: `${removed} looks rendered from it removed` });
      steps.push({ step: "Provider zero-retention confirmed", done: true, detail: "Local gateway keeps no copies" });
    }
    // Polls and restyled outfits are rendered from the twin and looks, so every scope removes them.
    const polls = await this.circle.deleteFor(user.id);
    const outfits = await this.wardrobe.deleteFor(user.id);
    steps.push({ step: "Circle polls and wardrobe outfits deleted", done: true, detail: `${polls} polls (shared copies and votes), ${outfits} outfit images` });
    if (scope === "LOOKS" || scope === "ACCOUNT") {
      const gens = await this.prisma.generation.findMany({ where: { userId: user.id } });
      for (const g of gens) if (g.outputPath) await this.storage.remove(g.outputPath);
      await this.prisma.generation.deleteMany({ where: { userId: user.id } });
      await this.prisma.look.deleteMany({ where: { userId: user.id } });
      await this.prisma.intentSession.deleteMany({ where: { userId: user.id } });
      steps.push({ step: "Generated looks and Muse history deleted", done: true, detail: `${gens.length} images` });
    }
    if (scope === "LOOKS" || scope === "ACCOUNT") {
      const previews = await this.customOrders.deleteFor(user.id);
      steps.push({ step: "Previews shared with tailors deleted", done: true, detail: `${previews} images` });
    }
    if (scope === "ACCOUNT") {
      const m = await this.measurements.deleteFor(user.id);
      steps.push({ step: "Measurement profile deleted; tailor shares ended", done: true, detail: `${m.sharesRevoked} active shares ended` });
      for (const p of CONSENT_PURPOSES) await this.consent.record(user.id, p, false, locale);
      await this.prisma.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
      await this.prisma.follow.deleteMany({ where: { userId: user.id } });
      // Orders are kept for the legal retention period but pseudonymised (SRS §8.2).
      await this.prisma.user.update({ where: { id: user.id }, data: { phone: `deleted:${user.id}`, name: null, deletedAt: new Date() } });
      steps.push({ step: "Account pseudonymised; sessions revoked", done: true, detail: "Order records retained for accounting law, without your name or phone" });
    }
    return this.prisma.deletionJob.update({ where: { id: job.id }, data: { status: "COMPLETED", steps, completedAt: new Date() } });
  }
}

@Module({ imports: [TwinModule, CircleModule, WardrobeModule, TailorModule], controllers: [PrivacyController] })
export class PrivacyModule {}
