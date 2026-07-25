/**
 * Performance invalidation HTTP routes — thin handlers.
 * Business logic lives in service.js; default ctx assembled here for index.js compatibility.
 */
import { pool } from '../../utils/database.js';
import { calculateEmployeeScore, getIncompleteTaskCount } from '../../new-scoring-model.js';
import { sendLarkCard, sendLarkMessage } from '../../agents.js';
import { childLogger } from '../../utils/logger.js';
import { listPerformanceRecords, invalidatePerformanceRecord } from './service.js';

const log = childLogger({ domain: 'performance-invalidation', handler: 'routes' });

function sendFail(res, result) {
  const { ok: _ok, status, ...body } = result;
  return res.status(status || 500).json(body);
}

function sendOk(res, result) {
  const { ok: _ok, status: _status, ...body } = result;
  return res.json(body);
}

function defaultCtx() {
  return {
    pool,
    calculateEmployeeScore,
    getIncompleteTaskCount,
    sendLarkCard,
    sendLarkMessage,
  };
}

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 */
export function registerPerformanceInvalidationRoutes(app, authRequired) {
  const ctx = defaultCtx();

  app.get('/api/admin/performance-records', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });

    const { username, period } = req.query;
    const result = await listPerformanceRecords(ctx, {
      username,
      period,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/admin/performance-invalidate', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });

    const { source_type, source_id, username, store, period, reason } = req.body || {};
    const result = await invalidatePerformanceRecord(ctx, {
      source_type,
      source_id,
      username,
      store,
      period,
      reason,
      actorUsername: req.user?.username,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  log.info({ msg: 'performance_invalidation_routes_registered' });
}
