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
import { PrivacyModule } from "./modules/privacy/privacy.module";
import { AdminModule } from "./modules/admin/admin.module";
import { MigrationModule } from "./modules/migration/migration.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { CircleModule } from "./modules/circle/circle.module";
import { WardrobeModule } from "./modules/wardrobe/wardrobe.module";
import { TailorModule } from "./modules/tailor/tailor.module";
import { PilotModule } from "./modules/pilot/pilot.module";
import { XrModule } from "./modules/xr/xr.module";
import { VoiceModule } from "./modules/voice/voice.module";
import { PasskeysModule } from "./modules/passkeys/passkeys.module";
import { CheckoutModule } from "./modules/checkout/checkout.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { GrowthModule } from "./modules/growth/growth.module";
import { CoopVoiceModule } from "./modules/coopvoice/coopvoice.module";
import { NetworkMigrationModule } from "./modules/migration/network";
import { PushModule } from "./common/push/push.module";
import { RegionModule } from "./modules/region/region.module";
import { Twin3dModule } from "./modules/twin3d/twin3d.module";
import { InferenceModule } from "./modules/inference/inference.module";
import { VideoModule } from "./modules/video/video.module";
import { VrModule } from "./modules/vr/vr.module";

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
    PrivacyModule,
    AdminModule,
    MigrationModule,
    MetricsModule,
    CircleModule,
    WardrobeModule,
    TailorModule,
    PilotModule,
    XrModule,
    VoiceModule,
    PasskeysModule,
    CheckoutModule,
    AgentsModule,
    GrowthModule,
    CoopVoiceModule,
    NetworkMigrationModule,
    PushModule,
    RegionModule,
    Twin3dModule,
    InferenceModule,
    VideoModule,
    VrModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
