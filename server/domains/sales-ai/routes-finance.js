import { registerSalesAiFinanceContractRoutes } from './routes-finance-contracts.js';
import { registerSalesAiFinanceCreditRoutes } from './routes-finance-credit.js';
import { registerSalesAiFinanceDeliveryRoutes } from './routes-finance-delivery.js';

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */
export function registerSalesAiFinanceRoutes(ctx) {
  registerSalesAiFinanceContractRoutes(ctx);
  registerSalesAiFinanceCreditRoutes(ctx);
  registerSalesAiFinanceDeliveryRoutes(ctx);
}
