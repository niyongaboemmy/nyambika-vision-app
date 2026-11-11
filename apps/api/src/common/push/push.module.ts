import { Body, Controller, Delete, Get, Global, HttpCode, Module, Param, Post, Put } from "@nestjs/common";
import { NotificationPrefs } from "@nyambika/contracts";
import { z } from "zod";
import { AuthUser, CurrentUser, Public } from "../auth";
import { parse } from "../zod";
import { PushService } from "./push.service";

/** Device tokens, Web Push subscriptions and notification preferences (E38). */
@Controller("push")
export class PushController {
  constructor(private push: PushService) {}

  /** VAPID application server key for `PushManager.subscribe`. */
  @Public()
  @Get("vapid")
  vapid() {
    return { publicKey: this.push.vapid().publicKey, mode: this.push.providers.mode };
  }

  @Get()
  async status(@CurrentUser() user: AuthUser) {
    const [prefs, devices] = await Promise.all([this.push.prefs(user.id), this.push.devices(user.id)]);
    return { prefs, devices };
  }

  @Post("devices")
  register(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.push.register(user.id, body);
  }

  /** Called by the app right before sign-out (also works after the access cookie expired). */
  @Public()
  @Post("devices/revoke")
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser | null, @Body() body: unknown) {
    const { installationId } = parse(z.object({ installationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }), body);
    return this.push.revokeInstallation(user?.id ?? null, installationId);
  }

  @Delete("devices/:id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.push.revokeDevice(user.id, id);
  }

  @Put("prefs")
  async setPrefs(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return { prefs: await this.push.setPrefs(user.id, parse(NotificationPrefs.partial(), body)) };
  }

  /** "Send me a test" from the trust centre: only ever reaches the caller's own devices. */
  @Post("test")
  @HttpCode(200)
  async test(@CurrentUser() user: AuthUser) {
    const r = await this.push.notify(user.id, "look.ready", () => ({
      event: "look.ready",
      title: "Nyambika ✨",
      body: "Notifications are on. We'll only ping you when it matters.",
      url: "/trust",
      tag: "test",
      alert: true,
      refId: `test-${user.id}`,
    }), { throttleMs: 10_000 });
    return r;
  }
}

/** Global so any module can push without importing it (like `MessagingModule`). */
@Global()
@Module({ controllers: [PushController], providers: [PushService], exports: [PushService] })
export class PushModule {}
