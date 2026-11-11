import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, Module, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, Public } from "../../common/auth";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { CatalogueModule, CatalogueService } from "../catalogue/catalogue.module";

/** Import format for a wave. The legacy export (OI-04) is transformed into this shape. */
const LegacyColour = z.object({
  name: z.string().min(1),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sizes: z.array(z.string()).min(1).default(["S", "M", "L", "XL"]),
  stock: z.number().int().min(0).default(0),
  imageUrl: z.string().url().optional(),
  imageB64: z.string().optional(),
});
const LegacyProduct = z.object({
  legacyId: z.string(),
  title: z.string().min(2),
  description: z.string().default(""),
  category: z.string().min(2),
  priceRwf: z.number().int().positive(),
  madeToOrder: z.boolean().default(false),
  leadTimeDays: z.number().int().min(0).default(0),
  occasions: z.array(z.string()).default([]),
  styles: z.array(z.string()).default([]),
  fabric: z.string().default(""),
  colours: z.array(LegacyColour).min(1),
});
const LegacyPage = z.object({
  legacyUrl: z.string().min(1),
  handle: z.string().regex(/^[a-z0-9-]{3,40}$/),
  name: z.string().min(2),
  memberType: z.enum(["TAILOR", "COOPERATIVE", "SELLER"]),
  ownerPhone: z.string().min(9),
  ownerName: z.string().optional(),
  story: z.string().default(""),
  district: z.string().default(""),
  sector: z.string().default(""),
  whatsapp: z.string().default(""),
  momoMerchant: z.string().default(""),
  products: z.array(LegacyProduct).default([]),
});
const WaveBundle = z.object({ wave: z.string().min(1), pages: z.array(LegacyPage).min(1).max(50) });

const toE164 = (p: string) => (p.startsWith("+") ? p : `+250${p.replace(/\D/g, "").replace(/^0/, "")}`);
const legacyPath = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return ("/" + u.replace(/^\/+/, "")).replace(/\/+$/, "");
  }
};

interface Defect {
  severity: "blocker" | "fix" | "info";
  message: string;
}

@Controller()
export class MigrationController {
  private log = new Logger("Migration");

  constructor(
    private prisma: PrismaService,
    private access: Access,
    private catalogue: CatalogueService,
    private messaging: MessagingService,
    private storage: StorageService,
  ) {}

  /** Export → transform → import (runbook §16.3 step 2): hidden pages, checksums, image re-processing. */
  @Post("admin/migration/waves")
  async importWave(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const bundle = parse(WaveBundle, body);
    const wave = await this.prisma.migrationWave.create({ data: { name: bundle.wave, createdBy: user.id } });
    const report: { handle: string; ok: boolean; defects: Defect[]; error?: string }[] = [];

    for (const src of bundle.pages) {
      try {
        report.push({ handle: src.handle, ok: true, defects: await this.importPage(wave.id, src) });
      } catch (e) {
        report.push({ handle: src.handle, ok: false, defects: [], error: (e as Error).message });
      }
    }
    await this.access.audit(user.id, "migration.import", { wave: wave.name, pages: report.length, failed: report.filter((r) => !r.ok).length });
    return { waveId: wave.id, report };
  }

