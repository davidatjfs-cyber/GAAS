/**
 * Agent 运维监控路由（从 agents.js#registerAgentRoutes Group C 外提）。
 */
import {
  isOpsAdminRole,
  isOpsViewerRole,
  listAutonomousTasks,
  listEvalSuiteRuns,
  listQualityAudits,
  resolveAutonomousTask,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: () => import('pg').Pool,
 *   getAgentPerformanceMetrics: () => object,
 *   runAgentEvalSuite: (opts: object) => Promise<object>,
 *   getScheduledTaskStatus: () => object,
 *   clearAgentCache: () => void,
 * }} deps
 */
export function registerAgentOpsRoutes(app, authRequired, deps) {
  const {
    pool,
    getAgentPerformanceMetrics,
    runAgentEvalSuite,
    getScheduledTaskStatus,
    clearAgentCache,
  } = deps;

  app.get('/api/agents/performance', authRequired, async (req, res) => {
    if (!isOpsAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      return res.json({ metrics: getAgentPerformanceMetrics() });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/eval-suite/run', authRequired, async (req, res) => {
    if (!isOpsAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const suiteName = String(req.body?.suiteName || 'default').trim() || 'default';
      const result = await runAgentEvalSuite({
        createdBy: String(req.user?.username || ''),
        suiteName,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      });
      return res.json({ ok: true, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/eval-suite/runs', authRequired, async (req, res) => {
    if (!isOpsViewerRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const items = await listEvalSuiteRuns(
        pool(),
        req.tenantId || req.user?.tenant_id || 'default',
        req.query?.limit
      );
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/autonomous-tasks', authRequired, async (req, res) => {
    try {
      const items = await listAutonomousTasks(pool(), {
        status: req.query?.status,
        role: req.user?.role,
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      });
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/autonomous-tasks/:id/resolve', authRequired, async (req, res) => {
    try {
      const result = await resolveAutonomousTask(pool(), {
        id: req.params?.id,
        role: req.user?.role,
        username: req.user?.username,
        note: req.body?.note,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/quality-audits', authRequired, async (req, res) => {
    if (!isOpsViewerRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const items = await listQualityAudits(pool(), {
        route: req.query?.route,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      });
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/scheduler-status', authRequired, async (req, res) => {
    if (!isOpsViewerRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      return res.json({ scheduler: getScheduledTaskStatus() });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/clear-cache', authRequired, async (req, res) => {
    if (!isOpsAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      clearAgentCache();
      return res.json({ ok: true, message: 'Cache cleared successfully' });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
