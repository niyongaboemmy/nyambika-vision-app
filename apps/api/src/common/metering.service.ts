import { Global, HttpException, HttpStatus, Injectable, Module } from "@nestjs/common";
import { LOOK_GUARDRAILS } from "@nyambika/contracts";
import { config } from "../config";
import { dailyCapBody, kigaliDayStart } from "./kigali-day";
import { PrismaService } from "./prisma.service";

/**
 * Metering and allowance resolution (FR-PLAN-02/03, plan §4.4 cost guardrails).
 * Consumption order: shopper free weekly quota → page allowance (if enabled and under cap) → shopper credits.
 */
@Injectable()
export class MeteringService {
  constructor(private prisma: PrismaService) {}

  /** Daily caps follow the Kigali calendar day (see kigali-day.ts). */
  private startOfDay() {
    return kigaliDayStart();
  }

  async generationsToday(userId: string) {
    return this.prisma.usageEvent.count({ where: { userId, kind: "TRYON", createdAt: { gte: this.startOfDay() } } });
  }

  async assertDailyCap(userId: string) {
    const used = await this.generationsToday(userId);
    const cap = await this.dailyCap();
    if (used >= cap) {
      throw new HttpException(dailyCapBody(cap, used), HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async dailyCap() {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: "looks.daily_cap" } });
    return flag?.enabled ? flag.rollout : LOOK_GUARDRAILS.dailyUserCap;
  }

  /** Kill-switch for AI spend (NFR-CST-02). */
  async assertBudgetOpen() {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: "ai.kill_switch" } });
    if (flag?.enabled) {
      throw new HttpException({ message: "Looks are paused for a moment. Please try again later.", code: "KILL_SWITCH", retryAfterSec: 300 }, 503);
    }
  }

  async resolveSource(userId: string, pageId: string): Promise<"FREE_QUOTA" | "PAGE_ALLOWANCE" | "CREDITS"> {
    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const free = await this.prisma.usageEvent.count({
      where: { userId, kind: "TRYON", source: "FREE_QUOTA", createdAt: { gte: weekAgo } },
    });
    if (free < config.freeWeeklyLooks) return "FREE_QUOTA";
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, include: { subscription: true } });
    if (page?.allowanceOn && page.subscription) {
      const used = await this.prisma.usageEvent.count({
        where: { pageId, source: "PAGE_ALLOWANCE", createdAt: { gte: page.subscription.periodStart } },
      });
      if (used < page.subscription.monthlyCap) return "PAGE_ALLOWANCE";
    }
    return "CREDITS";
  }

  async record(kind: string, source: string, costRwf: number, userId: string | null, pageId: string | null, refId?: string) {
    return this.prisma.usageEvent.create({ data: { kind, source, costRwf, userId, pageId, refId } });
  }
}

@Global()
@Module({ providers: [MeteringService], exports: [MeteringService] })
export class MeteringModule {}
