import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post, Res, UnauthorizedException } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Response } from "express";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { issueSession } from "../identity/identity.module";

const CHALLENGE_TTL_MS = 5 * 60_000;
export const MAX_PASSKEYS = 10;

/** Relying party derived from PUBLIC_WEB_URL (the shopper-facing origin). */
export function relyingParty(webUrl = config.webUrl) {
  const u = new URL(webUrl);
  return { rpID: u.hostname, origin: u.origin, rpName: "Nyambika" };
}

/** The challenge the browser signed, read from clientDataJSON (base64url JSON). */
export function signedChallenge(clientDataJSON: string): string {
  try {
    const c = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown };
    if (typeof c.challenge === "string" && c.challenge.length >= 16) return c.challenge;
  } catch {
    /* fall through */
  }
  throw new BadRequestException("Malformed passkey response");
}

const Name = z.string().trim().min(1).max(40);

/**
 * Passkeys (E29, FR-ACC-02, NFR-SEC-05 groundwork). Offered after OTP sign-in; OTP stays the fallback.
 * Only the public key is stored. Registration, rename and removal are audit-logged.
 */
@Injectable()
export class PasskeysService {
  constructor(
    private prisma: PrismaService,
    private access: Access,
  ) {}

  list(userId: string) {
    return this.prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, backedUp: true, deviceType: true },
    });
  }

  private async saveChallenge(kind: "register" | "login", challenge: string, userId: string | null) {
    await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.webAuthnChallenge.create({ data: { kind, challenge, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } });
  }

  /** Single use: consumes the challenge atomically, so a replayed response fails. */
  private async consumeChallenge(kind: "register" | "login", challenge: string, userId: string | null) {
    const r = await this.prisma.webAuthnChallenge.updateMany({
      where: { challenge, kind, consumedAt: null, expiresAt: { gt: new Date() }, ...(userId ? { userId } : {}) },
      data: { consumedAt: new Date() },
    });
    if (r.count === 0) throw new UnauthorizedException("This passkey request expired. Try again.");
  }

  async registrationOptions(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const existing = await this.prisma.passkey.findMany({ where: { userId } });
    if (existing.length >= MAX_PASSKEYS) throw new BadRequestException(`You can keep up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
    const rp = relyingParty();
    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userName: user.phone,
      userDisplayName: user.name ?? user.phone,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })),
      // Discoverable so sign-in needs no phone number; UV preferred (fingerprint / face / screen lock).
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    await this.saveChallenge("register", options.challenge, userId);
    return options;
  }

  async register(userId: string, response: RegistrationResponseJSON, name: string) {
    const challenge = signedChallenge(response.response.clientDataJSON);
    await this.consumeChallenge("register", challenge, userId);
    const rp = relyingParty();
    const v = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: false }).catch((e: Error) => {
      throw new BadRequestException(`Passkey could not be verified: ${e.message}`);
    });
    if (!v.verified) throw new BadRequestException("Passkey could not be verified");
    const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
    const created = await this.prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name,
      },
    });
    await this.access.audit(userId, "passkey.registered", { passkeyId: created.id, name, deviceType: credentialDeviceType, backedUp: credentialBackedUp });
    return created;
  }

  async loginOptions() {
    const rp = relyingParty();
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "preferred", allowCredentials: [] });
    await this.saveChallenge("login", options.challenge, null);
    return options;
  }

  async login(response: AuthenticationResponseJSON) {
    const challenge = signedChallenge(response.response.clientDataJSON);
    await this.consumeChallenge("login", challenge, null);
    const key = await this.prisma.passkey.findUnique({ where: { credentialId: response.id } });
    if (!key) throw new UnauthorizedException("This passkey isn't registered with Nyambika any more. Sign in with your phone.");
    const user = await this.prisma.user.findUnique({ where: { id: key.userId } });
    if (!user || user.deletedAt) throw new UnauthorizedException("Account not found");
    const rp = relyingParty();
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: { id: key.credentialId, publicKey: new Uint8Array(key.publicKey), counter: key.counter, transports: key.transports as AuthenticatorTransportFuture[] },
      requireUserVerification: false,
    }).catch((e: Error) => {
      throw new UnauthorizedException(`Passkey check failed: ${e.message}`);
    });
    if (!v.verified) throw new UnauthorizedException("Passkey check failed");
    await this.prisma.passkey.update({ where: { id: key.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: new Date(), backedUp: v.authenticationInfo.credentialBackedUp } });
    return { id: user.id, phone: user.phone };
  }

  async rename(userId: string, id: string, name: string) {
    const key = await this.prisma.passkey.findFirst({ where: { id, userId } });
    if (!key) throw new NotFoundException();
    await this.prisma.passkey.update({ where: { id }, data: { name } });
    await this.access.audit(userId, "passkey.renamed", { passkeyId: id, from: key.name, to: name });
  }

  async remove(userId: string, id: string) {
    const key = await this.prisma.passkey.findFirst({ where: { id, userId } });
    if (!key) throw new NotFoundException();
    await this.prisma.passkey.delete({ where: { id } });
    await this.access.audit(userId, "passkey.removed", { passkeyId: id, name: key.name });
  }

  /** Privacy export (FR-PRV): names and dates only; public keys are not personal content. */
  exportFor(userId: string) {
    return this.list(userId);
  }

  async deleteFor(userId: string) {
    const r = await this.prisma.passkey.deleteMany({ where: { userId } });
    await this.prisma.webAuthnChallenge.deleteMany({ where: { userId } });
    if (r.count) await this.access.audit(userId, "passkey.removed_all", { count: r.count, reason: "account deletion" });
    return r.count;
  }
}

@Controller("auth/passkeys")
export class PasskeysController {
  constructor(
    private passkeys: PasskeysService,
    private prisma: PrismaService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.passkeys.list(user.id);
  }

  @Post("register/options")
  @HttpCode(200)
  registerOptions(@CurrentUser() user: AuthUser) {
    return this.passkeys.registrationOptions(user.id);
  }

  @Post("register")
  async register(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(z.object({ response: z.custom<RegistrationResponseJSON>((v) => typeof v === "object" && v !== null && "response" in v), name: Name.default("Passkey") }), body);
    await this.passkeys.register(user.id, input.response, input.name);
    return this.passkeys.list(user.id);
  }

  @Public()
  @Post("login/options")
  @HttpCode(200)
  loginOptions() {
    return this.passkeys.loginOptions();
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(z.object({ response: z.custom<AuthenticationResponseJSON>((v) => typeof v === "object" && v !== null && "id" in v && "response" in v) }), body);
    const user = await this.passkeys.login(input.response);
    await issueSession(this.prisma, res, user);
    return { ok: true };
  }

  @Patch(":id")
  async rename(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    await this.passkeys.rename(user.id, id, parse(z.object({ name: Name }), body).name);
    return this.passkeys.list(user.id);
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.passkeys.remove(user.id, id);
    return this.passkeys.list(user.id);
  }
}

@Module({ controllers: [PasskeysController], providers: [PasskeysService], exports: [PasskeysService] })
export class PasskeysModule {}
