/**
 * 增长发券窄路由：/api/growth/coupons
 * handler ≤30 行；业务在 service.js。
 */
import { tenantContext } from '../../utils/database.js';
import { listGrowthCoupons, upsertGrowthCoupon } from './service.js';

/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: any,
 *   requirePhaseAuth: (req, res)=>boolean,
 *   getPhaseTenantId: (req)=>string,
 * }} deps
 */
export function registerGrowthCouponRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId } = deps;

  app.post('/api/growth/coupons', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const tid = getPhaseTenantId(req);
    try {
      const coupon = await tenantContext.run(tid, () => upsertGrowthCoupon(pool, tid, req.body || {}));
      return res.json({ ok: true, coupon });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/coupons', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const tid = getPhaseTenantId(req);
    try {
      const coupons = await tenantContext.run(tid, () => listGrowthCoupons(pool, tid));
      return res.json({ ok: true, coupons });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
