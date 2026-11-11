import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { REGION_CODES, type RegionCode } from "@nyambika/contracts";
import { PrismaService } from "../../common/prisma.service";
import { StorageService } from "../../common/storage.service";

/**
 * Data-residency routing seam (E41, ADR-0006). Every region maps to an object-store bucket and a
 * Postgres schema/database. Today one database and one local store serve all regions; the seam lets
 * personal and order data for a Kenyan page move to Kenyan infrastructure by configuration only.
 *
 *   RESIDENCY_MODE=off     (default) everything in the home store/DB; routes are reported, not applied
 *   RESIDENCY_MODE=prefix  storage keys are written under regions/<bucket>/… (bucket stand-in)
 *   DATABASE_URL_KE=…      a region DB; `prisma(region)` returns a client bound to it
 */
export interface ResidencyRoute {
  region: RegionCode;
  bucket: string;
  dbSchema: string;
  storagePrefix: string;
  database: "home" | "regional";
  applied: boolean;
}

export const DEFAULT_BUCKETS: Record<RegionCode, { bucket: string; dbSchema: string }> = {
  RW: { bucket: "nyambika-rw-kgl", dbSchema: "public" },
  KE: { bucket: "nyambika-ke-nbo", dbSchema: "region_ke" },
  UG: { bucket: "nyambika-ug-kla", dbSchema: "region_ug" },
  TZ: { bucket: "nyambika-tz-dar", dbSchema: "region_tz" },
};

export const HOME_REGION: RegionCode = "RW";

/** Pure routing decision (tested): where data for a region lives under the given mode/config. */
export function routeFor(region: RegionCode, mode: string, cfg: { bucket?: string; dbSchema?: string } = {}, env: Record<string, string | undefined> = {}): ResidencyRoute {
  const d = DEFAULT_BUCKETS[region];
  const bucket = cfg.bucket || d.bucket;
  const dbSchema = cfg.dbSchema || d.dbSchema;
  const prefixMode = mode === "prefix" && region !== HOME_REGION;
  return {
    region,
    bucket,
    dbSchema,
    storagePrefix: prefixMode ? `regions/${bucket}/` : "",
    database: region !== HOME_REGION && env[`DATABASE_URL_${region}`] ? "regional" : "home",
    applied: prefixMode,
  };
}

/** Rewrite a storage key into its region's bucket (idempotent). */
export function regionalKey(route: ResidencyRoute, rel: string) {
  const clean = rel.replace(/^\/+/, "");
  return route.storagePrefix && !clean.startsWith(route.storagePrefix) ? `${route.storagePrefix}${clean}` : clean;
}

@Injectable()
export class ResidencyService implements OnModuleDestroy {
  private log = new Logger("Residency");
  private clients = new Map<RegionCode, PrismaClient>();
  readonly mode = process.env.RESIDENCY_MODE ?? "off";

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async route(region: RegionCode): Promise<ResidencyRoute> {
    const cfg = await this.prisma.regionConfig.findUnique({ where: { code: region } });
    return routeFor(region, this.mode, { bucket: cfg?.storageBucket, dbSchema: cfg?.dbSchema }, process.env);
  }

  async regionOfPage(pageId: string): Promise<RegionCode> {
    const r = await this.prisma.pageRegion.findUnique({ where: { pageId } });
    return (r?.region as RegionCode) ?? HOME_REGION;
  }

  /** Write an object for a page into its region's bucket (via the existing StorageService). */
  async putForPage(pageId: string, rel: string, data: Buffer) {
    const route = await this.route(await this.regionOfPage(pageId));
    const key = regionalKey(route, rel);
    await this.storage.put(key, data);
    return { key, route };
  }

  /**
   * Prisma client for a region: the home client unless DATABASE_URL_<REGION> is configured.
   * Running several databases is out of scope locally; this is the seam the data layer calls.
   */
  prismaFor(region: RegionCode): PrismaClient {
    const url = region !== HOME_REGION ? process.env[`DATABASE_URL_${region}`] : undefined;
    if (!url) return this.prisma;
    let c = this.clients.get(region);
    if (!c) {
      c = new PrismaClient({ datasourceUrl: url });
      this.clients.set(region, c);
      this.log.log(`regional database client for ${region}`);
    }
    return c;
  }

  async all() {
    return Promise.all(REGION_CODES.map((r) => this.route(r)));
  }

  async onModuleDestroy() {
    await Promise.all([...this.clients.values()].map((c) => c.$disconnect()));
  }
}
