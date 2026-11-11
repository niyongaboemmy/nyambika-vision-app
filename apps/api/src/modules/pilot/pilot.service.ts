import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AnalyticsEventName } from "@nyambika/contracts";
import { PrismaService } from "../../common/prisma.service";
import { assign, isLive, type Variant } from "./assign";
import { pseudonymise, sanitizeProps } from "./privacy";

export { pseudonymise, sanitizeProps };

/** Record a server-side analytics fact (order paid, twin created) without DI wiring. Never throws. */
export async function serverEvent(prisma: PrismaService, name: AnalyticsEventName, userId: string, props: Record<string, unknown> = {}) {
  await prisma.event.create({ data: { name, pseudoId: pseudonymise(userId), authed: true, props: sanitizeProps(props) } }).catch(() => undefined);
}

@Injectable()
export class PilotService {
  constructor(private prisma: PrismaService) {}

  /** The pilot cohort in force (latest by start date). */
  async cohort() {
    return this.prisma.pilotCohort.findFirst({ orderBy: { startsAt: "desc" } });
  }

  async allowlistOn() {
    const f = await this.prisma.featureFlag.findUnique({ where: { key: "pilot.allowlist" } });
    return Boolean(f?.enabled);
  }

  async isMember(kind: "SHOPPER" | "PAGE", subjectId: string) {
    const c = await this.cohort();
    if (!c) return false;
    return (await this.prisma.pilotMember.count({ where: { cohortId: c.id, kind, subjectId } })) > 0;
  }

  /** Page ids allowed in ranking, or null when the allowlist is off (everything allowed). */
  async rankablePageIds(): Promise<Set<string> | null> {
    if (!(await this.allowlistOn())) return null;
    const c = await this.cohort();
    if (!c) return new Set();
    const rows = await this.prisma.pilotMember.findMany({ where: { cohortId: c.id, kind: "PAGE" }, select: { subjectId: true } });
    return new Set(rows.map((r) => r.subjectId));
  }

  /** Closed pilot gate for Muse / Looks (plan §8.1 allowlist flags). Hosts always pass. */
  async assertShopper(userId: string) {
    if (!(await this.allowlistOn())) return;
    if (await this.isMember("SHOPPER", userId)) return;
    const host = await this.prisma.roleAssignment.count({ where: { userId, role: { in: ["HOST_ADMIN", "MODERATOR", "DPO"] } } });
    if (host) return;
    throw new ForbiddenException({ message: "Nyambika looks are in a closed pilot right now. Have an invite code? Enter it to join.", code: "PILOT_ONLY" });
  }

  /** Redeem an invite code (via /join/<code> or at sign-in). Idempotent for an existing member. */
  async join(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const invite = await this.prisma.pilotInvite.findUnique({ where: { code } });
    if (!invite) throw new NotFoundException("That invite code isn't valid. Check it and try again.");
    if (invite.expiresAt && invite.expiresAt < new Date()) throw new BadRequestException("That invite code has expired.");
    const cohort = await this.prisma.pilotCohort.findUniqueOrThrow({ where: { id: invite.cohortId } });
    let subjects: string[];
    if (invite.kind === "PAGE") {
      const roles = await this.prisma.roleAssignment.findMany({ where: { userId, role: { in: ["PAGE_OWNER", "COOP_ADMIN"] }, pageId: { not: null } } });
      subjects = roles.map((r) => r.pageId!);
      if (!subjects.length) throw new BadRequestException("This is a member invite. Sign in with the phone number that owns your page.");
    } else subjects = [userId];
    const existing = await this.prisma.pilotMember.findMany({ where: { cohortId: cohort.id, kind: invite.kind, subjectId: { in: subjects } } });
    const fresh = subjects.filter((s) => !existing.some((e) => e.subjectId === s));
    if (fresh.length) {
      const claimed = await this.prisma.pilotInvite.updateMany({ where: { code, uses: { lt: invite.maxUses } }, data: { uses: { increment: 1 } } });
      if (claimed.count === 0) throw new BadRequestException("That invite code has already been used.");
      await this.prisma.pilotMember.createMany({
        data: fresh.map((subjectId) => ({ cohortId: cohort.id, kind: invite.kind, subjectId, source: "INVITE", inviteCode: code })),
        skipDuplicates: true,
      });
    }
    return { joined: true, kind: invite.kind, cohort: cohort.name, pages: invite.kind === "PAGE" ? subjects.length : 0 };
  }
}

@Injectable()
export class ExperimentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * The user's arm for a live experiment, or null when it is not running (callers then use the default).
   * Arms are sticky: an earlier exposure wins even if weights change later. `expose: false` peeks without logging.
   */
  async variant(userId: string, key: string, opts: { expose?: boolean } = {}): Promise<string | null> {
    const e = await this.prisma.experiment.findUnique({ where: { key } });
    if (!e || !isLive(e)) return null;
    const prior = await this.prisma.experimentExposure.findUnique({ where: { experimentKey_userId: { experimentKey: key, userId } } });
    if (prior) return prior.variant;
    const v = assign(userId, key, e.variants as unknown as Variant[]);
    if (opts.expose !== false) {
      await this.prisma.experimentExposure.createMany({ data: [{ experimentKey: key, userId, variant: v }], skipDuplicates: true });
    }
    return v;
  }
}
