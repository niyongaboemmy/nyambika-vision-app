import "multer";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  Injectable,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { EXPERIMENTS, Locale } from "@nyambika/contracts";
import { memoryStorage } from "multer";
import { z } from "zod";
import { AuthUser, CurrentUser } from "../../common/auth";
import { ConsentService } from "../../common/consent.service";
import { MeteringService } from "../../common/metering.service";
import { PrismaService } from "../../common/prisma.service";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { CounterStore, Limit, MemoryCounterStore, overLimit, RedisCounterStore } from "../circle/guards";
import { ExperimentsService } from "../pilot/pilot.service";
import { Redis } from "ioredis";

export const STT_MAX_BYTES = 2 * 1024 * 1024;
const STT_PER_10_MIN = 40;

export interface SttResult {
  text: string;
  language: "rw" | "en" | "fr";
  confidence: number;
  duration_s: number | null;
  no_speech: boolean;
  provider: string;
  simulated: boolean;
}

/** Per-user STT window, counted in Redis so it holds across API instances (same fixed-window store as poll votes). */
export const STT_LIMITS = (userId: string): Limit[] => [{ key: `voice:stt:${userId}`, max: STT_PER_10_MIN, windowSec: 600 }];

/**
 * Voice Muse GA (E22, FR-AST-04): server-side speech-to-text through the AI gateway. The recording is
 * held in memory for the duration of the request only. It is never written to storage, logged or kept.
 */
@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
  private redis?: Redis;
  /** Redis once connected; memory only while Redis is down (and in unit tests). */
  counters: CounterStore = new MemoryCounterStore();

  constructor(
    private prisma: PrismaService,
    private consent: ConsentService,
    private metering: MeteringService,
    private experiments: ExperimentsService,
  ) {}

  onModuleInit() {
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, keyPrefix: config.redisKeyPrefix });
    this.redis.on("error", () => undefined);
    this.redis.on("ready", () => (this.counters = new RedisCounterStore(this.redis!)));
    this.redis.on("end", () => (this.counters = new MemoryCounterStore()));
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  /** GA: on by default (flag `muse.voice`); the running `muse.voice` experiment can still hold a user out. */
  async enabled(userId: string) {
    const arm = await this.experiments.variant(userId, EXPERIMENTS.museVoice, { expose: false });
    if (arm) return arm === "voice";
    const flag = await this.prisma.featureFlag.findUnique({ where: { key: "muse.voice" } });
    return flag?.enabled ?? false;
  }

  async transcribe(userId: string, audio: Buffer, mime: string, language: string, durationMs?: number): Promise<SttResult> {
    if (!(await this.enabled(userId))) throw new NotFoundException("Voice is switched off right now. Type instead.");
    if (!(await this.consent.has(userId, "VOICE_PROCESSING"))) {
      throw new ForbiddenException({ message: "Allow voice in the trust centre to speak to the Muse.", code: "VOICE_CONSENT" });
    }
    await this.metering.assertBudgetOpen();
    if (await overLimit(this.counters, STT_LIMITS(userId))) throw new HttpException("Lots of voice requests. Take a breath, or type instead.", 429);
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(audio)], { type: mime || "application/octet-stream" }), "muse");
    form.append("language", language);
    if (durationMs) form.append("duration_ms", String(Math.round(durationMs)));
    let res: Response;
    try {
      res = await fetch(`${config.aiUrl}/v1/stt`, { method: "POST", body: form, signal: AbortSignal.timeout(35_000) });
    } catch (e) {
      throw new ServiceUnavailableException(`Speech service unreachable: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as SttResult & { detail?: string };
    if (res.status === 413 || res.status === 415 || res.status === 422) throw new HttpException(body.detail ?? "Recording not accepted", res.status);
    if (!res.ok) throw new ServiceUnavailableException("Speech service failed. Type instead, or try again.");
    return body;
  }
}

@Controller("voice")
export class VoiceController {
  constructor(private voice: VoiceService) {}

  @Post("stt")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("audio", { storage: memoryStorage(), limits: { fileSize: STT_MAX_BYTES, files: 1 } }))
  async stt(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file?.buffer?.length) throw new BadRequestException("Recording missing");
    const input = parse(z.object({ language: Locale.or(z.literal("auto")).default("auto"), durationMs: z.coerce.number().int().min(0).max(60_000).optional() }), body);
    try {
      return await this.voice.transcribe(user.id, file.buffer, file.mimetype, input.language, input.durationMs);
    } finally {
      file.buffer.fill(0); // drop the audio as soon as the request is answered
    }
  }
}

@Module({ controllers: [VoiceController], providers: [VoiceService], exports: [VoiceService] })
export class VoiceModule {}
