import { Controller, ForbiddenException, Get, Module, NotFoundException, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { extname } from "node:path";
import { Public } from "../../common/auth";
import { StorageService } from "../../common/storage.service";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

@Controller()
export class FilesController {
  constructor(private storage: StorageService) {}

  /** Public, member-owned catalogue media. */
  @Public()
  @Get("files/public/*path")
  async publicFile(@Param("path") path: string | string[], @Res() res: Response) {
    const rel = `public/${Array.isArray(path) ? path.join("/") : path}`;
    try {
      const data = await this.storage.read(rel);
      res.setHeader("content-type", TYPES[extname(rel)] ?? "application/octet-stream");
      res.setHeader("cache-control", "public, max-age=86400");
      res.send(data);
    } catch {
      throw new NotFoundException();
    }
  }

  /** Private looks / twins via short-lived signed URL only. Never cached by shared caches. */
  @Public()
  @Get("private/:kind")
  async privateFile(
    @Param("kind") kind: string,
    @Query("p") p: string,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: Response,
  ) {
    if (!p || !this.storage.verify(kind, p, exp, sig)) throw new ForbiddenException("Link expired");
    try {
      const data = await this.storage.read(p);
      res.setHeader("content-type", "image/png");
      res.setHeader("cache-control", "private, max-age=300");
      res.send(data);
    } catch {
      throw new NotFoundException();
    }
  }
}

@Module({ controllers: [FilesController] })
export class FilesModule {}
