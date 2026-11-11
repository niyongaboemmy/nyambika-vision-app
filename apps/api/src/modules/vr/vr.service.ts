import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { FashionShow, FashionShowItem, Page } from "@prisma/client";
import {
  type BoothInput,
  REACTION_LIMIT,
  REACTIONS,
  reminderDue,
  runwayCursor,
  scheduleProblems,
  shapeShelf,
  SHOW,
  showDurationSec,
  showPhase,
  type ShelfItem,
  type ShowInput,
  SHOWROOM_BUDGET,
  SHOWROOM_THEMES,
} from "@nyambika/contracts";
import sharp from "sharp";
import { AiClient } from "../../common/ai.client";
import { MessagingService } from "../../common/messaging.service";
import { aiSpend } from "../../common/metrics";
import { MeteringService } from "../../common/metering.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { config } from "../../config";
import { GenerationService } from "../looks/generation.service";
import { FIT_COST, supports3dTryOn } from "../twin3d/twin3d-rules";
import { pickModelSize } from "../xr/xr-rules";
import { ShowLive } from "./vr-live";

export const RUNWAY_JOB = "showrunway";
export const RUNWAY_LABEL = "Runway model: a synthetic AI avatar, not a real person";

interface DressResult {
  glb_b64: string;
  poster_b64: string;
  bytes: number;
  triangles: number;
  model_version: string;
}

const hexToRgb01 = (h: string) => [1, 3, 5].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000);

type ShowWithItems = FashionShow & { items: FashionShowItem[] };

/**
 * E35: Maker Space 3D shelf, VR showroom data, virtual fashion shows (schedule, RSVP + WhatsApp reminder,
 * runway models on a synthetic avatar, live viewers + reactions over SSE, replay).
 */
