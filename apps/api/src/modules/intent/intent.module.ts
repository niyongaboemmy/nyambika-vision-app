import "multer";
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { countryOfPhone, EXPERIMENTS, Intent, IntentRequest, isRegion, LOOK_GUARDRAILS, type RegionCode } from "@nyambika/contracts";
import { AiClient } from "../../common/ai.client";
import { AuthUser, CurrentUser, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { LooksModule, LooksService } from "../looks/looks.module";
import { ExperimentsService, PilotService } from "../pilot/pilot.service";
import { diversify, rank, visibleForShopper, type Candidate } from "./ranking";

@Injectable()
export class IntentService {
  constructor(
    private prisma: PrismaService,
    private ai: AiClient,
    private looks: LooksService,
    private experiments: ExperimentsService,
    private pilot: PilotService,
  ) {}

  /** Pilot experiment "3 vs 2 initial looks" (plan §8.1); the guardrail default when it isn't running. */
  async initialLooks(userId: string) {
    const arm = await this.experiments.variant(userId, EXPERIMENTS.initialLooks);
    const n = Number(arm);
    return arm && Number.isInteger(n) && n >= 1 && n <= 5 ? n : LOOK_GUARDRAILS.initialLooks;
  }

  /** Grounding: only published, try-on-ready products from live pages are ever recommended (plan §15.2). */
  /**
   * Error sweep: pages a shopper may see in looks, by E41 region rules (same as the maker directory): home-country
   * makers, plus cross-border-listed makers only when the shopper opted in. Before this, a Rwandan shopper's Muse
   * could rank a Kenyan maker whose hold-to-buy then failed with "hasn't set up Mobile Money".
   */
  async visiblePageIds(userId: string): Promise<Set<string> | null> {
    const regions = await this.prisma.pageRegion.findMany({ select: { pageId: true, region: true, crossBorder: true } });
    if (!regions.some((r) => r.region !== "RW")) return null; // single-country catalogue: nothing to filter
    const [prefs, user] = await Promise.all([
      this.prisma.shopperPrefs.findUnique({ where: { userId } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    ]);
    const country: RegionCode = prefs && isRegion(prefs.country) ? prefs.country : (user ? countryOfPhone(user.phone) : null) ?? "RW";
    const pages = await this.prisma.page.findMany({ where: { status: "PUBLISHED" }, select: { id: true } });
    return visibleForShopper(pages.map((p) => p.id), regions, { country, crossBorder: prefs?.crossBorder ?? false });
  }

  async candidates(userId?: string): Promise<Candidate[]> {
    const cohort = await this.pilot.rankablePageIds(); // pilot.allowlist: rank cohort pages only
    const visible = userId ? await this.visiblePageIds(userId) : null;
    const allowed = cohort && visible ? [...cohort].filter((id) => visible.has(id)) : cohort ? [...cohort] : visible ? [...visible] : null;
    const products = await this.prisma.product.findMany({
      where: { status: "PUBLISHED", readiness: "READY", page: { status: "PUBLISHED" }, ...(allowed ? { pageId: { in: allowed } } : {}) },
      include: { page: true, variants: { where: { cutoutPath: { not: null } } } },
    });
    return products.map((p) => ({
      productId: p.id,
      pageId: p.pageId,
      priceRwf: p.priceRwf,
      category: p.category,
      fabric: p.fabric,
      occasions: p.occasions,
      styles: p.styles,
      madeToOrder: p.madeToOrder,
      leadTimeDays: p.leadTimeDays,
      featured: p.featured,
      rating: p.page.rating,
      district: p.page.district,
      sector: p.page.sector,
      variants: p.variants.map((v) => ({ id: v.id, colourHex: v.colourHex, colourName: v.colourName, inStock: v.stock > 0 || p.madeToOrder })),
    }));
  }

  async parse(text: string, source: "text" | "voice", locale?: string): Promise<Intent> {
    const raw = await this.ai.post<Intent>("/v1/intent/parse", { text, locale, source });
    return parse(Intent, raw);
  }

  /** Create the session's looks and render only the first few (progressive generation). */
  async session(userId: string, input: string, source: string, intent: Intent, ranked: { productId: string; variantId: string; score: number }[]) {
    const session = await this.prisma.intentSession.create({ data: { userId, input, source, intent } });
    const looks = [];
    for (const [i, r] of ranked.entries()) looks.push(await this.looks.create(userId, session.id, r.productId, r.variantId, i, r.score));
    const initial = await this.initialLooks(userId);
    for (const l of looks.slice(0, initial)) await this.looks.render(l.id).catch(() => undefined);
    return { sessionId: session.id, intent, total: looks.length };
  }

  async fromIntent(userId: string, input: string, source: string, intent: Intent) {
    const ranked = rank(await this.candidates(userId), intent, userId + input);
    return this.session(userId, input, source, intent, ranked);
  }

  /** Render the next looks only when the shopper reaches look n−1 (plan §4.4). */
  async advance(userId: string, sessionId: string, index: number) {
    const looks = await this.prisma.look.findMany({ where: { intentSessionId: sessionId, userId }, orderBy: { rank: "asc" } });
    if (!looks.length) throw new NotFoundException();
    const rendered = looks.filter((l) => l.generationId).length;
    if (index < rendered - 1) return { rendered, queued: 0 };
    const next = looks.filter((l) => !l.generationId).slice(0, LOOK_GUARDRAILS.prefetchPerSwipe);
    let queued = 0;
    for (const l of next) {
      try {
        await this.looks.render(l.id);
        queued++;
      } catch (e) {
        if (queued === 0) throw e;
      }
    }
    return { rendered: rendered + queued, queued };
  }
}

@Controller("intent")
export class IntentController {
  constructor(
    private intents: IntentService,
    private prisma: PrismaService,
    private ai: AiClient,
    private looks: LooksService,
    private pilot: PilotService,
  ) {}

  /** Parse only (no looks): used to show chips before the shopper signs in. */
  @Public()
  @Post("parse")
  async parseOnly(@Body() body: unknown) {
    const req = parse(IntentRequest, body);
    return this.intents.parse(req.text, req.source, req.locale);
  }

  /** Muse: text or voice transcript → intent → ranked looks (US-07.2). */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.pilot.assertShopper(user.id);
    const req = parse(IntentRequest, body);
    const intent = await this.intents.parse(req.text, req.source, req.locale);
    if (!intent.size) {
      const twin = await this.prisma.twin.findFirst({ where: { userId: user.id, deletedAt: null } });
      if (twin?.size) intent.size = twin.size;
    }
    return this.intents.fromIntent(user.id, req.text, req.source, intent);
  }

  /** Tap-to-edit chips: re-rank with the corrected intent. */
  @Post("refine")
  async refine(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.pilot.assertShopper(user.id);
    const intent = parse(Intent, (body as { intent?: unknown })?.intent);
    return this.intents.fromIntent(user.id, "refined", intent.source, intent);
  }

  /** Snap a fabric or outfit → visually similar items from several makers (US-07.4). */
  @Post("snap")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  async snap(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Attach a photo");
    await this.pilot.assertShopper(user.id);
    const { embedding, dominant_colours } = await this.ai.post<{ embedding: number[]; dominant_colours: string[] }>("/v1/embed/image", {
      image_b64: file.buffer.toString("base64"),
    });
    const rows = await this.prisma.$queryRawUnsafe<{ variantId: string; productId: string; pageId: string; sim: number }[]>(
      `SELECT v.id AS "variantId", p.id AS "productId", p."pageId", 1 - (v.embedding <=> $1::vector) AS sim
         FROM "Variant" v
         JOIN "Product" p ON p.id = v."productId"
         JOIN "Page" pg ON pg.id = p."pageId"
        WHERE v.embedding IS NOT NULL AND v."cutoutPath" IS NOT NULL
          AND p.status = 'PUBLISHED' AND p.readiness = 'READY' AND pg.status = 'PUBLISHED'
          AND (v.stock > 0 OR p."madeToOrder")
        ORDER BY v.embedding <=> $1::vector
        LIMIT 40`,
      `[${embedding.join(",")}]`,
    );
    const best = new Map<string, (typeof rows)[number]>();
    const cohort = await this.pilot.rankablePageIds();
    const visible = await this.intents.visiblePageIds(user.id);
    for (const r of rows) if (!best.has(r.productId) && (!cohort || cohort.has(r.pageId)) && (!visible || visible.has(r.pageId))) best.set(r.productId, r);
    const ranked = diversify([...best.values()], 9).map((r) => ({ productId: r.productId, variantId: r.variantId, score: Number(r.sim) }));
    const intent: Intent = {
      occasion: null,
      date: null,
      budgetMax: null,
      styles: [],
      colours: [],
      categories: [],
      size: null,
      location: null,
      language: "en",
      source: "snap",
      parser: "rules",
    };
    const res = await this.intents.session(user.id, "snap", "snap", intent, ranked);
    return { ...res, dominantColours: dominant_colours, makers: new Set(ranked.map((r) => best.get(r.productId)!.pageId)).size };
  }

  @Get(":sessionId")
  async get(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) {
    const session = await this.prisma.intentSession.findFirst({ where: { id: sessionId, userId: user.id } });
    if (!session) throw new NotFoundException();
    const looks = await this.looks.views(await this.looks.rows({ intentSessionId: sessionId, userId: user.id }));
    return { id: session.id, input: session.input, source: session.source, intent: session.intent, looks };
  }

  @Post(":sessionId/advance")
  async advance(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string, @Body() body: { index?: number }) {
    return this.intents.advance(user.id, sessionId, Number(body?.index ?? 0));
  }
}

@Module({ imports: [LooksModule], controllers: [IntentController], providers: [IntentService] })
export class IntentModule {}
