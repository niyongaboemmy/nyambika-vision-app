import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

type Channel = "WHATSAPP" | "SMS" | "PUSH";

/**
 * Messaging adapter (SI-03/04). Dev adapter writes to the outbox table and the log;
 * a WhatsApp Cloud API / SMS gateway adapter replaces `deliver` in production.
 */
@Injectable()
export class MessagingService {
  private log = new Logger("Messaging");
  constructor(private prisma: PrismaService) {}

  async send(channel: Channel, to: string, template: string, body: string, refId?: string) {
    this.log.log(`[${channel} → ${to}] ${template}: ${body}`);
    return this.prisma.notification.create({ data: { channel, to, template, body, refId } });
  }
}

@Global()
@Module({ providers: [MessagingService], exports: [MessagingService] })
export class MessagingModule {}
