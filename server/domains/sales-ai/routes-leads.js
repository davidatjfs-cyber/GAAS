import { registerSalesAiLeadsReadRoutes } from './routes-leads-read.js';
import { registerSalesAiLeadsTenantRoutes } from './routes-leads-tenant.js';
import { registerSalesAiLeadsWorkflowRoutes } from './routes-leads-workflow.js';
import { registerSalesAiLeadsEngageRoutes } from './routes-leads-engage.js';

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */
export function registerSalesAiLeadsRoutes(ctx) {
  registerSalesAiLeadsReadRoutes(ctx);
  registerSalesAiLeadsTenantRoutes(ctx);
  registerSalesAiLeadsWorkflowRoutes(ctx);
  registerSalesAiLeadsEngageRoutes(ctx);
}
