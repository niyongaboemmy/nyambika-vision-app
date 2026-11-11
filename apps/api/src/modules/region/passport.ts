import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EU_DPP_DRAFT_FIELDS, PassportData, passportDiff, passportUri, REGIONS, isRegion, validatePassport, type PassportData as Passport } from "@nyambika/contracts";
import { config } from "../../config";
import { Access } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";
import { ResidencyService } from "./residency";

/**
 * Digital Product Passport (FR-DPP-01..04). Each publish writes an immutable version (and a JSON
 * snapshot into the page's residency bucket); the public page always shows the latest unless ?v= is given.
 */
@Injectable()
export class PassportService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private residency: ResidencyService,
    private access: Access,
  ) {}

  private async product(productId: string) {
    const p = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { page: true, variants: { take: 1 }, makers: { include: { coopMember: true } } },
    });
    if (!p) throw new NotFoundException("Product not found");
    return p;
  }

  /** FR-DPP-01 prefill from what the product already knows. */
  async prefill(productId: string): Promise<Passport> {
    const p = await this.product(productId);
    const region = await this.residency.regionOfPage(p.pageId);
    const madeIn = REGIONS[isRegion(region) ? region : "RW"].name;
    const cotton = /cotton/i.test(p.fabric);
    return PassportData.parse({
      materials: cotton ? [{ fibre: "Cotton", percent: 100, origin: "" }] : [],
      fabric: { type: p.fabric, origin: "" },
      origin: {
        country: region,
        district: p.page.district,
        cooperative: p.page.memberType === "COOPERATIVE" ? p.page.name : "",
        makers: p.makers.filter((m) => m.coopMember.attributionConsent).map((m) => m.coopMember.name),
        handmade: true,
      },
      process: [
        { step: "Fabric selected", by: p.page.name, place: p.page.sector },
        { step: p.madeToOrder ? "Cut and sewn to measure" : "Cut and sewn", by: p.page.name, place: p.page.sector },
      ],
      care: cotton ? ["Hand wash cold, inside out", "Dry in shade", "Iron on medium"] : [],
      repair: { offered: p.page.memberType !== "SELLER", services: p.page.memberType !== "SELLER" ? ["Hem and fit alterations"] : [], contact: p.page.whatsapp },
      claims: { madeIn: `Made in ${madeIn}`, impactStory: "" },
    });
  }

  async draft(userId: string, productId: string) {
    const p = await this.product(productId);
    await this.access.requirePage(userId, p.pageId, ["PAGE_OWNER", "PAGE_STAFF", "COOP_ADMIN", "COOP_MEMBER"]);
    const cur = await this.prisma.productPassport.findUnique({ where: { productId } });
    return {
      productId,
      version: cur?.version ?? 0,
      data: cur ? PassportData.parse(cur.data) : await this.prefill(productId),
      claimsVerified: cur?.claimsVerified ?? false,
      url: passportUri(config.webUrl, productId, cur?.gtin),
      versions: await this.versions(productId),
    };
  }

  async versions(productId: string) {
    const rows = await this.prisma.productPassportVersion.findMany({ where: { productId }, orderBy: { version: "desc" }, take: 30 });
    return rows.map((r) => ({ version: r.version, note: r.note, changed: r.changed, at: r.createdAt }));
  }

  /** Publish a new immutable version. Changing claims resets the host's verification. */
  async publish(userId: string, productId: string, data: Passport, note: string) {
    const p = await this.product(productId);
    await this.access.requirePage(userId, p.pageId, ["PAGE_OWNER", "PAGE_STAFF", "COOP_ADMIN"]);
    const issues = validatePassport(data);
    if (issues.length) throw new BadRequestException({ message: issues[0], issues });
    const cur = await this.prisma.productPassport.findUnique({ where: { productId } });
    const prev = cur ? PassportData.parse(cur.data) : null;
    const changed = passportDiff(prev, data);
    if (prev && !changed.length) throw new BadRequestException("Nothing changed since the last version");
    const version = (cur?.version ?? 0) + 1;
    const claimsChanged = !prev || JSON.stringify(prev.claims) !== JSON.stringify(data.claims);
    const gtin = data.gtin || null;
    if (gtin) {
      const taken = await this.prisma.productPassport.findFirst({ where: { gtin, NOT: { productId } } });
      if (taken) throw new BadRequestException("That GTIN is already used by another passport");
    }
    await this.prisma.$transaction([
      this.prisma.productPassportVersion.create({ data: { productId, version, data, note, changed, editorId: userId } }),
      this.prisma.productPassport.upsert({
        where: { productId },
        create: { productId, pageId: p.pageId, version, data, gtin },
        update: { version, data, gtin, ...(claimsChanged ? { claimsVerified: false, verifiedById: null, verifiedAt: null } : {}) },
      }),
    ]);
    // Residency seam: the snapshot lands in the page's regional bucket.
    await this.residency.putForPage(p.pageId, `passports/${productId}/v${version}.json`, Buffer.from(JSON.stringify({ productId, version, data, at: new Date().toISOString() })));
    await this.access.audit(userId, "passport.publish", { productId, version, changed }, p.pageId);
    return this.draft(userId, productId);
  }

  /** FR-DPP-04: host verifies "Made in …" and impact claims. */
  async verify(userId: string, productId: string, verified: boolean) {
    await this.access.requireHost(userId);
    const cur = await this.prisma.productPassport.findUnique({ where: { productId } });
    if (!cur) throw new NotFoundException("No passport yet");
    await this.prisma.productPassport.update({ where: { productId }, data: { claimsVerified: verified, verifiedById: verified ? userId : null, verifiedAt: verified ? new Date() : null } });
    await this.access.audit(userId, verified ? "passport.claims_verified" : "passport.claims_unverified", { productId, version: cur.version }, cur.pageId);
    return { ok: true, claimsVerified: verified };
  }

  async pendingClaims() {
    const rows = await this.prisma.productPassport.findMany({ where: { claimsVerified: false }, orderBy: { updatedAt: "desc" }, take: 20 });
    const products = await this.prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, include: { page: true } });
    const by = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => {
      const d = PassportData.parse(r.data);
      return { productId: r.productId, version: r.version, title: by.get(r.productId)?.title ?? "", page: by.get(r.productId)?.page.name ?? "", madeIn: d.claims.madeIn, impactStory: d.claims.impactStory, updatedAt: r.updatedAt };
    }).filter((r) => r.madeIn || r.impactStory);
  }

  async byGtin(gtin: string) {
    const g = gtin.replace(/^0+/, "");
    const rows = await this.prisma.productPassport.findMany({ where: { gtin: { not: null } }, select: { productId: true, gtin: true } });
    const hit = rows.find((r) => r.gtin!.replace(/^0+/, "") === g);
    if (!hit) throw new NotFoundException("No passport for this GTIN");
    return { productId: hit.productId };
  }

  /** Public passport (light, printable page `/p/<id>`). */
  async public(productId: string, v?: number) {
    const cur = await this.prisma.productPassport.findUnique({ where: { productId } });
    if (!cur) throw new NotFoundException("This product has no passport yet");
    const p = await this.product(productId);
    if (p.status !== "PUBLISHED" && p.status !== "OUT_OF_STOCK" && p.status !== "ARCHIVED") throw new NotFoundException("This product has no passport yet");
    const ver = v ? await this.prisma.productPassportVersion.findUnique({ where: { productId_version: { productId, version: v } } }) : null;
    if (v && !ver) throw new NotFoundException("No such version");
    const data = PassportData.parse(ver ? ver.data : cur.data);
    const version = ver?.version ?? cur.version;
    const url = passportUri(config.webUrl, productId, cur.gtin);
    const image = this.storage.publicUrl(p.variants[0]?.imagePath);
    const versions = await this.versions(productId);
    return {
      productId,
      version,
      latest: cur.version,
      publishedAt: versions.find((x) => x.version === version)?.at ?? cur.updatedAt,
      title: p.title,
      category: p.category,
      image,
      page: { name: p.page.name, handle: p.page.handle, memberType: p.page.memberType, verified: p.page.verified, district: p.page.district, sector: p.page.sector },
      data,
      claimsVerified: cur.claimsVerified && version === cur.version,
      verifiedAt: cur.verifiedAt,
      url,
      versions,
      euDraftFields: EU_DPP_DRAFT_FIELDS,
      jsonLd: jsonLd({ url, title: p.title, category: p.category, image: image ? `${config.webUrl}${image}` : null, brand: p.page.name, version, data }),
    };
  }
}

