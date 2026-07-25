import express from 'express';
import {
  loadPaymentConfigFromState,
  normalizePaymentBudgets,
  normalizePaymentSettings,
} from './service.js';
import { patchHrmsStateFieldsOnClient, readHrmsStateForUpdate, withMirrorWriteTx } from '../shared/mirror-tx.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'payment-config', handler: 'routes' });


/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   getSharedState: (tenantId?: string)=>Promise<object|null>,
 *   resolveTenantId: (req)=>string,
 * }} deps
 */
export function registerPaymentConfigRoutes(app, authRequired, deps) {
  const { pool, getSharedState, resolveTenantId } = deps;
  const r = express.Router();

  r.get('/', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      return res.json(loadPaymentConfigFromState(state0));
    } catch (e) {
      log.error({ msg: 'get_api_payment_config', err: e?.message || e });
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
      const { paymentSettings, paymentBudgets } = await withMirrorWriteTx(pool, async (client) => {
        const { current } = await readHrmsStateForUpdate(client, tid);
        const nextSettings = normalizePaymentSettings(
          req.body?.paymentSettings !== undefined ? req.body.paymentSettings : current.paymentSettings
        );
        const nextBudgets = normalizePaymentBudgets(
          req.body?.paymentBudgets !== undefined ? req.body.paymentBudgets : current.paymentBudgets
        );
        await patchHrmsStateFieldsOnClient(client, tid, {
          paymentSettings: nextSettings,
          paymentBudgets: nextBudgets,
        });
        return { paymentSettings: nextSettings, paymentBudgets: nextBudgets };
      });
      return res.json({ ok: true, paymentSettings, paymentBudgets });
    } catch (e) {
      log.error({ msg: 'put_api_payment_config', err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.use('/api/payment-config', r);
}
