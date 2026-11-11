import { Body, Controller, ForbiddenException, Get, Module, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AuthUser, CurrentUser, Public } from "../../common/auth";
import { StorageService } from "../../common/storage.service";
import { parse } from "../../common/zod";
import { LooksModule } from "../looks/looks.module";
import { TwinModule } from "../twin/twin.module";
import { VIDEO_TRYON } from "./video-rules";
import { VideoTryOnService } from "./video.service";

const startSchema = z.object({
  source: z.enum(["CLIP", "TURNAROUND"]),
  frames: z.array(z.string().max(240_000)).max(VIDEO_TRYON.maxFrames).optional(),
  consent: z.boolean().optional(),
  locale: z.enum(["rw", "en", "fr"]).optional(),
});

/** E39 "See it on video" (shopper, private). */
@Controller("video")
export class VideoController {
  constructor(
    private video: VideoTryOnService,
    private storage: StorageService,
  ) {}

  /** Cheap check for the look rail: is any video provider activated (NLB passed) and the kill switch open? */
  @Public()
  @Get("available")
  async available() {
    return { available: (await this.video.available()).available };
  }

  @Get("looks/:lookId")
  state(@Param("lookId") lookId: string, @CurrentUser() user: AuthUser) {
    return this.video.state(user.id, lookId);
  }

  @Post("looks/:lookId")
  start(@Param("lookId") lookId: string, @CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.video.start(user.id, lookId, parse(startSchema, body));
  }

  @Get("jobs/:id")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.video.get(user.id, id);
  }

  /** Signed, short-lived private file (range requests for the MP4). */
  @Public()
  @Get("file")
  file(@Query("p") p: string, @Query("exp") exp: string, @Query("sig") sig: string, @Res() res: Response) {
    if (!p || !p.startsWith("private/video/") || p.includes("..") || p.endsWith(".enc") || !this.storage.verify("video", p, exp, sig)) {
      throw new ForbiddenException("Link expired");
    }
    res.sendFile(p, { root: this.storage.root, headers: { "cache-control": "private, max-age=300" }, dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}

@Module({ imports: [LooksModule, TwinModule], controllers: [VideoController], providers: [VideoTryOnService] })
export class VideoModule {}
