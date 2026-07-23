import express from 'express';
import {
  loadPaymentConfigFromState,
  normalizePaymentBudgets,
  normalizePaymentSettings,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: (tenantId?: string)=>Promise<object|null>,
 *   saveSharedState: (data: object, tenantId?: string)=>Promise<any>,
 *   resolveTenantId: (req)=>string,
 * }} deps
 */
export function registerPaymentConfigRoutes(app, authRequired, deps) {
  const { getSharedState, saveSharedState, resolveTenantId } = deps;
  const r = express.Router();

  r.get('/', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      return res.json(loadPaymentConfigFromState(state0));
    } catch (e) {
      console.error('[GET /api/payment-config]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  r.put('/', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden', message: '仅管理员可修改请款配置' });
    }
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      const paymentSettings = normalizePaymentSettings(
        req.body?.paymentSettings !== undefined ? req.body.paymentSettings : state0.paymentSettings
      );
      const paymentBudgets = normalizePaymentBudgets(
        req.body?.paymentBudgets !== undefined ? req.body.paymentBudgets : state0.paymentBudgets
      );
      await saveSharedState({ ...state0, paymentSettings, paymentBudgets }, tid);
      return res.json({ ok: true, paymentSettings, paymentBudgets });
    } catch (e) {
      console.error('[PUT /api/payment-config]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.use('/api/payment-config', r);
}
