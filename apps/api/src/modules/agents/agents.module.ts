import { Module } from "@nestjs/common";
import { AgentAccessService, AgentGuard } from "./access";
import { AgentChannelsController, AgentsAdminController } from "./admin.controller";
import { CatalogueApi } from "./catalogue.service";
import { AgentCheckoutService } from "./checkout.service";
import { AgentCheckoutController, AgentDiscoveryController, MandateController, McpController, PartnerController, PartnerResultController, PublicCatalogueController } from "./controllers";
import { PartnerService } from "./partner.service";

/** E36 Agentic commerce + E37 Try-on as a Service (FR-AGT-01..06, 08). */
@Module({
  controllers: [
    AgentDiscoveryController,
    PublicCatalogueController,
    AgentCheckoutController,
    McpController,
    PartnerController,
    PartnerResultController,
    MandateController,
    AgentsAdminController,
    AgentChannelsController,
  ],
  providers: [AgentAccessService, AgentGuard, CatalogueApi, AgentCheckoutService, PartnerService],
  exports: [CatalogueApi, AgentCheckoutService, PartnerService, AgentAccessService],
})
export class AgentsModule {}
