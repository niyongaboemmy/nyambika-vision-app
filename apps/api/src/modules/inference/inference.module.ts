import { Body, Controller, Get, Module, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { Access, AuthUser, CurrentUser } from "../../common/auth";
import { parse } from "../../common/zod";
import { breakerPolicy, ROUTES, routePolicy } from "./inference-rules";
import { InferenceService } from "./inference.service";

/** Host admin: "Inference" panel in Flags & models (E42) + NLB video evals for the registry gate (E39). */
@Controller("admin")
export class InferenceController {
  constructor(
    private inference: InferenceService,
    private access: Access,
  ) {}

  @Get("inference")
  async overview(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.inference.overview();
  }

  @Put("inference/policy/:route")
  async setPolicy(@CurrentUser() user: AuthUser, @Param("route") route: string, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const r = parse(z.enum(ROUTES), route);
    const input = parse(z.object({ policy: routePolicy, breaker: breakerPolicy.optional() }), body);
    return this.inference.setRoutePolicy(user.id, r, input.policy, input.breaker);
  }

  @Post("inference/probe")
  async probe(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { route, n } = parse(z.object({ route: z.enum(["tryon", "stt", "llm", "avatar"]), n: z.number().int().min(1).max(50).default(10) }), body);
    return this.inference.probe(user.id, route, n);
  }

  @Post("inference/health")
  async health(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.inference.healthCheck();
  }

  @Post("inference/chaos")
  async chaos(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    await this.access.requireHost(user.id);
    const { mode } = parse(z.object({ mode: z.enum(["healthy", "slow", "flaky", "failing", "down"]) }), body);
    return this.inference.chaos(user.id, mode);
  }

  @Get("video/models")
  async videoModels(@CurrentUser() user: AuthUser) {
    await this.access.requireHost(user.id);
    return this.inference.videoModels();
  }

  @Post("video/models/:id/eval")
  async evalModel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.access.requireHost(user.id);
    return this.inference.runEval(user.id, id);
  }
}

@Module({ controllers: [InferenceController], providers: [InferenceService], exports: [InferenceService] })
export class InferenceModule {}
