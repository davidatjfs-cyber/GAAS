/**
 * Agent 记录路由（从 agents.js#registerAgentRoutes Group D 外提）。
 */
import {
  createAppeal,
  getMyAgentScore,
  isRecordsAdminRole,
  listAgentIssues,
  listAgentMessages,
  listAgentScores,
  listAppeals,
  listFeishuUsers,
  listMyNotifications,
  listVisualAudits,
  resolveAgentIssue,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: () => import('pg').Pool,
 *   getSharedState: (tenantId?: string) => Promise<object|null>,
 *   inferBrandFromStoreName: (store: string) => string|null,
 *   fetchStoreRatingForProfileDisplay: (store: string, period: string) => Promise<object>,
 *   calculateStoreRating: (store: string, brand: string, period: string) => Promise<unknown>,
 *   registerFeishuUser: (openId: string, username: string) => Promise<object>,
 * }} deps
 */
export function registerAgentRecordsRoutes(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    inferBrandFromStoreName,
    fetchStoreRatingForProfileDisplay,
    calculateStoreRating,
    registerFeishuUser,
  } = deps;

  app.get('/api/agents/issues', authRequired, async (req, res) => {
    try {
      const items = await listAgentIssues(pool(), {
        role: req.user?.role,
        username: req.user?.username,
        status: req.query?.status,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      });
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/issues/:id/resolve', authRequired, async (req, res) => {
    try {
      const result = await resolveAgentIssue(pool(), {
        id: req.params?.id,
        resolution: req.body?.resolution,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agent-scores/me', authRequired, async (req, res) => {
    try {
      const result = await getMyAgentScore(pool(), {
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        getSharedState,
        inferBrandFromStoreName,
        fetchStoreRatingForProfileDisplay,
        calculateStoreRating,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result.body);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/hrms-notifications/me', authRequired, async (req, res) => {
    try {
      const result = await listMyNotifications(pool(), req.user?.username, req.query?.limit);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ items: result.items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/scores', authRequired, async (req, res) => {
    try {
      const items = await listAgentScores(pool(), {
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

  app.get('/api/agents/audits', authRequired, async (req, res) => {
    try {
      const items = await listVisualAudits(pool(), {
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

  app.post('/api/agents/appeals', authRequired, async (req, res) => {
    try {
      const result = await createAppeal(pool(), {
        username: req.user?.username,
        reason: req.body?.reason,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ ok: true, id: result.id });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/appeals', authRequired, async (req, res) => {
    try {
      const items = await listAppeals(pool(), {
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

  app.get('/api/agents/messages', authRequired, async (req, res) => {
    try {
      const items = await listAgentMessages(pool(), {
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

  app.get('/api/agents/feishu-users', authRequired, async (req, res) => {
    if (!isRecordsAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    try {
      return res.json({ items: await listFeishuUsers(pool()) });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/feishu-users/bind', authRequired, async (req, res) => {
    if (!isRecordsAdminRole(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    const openId = String(req.body?.openId || '').trim();
    const username = String(req.body?.username || '').trim();
    if (!openId || !username) return res.status(400).json({ error: 'missing_params' });
    try {
      return res.json(await registerFeishuUser(openId, username));
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