  private async importPage(waveId: string, src: z.infer<typeof LegacyPage>): Promise<Defect[]> {
    if (await this.prisma.page.findUnique({ where: { handle: src.handle } })) throw new Error(`Handle ${src.handle} already exists`);
    const fromPath = legacyPath(src.legacyUrl);
    if (await this.prisma.redirect.findUnique({ where: { fromPath } })) throw new Error(`Legacy URL ${fromPath} already migrated`);
    const checksum = createHash("sha256").update(JSON.stringify(src)).digest("hex");
    const phone = toE164(src.ownerPhone);
    const owner = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, name: src.ownerName, roles: { create: { role: "SHOPPER" } } },
    });
    const defects: Defect[] = [];
    // Hidden until the owner signs off and the host goes live (OP-1: the member owns the page).
    const page = await this.prisma.page.create({
      data: {
        handle: src.handle,
        name: src.name,
        memberType: src.memberType,
        status: "DRAFT",
        story: src.story,
        district: src.district,
        sector: src.sector,
        whatsapp: src.whatsapp || phone,
        momoMerchant: src.momoMerchant,
        roles: { create: { userId: owner.id, role: src.memberType === "COOPERATIVE" ? "COOP_ADMIN" : "PAGE_OWNER" } },
        subscription: { create: { planCode: "BASIC", monthlyCap: 20 } },
      },
    });
    if (!src.momoMerchant) defects.push({ severity: "fix", message: "No MoMo merchant number: hold-to-buy stays off until it's added (WhatsApp ordering works)." });
    if (src.story.length < 30) defects.push({ severity: "info", message: "Short page story: a few sentences about the maker help shoppers." });
    if (!src.products.length) defects.push({ severity: "fix", message: "No products imported." });

    for (const lp of src.products) {
      const { colours, legacyId, ...rest } = lp;
      void legacyId;
      const product = await this.prisma.product.create({
        data: {
          ...rest,
          pageId: page.id,
          status: "DRAFT",
          submittedById: owner.id,
          variants: { create: colours.map((c) => ({ colourName: c.name, colourHex: c.hex, sizes: c.sizes, stock: c.stock })) },
        },
        include: { variants: true },
      });
      for (const [i, v] of product.variants.entries()) {
        const c = colours[i];
        const img = await this.loadImage(c).catch((e: Error) => {
          defects.push({ severity: "fix", message: `${lp.title} (${c.name}): image could not be loaded (${e.message}).` });
          return null;
        });
        if (!img) continue;
        const r = await this.catalogue.attachVariantImage(v.id, img);
        if (r.readiness !== "READY") defects.push({ severity: "fix", message: `${lp.title} (${c.name}): ${r.readiness.replace(/_/g, " ").toLowerCase()} · ${r.notes.join("; ")}` });
      }
    }
    await this.prisma.redirect.create({ data: { fromPath, toPath: `/m/${src.handle}`, active: false } });
    await this.prisma.migrationItem.create({
      data: { waveId, pageId: page.id, legacyUrl: src.legacyUrl, checksum, defects: defects as object[], reviewToken: randomBytes(18).toString("base64url") },
    });
    return defects;
  }

  private async loadImage(c: z.infer<typeof LegacyColour>): Promise<Buffer> {
    if (c.imageB64) return Buffer.from(c.imageB64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (!c.imageUrl) throw new Error("no image");
    const res = await fetch(c.imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/^image\//.test(res.headers.get("content-type") ?? "")) throw new Error("not an image");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error("image over 8 MB");
    return buf;
  }

  @Get("admin/migration/waves")
  async waves(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    const waves = await this.prisma.migrationWave.findMany({ orderBy: { createdAt: "desc" }, include: { items: { orderBy: { createdAt: "asc" } } } });
    const pageIds = waves.flatMap((w) => w.items.map((i) => i.pageId));
    const pages = await this.prisma.page.findMany({ where: { id: { in: pageIds } }, select: { id: true, name: true, handle: true, status: true, _count: { select: { products: true } } } });
    const byId = new Map(pages.map((p) => [p.id, p]));
    const redirects = await this.prisma.redirect.findMany({ where: { toPath: { in: pages.map((p) => `/m/${p.handle}`) } } });
    const rByTo = new Map(redirects.map((r) => [r.toPath, r]));
    return waves.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.createdAt,
      items: w.items.map((i) => {
        const p = byId.get(i.pageId);
        const r = p ? rByTo.get(`/m/${p.handle}`) : undefined;
        return {
          id: i.id,
          status: i.status,
          legacyUrl: i.legacyUrl,
          checksum: i.checksum.slice(0, 12),
          defects: i.defects,
          ownerNote: i.ownerNote,
          reviewUrl: `${config.webUrl}/migrate/${i.reviewToken}`,
          page: p ? { id: p.id, name: p.name, handle: p.handle, status: p.status, products: p._count.products } : null,
          redirect: r ? { from: r.fromPath, active: r.active, hits: r.hits } : null,
        };
      }),
    }));
  }

  /** Runbook step 3: send the owner a review link on WhatsApp. */
  @Post("admin/migration/items/:id/send-review")
  async sendReview(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.access.requireHost(user.id);
    const item = await this.prisma.migrationItem.findUniqueOrThrow({ where: { id } });
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id: item.pageId }, include: { roles: { include: { user: true } } } });
    const owner = page.roles.find((r) => r.role === "PAGE_OWNER" || r.role === "COOP_ADMIN")?.user;
    if (!owner) throw new BadRequestException("Page has no owner");
    await this.messaging.send(
      "WHATSAPP",
      owner.phone,
      "migration_review",
      `Muraho! Your page ${page.name} has moved to the new Nyambika. Please check it and sign off: ${config.webUrl}/migrate/${item.reviewToken}`,
      item.id,
    );
    await this.prisma.migrationItem.update({ where: { id }, data: { status: "IN_REVIEW" } });
    await this.access.audit(user.id, "migration.send_review", { itemId: id }, page.id);
    return { ok: true };
  }

  /** Runbook step 5: go live and enable the legacy redirect. */
  @Post("admin/migration/items/:id/go-live")
  async goLive(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.access.requireHost(user.id);
    const item = await this.prisma.migrationItem.findUniqueOrThrow({ where: { id } });
    if (item.status !== "SIGNED_OFF") throw new BadRequestException("The owner must sign off first");
    const page = await this.prisma.page.update({ where: { id: item.pageId }, data: { status: "PUBLISHED", verified: true } });
    await this.prisma.product.updateMany({ where: { pageId: page.id, status: "DRAFT" }, data: { status: "PUBLISHED" } });
    await this.prisma.redirect.updateMany({ where: { toPath: `/m/${page.handle}` }, data: { active: true } });
    await this.prisma.migrationItem.update({ where: { id }, data: { status: "LIVE", liveAt: new Date() } });
    await this.access.audit(user.id, "migration.go_live", { itemId: id }, page.id);
    return { ok: true };
  }

  /** Per-page rollback: disable the redirect and hide the new page; legacy stays live (§16.3 step 7). */
  @Post("admin/migration/items/:id/rollback")
  async rollback(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.access.requireHost(user.id);
    const item = await this.prisma.migrationItem.findUniqueOrThrow({ where: { id } });
    const page = await this.prisma.page.update({ where: { id: item.pageId }, data: { status: "DRAFT" } });
    await this.prisma.redirect.updateMany({ where: { toPath: `/m/${page.handle}` }, data: { active: false } });
    await this.prisma.migrationItem.update({ where: { id }, data: { status: "ROLLED_BACK" } });
    await this.access.audit(user.id, "migration.rollback", { itemId: id }, page.id);
    return { ok: true };
  }

  @Get("admin/migration/not-found")
  async notFound(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.prisma.notFoundHit.findMany({ orderBy: { hits: "desc" }, take: 30 });
  }

  // ---- Owner review (signed-in owner of the migrated page) ----

  private async reviewItem(token: string, userId: string) {
    const item = await this.prisma.migrationItem.findUnique({ where: { reviewToken: token } });
    if (!item) throw new NotFoundException("This review link isn't valid");
    const isOwner = await this.prisma.roleAssignment.count({ where: { userId, pageId: item.pageId, role: { in: ["PAGE_OWNER", "COOP_ADMIN"] } } });
    if (!isOwner && !(await this.access.isHost(userId))) throw new ForbiddenException("Sign in with the phone number registered for this page");
    return item;
  }

  @Get("migration/review/:token")
  async review(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    const item = await this.reviewItem(token, user.id);
    const page = await this.prisma.page.findUniqueOrThrow({
      where: { id: item.pageId },
      include: { products: { include: { variants: true }, orderBy: { createdAt: "asc" } } },
    });
    return {
      status: item.status,
      defects: item.defects,
      legacyUrl: item.legacyUrl,
      ownerNote: item.ownerNote,
      page: {
        id: page.id,
        name: page.name,
        handle: page.handle,
        memberType: page.memberType,
        story: page.story,
        district: page.district,
        sector: page.sector,
        whatsapp: page.whatsapp,
        momoMerchant: page.momoMerchant,
        theme: page.theme,
        products: page.products.map((p) => ({
          id: p.id,
          title: p.title,
          priceRwf: p.priceRwf,
          readiness: p.readiness,
          image: this.storage.publicUrl(p.variants.find((v) => v.imagePath)?.imagePath),
          colours: p.variants.map((v) => v.colourName),
        })),
      },
    };
  }

  /** Runbook step 4: owner sign-off is recorded before go-live. */
  @Post("migration/review/:token/sign-off")
  async signOff(@CurrentUser() user: AuthUser, @Param("token") token: string) {
    const item = await this.reviewItem(token, user.id);
    if (!["IN_REVIEW", "CHANGES_REQUESTED", "IMPORTED"].includes(item.status)) throw new BadRequestException(`Already ${item.status.toLowerCase()}`);
    await this.prisma.migrationItem.update({ where: { id: item.id }, data: { status: "SIGNED_OFF", signedOffAt: new Date() } });
    await this.access.audit(user.id, "migration.owner_sign_off", { itemId: item.id }, item.pageId);
    return { status: "SIGNED_OFF" };
  }

  @Post("migration/review/:token/request-changes")
  async requestChanges(@CurrentUser() user: AuthUser, @Param("token") token: string, @Body() body: unknown) {
    const { note } = parse(z.object({ note: z.string().min(3).max(500) }), body);
    const item = await this.reviewItem(token, user.id);
    await this.prisma.migrationItem.update({ where: { id: item.id }, data: { status: "CHANGES_REQUESTED", ownerNote: note } });
    await this.prisma.moderationItem.create({ data: { kind: "MIGRATION_FIX", refId: item.id, pageId: item.pageId, reason: note } });
    await this.access.audit(user.id, "migration.owner_changes", { itemId: item.id, note }, item.pageId);
    return { status: "CHANGES_REQUESTED" };
  }

  // ---- Public redirect resolution for legacy URLs ----

  @Public()
  @Get("redirects/resolve")
  async resolve(@Query("path") raw: string) {
    const path = legacyPath(raw ?? "/");
    const r = await this.prisma.redirect.findUnique({ where: { fromPath: path } });
    if (r?.active) {
      await this.prisma.redirect.update({ where: { fromPath: path }, data: { hits: { increment: 1 } } });
      return { to: r.toPath };
    }
    await this.prisma.notFoundHit.upsert({ where: { path }, update: { hits: { increment: 1 }, lastSeen: new Date() }, create: { path } });
    return { to: null };
  }
}

@Module({ imports: [CatalogueModule], controllers: [MigrationController] })
export class MigrationModule {}
