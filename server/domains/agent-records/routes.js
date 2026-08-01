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
  ackMyNotification,
  listVisualAudits,
  resolveAgentIssue,
} from './service.js';

function withRequestId(req, extra = {}) {
  return { ...extra, requestId: req.requestId };
}

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
      const items = await listAgentIssues(pool(), withRequestId(req, {
        role: req.user?.role,
        username: req.user?.username,
        status: req.query?.status,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      }));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/issues/:id/resolve', authRequired, async (req, res) => {
    try {
      const result = await resolveAgentIssue(pool(), withRequestId(req, {
        id: req.params?.id,
        resolution: req.body?.resolution,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      }));
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agent-scores/me', authRequired, async (req, res) => {
    try {
      const result = await getMyAgentScore(pool(), withRequestId(req, {
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        // 2026-08-01：我的绩效加月份筛选，?month=YYYY-MM。
        month: String(req.query?.month || '').trim(),
        getSharedState,
        inferBrandFromStoreName,
        fetchStoreRatingForProfileDisplay,
        calculateStoreRating,
      }));
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result.body);
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/hrms-notifications/me', authRequired, async (req, res) => {
    try {
      const unreadOnly = String(req.query?.unread || '').trim() === '1';
      const result = await listMyNotifications(pool(), req.user?.username, req.query?.limit, { unreadOnly });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ items: result.items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/hrms-notifications/:id/ack', authRequired, async (req, res) => {
    try {
      const result = await ackMyNotification(pool(), req.user?.username, req.params?.id);
      if (!result.ok) return res.status(result.status).json({ error: result.error, message: result.message });
      return res.json({ ok: true, acked_ids: result.acked_ids, read_at: result.read_at });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/scores', authRequired, async (req, res) => {
    try {
      const items = await listAgentScores(pool(), withRequestId(req, {
        role: req.user?.role,
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      }));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/audits', authRequired, async (req, res) => {
    try {
      const items = await listVisualAudits(pool(), withRequestId(req, {
        role: req.user?.role,
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      }));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post('/api/agents/appeals', authRequired, async (req, res) => {
    try {
      const result = await createAppeal(pool(), withRequestId(req, {
        username: req.user?.username,
        reason: req.body?.reason,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      }));
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ ok: true, id: result.id });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/appeals', authRequired, async (req, res) => {
    try {
      const items = await listAppeals(pool(), withRequestId(req, {
        role: req.user?.role,
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      }));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.get('/api/agents/messages', authRequired, async (req, res) => {
    try {
      const items = await listAgentMessages(pool(), withRequestId(req, {
        role: req.user?.role,
        username: req.user?.username,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        limit: req.query?.limit,
      }));
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