@Injectable()
export class VrService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Vr");
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private ai: AiClient,
    private messaging: MessagingService,
    private metering: MeteringService,
    private generations: GenerationService,
    private live: ShowLive,
  ) {}

  onModuleInit() {
    this.generations.handle(RUNWAY_JOB, (job) => this.buildRunway(job.data.id as string));
    // Shows drifting into the reminder window get their WhatsApp reminder without any other trigger.
    this.timer = setInterval(() => void this.remindDue().catch((e) => this.log.warn(e.message)), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ── shelf + showroom (public) ────────────────────────────────────────────
  private async publishedPage(handle: string) {
    const page = await this.prisma.page.findUnique({ where: { handle } });
    if (!page || page.status !== "PUBLISHED") throw new NotFoundException("This page isn't available");
    return page;
  }

  /** Approved, ready 3D pieces of a page shaped for the shelf / room (featured first, ≤ 25 MB). */
  async lineup(pageId: string, featured: string[] = [], max: number = SHOWROOM_BUDGET.maxItems): Promise<ShelfItem[]> {
    const [products, assets] = await Promise.all([
      this.prisma.product.findMany({
        where: { pageId, status: "PUBLISHED" },
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        include: { variants: { orderBy: { id: "asc" } } },
      }),
      this.prisma.garmentAsset3d.findMany({ where: { pageId, status: "READY", approved: true, glbPath: { not: null } } }),
    ]);
    return shapeShelf(
      {
        products: products.map((p) => ({ ...p, variants: p.variants })),
        assets: new Map(assets.map((a) => [a.variantId, { variantId: a.variantId, glbPath: a.glbPath!, posterPath: a.posterPath, heightM: a.heightM, bytes: a.bytes, size: a.size }])),
        featured,
      },
      max,
    );
  }

  private itemView(i: ShelfItem) {
    return {
      productId: i.productId,
      title: i.title,
      priceRwf: i.priceRwf,
      category: i.category,
      variantId: i.variantId,
      colourName: i.colourName,
      glb: this.storage.publicUrl(i.glbPath)!,
      poster: this.storage.publicUrl(i.posterPath),
      photo: this.storage.publicUrl(i.photoPath),
      heightM: i.heightM,
      bytes: i.bytes,
      size: i.size,
      featured: i.featured,
      colours: i.colours.map((c) => ({ variantId: c.variantId, colourName: c.colourName, colourHex: c.colourHex, glb: this.storage.publicUrl(c.glbPath)!, poster: this.storage.publicUrl(c.posterPath) })),
    };
  }

  async booth(pageId: string) {
    return (await this.prisma.showroomBooth.findUnique({ where: { pageId } })) ?? { pageId, enabled: true, banner: "", featured: [] as string[] };
  }

  /** Maker Space 3D shelf (shopper, public). */
  async shelf(handle: string) {
    const page = await this.publishedPage(handle);
    const booth = await this.booth(page.id);
    const items = (await this.lineup(page.id, booth.featured, 24)).map((i) => this.itemView(i));
    const shows = await this.upcoming(page.id, 2);
    return { pageId: page.id, handle: page.handle, showroom: booth.enabled && items.length > 0, items, shows };
  }

  private makerCard(page: Page) {
    return { pageId: page.id, name: page.name, handle: page.handle, memberType: page.memberType, verified: page.verified, sector: page.sector, whatsapp: page.whatsapp, madeBy: [] as string[] };
  }

  /** Everything the showroom scene needs (FR-VR-01/03/04/08): branding, pieces with buy data, upcoming shows. */
  async showroom(handle: string) {
    const page = await this.publishedPage(handle);
    const booth = await this.booth(page.id);
    if (!booth.enabled) throw new NotFoundException("This maker's showroom is closed right now");
    const lineup = await this.lineup(page.id, booth.featured);
    const variants = await this.prisma.variant.findMany({ where: { productId: { in: lineup.map((i) => i.productId) } }, include: { product: true } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const items = lineup.map((i) => {
      const product = byId.get(i.variantId)!.product;
      return {
        ...this.itemView(i),
        product: { id: product.id, title: product.title, priceRwf: product.priceRwf, madeToOrder: product.madeToOrder, leadTimeDays: product.leadTimeDays, category: product.category, fabric: product.fabric },
        variants: i.colours.map((c) => {
          const v = byId.get(c.variantId)!;
          return { id: v.id, colourName: v.colourName, colourHex: v.colourHex, sizes: v.sizes, inStock: v.stock > 0 || product.madeToOrder };
        }),
      };
    });
    return {
      page: { ...this.makerCard(page), theme: page.theme, palette: SHOWROOM_THEMES[page.theme] ?? SHOWROOM_THEMES.terra, story: page.story.slice(0, 160), rating: page.rating },
      banner: booth.banner || `Murakaza neza · Welcome to ${page.name}`,
      items,
      budget: { totalBytes: items.reduce((s, i) => s + i.bytes, 0), limitBytes: SHOWROOM_BUDGET.totalBytes },
      shows: await this.upcoming(page.id, 3),
      label: "3D previews generated by AI",
    };
  }

  // ── fashion shows: reads ─────────────────────────────────────────────────
  private phaseOf(s: ShowWithItems, now = new Date()) {
    return showPhase({ status: s.status, startsAt: s.startsAt, items: s.items.length, walkSec: s.walkSec }, now);
  }

  private cover(s: ShowWithItems, photos: Map<string, string | null>) {
    return this.storage.publicUrl(s.coverPath) ?? (s.items[0] ? (photos.get(s.items[0].variantId) ?? null) : null);
  }

  private async photos(variantIds: string[]) {
    const vs = await this.prisma.variant.findMany({ where: { id: { in: variantIds } }, select: { id: true, imagePath: true } });
    return new Map(vs.map((v) => [v.id, this.storage.publicUrl(v.imagePath)]));
  }

  async upcoming(pageId: string, take: number) {
    const shows = await this.prisma.fashionShow.findMany({
      where: { pageId, status: "SCHEDULED", startsAt: { gte: new Date(Date.now() - 3 * 3600_000) } },
      orderBy: { startsAt: "asc" },
      include: { items: { orderBy: { position: "asc" } } },
      take: take + 4,
    });
    const photos = await this.photos(shows.flatMap((s) => s.items.map((i) => i.variantId)));
    return shows
      .filter((s) => this.phaseOf(s) !== "ENDED")
      .slice(0, take)
      .map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, phase: this.phaseOf(s), items: s.items.length, cover: this.cover(s, photos) }));
  }

  private async show(id: string) {
    const s = await this.prisma.fashionShow.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
    if (!s) throw new NotFoundException("Show not found");
    return s;
  }

  /** Public show page data: schedule, runway items (with buy data), RSVP state for the signed-in viewer. */
  async publicShow(id: string, userId: string | null) {
    const s = await this.show(id);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: s.pageId } });
    if (page.status !== "PUBLISHED") throw new NotFoundException("Show not found");
    const variants = await this.prisma.variant.findMany({ where: { id: { in: s.items.map((i) => i.variantId) } }, include: { product: { include: { variants: true } } } });
    const garments = await this.prisma.garmentAsset3d.findMany({ where: { variantId: { in: s.items.map((i) => i.variantId) }, status: "READY", approved: true } });
    const byV = new Map(variants.map((v) => [v.id, v]));
    const byG = new Map(garments.map((g) => [g.variantId, g]));
    const photos = await this.photos(s.items.map((i) => i.variantId));
    const [rsvps, mine] = await Promise.all([
      this.prisma.fashionShowRsvp.count({ where: { showId: id } }),
      userId ? this.prisma.fashionShowRsvp.findUnique({ where: { showId_userId: { showId: id, userId } } }) : null,
    ]);
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      startsAt: s.startsAt,
      walkSec: s.walkSec,
      durationSec: showDurationSec(s.items.length, s.walkSec),
      phase: this.phaseOf(s),
      serverNow: new Date(),
      cover: this.cover(s, photos),
      runwayStatus: s.runwayStatus,
      model: { skin: s.modelSkin, size: s.modelSize, label: RUNWAY_LABEL },
      rsvps,
      going: Boolean(mine),
      maker: { ...this.makerCard(page), theme: page.theme, palette: SHOWROOM_THEMES[page.theme] ?? SHOWROOM_THEMES.terra },
      items: s.items
        .filter((i) => byV.has(i.variantId))
        .map((i) => {
          const v = byV.get(i.variantId)!;
          const g = byG.get(i.variantId);
          return {
            position: i.position,
            status: i.status,
            runway: i.status === "READY" ? { glb: this.storage.publicUrl(i.glbPath)!, poster: this.storage.publicUrl(i.posterPath) } : null,
            garment: g ? { glb: this.storage.publicUrl(g.glbPath)!, poster: this.storage.publicUrl(g.posterPath) } : null,
            photo: photos.get(i.variantId) ?? null,
            product: { id: v.product.id, title: v.product.title, priceRwf: v.product.priceRwf, madeToOrder: v.product.madeToOrder, leadTimeDays: v.product.leadTimeDays, category: v.product.category, fabric: v.product.fabric },
            variant: { id: v.id, colourName: v.colourName, colourHex: v.colourHex, sizes: v.sizes, inStock: v.stock > 0 || v.product.madeToOrder },
            variants: v.product.variants.map((x) => ({ id: x.id, colourName: x.colourName, colourHex: x.colourHex })),
          };
        }),
    };
  }

  /** Live snapshot pushed over SSE and served to the polling fallback. */
  async snapshot(id: string) {
    const s = await this.show(id);
    const now = new Date();
    const elapsed = (now.getTime() - s.startsAt.getTime()) / 1000;
    const [viewers, counts, recent] = await Promise.all([
      this.live.viewers(id),
      this.prisma.fashionShowReaction.groupBy({ by: ["emoji"], where: { showId: id }, _count: { _all: true } }),
      this.prisma.fashionShowReaction.findMany({ where: { showId: id }, orderBy: { createdAt: "desc" }, take: 12, select: { emoji: true, offsetMs: true, id: true } }),
    ]);
    if (viewers > s.peakViewers && this.phaseOf(s, now) !== "ENDED") {
      await this.prisma.fashionShow.updateMany({ where: { id, peakViewers: { lt: viewers } }, data: { peakViewers: viewers } });
    }
    return {
      id,
      phase: this.phaseOf(s, now),
      serverNow: now,
      startsAt: s.startsAt,
      cursor: runwayCursor(elapsed, s.items.length, s.walkSec),
      viewers,
      reactions: Object.fromEntries(REACTIONS.map((e) => [e, counts.find((c) => c.emoji === e)?._count._all ?? 0])),
      recent: recent.reverse(),
      runwayStatus: s.runwayStatus,
    };
  }

  /** Reactions over the whole show, for replay at the same moments. */
  async reactionTrack(id: string) {
    await this.show(id);
    const rows = await this.prisma.fashionShowReaction.findMany({ where: { showId: id }, orderBy: { offsetMs: "asc" }, take: 2000, select: { emoji: true, offsetMs: true } });
    return { id, reactions: rows };
  }

  // ── fashion shows: viewer actions ────────────────────────────────────────
  async react(id: string, emoji: string, viewerKey: string) {
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw new BadRequestException("Pick one of the reactions");
    const s = await this.show(id);
    const phase = this.phaseOf(s);
    if (phase !== "LIVE" && phase !== "DOORS_OPEN") throw new BadRequestException("Reactions open when the show is live");
    const n = await this.live.counters.incr(`vr:react:${id}:${viewerKey}`, REACTION_LIMIT.windowSec);
    if (n > REACTION_LIMIT.perWindow) throw new HttpException("Slow down a little, reactions are rate limited", HttpStatus.TOO_MANY_REQUESTS);
    const offsetMs = Math.max(0, Date.now() - s.startsAt.getTime());
    await this.prisma.fashionShowReaction.create({ data: { showId: id, emoji, offsetMs } });
    await this.live.publish(id);
    return { ok: true, offsetMs };
  }

  /** RSVP = ask for one WhatsApp reminder (sent right away if the show is already within the lead window). */
  async rsvp(id: string, userId: string, going: boolean) {
    const s = await this.show(id);
    const phase = this.phaseOf(s);
    if (going && (phase === "ENDED" || phase === "CANCELLED")) throw new BadRequestException("This show is over. Watch the replay instead.");
    if (!going) {
      await this.prisma.fashionShowRsvp.deleteMany({ where: { showId: id, userId } });
    } else {
      const r = await this.prisma.fashionShowRsvp.upsert({ where: { showId_userId: { showId: id, userId } }, create: { showId: id, userId }, update: {} });
      await this.remind(r.id);
    }
    return { going, rsvps: await this.prisma.fashionShowRsvp.count({ where: { showId: id } }) };
  }

  private reminderText(locale: string, title: string, maker: string, time: string, url: string) {
    if (locale === "rw") return `Muraho! Imurika "${title}" rya ${maker} riratangira saa ${time}. Rirebe imbonankubone: ${url}`;
    if (locale === "fr") return `Bonjour ! Le défilé « ${title} » de ${maker} commence à ${time}. Regardez en direct : ${url}`;
    return `Muraho! "${title}" by ${maker} starts at ${time}. Watch live: ${url}`;
  }

  /** Send one reminder for an RSVP if it is due; claim-first so two instances never send twice. */
  async remind(rsvpId: string, now = new Date()) {
    const r = await this.prisma.fashionShowRsvp.findUnique({ where: { id: rsvpId } });
    if (!r) return false;
    const s = await this.show(r.showId);
    if (!reminderDue({ status: s.status, startsAt: s.startsAt, items: s.items.length, walkSec: s.walkSec }, r, now)) return false;
    const user = await this.prisma.user.findUnique({ where: { id: r.userId } });
    if (!user || user.deletedAt) return false;
    const claimed = await this.prisma.fashionShowRsvp.updateMany({ where: { id: r.id, remindedAt: null }, data: { remindedAt: now } });
    if (!claimed.count) return false;
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: s.pageId } });
    const time = s.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });
    const url = `${config.webUrl}/m/${page.handle}/shows/${s.id}`;
    await this.messaging.send("WHATSAPP", user.phone, "fashion_show_reminder", this.reminderText(user.locale, s.title, page.name, time, url), s.id);
    return true;
  }

  async remindDue(now = new Date()) {
    const soon = await this.prisma.fashionShowRsvp.findMany({
      where: { remindedAt: null },
      select: { id: true, showId: true },
      take: 2000,
    });
    if (!soon.length) return 0;
    const shows = await this.prisma.fashionShow.findMany({
      where: { id: { in: [...new Set(soon.map((r) => r.showId))] }, status: "SCHEDULED", startsAt: { lte: new Date(now.getTime() + SHOW.reminderLeadMin * 60_000) } },
      select: { id: true },
    });
    const ok = new Set(shows.map((s) => s.id));
    let sent = 0;
    for (const r of soon) if (ok.has(r.showId) && (await this.remind(r.id, now))) sent += 1;
    return sent;
  }

  // ── studio (page managers) ───────────────────────────────────────────────
  async studio(pageId: string) {
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const booth = await this.booth(pageId);
    const lineup = await this.lineup(pageId, booth.featured);
    const products = await this.prisma.product.findMany({
      where: { pageId, status: "PUBLISHED" },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      include: { variants: { orderBy: { id: "asc" } } },
    });
    const assets = await this.prisma.garmentAsset3d.findMany({ where: { pageId, status: "READY", approved: true } });
    const with3d = new Set(assets.map((a) => a.productId));
    const shows = await this.prisma.fashionShow.findMany({ where: { pageId }, orderBy: { startsAt: "desc" }, include: { items: { orderBy: { position: "asc" } } }, take: 30 });
    const counts = await this.prisma.fashionShowRsvp.groupBy({ by: ["showId"], where: { showId: { in: shows.map((s) => s.id) } }, _count: { _all: true } });
    const reacts = await this.prisma.fashionShowReaction.groupBy({ by: ["showId"], where: { showId: { in: shows.map((s) => s.id) } }, _count: { _all: true } });
    const photos = await this.photos([...shows.flatMap((s) => s.items.map((i) => i.variantId)), ...products.map((p) => p.variants[0]?.id).filter(Boolean)]);
    return {
      page: { id: page.id, handle: page.handle, name: page.name, theme: page.theme },
      booth: { enabled: booth.enabled, banner: booth.banner, featured: booth.featured },
      showroom: { pieces: lineup.length, bytes: lineup.reduce((s, i) => s + i.bytes, 0), limitBytes: SHOWROOM_BUDGET.totalBytes, mannequins: SHOWROOM_BUDGET.mannequins },
      candidates: products.map((p) => {
        const v = p.variants.find((x) => x.cutoutPath) ?? p.variants[0];
        return {
          productId: p.id,
          title: p.title,
          priceRwf: p.priceRwf,
          category: p.category,
          photo: v ? (photos.get(v.id) ?? this.storage.publicUrl(v.imagePath)) : null,
          has3d: with3d.has(p.id),
          runway: supports3dTryOn(p.category) && p.variants.some((x) => x.cutoutPath),
        };
      }),
      shows: shows.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        startsAt: s.startsAt,
        status: s.status,
        phase: this.phaseOf(s),
        runwayStatus: s.runwayStatus,
        items: s.items.map((i) => ({ productId: i.productId, variantId: i.variantId, status: i.status })),
        cover: this.cover(s, photos),
        rsvps: counts.find((c) => c.showId === s.id)?._count._all ?? 0,
        reactions: reacts.find((c) => c.showId === s.id)?._count._all ?? 0,
        peakViewers: s.peakViewers,
        durationSec: showDurationSec(s.items.length, s.walkSec),
      })),
    };
  }

  async saveBooth(pageId: string, input: BoothInput) {
    const ids = (await this.prisma.product.findMany({ where: { id: { in: input.featured }, pageId }, select: { id: true } })).map((p) => p.id);
    const featured = input.featured.filter((id) => ids.includes(id));
    return this.prisma.showroomBooth.upsert({
      where: { pageId },
      create: { pageId, enabled: input.enabled, banner: input.banner, featured },
      update: { enabled: input.enabled, banner: input.banner, featured },
    });
  }

  /** Resolve the pieces of a show: published products of this page; the colour defaults to one with a cut-out. */
  private async resolveItems(pageId: string, items: ShowInput["items"]) {
    const products = await this.prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) }, pageId, status: "PUBLISHED" }, include: { variants: { orderBy: { id: "asc" } } } });
    return items.map((i, position) => {
      const p = products.find((x) => x.id === i.productId);
      if (!p) throw new BadRequestException("A piece is not a published product of this page");
      const v = (i.variantId && p.variants.find((x) => x.id === i.variantId)) || p.variants.find((x) => x.cutoutPath) || p.variants[0];
      if (!v) throw new BadRequestException(`"${p.title}" has no colours`);
      return { productId: p.id, variantId: v.id, position };
    });
  }

  async createShow(pageId: string, userId: string, input: ShowInput, now = new Date()) {
    const problems = scheduleProblems(input, now);
    if (problems.length) throw new BadRequestException(problems.join(" "));
    const items = await this.resolveItems(pageId, input.items);
    const show = await this.prisma.fashionShow.create({
      data: {
        pageId,
        title: input.title,
        description: input.description,
        startsAt: new Date(input.startsAt),
        walkSec: input.walkSec,
        modelSkin: input.modelSkin,
        modelSize: input.modelSize,
        createdById: userId,
        items: { create: items },
      },
    });
    await this.queueRunway(show.id);
    return show;
  }

  async updateShow(pageId: string, id: string, input: Partial<ShowInput>, now = new Date()) {
    const s = await this.show(id);
    if (s.pageId !== pageId) throw new NotFoundException("Show not found");
    if (s.status === "CANCELLED" || this.phaseOf(s, now) === "LIVE" || this.phaseOf(s, now) === "ENDED") throw new BadRequestException("Only upcoming shows can be changed");
    if (input.startsAt || input.items) {
      const problems = scheduleProblems({ startsAt: input.startsAt ?? s.startsAt.toISOString(), items: input.items ?? s.items }, now);
      if (problems.length) throw new BadRequestException(problems.join(" "));
    }
    const data: Record<string, unknown> = {};
    for (const k of ["title", "description", "walkSec", "modelSkin", "modelSize"] as const) if (input[k] !== undefined) data[k] = input[k];
    if (input.startsAt) data.startsAt = new Date(input.startsAt);
    const rebuild = Boolean(input.items) || input.modelSkin !== undefined || input.modelSize !== undefined;
    if (input.items) {
      const items = await this.resolveItems(pageId, input.items);
      await this.prisma.fashionShowItem.deleteMany({ where: { showId: id } });
      await this.prisma.fashionShowItem.createMany({ data: items.map((i) => ({ ...i, showId: id })) });
    }
    // A new time means a new reminder.
    if (input.startsAt && new Date(input.startsAt).getTime() !== s.startsAt.getTime()) await this.prisma.fashionShowRsvp.updateMany({ where: { showId: id }, data: { remindedAt: null } });
    const out = await this.prisma.fashionShow.update({ where: { id }, data: { ...data, ...(rebuild ? { runwayStatus: "QUEUED" } : {}) } });
    if (rebuild) {
      await this.prisma.fashionShowItem.updateMany({ where: { showId: id }, data: { status: "QUEUED", glbPath: null, posterPath: null } });
      await this.queueRunway(id);
    }
    return out;
  }

  async cancelShow(pageId: string, id: string) {
    const s = await this.show(id);
    if (s.pageId !== pageId) throw new NotFoundException("Show not found");
    return this.prisma.fashionShow.update({ where: { id }, data: { status: "CANCELLED" } });
  }

  async setCover(pageId: string, id: string, file: Buffer) {
    const s = await this.show(id);
    if (s.pageId !== pageId) throw new NotFoundException("Show not found");
    let img: Buffer;
    try {
      img = await sharp(file).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException("That file is not an image we can read");
    }
    const path = `public/media/${pageId}/shows/${id}/cover-${Date.now().toString(36)}.webp`;
    await this.storage.put(path, img);
    if (s.coverPath) await this.storage.remove(s.coverPath);
    await this.prisma.fashionShow.update({ where: { id }, data: { coverPath: path } });
    return { cover: this.storage.publicUrl(path) };
  }

  /** Host/maker guard for the public show routes (the page must be live). */
  async assertManager(showId: string, pageId: string) {
    const s = await this.show(showId);
    if (s.pageId !== pageId) throw new ForbiddenException();
    return s;
  }

  // ── runway models (synthetic avatar, FR-VR-05) ───────────────────────────
  private async queueRunway(id: string) {
    try {
      await this.generations.enqueue(RUNWAY_JOB, { id }, `showrunway-${id}-${Date.now()}`);
    } catch (e) {
      this.log.warn(`runway queue unavailable, building inline: ${(e as Error).message}`);
      void this.buildRunway(id).catch(() => undefined);
    }
  }

  /**
   * Dress every piece on the synthetic parametric body (E33 avatar pipeline, measurements-only, Monk-scale
   * swatch). Never uses a shopper's twin. Pieces the dresser can't wear (bags, shoes, no cut-out) walk as the
   * approved E27 garment on a stand (FALLBACK). Output is synthetic, so it is public media of the page.
   */
  async buildRunway(id: string) {
    const s = await this.show(id);
    await this.prisma.fashionShow.update({ where: { id }, data: { runwayStatus: "BUILDING" } });
    const params = { measurements: {}, skin_rgb: hexToRgb01(s.modelSkin), size_estimate: s.modelSize };
    let ready = 0;
    let fallback = 0;
    for (const item of s.items) {
      const v = await this.prisma.variant.findUnique({ where: { id: item.variantId }, include: { product: true } });
      if (!v) {
        await this.prisma.fashionShowItem.update({ where: { id: item.id }, data: { status: "FAILED", error: "Colour removed" } });
        continue;
      }
      if (!supports3dTryOn(v.product.category) || !v.cutoutPath) {
        await this.prisma.fashionShowItem.update({ where: { id: item.id }, data: { status: "FALLBACK", error: null } });
        fallback += 1;
        continue;
      }
      try {
        const cutout = await this.storage.read(v.cutoutPath);
        const size = v.sizes.map((x) => x.toUpperCase()).includes(s.modelSize) ? s.modelSize : pickModelSize(v.sizes);
        const r = await this.ai.post<DressResult>(
          "/v1/avatar/dress",
          { params, cutout_b64: cutout.toString("base64"), category: v.product.category, size, request_id: `showrunway-${item.id}` },
          60_000,
        );
        const base = `public/media/${s.pageId}/shows/${id}/${item.position}-${v.id}`;
        await this.storage.put(`${base}.glb`, Buffer.from(r.glb_b64, "base64"));
        await this.storage.put(`${base}.png`, Buffer.from(r.poster_b64, "base64"));
        await this.prisma.fashionShowItem.update({ where: { id: item.id }, data: { status: "READY", glbPath: `${base}.glb`, posterPath: `${base}.png`, bytes: r.bytes, error: null } });
        await this.metering.record(FIT_COST.kind, "PAGE_ALLOWANCE", FIT_COST.costRwf, null, s.pageId, item.id);
        aiSpend.inc({ kind: FIT_COST.kind }, FIT_COST.costRwf);
        ready += 1;
      } catch (e) {
        this.log.warn(`runway item ${item.id} failed: ${(e as Error).message}`);
        await this.prisma.fashionShowItem.update({ where: { id: item.id }, data: { status: "FALLBACK", error: (e as Error).message.slice(0, 200) } });
        fallback += 1;
      }
    }
    const status = ready === s.items.length ? "READY" : ready > 0 || fallback > 0 ? "PARTIAL" : "FAILED";
    return this.prisma.fashionShow.update({ where: { id }, data: { runwayStatus: status } });
  }

  // ── privacy (DSAR export + account deletion) ─────────────────────────────
  async exportFor(userId: string) {
    const rows = await this.prisma.fashionShowRsvp.findMany({ where: { userId } });
    const shows = await this.prisma.fashionShow.findMany({ where: { id: { in: rows.map((r) => r.showId) } }, select: { id: true, title: true, startsAt: true } });
    return rows.map((r) => ({ show: shows.find((s) => s.id === r.showId) ?? { id: r.showId }, rsvpAt: r.createdAt, remindedAt: r.remindedAt }));
  }

  async deleteFor(userId: string) {
    return (await this.prisma.fashionShowRsvp.deleteMany({ where: { userId } })).count;
  }
}
