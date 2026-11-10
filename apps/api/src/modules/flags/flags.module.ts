import { Controller, Get, Module } from "@nestjs/common";
import { Public } from "../../common/auth";
import { PrismaService } from "../../common/prisma.service";

const PUBLIC_FLAGS = ["muse.voice_beta"];

/** Client-visible feature flags (plan §3.1: deploy daily, release deliberately). */
@Controller("flags")
export class FlagsController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async list() {
    const flags = await this.prisma.featureFlag.findMany({ where: { key: { in: PUBLIC_FLAGS } } });
    return Object.fromEntries(flags.map((f) => [f.key, f.enabled]));
  }
}

@Module({ controllers: [FlagsController] })
export class FlagsModule {}
