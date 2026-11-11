import { Body, Controller, Get, HttpCode, Module, Patch, Post, Req, Res, HttpException, UnauthorizedException } from "@nestjs/common";
import { OtpRequest, OtpVerify, Locale } from "@nyambika/contracts";
import type { Request, Response } from "express";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { Access, ACCESS_COOKIE, AuthUser, CurrentUser, Public, REFRESH_COOKIE, signAccess } from "../../common/auth";
import { MessagingService } from "../../common/messaging.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { config } from "../../config";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normalisePhone = (p: string) => {
  const digits = p.replace(/[^0-9]/g, "");
  if (digits.startsWith("250")) return `+${digits}`;
  if (digits.startsWith("07")) return `+250${digits.slice(1)}`;
  return `+${digits}`;
};

const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

/** Access + rotating refresh cookies. Shared by OTP and passkey sign-in (E29). */
export async function issueSession(prisma: PrismaService, res: Response, user: AuthUser) {
  const refresh = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { userId: user.id, refreshHash: sha(refresh), expiresAt: new Date(Date.now() + 30 * 86400_000) },
  });
  res.cookie(ACCESS_COOKIE, signAccess(user), { ...cookieBase, maxAge: 15 * 60_000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...cookieBase, maxAge: 30 * 86400_000 });
}

@Controller("auth")
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private messaging: MessagingService,
    private access: Access,
  ) {}

  /** FR-ACC-01: phone + OTP. Rate limited per phone per 15 minutes (OTP_MAX_PER_15M, default 5). */
  @Public()
  @Post("otp/request")
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    const phone = normalisePhone(parse(OtpRequest, body).phone);
    const recent = await this.prisma.otpChallenge.count({
      where: { phone, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
    });
    if (recent >= config.otpMaxPer15m) throw new HttpException("Too many codes requested. Try again in 15 minutes.", 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.prisma.otpChallenge.create({
      data: { phone, codeHash: sha(`${phone}:${code}`), expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    await this.messaging.send("SMS", phone, "otp", `Nyambika code: ${code}. Valid 5 minutes. Never share it.`);
    return { phone, sent: true, ...(config.devExposeOtp ? { devCode: code } : {}) };
  }

  @Public()
  @Post("otp/verify")
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(OtpVerify, body);
    const phone = normalisePhone(input.phone);
    const ch = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!ch || ch.attempts >= 5) throw new UnauthorizedException("Code expired. Request a new one.");
    if (ch.codeHash !== sha(`${phone}:${input.code}`)) {
      await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException("Wrong code");
    }
    await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { consumedAt: new Date() } });
    let user = await this.prisma.user.findUnique({ where: { phone } });
    const isNew = !user;
    if (!user) {
      user = await this.prisma.user.create({ data: { phone, roles: { create: { role: "SHOPPER" } } } });
    }
    await this.issue(res, { id: user.id, phone });
    return { user: await this.profile(user.id), isNew };
  }

  /** Rotating refresh token: every refresh revokes the old token. */
  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    // Anonymous visitors simply have no session: answer 200 so the client stays quiet.
    if (!token) return { ok: false };
    const session = await this.prisma.session.findUnique({ where: { refreshHash: sha(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      if (session && session.revokedAt) {
        // Reuse of a revoked token: revoke the whole family for this user.
        await this.prisma.session.updateMany({ where: { userId: session.userId }, data: { revokedAt: new Date() } });
      }
      return { ok: false };
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await this.issue(res, { id: session.user.id, phone: session.user.phone });
    return { ok: true };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) await this.prisma.session.updateMany({ where: { refreshHash: sha(token) }, data: { revokedAt: new Date() } });
    res.clearCookie(ACCESS_COOKIE, cookieBase);
    res.clearCookie(REFRESH_COOKIE, cookieBase);
    return { ok: true };
  }

  @Public()
  @Get("me")
  async me(@CurrentUser() user: AuthUser | null) {
    if (!user) return { user: null };
    return { user: await this.profile(user.id) };
  }

  @Patch("me")
  async updateMe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(z.object({ name: z.string().min(1).max(60).optional(), locale: Locale.optional() }), body);
    await this.prisma.user.update({ where: { id: user.id }, data: input });
    return { user: await this.profile(user.id) };
  }

  private async issue(res: Response, user: AuthUser) {
    await issueSession(this.prisma, res, user);
  }

  private async profile(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { page: { select: { id: true, handle: true, name: true, memberType: true } } } } },
    });
    const twin = await this.prisma.twin.findFirst({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    return {
      id: u.id,
      phone: u.phone,
      name: u.name,
      locale: u.locale,
      isHost: await this.access.isHost(u.id),
      hasTwin: Boolean(twin),
      twinSize: twin?.size ?? null,
      roles: u.roles.map((r) => ({ role: r.role, page: r.page })),
    };
  }
}

@Module({ controllers: [AuthController] })
export class IdentityModule {}
