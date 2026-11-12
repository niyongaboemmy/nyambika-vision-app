import { Controller, Get, Module, Param, Query } from "@nestjs/common";
import { Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { creditGroups, mediaPath, pickCopy, type CreditRow } from "./credits";

/**
 * Image credits (CC BY / BY-SA attribution for seeded photos, cut-outs, recolours and illustrations) and the
 * trilingual product copy. Public: credits must be reachable from every product image and from /credits.
 */
@Controller()
export class CreditsController {
  constructor(private prisma: PrismaService) {}

  private view(c: CreditRow) {
    return {
      path: c.path,
      title: c.title,
      author: c.author,
      sourceUrl: c.sourceUrl,
      licence: c.licence,
      licenceUrl: c.licenceUrl,
      shareAlike: c.shareAlike,
      changes: c.changes,
      illustration: c.illustration,
    };
  }

  @Public()
  @Get("credits")
  async all() {
    const rows = await this.prisma.mediaCredit.findMany({ orderBy: { assetKey: "asc" } });
    return { sources: creditGroups(rows) };
  }

  /** Credit for one image URL (`/api/files/public/media/…`) or storage path. */
  @Public()
  @Get("credits/media")
  async media(@Query("src") src = "") {
    const path = mediaPath(src);
    const row = path ? await this.prisma.mediaCredit.findUnique({ where: { path } }) : null;
    return { credit: row ? this.view(row) : null };
  }

  /** Credits for every image of a product (all colours). */
  @Public()
  @Get("credits/products/:id")
  async product(@Param("id") id: string) {
    const p = await this.prisma.product.findUnique({ where: { id }, include: { variants: true, media: true } });
    if (!p) return { credits: [] };
    const paths = [...p.variants.flatMap((v) => [v.imagePath, v.cutoutPath]), ...p.media.map((m) => m.path)].filter((x): x is string => Boolean(x));
    const rows = await this.prisma.mediaCredit.findMany({ where: { path: { in: paths } } });
    const seen = new Set<string>();
    return { credits: rows.filter((r) => !seen.has(r.assetKey) && seen.add(r.assetKey)).map((r) => this.view(r)) };
  }

  /** Product title/description in the shopper's language (falls back to English). */
  @Public()
  @Get("copy/products/:id")
  async copy(@Param("id") id: string, @Query("locale") locale = "en") {
    const rows = await this.prisma.productCopy.findMany({ where: { productId: id } });
    return { copy: pickCopy(rows, locale) };
  }
}

@Module({ controllers: [CreditsController] })
export class CreditsModule {}
