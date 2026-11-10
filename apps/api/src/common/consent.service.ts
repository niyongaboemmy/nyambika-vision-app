import { Global, Injectable, Module } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "./prisma.service";

export const NOTICE_VERSION = "2026-11-v1";

/** Append-only consent ledger; each record hashes the previous one for tamper evidence. */
@Injectable()
export class ConsentService {
  constructor(private prisma: PrismaService) {}

  async record(userId: string, purpose: string, granted: boolean, locale: string) {
    const last = await this.prisma.consentRecord.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    const prevHash = last?.hash ?? "GENESIS";
    const createdAt = new Date();
    const hash = createHash("sha256")
      .update([prevHash, userId, purpose, granted, NOTICE_VERSION, locale, createdAt.toISOString()].join("|"))
      .digest("hex");
    return this.prisma.consentRecord.create({
      data: { userId, purpose, granted, noticeVersion: NOTICE_VERSION, locale, prevHash, hash, createdAt },
    });
  }

  async current(userId: string) {
    const all = await this.prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    const state: Record<string, { granted: boolean; at: Date }> = {};
    for (const r of all) state[r.purpose] = { granted: r.granted, at: r.createdAt };
    return state;
  }

  async has(userId: string, purpose: string) {
    return (await this.current(userId))[purpose]?.granted === true;
  }

  /** Recompute the chain to prove the ledger has not been edited. */
  async verifyChain(userId: string) {
    const all = await this.prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    let prev = "GENESIS";
    for (const r of all) {
      const h = createHash("sha256")
        .update([prev, userId, r.purpose, r.granted, r.noticeVersion, r.locale, r.createdAt.toISOString()].join("|"))
        .digest("hex");
      if (r.prevHash !== prev || r.hash !== h) return false;
      prev = r.hash;
    }
    return true;
  }
}

@Global()
@Module({ providers: [ConsentService], exports: [ConsentService] })
export class ConsentModule {}
