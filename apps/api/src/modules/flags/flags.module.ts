import { Controller, Get, Module } from "@nestjs/common";
import { EXPERIMENTS } from "@nyambika/contracts";
import { AuthUser, CurrentUser, Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";
import { ExperimentsService } from "../pilot/pilot.service";

const PUBLIC_FLAGS = ["muse.voice_beta", "muse.voice", "ar.mirror_pilot", "mr.mirror_spike", "vr.multiuser_spike"];

/** Client-visible feature flags (plan §3.1: deploy daily, release deliberately). */
@Controller("flags")
export class FlagsController {
  constructor(
    private prisma: PrismaService,
    private experiments: ExperimentsService,
  ) {}

  @Public()
  @Get()
  async list(@CurrentUser() user: AuthUser | null) {
    const flags = await this.prisma.featureFlag.findMany({ where: { key: { in: PUBLIC_FLAGS } } });
    const out: Record<string, boolean> = Object.fromEntries(flags.map((f) => [f.key, f.enabled]));
    // Pilot experiment "voice vs text Muse" (plan §8.1) overrides the flag per signed-in user while it runs.
    const arm = user ? await this.experiments.variant(user.id, EXPERIMENTS.museVoice) : null;
    if (arm) out["muse.voice_beta"] = out["muse.voice"] = arm === "voice";
    return out;
  }
}

@Module({ controllers: [FlagsController] })
export class FlagsModule {}
