import { Body, Controller, Get, Module, Param, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { AuthUser, CurrentUser } from "../../common/auth";
import { parse } from "../../common/zod";
import { MlSpikeService } from "./mlspike.service";

const Locale = z.enum(["rw", "en", "fr"]).default("rw");

/** R4 spike routes (plan §11): maker training-data opt-in, ✨ attribute suggestions, trends card, host spike console. */
@Controller()
export class MlSpikeController {
  constructor(private svc: MlSpikeService) {}

  @Get("pages/:pageId/training-data")
  state(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    return this.svc.trainingState(user.id, pageId);
  }

  @Put("pages/:pageId/training-data")
  setPage(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    const b = parse(z.object({ optedIn: z.boolean(), locale: Locale }), body);
    return this.svc.setPageConsent(user.id, pageId, b.optedIn, b.locale);
  }

  @Put("pages/:pageId/training-data/products/:productId")
  setProduct(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Param("productId") productId: string, @Body() body: unknown) {
    const b = parse(z.object({ included: z.boolean(), locale: Locale }), body);
    return this.svc.setProductConsent(user.id, pageId, productId, b.included, b.locale);
  }

  /** Cooperative maker's own decision for the pieces credited to them (required on top of the admin's). */
  @Get("pages/:pageId/training-data/maker")
  makerState(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string) {
    return this.svc.makerTrainingState(user.id, pageId);
  }

  @Put("pages/:pageId/training-data/maker")
  setMaker(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Body() body: unknown) {
    const b = parse(z.object({ consented: z.boolean(), locale: Locale }), body);
    return this.svc.setMakerConsent(user.id, pageId, b.consented, b.locale);
  }

  @Get("products/:id/attr-suggest")
  suggest(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.svc.suggest(user.id, id);
  }

  @Get("pages/:pageId/trends")
  trends(@CurrentUser() user: AuthUser, @Param("pageId") pageId: string, @Query("locale") locale?: string) {
    return this.svc.trends(user.id, pageId, parse(Locale, locale ?? undefined));
  }

  // ── host spike console ─────────────────────────────────────────────────────
  @Get("admin/mlspike")
  overview(@CurrentUser() user: AuthUser) {
    return this.svc.overview(user.id);
  }

  @Post("admin/mlspike/dataset")
  dataset(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = parse(z.object({ perCell: z.number().int().min(1).max(40).default(16) }), body ?? {});
    return this.svc.buildDataset(user.id, b.perCell);
  }

  @Post("admin/mlspike/train-eval")
  trainEval(@CurrentUser() user: AuthUser) {
    return this.svc.trainEval(user.id);
  }

  @Post("admin/mlspike/models/:id/activate")
  activate(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.svc.activate(user.id, id);
  }

  @Post("admin/mlspike/trends/seed")
  seed(@CurrentUser() user: AuthUser) {
    return this.svc.seedTrends(user.id);
  }

  @Post("admin/mlspike/trends/ingest")
  ingest(@CurrentUser() user: AuthUser) {
    return this.svc.ingestTrends(user.id);
  }

  @Post("admin/mlspike/trends/eval")
  trendsEval(@CurrentUser() user: AuthUser) {
    return this.svc.trendsEval(user.id);
  }
}

@Module({ controllers: [MlSpikeController], providers: [MlSpikeService] })
export class MlSpikeModule {}
