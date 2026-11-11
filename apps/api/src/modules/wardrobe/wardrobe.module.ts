import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AiClient } from "../../common/ai.client";
import { AuthUser, CurrentUser } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { MessagingService } from "../../common/messaging.service";
import { MeteringService } from "../../common/metering.service";
import { aiSpend, generations } from "../../common/metrics";
import { PrismaService } from "../../common/prisma.service";
import { PushService } from "../../common/push/push.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { colourWords } from "../intent/ranking";
import { GenerationService } from "../looks/generation.service";
import { LooksModule, LooksService } from "../looks/looks.module";
import { TwinModule, TwinService } from "../twin/twin.module";
import { daysUntil, type Piece, reminderDue, slotOf, suggestOutfits } from "./outfit-rules";

/** Orders that put a piece in the shopper's hands. */
const OWNED_STATUSES = ["DELIVERED", "COMPLETED", "RESOLVED"] as const;

const CreateEvent = z.object({
  title: z.string().trim().max(60).optional(),
  occasion: z.string().trim().min(2).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budgetMax: z.number().int().positive().max(2_000_000).nullable().optional(),
  intentSessionId: z.string().optional(),
});

interface TryOnResult {
  status: "DELIVERED" | "WITHHELD";
  image_b64: string | null;
  guard: { passed: boolean; reasons: string[] };
  c2pa: { manifest: Record<string, unknown>; signature: string; sha256: string } | null;
  model_version: string;
}

type OutfitItem = { productId: string; variantId: string; category: string; owned: boolean };

/** Job name on the generation queue (routed by GenerationService's job-name switch, like `asset3d` and `motion`). */
export const OUTFIT_JOB = "outfit";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ");

