import { executeGrowthActionRecord, resolveTenantIdForStore } from './growth-api.js';
import {
  ensureGrowthPhaseTables_1_4,
  ensureGrowthPhaseTables_5_8,
  ensureGrowthPhaseTables_9,
} from './growth-phase-tables.js';
import { registerGrowthAbRoutes } from './domains/growth-ab/routes.js';
import { registerGrowthCouponRoutes } from './domains/growth-coupons/routes.js';
import { registerGrowthSyncFailureRoutes } from './domains/growth-sync-failures/routes.js';
import { registerGrowthWechatWorkRoutes } from './domains/growth-wechat-work/routes.js';
import { registerGrowthCampaignRoutes } from './domains/growth-campaigns/routes.js';
import { registerGrowthContentCalendarRoutes } from './domains/growth-content-calendar/routes.js';
import { registerGrowthContentRoutes } from './domains/growth-content/routes.js';
import { registerGrowthPosRoutes } from './domains/growth-pos/routes.js';
import { registerGrowthChurnRoutes } from './domains/growth-churn/routes.js';
import { registerGrowthMenuHealthRoutes } from './domains/growth-menu-health/routes.js';
import {
  authPhaseApi,
  getPhaseApiTenantId,
} from './domains/growth-phase-auth.js';
import { startGrowthPhaseCrons } from './domains/growth-phases/phase-cron.js';
import { startPosFeishuSyncCron } from './domains/growth-phases/phase-pos-sync-cron.js';


export async function ensurePhaseTables(pool) {
  await ensureGrowthPhaseTables_1_4(pool);
  await ensureGrowthPhaseTables_5_8(pool);
  await ensureGrowthPhaseTables_9(pool);
}


export { ingestPosOrders } from './domains/growth-pos/ingest.js';

/**
 * @param {import('express').Express} app
 * @param {any} pool
 * @param {{ getFeishuBitableData?: Function }} [deps]
 */
export function registerPhaseRoutes(app, pool, deps = {}) {
  function rqa(req, res) {
    const auth = authPhaseApi(req);
    if (!auth.ok) { res.status(auth.status).json({ ok: false, error: auth.error }); return false; }
    return true;
  }

  const phaseAuthDeps = {
    pool,
    requirePhaseAuth: rqa,
    getPhaseTenantId: getPhaseApiTenantId,
  };

  registerGrowthCouponRoutes(app, phaseAuthDeps);
  registerGrowthSyncFailureRoutes(app, phaseAuthDeps);
  registerGrowthWechatWorkRoutes(app, {
    ...phaseAuthDeps,
    resolveTenantIdForStore,
    getFeishuBitableData:
      deps.getFeishuBitableData ||
      (async () => {
        throw new Error('getFeishuBitableData_not_injected');
      }),
  });
  registerGrowthCampaignRoutes(app, {
    ...phaseAuthDeps,
    executeGrowthActionRecord,
  });
  registerGrowthContentCalendarRoutes(app, phaseAuthDeps);
  registerGrowthContentRoutes(app, phaseAuthDeps);
  registerGrowthPosRoutes(app, phaseAuthDeps);
  registerGrowthChurnRoutes(app, phaseAuthDeps);
  registerGrowthMenuHealthRoutes(app, phaseAuthDeps);
  registerGrowthAbRoutes(app, phaseAuthDeps);

  startGrowthPhaseCrons(pool);
  startPosFeishuSyncCron(pool);
}
