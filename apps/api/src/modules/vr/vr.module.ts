import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, Param, Patch, Post, Put, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { BoothInput, ShowInput } from "@nyambika/contracts";
import type { Request, Response } from "express";
import { z } from "zod";
import { Access, AuthUser, CurrentUser, MANAGE, Public } from "../../common/auth";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { hashId } from "../circle/guards";
import { LooksModule } from "../looks/looks.module";
import { ShowLive } from "./vr-live";
import { VrService } from "./vr.service";

/** Max SSE viewers held per API instance per show before viewers fall back to polling. */
const MAX_STREAMS = 500;

function sse(res: Response) {
  res.status(200);
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();
  res.write(`: ${" ".repeat(2048)}\nretry: 3000\n\n`);
}

/** E35 shopper side: 3D shelf, showroom, fashion shows (public reads, live stream, reactions, RSVP). */
@Controller("vr")
export class VrController {
  constructor(
    private vr: VrService,
    private live: ShowLive,
  ) {}

  @Public()
  @Get("public/pages/:handle/shelf")
  shelf(@Param("handle") handle: string) {
    return this.vr.shelf(handle);
  }

  @Public()
  @Get("public/pages/:handle/showroom")
  showroom(@Param("handle") handle: string) {
    return this.vr.showroom(handle);
  }

  @Public()
  @Get("public/shows/:id")
  show(@Param("id") id: string, @CurrentUser() user: AuthUser | null) {
    return this.vr.publicShow(id, user?.id ?? null);
  }

  @Public()
  @Get("public/shows/:id/live")
  snapshot(@Param("id") id: string) {
    return this.vr.snapshot(id);
  }

  @Public()
  @Get("public/shows/:id/reactions")
  reactions(@Param("id") id: string) {
    return this.vr.reactionTrack(id);
  }

  /** Live viewers + reactions over Server-Sent Events (each open stream counts as one viewer). */
  @Public()
  @Get("public/shows/:id/stream")
  async stream(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    await this.vr.snapshot(id); // 404 for unknown shows before the stream opens
    if (this.live.localViewers(id) >= MAX_STREAMS) throw new ForbiddenException("So many people are watching. The count refreshes every few seconds instead.");
    sse(res);
    let closed = false;
    const send = async () => {
      if (closed) return;
      try {
        res.write(`event: snapshot\ndata: ${JSON.stringify(await this.vr.snapshot(id))}\n\n`);
      } catch {
        /* client went away mid-write */
      }
    };
    const off = this.live.on(id, () => void send());
    await this.live.join(id);
    void send();
    const beat = setInterval(() => res.write(`: ping\n\n`), 20_000);
    req.on("close", () => {
      closed = true;
      off();
      clearInterval(beat);
      void this.live.leave(id);
    });
  }

  @Public()
  @Post("public/shows/:id/react")
  react(@Param("id") id: string, @Body() body: unknown, @Req() req: Request, @CurrentUser() user: AuthUser | null) {
    const { emoji } = parse(z.object({ emoji: z.string().min(1).max(8) }), body);
    const key = user?.id ?? hashId(config.jwtSecret, "ip", req.ip ?? "unknown");
    return this.vr.react(id, emoji, key);
  }

  @Post("shows/:id/rsvp")
  rsvp(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    const { going } = parse(z.object({ going: z.boolean() }), body);
    return this.vr.rsvp(id, user.id, going);
  }
}

/** E35 studio side: booth settings and fashion shows of one page (page managers only). */
@Controller("vr/pages/:pageId")
export class VrStudioController {
  constructor(
    private vr: VrService,
    private access: Access,
  ) {}

  @Get()
  async studio(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    return this.vr.studio(pageId);
  }

  @Put("booth")
  async booth(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    return this.vr.saveBooth(pageId, parse(BoothInput, body));
  }

  @Post("shows")
  async create(@Param("pageId") pageId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const show = await this.vr.createShow(pageId, user.id, parse(ShowInput, body));
    await this.access.audit(user.id, "show.schedule", { showId: show.id, startsAt: show.startsAt }, pageId);
    return show;
  }

  @Patch("shows/:id")
  async update(@Param("pageId") pageId: string, @Param("id") id: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    return this.vr.updateShow(pageId, id, parse(ShowInput.partial(), body));
  }

  @Post("shows/:id/cancel")
  async cancel(@Param("pageId") pageId: string, @Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    const out = await this.vr.cancelShow(pageId, id);
    await this.access.audit(user.id, "show.cancel", { showId: id }, pageId);
    return out;
  }

  @Post("shows/:id/cover")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 6 * 1024 * 1024 } }))
  async cover(@Param("pageId") pageId: string, @Param("id") id: string, @CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    await this.access.requirePage(user.id, pageId, MANAGE);
    if (!file) throw new BadRequestException("Attach a cover image");
    if (!/^image\/(png|jpe?g|webp)$/.test(file.mimetype)) throw new BadRequestException("Use a PNG, JPEG or WebP image");
    return this.vr.setCover(pageId, id, file.buffer);
  }
}

@Module({
  imports: [LooksModule],
  controllers: [VrController, VrStudioController],
  providers: [VrService, ShowLive],
  exports: [VrService],
})
export class VrModule {}
