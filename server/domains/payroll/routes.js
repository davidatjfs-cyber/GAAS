import express from 'express';
import { loadPayrollDomainFromTable, loadPointRecordsFromTable } from './service.js';

/**
 * 窄接口：读权威表，不碰 req/res 以外的巨石逻辑。
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: any, resolveTenantId: (req)=>string }} deps
 */
export function registerPayrollDomainRoutes(app, authRequired, deps) {
  const { pool, resolveTenantId } = deps;
  const r = express.Router();

  r.get('/domain', authRequired, async (req, res) => {
    const role = String(req.user?.role || '');
    if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager')) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const domain = await loadPayrollDomainFromTable(pool, tid);
      return res.json({ ok: true, data: domain || {} });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  r.get('/points-mirror', authRequired, async (req, res) => {
    const role = String(req.user?.role || '');
    if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager')) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tid = resolveTenantId(req);
      const points = await loadPointRecordsFromTable(pool, tid);
      return res.json({ ok: true, items: points, count: points.length });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.use('/api/payroll', r);
}
