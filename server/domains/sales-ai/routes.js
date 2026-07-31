/**
 * 销售 AI 路由入口：组合子模块 + 定时任务
 */
import { refreshSalesPermissionConfigCache } from '../../services/sales/sales-permission-config.js';
import { setSalesCustomerAiLlm } from '../../services/sales/sales-customer-ai.js';
import { setSalesReplyDraftLlm } from '../../services/sales/sales-reply-draft.js';
import { setSalesProposalLlm } from '../../services/sales/sales-proposal.js';
import { setSalesAssistantLlm } from '../../services/sales/sales-internal-assistant.js';
import { setSalesNotify } from '../../services/sales/sales-session.js';
import { createSalesAiGates } from './gates.js';
import { registerSalesAiKfRoutes } from './routes-kf.js';
import { registerSalesAiAdminMetaRoutes } from './routes-admin-meta.js';
import { registerSalesAiFinanceRoutes } from './routes-finance.js';
import { registerSalesAiLeadsRoutes } from './routes-leads.js';
import { registerSalesAiOpsRoutes } from './routes-ops.js';
import { registerSalesAiSchedulers } from './routes-schedulers.js';
import { registerSalesLeadScopeMiddleware } from './routes-lead-scope.js';
import { registerSalesSimRoutes } from '../sales-sim/routes.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes' });


export function registerSalesAiRoutes(app, pool, platformAdminRequired, {
  callLLM, sendOpsAlert, requireSalesManagerOrAbove, upload, authRequired,
} = {}) {
  const gates = createSalesAiGates(pool, requireSalesManagerOrAbove);
  const ctx = { app, pool, platformAdminRequired, gates, callLLM, sendOpsAlert, upload, authRequired };

  if (typeof callLLM === 'function') {
    setSalesCustomerAiLlm(callLLM);
    setSalesReplyDraftLlm(callLLM);
    setSalesProposalLlm(callLLM);
    setSalesAssistantLlm(callLLM);
  }
  if (typeof sendOpsAlert === 'function') setSalesNotify(sendOpsAlert);

  refreshSalesPermissionConfigCache(pool).catch((e) => log.warn({ msg: 'sales_ai_permission_config_warm_up_failed', err: e?.message || e }));

  registerSalesAiSchedulers(pool, sendOpsAlert);
  registerSalesLeadScopeMiddleware(app, pool, platformAdminRequired);

  registerSalesAiKfRoutes(ctx);
  registerSalesAiAdminMetaRoutes(ctx);
  registerSalesAiFinanceRoutes(ctx);
  registerSalesAiLeadsRoutes(ctx);
  registerSalesAiOpsRoutes(ctx);
  registerSalesSimRoutes(ctx);
}
