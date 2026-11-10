import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AiClient, AiModule } from "./common/ai.client";
import { AuthGuard, Public } from "./common/auth";
import { CommonModule } from "./common/common.module";
import { ConsentModule } from "./common/consent.service";
import { MessagingModule } from "./common/messaging.service";
import { MeteringModule } from "./common/metering.service";
import { PrismaModule } from "./common/prisma.service";
import { StorageModule } from "./common/storage.service";
import { FilesModule } from "./modules/files/files.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { PagesModule } from "./modules/pages/pages.module";
import { CatalogueModule } from "./modules/catalogue/catalogue.module";
import { CoopsModule } from "./modules/coops/coops.module";
import { TwinModule } from "./modules/twin/twin.module";
import { LooksModule } from "./modules/looks/looks.module";
import { IntentModule } from "./modules/intent/intent.module";
import { FlagsModule } from "./modules/flags/flags.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";

@Controller()
class HealthController {
  constructor(private ai: AiClient) {}
  @Public()
  @Get("health")
  async health() {
    const ai = await this.ai.get<{ status: string }>("/health").catch(() => ({ status: "down" }));
    return { status: "ok", ai: ai.status, time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AiModule,
    CommonModule,
    MessagingModule,
    ConsentModule,
    MeteringModule,
    FilesModule,
    IdentityModule,
    PagesModule,
    CatalogueModule,
    CoopsModule,
    TwinModule,
    LooksModule,
    IntentModule,
    FlagsModule,
    PaymentsModule,
    OrdersModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