/** schema.org Product + draft DPP vocabulary (namespace marked draft). */
export function jsonLd(x: { url: string; title: string; category: string; image: string | null; brand: string; version: number; data: Passport }) {
  const d = x.data;
  const prop = (name: string, value: unknown) => ({ "@type": "PropertyValue", name, value });
  return {
    "@context": ["https://schema.org", { dpp: "https://nyambika.rw/ns/textile-dpp-draft#" }],
    "@type": "Product",
    "@id": x.url,
    name: x.title,
    category: x.category,
    ...(x.image ? { image: x.image } : {}),
    brand: { "@type": "Brand", name: x.brand },
    manufacturer: { "@type": "Organization", name: d.origin.cooperative || x.brand, address: { "@type": "PostalAddress", addressRegion: d.origin.district, addressCountry: d.origin.country } },
    countryOfOrigin: d.origin.country,
    ...(d.gtin ? { gtin: d.gtin } : {}),
    material: d.materials.map((m) => `${m.percent}% ${m.fibre}`).join(", ") || undefined,
    additionalProperty: [
      prop("dpp:passportVersion", x.version),
      prop("dpp:fibreComposition", d.materials),
      prop("dpp:materialOrigin", d.fabric.origin || null),
      prop("dpp:manufacturerContributors", d.origin.makers),
      prop("dpp:handmade", d.origin.handmade),
      prop("dpp:batchNumber", d.production.batch || null),
      prop("dpp:dateOfManufacturing", d.production.date || null),
      prop("dpp:manufacturingProcessSteps", d.process),
      prop("dpp:careInstructions", d.care),
      prop("dpp:repairServices", d.repair),
      prop("dpp:certificationsAndLabels", d.certifications),
      prop("dpp:carbonFootprint", d.carbon),
      prop("dpp:alignmentStatus", "draft: EU ESPR textile delegated act not yet published"),
    ],
  };
}
