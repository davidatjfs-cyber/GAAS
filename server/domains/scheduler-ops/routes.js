/**
 * 全局定时任务面板 HTTP。路由只做绑定与鉴权，逻辑在 service.js。
 */
import { isOpsAdminRole } from '../agent-ops/service.js';
import { buildSchedulerOpsSnapshot } from './service.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'scheduler-ops', handler: 'routes' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: () => import('pg').Pool }} deps
 */
export function registerSchedulerOpsRoutes(app, authRequired, deps) {
  const { pool } = deps;

  app.get('/api/ops/schedulers', authRequired, async (req, res) => {
    if (!isOpsAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const snapshot = await buildSchedulerOpsSnapshot(pool());
      return res.json(snapshot);
    } catch (e) {
      log.error({ msg: 'scheduler_ops_snapshot_failed', err: e?.message });
      return res.status(500).json({ error: 'internal_error' });
    }
  });
}
