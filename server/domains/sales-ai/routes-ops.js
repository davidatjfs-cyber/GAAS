import { registerSalesAiOpsReportRoutes } from './routes-ops-reports.js';
import { registerSalesAiOpsPipelineRoutes } from './routes-ops-pipeline.js';
import { registerSalesAiOpsEnablementRoutes } from './routes-ops-enablement.js';
import { registerSalesAiOpsAssistantRoutes } from './routes-ops-assistant.js';
import { registerSalesAiOpsRepRoutes } from './routes-ops-reps.js';
import { registerSalesAiOpsCommissionRoutes } from './routes-ops-commission.js';

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object, sendOpsAlert?: Function }} ctx */
export function registerSalesAiOpsRoutes(ctx) {
  registerSalesAiOpsReportRoutes(ctx);
  registerSalesAiOpsPipelineRoutes(ctx);
  registerSalesAiOpsEnablementRoutes(ctx);
  registerSalesAiOpsAssistantRoutes(ctx);
  registerSalesAiOpsRepRoutes(ctx);
  registerSalesAiOpsCommissionRoutes(ctx);
}
