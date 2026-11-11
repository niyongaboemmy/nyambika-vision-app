import { Body, ConflictException, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import { PageInput } from "@nyambika/contracts";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";

const PUBLIC_STATUSES = ["PUBLISHED"] as const;

@Controller("pages")
export class PagesController {
  constructor(
    private prisma: PrismaService,
    private access: Access,
    private storage: StorageService,
  ) {}

  /** Secondary "Browse makers" directory (CR-01). */
  @Public()
  @Get()
  async directory(@Query("q") q?: string, @Query("type") type?: string, @Query("district") district?: string) {
    const pages = await this.prisma.page.findMany({
      where: {
        status: { in: [...PUBLIC_STATUSES] },
        ...(type ? { memberType: type as never } : {}),
        ...(district ? { district: { equals: district, mode: "insensitive" } } : {}),
        ...(q
          ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { story: { contains: q, mode: "insensitive" } }] }
          : {}),
      },
      orderBy: [{ verified: "desc" }, { rating: "desc" }],
      include: { _count: { select: { products: { where: { status: "PUBLISHED" } }, follows: true } } },
    });
    return pages.map((p) => this.card(p));
  }

  /** Maker Space data (FR-PAGE-04). Public, SEO-rendered by the web app. */
  @Public()
  @Get("by-handle/:handle")
  async byHandle(@Param("handle") handle: string, @CurrentUser() user: AuthUser | null) {
    const page = await this.prisma.page.findUnique({
      where: { handle },
      include: {
        products: {
          where: { status: "PUBLISHED" },
          orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
          include: { variants: true, makers: { include: { coopMember: true } }, media: { where: { kind: "STUDIO" } } },
        },
        _count: { select: { follows: true } },
      },
    });
    if (!page || page.status !== "PUBLISHED") throw new NotFoundException("This page isn't available");
    const reviews = await this.prisma.review.findMany({
      where: { pageId: page.id, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { order: { select: { shopper: { select: { name: true } } } } },
    });
    const following = user
      ? Boolean(await this.prisma.follow.findUnique({ where: { userId_pageId: { userId: user.id, pageId: page.id } } }))
      : false;
    return {
      ...this.card(page),
      productCount: page.products.length,
      story: page.story,
      instagram: page.instagram,
      whatsapp: page.whatsapp,
      following,
      products: page.products.map((p) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        priceRwf: p.priceRwf,
        madeToOrder: p.madeToOrder,
        leadTimeDays: p.leadTimeDays,
        readiness: p.readiness,
        featured: p.featured,
        makers: p.makers.filter((m) => m.coopMember.attributionConsent).map((m) => m.coopMember.name),
        studio: p.media.map((m) => this.storage.publicUrl(m.path)),
        variants: p.variants.map((v) => ({
          id: v.id,
          colourName: v.colourName,
          colourHex: v.colourHex,
          sizes: v.sizes,
          inStock: v.stock > 0 || p.madeToOrder,
          image: this.storage.publicUrl(v.imagePath),
        })),
      })),
      reviews: reviews.map((r) => ({ rating: r.rating, text: r.text, by: r.order.shopper.name ?? "Shopper", at: r.createdAt })),
    };
  }

  @Post(":id/follow")
  async follow(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    const existing = await this.prisma.follow.findUnique({ where: { userId_pageId: { userId: user.id, pageId: id } } });
    if (existing) await this.prisma.follow.delete({ where: { userId_pageId: { userId: user.id, pageId: id } } });
    else await this.prisma.follow.create({ data: { userId: user.id, pageId: id } });
    return { following: !existing };
  }

  // ---- Page manager (member side) ----

  @Get("mine/list")
  async mine(@CurrentUser() user: AuthUser) {
    const roles = await this.prisma.roleAssignment.findMany({
      where: { userId: user.id, pageId: { not: null } },
      include: { page: { include: { subscription: true, _count: { select: { products: true, orders: true } } } } },
    });
    return roles.map((r) => ({ role: r.role, ...this.card(r.page!), plan: r.page!.subscription?.planCode ?? "BASIC" }));
  }

  /** FR-PAGE-01: one page per member; extra pages need host approval. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(PageInput, body);
    const owned = await this.prisma.roleAssignment.count({
      where: { userId: user.id, role: { in: ["PAGE_OWNER", "COOP_ADMIN"] } },
    });
    if (owned > 0 && !(await this.access.isHost(user.id))) {
      throw new ConflictException("You already own a page. Additional pages need host approval.");
    }
    if (await this.prisma.page.findUnique({ where: { handle: input.handle } })) {
      throw new ConflictException("That page address is taken");
    }
    const role = input.memberType === "COOPERATIVE" ? "COOP_ADMIN" : "PAGE_OWNER";
    const page = await this.prisma.page.create({
      data: {
        ...input,
        status: "PENDING_VERIFICATION",
        roles: { create: { userId: user.id, role } },
        subscription: { create: { planCode: "BASIC", monthlyCap: 20 } },
      },
    });
    await this.prisma.moderationItem.create({
      data: { kind: "PAGE_VERIFICATION", refId: page.id, pageId: page.id, reason: `New ${input.memberType.toLowerCase()} page: ${input.name}` },
    });
    await this.access.audit(user.id, "page.create", { handle: page.handle }, page.id);
    return page;
  }

  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.access.requirePage(user.id, id, [...MANAGE, "COOP_MEMBER"]);
    const page = await this.prisma.page.findUnique({
      where: { id },
      include: { subscription: { include: { plan: true } }, roles: { include: { user: { select: { phone: true, name: true } } } } },
    });
    if (!page) throw new NotFoundException();
    const isManager =
      (await this.access.isHost(user.id)) || page.roles.some((r) => r.userId === user.id && MANAGE.includes(r.role));
    if (isManager) return { ...page, myAccess: "MANAGER" };
    // Cooperative members see their page context, not staff, payout or billing details (FR-COOP-06).
    const { roles: _r, momoMerchant: _m, airtelMerchant: _a, subscription: _s, ...rest } = page;
    return { ...rest, roles: [], subscription: null, momoMerchant: "", myAccess: "MEMBER" };
  }

  @Patch(":id")
  async update(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, id, ["PAGE_OWNER", "COOP_ADMIN"]);
    const input = parse(PageInput.partial().omit({ handle: true }).extend({ allowanceOn: z.boolean().optional() }), body);
    const page = await this.prisma.page.update({ where: { id }, data: input });
    await this.access.audit(user.id, "page.update", input, id);
    return page;
  }

  /** FR-PAGE-08: vacation mode / unpublish without losing data. */
  @Post(":id/status")
  async setStatus(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, id, ["PAGE_OWNER", "COOP_ADMIN"]);
    const { status } = parse(z.object({ status: z.enum(["PUBLISHED", "PAUSED"]) }), body);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id } });
    if (status === "PUBLISHED" && !page.verified) {
      throw new ConflictException("Your page will go live once the Nyambika team verifies it.");
    }
    if (page.status === "SUSPENDED") throw new ConflictException("This page is suspended. Contact support.");
    await this.access.audit(user.id, "page.status", { from: page.status, to: status }, id);
    return this.prisma.page.update({ where: { id }, data: { status } });
  }

  /** FR-ACC-05: invite / remove staff. */
  @Post(":id/staff")
  async addStaff(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, id, ["PAGE_OWNER", "COOP_ADMIN"]);
    const { phone } = parse(z.object({ phone: z.string().min(9) }), body);
    const normalised = phone.startsWith("+") ? phone : `+250${phone.replace(/\D/g, "").replace(/^0/, "")}`;
    const staff = await this.prisma.user.upsert({
      where: { phone: normalised },
      update: {},
      create: { phone: normalised, roles: { create: { role: "SHOPPER" } } },
    });
    await this.prisma.roleAssignment.upsert({
      where: { userId_role_pageId: { userId: staff.id, role: "PAGE_STAFF", pageId: id } },
      update: {},
      create: { userId: staff.id, role: "PAGE_STAFF", pageId: id },
    });
    await this.access.audit(user.id, "staff.add", { phone: normalised }, id);
    return { ok: true };
  }

  @Delete(":id/staff/:userId")
  async removeStaff(@Param("id") id: string, @Param("userId") staffId: string, @CurrentUser() user: AuthUser) {
    await this.access.requirePage(user.id, id, ["PAGE_OWNER", "COOP_ADMIN"]);
    await this.prisma.roleAssignment.deleteMany({ where: { userId: staffId, pageId: id, role: "PAGE_STAFF" } });
    await this.access.audit(user.id, "staff.remove", { userId: staffId }, id);
    return { ok: true };
  }

  private card(p: {
    id: string;
    handle: string;
    name: string;
    memberType: string;
    status: string;
    verified: boolean;
    district: string;
    sector: string;
    theme: string;
    rating: number;
    reviewCount: number;
    story?: string;
    _count?: { products?: number; follows?: number; orders?: number };
  }) {
    return {
      id: p.id,
      handle: p.handle,
      name: p.name,
      memberType: p.memberType,
      status: p.status,
      verified: p.verified,
      district: p.district,
      sector: p.sector,
      theme: p.theme,
      rating: p.rating,
      reviewCount: p.reviewCount,
      tagline: (p.story ?? "").slice(0, 120),
      productCount: p._count?.products ?? 0,
      followers: p._count?.follows ?? 0,
      orderCount: p._count?.orders,
    };
  }
}

@Module({ controllers: [PagesController] })
export class PagesModule {}
