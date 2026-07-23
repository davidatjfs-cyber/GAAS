import express from 'express';
import {
  loadConfigByKey,
  loadFlowConfigBundle,
  normalizeApprovalFlows,
  normalizePaymentFlowByStore,
  normalizeRoleModules,
  saveApprovalFlows,
  savePaymentFlowByStore,
  saveRoleModules,
  FLOW_CONFIG_KEYS,
} from './service.js';
import { patchHrmsStateFieldsOnClient, withMirrorWriteTx } from '../shared/mirror-tx.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   resolveTenantId: (req)=>string,
 *   getSharedState?: (tenantId: string)=>Promise<object|null>,
 * }} deps
 */
export function registerFlowConfigRoutes(app, authRequired, deps) {
  const { pool, resolveTenantId, getSharedState } = deps;
  const r = express.Router();

  r.get('/role-modules', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const fromTable = await loadConfigByKey(pool, tid, FLOW_CONFIG_KEYS.roleModules);
      let config = fromTable ? normalizeRoleModules(fromTable) : null;
      if ((!config || !Object.keys(config).length) && typeof getSharedState === 'function') {
        const state = (await getSharedState(tid)) || {};
        if (state.roleModules && typeof state.roleModules === 'object') {
          config = normalizeRoleModules(state.roleModules);
          if (Object.keys(config).length) {
            try {
              await saveRoleModules(pool, tid, config);
            } catch (_) { /* non-fatal backfill */ }
          }
        }
      }
      if (!config || !Object.keys(config).length) config = null;
      return res.json({ config });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.put('/role-modules', authRequired, async (req, res) => {
    if (String(req.user?.role || '') !== 'admin') {
      return res.status(403).json({ error: 'admin_only' });
    }
    try {
      const tid = resolveTenantId(req);
      const config = req.body?.config;
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'invalid_config' });
      }
      const saved = await withMirrorWriteTx(pool, async (client) => {
        const normalized = await saveRoleModules(client, tid, config);
        await patchHrmsStateFieldsOnClient(client, tid, { roleModules: normalized });
        return normalized;
      });
      return res.json({ ok: true, config: saved });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.get('/approval-flows', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      let bundle = await loadFlowConfigBundle(pool, tid);
      const needFlows = !bundle.approvalFlows || !Object.keys(bundle.approvalFlows).length;
      const needPay = !bundle.paymentFlowByStore || !Object.keys(bundle.paymentFlowByStore).length;
      if ((needFlows || needPay) && typeof getSharedState === 'function') {
        const state = (await getSharedState(tid)) || {};
        if (needFlows && state.approvalFlows) {
          try {
            bundle.approvalFlows = await saveApprovalFlows(pool, tid, state.approvalFlows);
          } catch (_) {
            bundle.approvalFlows = normalizeApprovalFlows(state.approvalFlows);
          }
        }
        if (needPay && state.paymentFlowByStore) {
          try {
            bundle.paymentFlowByStore = await savePaymentFlowByStore(pool, tid, state.paymentFlowByStore);
          } catch (_) {
            bundle.paymentFlowByStore = normalizePaymentFlowByStore(state.paymentFlowByStore);
          }
        }
      }
      return res.json({
        ok: true,
        approvalFlows: bundle.approvalFlows || {},
        paymentFlowByStore: bundle.paymentFlowByStore || {},
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.put('/approval-flows', authRequired, async (req, res) => {
    if (String(req.user?.role || '') !== 'admin') {
      return res.status(403).json({ error: 'admin_only' });
    }
    try {
      const tid = resolveTenantId(req);
      const approvalFlows = req.body?.approvalFlows;
      const paymentFlowByStore = req.body?.paymentFlowByStore;
      const hasApprovalFlows = approvalFlows && typeof approvalFlows === 'object';
      const hasPaymentFlow = paymentFlowByStore && typeof paymentFlowByStore === 'object';
      if (!hasApprovalFlows && !hasPaymentFlow) {
        return res.status(400).json({ error: 'invalid_config' });
      }
      const mirror = await withMirrorWriteTx(pool, async (client) => {
        const fields = {};
        if (hasApprovalFlows) {
          fields.approvalFlows = await saveApprovalFlows(client, tid, approvalFlows);
        }
        if (hasPaymentFlow) {
          fields.paymentFlowByStore = await savePaymentFlowByStore(client, tid, paymentFlowByStore);
        }
        await patchHrmsStateFieldsOnClient(client, tid, fields);
        return fields;
      });
      return res.json({ ok: true, ...mirror });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  // 挂到 /api：role-modules 与 approval-flows 保持原路径
  app.use('/api', r);
}