@Injectable()
export class WardrobeService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Wardrobe");
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private twins: TwinService,
    private metering: MeteringService,
    private consent: ConsentService,
    private messaging: MessagingService,
    private looks: LooksService,
    private generations: GenerationService,
    private push: PushService,
  ) {}

  onModuleInit() {
    this.generations.handle(OUTFIT_JOB, (job) => this.render(job.data.id as string));
    // Events drifting into the 3-day window get their reminder even if nothing else happens.
    this.timer = setInterval(() => void this.remindDue().catch((e) => this.log.warn(e.message)), 30 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Owned pieces: every item from the shopper's delivered / completed orders (FR-WRD-01). */
  async owned(userId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { shopperId: userId, status: { in: [...OWNED_STATUSES] } } },
      include: { order: { include: { page: true, events: { orderBy: { createdAt: "desc" }, take: 1 } } } },
      orderBy: { order: { createdAt: "desc" } },
    });
    const variants = await this.prisma.variant.findMany({ where: { id: { in: items.map((i) => i.variantId) } }, include: { product: true } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const seen = new Set<string>();
    return items
      .filter((i) => byId.has(i.variantId) && !seen.has(i.variantId) && seen.add(i.variantId))
      .map((i) => {
        const v = byId.get(i.variantId)!;
        return {
          id: i.id,
          productId: v.productId,
          variantId: v.id,
          pageId: i.order.pageId,
          title: i.title,
          category: v.product.category,
          slot: slotOf(v.product.category),
          colourName: v.colourName,
          colourHex: v.colourHex,
          colours: colourWords(v.colourHex),
          occasions: v.product.occasions,
          priceRwf: i.unitPriceRwf,
          size: i.size,
          image: this.storage.publicUrl(v.cutoutPath ?? v.imagePath),
          maker: { name: i.order.page.name, handle: i.order.page.handle },
          orderCode: i.order.code,
          since: i.order.events[0]?.createdAt ?? i.order.createdAt,
        };
      });
  }

  async overview(userId: string) {
    const [owned, saved, events] = await Promise.all([
      this.owned(userId),
      this.looks.rows({ userId, savedAt: { not: null } }, { savedAt: "desc" }).then((r) => this.looks.views(r)),
      this.prisma.wardrobeEvent.findMany({
        where: { userId, date: { gte: new Date(Date.now() - 86400_000) } },
        orderBy: { date: "asc" },
        include: { outfits: { orderBy: { rank: "asc" } } },
        take: 6,
      }),
    ]);
    return {
      owned,
      saved: saved.map((l) => ({ ...l, colours: colourWords(l.variant.colourHex) })),
      events: events.map((e) => this.eventSummary(e)),
    };
  }

  private eventSummary(e: Prisma.WardrobeEventGetPayload<{ include: { outfits: true } }>) {
    const ready = e.outfits.filter((o) => o.status === "DELIVERED");
    return {
      id: e.id,
      title: e.title,
      occasion: e.occasion,
      date: e.date,
      daysUntil: daysUntil(e.date),
      outfits: e.outfits.length,
      ready: ready.length,
      rendering: e.outfits.some((o) => ["QUEUED", "GENERATING", "GUARDING"].includes(o.status)),
      thumbs: ready.slice(0, 3).map((o) => this.storage.sign(o.outputPath!, "look")),
    };
  }

  async item(userId: string, id: string) {
    const item = (await this.owned(userId)).find((i) => i.id === id);
    if (!item) throw new NotFoundException("Not in your wardrobe");
    const outfits = await this.prisma.wardrobeOutfit.findMany({ where: { userId, status: "DELIVERED" }, include: { event: true }, orderBy: { createdAt: "desc" }, take: 40 });
    const featuring = outfits.filter((o) => (o.items as OutfitItem[]).some((x) => x.variantId === item.variantId)).slice(0, 6);
    return {
      ...item,
      outfits: featuring.map((o) => ({ id: o.id, eventId: o.eventId, event: o.event.title, image: this.storage.sign(o.outputPath!, "look") })),
    };
  }

  /** Recent Muse intents with an occasion, so "Restyle" can start from what the shopper already asked. */
  async intents(userId: string) {
    const rows = await this.prisma.intentSession.findMany({ where: { userId, source: { in: ["text", "voice"] } }, orderBy: { createdAt: "desc" }, take: 20 });
    return rows
      .map((r) => ({ id: r.id, input: r.input, intent: r.intent as { occasion?: string | null; date?: string | null; budgetMax?: number | null } }))
      .filter((r) => r.intent?.occasion)
      .slice(0, 5)
      .map((r) => ({ id: r.id, input: r.input, occasion: r.intent.occasion!, date: r.intent.date ?? null, budgetMax: r.intent.budgetMax ?? null }));
  }

  private async catalogue(): Promise<Piece[]> {
    const products = await this.prisma.product.findMany({
      where: { status: "PUBLISHED", readiness: "READY", page: { status: "PUBLISHED" } },
      include: { variants: { where: { cutoutPath: { not: null } } } },
    });
    return products.flatMap((p) =>
      p.variants
        .filter((v) => v.stock > 0 || p.madeToOrder)
        .map((v) => ({ productId: p.id, variantId: v.id, pageId: p.pageId, title: p.title, category: p.category, colourName: v.colourName, colourHex: v.colourHex, occasions: p.occasions, priceRwf: p.priceRwf, owned: false })),
    );
  }

  /** Restyle for an event (FR-WRD-02/03): suggest 3 outfits and render them on the twin. */
  async createEvent(userId: string, body: unknown) {
    const req = parse(CreateEvent, body);
    const date = new Date(`${req.date}T12:00:00Z`);
    if (daysUntil(date) < 0) throw new BadRequestException("Pick a date today or later");
    const twin = await this.twins.current(userId);
    if (twin && !(await this.consent.has(userId, "TRYON_GENERATION"))) {
      throw new ForbiddenException({ message: "You paused looks on your twin. Turn them back on in the Trust centre.", code: "CONSENT_WITHDRAWN" });
    }
    await this.metering.assertBudgetOpen();
    await this.metering.assertDailyCap(userId);
    const owned: Piece[] = (await this.owned(userId)).map((o) => ({ ...o, owned: true }));
    const outfits = suggestOutfits({ owned, catalogue: await this.catalogue(), occasion: req.occasion, budgetMax: req.budgetMax ?? null });
    if (!outfits.length) throw new BadRequestException("We couldn't build an outfit for that yet. Try another occasion or a bigger budget.");
    const event = await this.prisma.wardrobeEvent.create({
      data: { userId, title: req.title || cap(req.occasion), occasion: req.occasion, date, budgetMax: req.budgetMax ?? null, intentSessionId: req.intentSessionId },
    });
    for (const [rank, o] of outfits.entries()) {
      const row = await this.prisma.wardrobeOutfit.create({
        data: {
          eventId: event.id,
          userId,
          rank,
          items: o.pieces.map((p) => ({ productId: p.productId, variantId: p.variantId, category: p.category, owned: p.owned })),
          reasons: o.reasons,
          score: o.score,
          newCostRwf: o.newCostRwf,
        },
      });
      await this.enqueue(row.id);
    }
    return this.event(userId, event.id);
  }

  /** Outfit renders run on the shared generation queue (job `outfit`), so any API instance can take them and they survive restarts. */
  private enqueue(outfitId: string) {
    return this.generations.enqueue(OUTFIT_JOB, { id: outfitId }, `outfit-${outfitId}`);
  }

  /** Layered render on the twin through the same AI gateway, guard and C2PA signing as every look. */
  async render(outfitId: string) {
    // Claim QUEUED → GENERATING: a duplicate delivery or an outfit deleted meanwhile (privacy deletion) is a no-op.
    const claimed = await this.prisma.wardrobeOutfit.updateMany({ where: { id: outfitId, status: "QUEUED" }, data: { status: "GENERATING" } });
    if (!claimed.count) return;
    const o = await this.prisma.wardrobeOutfit.findUniqueOrThrow({ where: { id: outfitId }, include: { event: true } });
    const items = o.items as OutfitItem[];
    try {
      await this.metering.assertBudgetOpen();
      const variants = await this.prisma.variant.findMany({ where: { id: { in: items.map((i) => i.variantId) } }, include: { product: true } });
      let image = (await this.twins.renderSource(o.userId, 2)).image;
      let result: TryOnResult | null = null;
      const model = await this.generations.model("PREVIEW");
      for (const it of items) {
        const v = variants.find((x) => x.id === it.variantId);
        if (!v?.cutoutPath) throw new Error("A piece has no try-on cut-out");
        result = await this.ai.post<TryOnResult>("/v1/tryon", {
          twin_b64: image.toString("base64"),
          garment_b64: (await this.storage.read(v.cutoutPath)).toString("base64"),
          garment_category: v.product.category,
          tier: "PREVIEW",
          request_id: `${outfitId}:${it.variantId}`,
        });
        if (result.status !== "DELIVERED" || !result.image_b64) {
          await this.prisma.wardrobeOutfit.update({ where: { id: outfitId }, data: { status: "WITHHELD", guard: result.guard } });
          generations.inc({ status: "WITHHELD", model: result.model_version });
          await this.prisma.moderationItem.create({ data: { kind: "GUARD_WITHHELD", refId: outfitId, pageId: v.product.pageId, reason: result.guard.reasons.join("; ") || "Guard failed" } });
          return this.afterRender(o.eventId);
        }
        image = Buffer.from(result.image_b64, "base64");
      }
      await this.prisma.wardrobeOutfit.update({ where: { id: outfitId }, data: { status: "GUARDING" } });
      const outputPath = await this.storage.put(`private/wardrobe/${o.userId}/${outfitId}.png`, image);
      const cost = model.costRwf * items.length;
      const pageId = variants[0].product.pageId;
      const source = await this.metering.resolveSource(o.userId, pageId);
      await this.metering.record("TRYON", source, cost, o.userId, source === "PAGE_ALLOWANCE" ? pageId : null, outfitId);
      await this.prisma.wardrobeOutfit.update({
        where: { id: outfitId },
        data: {
          status: "DELIVERED",
          outputPath,
          guard: result!.guard,
          c2pa: result!.c2pa ? { sha256: result!.c2pa.sha256, signature: result!.c2pa.signature, manifest: result!.c2pa.manifest as object } : undefined,
          costRwf: cost,
          deliveredAt: new Date(),
        },
      });
      generations.inc({ status: "DELIVERED", model: result!.model_version });
      aiSpend.inc({ kind: "TRYON" }, cost);
    } catch (e) {
      await this.prisma.wardrobeOutfit.update({ where: { id: outfitId }, data: { status: "FAILED", guard: { error: (e as Error).message } } });
    }
    return this.afterRender(o.eventId);
  }

  private async afterRender(eventId: string) {
    const e = await this.prisma.wardrobeEvent.findUniqueOrThrow({ where: { id: eventId }, include: { outfits: true } });
    const busy = e.outfits.some((o) => ["QUEUED", "GENERATING", "GUARDING"].includes(o.status));
    if (!busy) await this.remind(e.id);
  }

  /** Send the WhatsApp reminder once the event is close and an outfit is ready (FR-WRD-03). */
  async remind(eventId: string, now = new Date()) {
    const e = await this.prisma.wardrobeEvent.findUniqueOrThrow({ where: { id: eventId }, include: { outfits: true } });
    const ready = e.outfits.filter((o) => o.status === "DELIVERED").length;
    if (!reminderDue(e, ready > 0, now)) return false;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: e.userId } });
    if (user.deletedAt) return false;
    const days = daysUntil(e.date, now);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    // Claim first so two instances never send twice.
    const claimed = await this.prisma.wardrobeEvent.updateMany({ where: { id: e.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!claimed.count) return false;
    await this.messaging.send(
      "WHATSAPP",
      user.phone,
      "wardrobe_event_reminder",
      `${e.title} ${when}: your outfit is ready ✨ ${ready} look${ready > 1 ? "s" : ""} styled from your wardrobe. ${config.webUrl}/wardrobe/events/${e.id}`,
      e.id,
    );
    await this.push.event(e.userId, "wardrobe.reminder", { url: `/wardrobe/events/${e.id}`, refId: e.id, vars: { event: e.title, when } });
    return true;
  }

  async remindDue() {
    const soon = await this.prisma.wardrobeEvent.findMany({ where: { reminderSentAt: null, date: { gte: new Date(Date.now() - 86400_000), lte: new Date(Date.now() + 4 * 86400_000) } }, select: { id: true } });
    for (const e of soon) await this.remind(e.id);
  }

  async event(userId: string, id: string) {
    const e = await this.prisma.wardrobeEvent.findFirst({ where: { id, userId }, include: { outfits: { orderBy: { rank: "asc" } } } });
    if (!e) throw new NotFoundException("Event not found");
    const variantIds = e.outfits.flatMap((o) => (o.items as OutfitItem[]).map((i) => i.variantId));
    const variants = await this.prisma.variant.findMany({ where: { id: { in: variantIds } }, include: { product: { include: { page: true } } } });
    const vById = new Map(variants.map((v) => [v.id, v]));
    return {
      ...this.eventSummary(e),
      budgetMax: e.budgetMax,
      reminderSentAt: e.reminderSentAt,
      looks: e.outfits.map((o) => ({
        id: o.id,
        rank: o.rank,
        status: o.status,
        image: o.status === "DELIVERED" && o.outputPath ? this.storage.sign(o.outputPath, "look") : null,
        c2pa: o.c2pa ? { signed: true, sha256: (o.c2pa as { sha256: string }).sha256.slice(0, 16) } : null,
        reasons: o.reasons,
        newCostRwf: o.newCostRwf,
        pieces: (o.items as OutfitItem[]).map((i) => {
          const v = vById.get(i.variantId);
          return {
            variantId: i.variantId,
            productId: i.productId,
            owned: i.owned,
            title: v?.product.title ?? "Item",
            category: i.category,
            colourName: v?.colourName ?? "",
            colourHex: v?.colourHex ?? "#888",
            priceRwf: v?.product.priceRwf ?? 0,
            image: this.storage.publicUrl(v?.imagePath ?? v?.cutoutPath),
            maker: v ? { name: v.product.page.name, handle: v.product.page.handle } : null,
          };
        }),
      })),
    };
  }

  /** Ambient card for the Muse home: the next event within a week that has a ready outfit. */
  async ambient(userId: string) {
    const e = await this.prisma.wardrobeEvent.findFirst({
      where: { userId, date: { gte: new Date(Date.now() - 12 * 3600_000), lte: new Date(Date.now() + 7 * 86400_000) }, outfits: { some: { status: "DELIVERED" } } },
      orderBy: { date: "asc" },
      include: { outfits: { orderBy: { rank: "asc" } } },
    });
    return e ? this.eventSummary(e) : null;
  }

  async exportFor(userId: string) {
    const events = await this.prisma.wardrobeEvent.findMany({ where: { userId }, include: { outfits: { select: { items: true, reasons: true, status: true, costRwf: true, createdAt: true } } } });
    return { owned: await this.owned(userId), events };
  }

  async deleteFor(userId: string) {
    const outfits = await this.prisma.wardrobeOutfit.findMany({ where: { userId } });
    for (const o of outfits) if (o.outputPath) await this.storage.remove(o.outputPath);
    await this.prisma.wardrobeEvent.deleteMany({ where: { userId } });
    return outfits.length;
  }
}

@Controller("wardrobe")
export class WardrobeController {
  constructor(private wardrobe: WardrobeService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.wardrobe.overview(user.id);
  }

  @Get("ambient")
  ambient(@CurrentUser() user: AuthUser) {
    return this.wardrobe.ambient(user.id);
  }

  @Get("intents")
  intents(@CurrentUser() user: AuthUser) {
    return this.wardrobe.intents(user.id);
  }

  @Get("items/:id")
  item(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.wardrobe.item(user.id, id);
  }

  @Post("events")
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.wardrobe.createEvent(user.id, body);
  }

  @Get("events/:id")
  event(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.wardrobe.event(user.id, id);
  }
}

@Module({
  imports: [TwinModule, LooksModule],
  controllers: [WardrobeController],
  providers: [WardrobeService],
  exports: [WardrobeService],
})
export class WardrobeModule {}
