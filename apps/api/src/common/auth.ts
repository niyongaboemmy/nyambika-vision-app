import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { PrismaService } from "./prisma.service";
import type { Role } from "@prisma/client";

export interface AuthUser {
  id: string;
  phone: string;
}

export const ACCESS_COOKIE = "nya_at";
export const REFRESH_COOKIE = "nya_rt";

export function signAccess(user: AuthUser) {
  return jwt.sign({ sub: user.id, phone: user.phone }, config.jwtSecret, { expiresIn: "15m" });
}

export function readUser(req: Request): AuthUser | null {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.[ACCESS_COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return { id: String(p.sub), phone: String(p.phone) };
  } catch {
    return null;
  }
}

const PUBLIC = "isPublic";
/** Routes that work without an account (FR-ACC-10); the user is attached when present. */
export const Public = () => SetMetadata(PUBLIC, true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser | null }>();
    req.user = readUser(req);
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException("Sign in required");
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as AuthUser;
});

/** Per-page permission checks (FR-ACC-04). Host admins pass every page check. */
@Injectable()
export class Access {
  constructor(private prisma: PrismaService) {}

  async roles(userId: string) {
    return this.prisma.roleAssignment.findMany({ where: { userId } });
  }

  async isHost(userId: string) {
    const n = await this.prisma.roleAssignment.count({
      where: { userId, role: { in: ["HOST_ADMIN", "MODERATOR", "DPO"] } },
    });
    return n > 0;
  }

  async requirePage(userId: string, pageId: string, allowed: Role[]) {
    if (await this.isHost(userId)) return;
    const n = await this.prisma.roleAssignment.count({ where: { userId, pageId, role: { in: allowed } } });
    if (n === 0) throw new ForbiddenException("You do not have access to this page");
  }

  async requireHost(userId: string) {
    if (!(await this.isHost(userId))) throw new ForbiddenException("Host admin only");
  }

  async audit(actorId: string | null, action: string, data: object, pageId?: string) {
    await this.prisma.auditLog.create({ data: { actorId, action, data, pageId } });
  }
}

export const MANAGE: Role[] = ["PAGE_OWNER", "PAGE_STAFF", "COOP_ADMIN"];
