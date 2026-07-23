import { tenantContext } from '../../utils/database.js';
import { cleanText } from '../growth-phase-auth.js';
import {
  importWechatCustomersFromFeishu,
  importWechatCustomersManual,
  listWechatCustomers,
  wechatCustomerStats,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: any,
 *   requirePhaseAuth: Function,
 *   getPhaseTenantId: Function,
 *   resolveTenantIdForStore: Function,
 *   getFeishuBitableData: Function,
 * }} deps
 */
export function registerGrowthWechatWorkRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId, resolveTenantIdForStore, getFeishuBitableData } = deps;

  app.post('/api/growth/wechat-work/import-feishu', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const result = await importWechatCustomersFromFeishu(
        pool,
        resolveTenantIdForStore,
        getFeishuBitableData,
        req.body || {}
      );
      return res.json({ ok: true, ...result });
    } catch (e) {
      if (e?.code === 'bad_request') return res.status(400).json({ ok: false, error: e.message });
      return res.status(500).json({ ok: false, error: e?.message || 'import_failed' });
    }
  });

  app.post('/api/growth/wechat-work/customers', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const b = req.body || {};
      const customers = Array.isArray(b.customers) ? b.customers : [b];
      const result = await importWechatCustomersManual(pool, resolveTenantIdForStore, customers);
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/wechat-work/customers', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const sid = cleanText(req.query.store_id || '', 128);
      const result = await tenantContext.run(getPhaseTenantId(req), () => listWechatCustomers(pool, sid));
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/wechat-work/stats', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const stats = await tenantContext.run(getPhaseTenantId(req), () => wechatCustomerStats(pool));
      return res.json({ ok: true, stats });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
