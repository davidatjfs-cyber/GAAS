import { childLogger } from '../../utils/logger.js';
import { ensureSalesSimSeed, setSalesSimLlm } from './session-service.js';
import { registerSalesSimAdminRoutes } from './routes-admin.js';
import { registerSalesSimTenantRoutes } from './routes-tenant.js';
import { registerTalentEngineRoutes } from './routes-talent.js';

const log = childLogger({ domain: 'sales-sim', handler: 'routes' });

/**
 * @param {{
 *   app: any,
 *   pool: any,
 *   platformAdminRequired: Function,
 *   authRequired?: Function,
 *   callLLM?: Function,
 * }} ctx
 */
export function registerSalesSimRoutes(ctx) {
  const { pool, callLLM } = ctx;
  if (typeof callLLM === 'function') setSalesSimLlm(callLLM);
  // 惰性挂载 KB 检索（避免循环依赖）
  import('../../rag-tool.js').then((m) => {
    if (typeof m.ragQuery === 'function') {
      import('./fact-gate.js').then((fg) => fg.setFactGateRag(m.ragQuery));
    }
  }).catch(() => {});
  ensureSalesSimSeed(pool).catch((e) => log.warn({ msg: 'sales_sim_seed_failed', err: e?.message || e }));
  registerSalesSimAdminRoutes(ctx);
  registerSalesSimTenantRoutes(ctx);
  registerTalentEngineRoutes(ctx);
}
