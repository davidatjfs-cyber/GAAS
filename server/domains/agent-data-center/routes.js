/**
 * Agent 数据中心只读路由（从 agents.js#registerAgentRoutes 外提）。
 * handler ≤30 行；业务在 service.js。
 */
import {
  BRIEF_ROLES,
  DASHBOARD_ROLES,
  getActivityDetail,
  getDashboardSummary,
  getDataCenterBrief,
  getScoreProvenance,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: () => import('pg').Pool,
 *   getAgentPerformanceMetrics: () => object,
 *   cronJobLabelZh: (key: string) => string,
 * }} deps
 */
export function registerAgentDataCenterRoutes(app, authRequired, deps) {
  const { pool, getAgentPerformanceMetrics, cronJobLabelZh } = deps;

  app.get('/api/agents/dashboard', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!DASHBOARD_ROLES.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
      const payload = await getDashboardSummary(pool(), tenantIdQ, getAgentPerformanceMetrics);
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/data-center-brief', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!BRIEF_ROLES.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const payload = await getDataCenterBrief(pool(), {
        username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        activityDate: req.query?.activityDate,
        cronJobLabelZh,
      });
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/activity-detail', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!BRIEF_ROLES.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const payload = await getActivityDetail(
        pool(),
        req.query?.date,
        req.tenantId || req.user?.tenant_id || 'default'
      );
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/score-provenance', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!BRIEF_ROLES.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const result = await getScoreProvenance(pool(), {
        query: req.query?.q || req.query?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      });
      if (!result.ok) return res.status(result.status).json(result.body);
      return res.json(result.body);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
