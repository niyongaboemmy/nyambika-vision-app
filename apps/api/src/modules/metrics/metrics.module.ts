import { Controller, ForbiddenException, Get, Headers, Module, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../../common/auth";
import { registry } from "../../common/metrics";
import { LooksModule } from "../looks/looks.module";
import { GenerationService } from "../looks/generation.service";

@Controller("metrics")
export class MetricsController {
  constructor(private generations: GenerationService) {}

  /** Prometheus scrape endpoint. Set METRICS_TOKEN to require `Authorization: Bearer <token>`. */
  @Public()
  @Get()
  async scrape(@Headers("authorization") auth: string | undefined, @Res() res: Response) {
    const token = process.env.METRICS_TOKEN;
    if (token && auth !== `Bearer ${token}`) throw new ForbiddenException();
    await this.generations.refreshQueueGauge();
    res.setHeader("content-type", registry.contentType);
    res.send(await registry.metrics());
  }
}

@Module({ imports: [LooksModule], controllers: [MetricsController] })
export class MetricsModule {}
