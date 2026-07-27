/**
 * HQ Planner — API Routes
 * 从 hq-planner-agent.js 拆出。ctx = { pool, callLLMTiered, log }（避免反向 import）。
 */
import {
  traceCausalChain,
  getStoreHealthOverview,
  crossStoreComparison,
  formatGraphContextForLLM
} from '../../knowledge-graph.js';
import { isHqRole } from '../../hq-brain-config.js';
import { generateActionPlan } from './generate-plan.js';
import { approvePlan, rejectPlan, listPlans } from './plan-lifecycle.js';

export function registerHqPlannerRoutes(app, authRequired, ctx) {

  // 生成行动计划
  app.post('/api/hq/plans', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!isHqRole(role)) return res.status(403).json({ error: 'forbidden' });
    const { store, goal } = req.body || {};
    if (!store) return res.status(400).json({ error: 'missing_store' });
    const result = await generateActionPlan(ctx, { store, goal, role, createdBy: req.user?.username, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
    return res.json(result);
  });

  // 计划列表
  app.get('/api/hq/plans', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!isHqRole(role)) return res.status(403).json({ error: 'forbidden' });
    const plans = await listPlans(ctx, {
      store: req.query?.store,
      status: req.query?.status,
      limit: Number(req.query?.limit) || 20
    });
    return res.json({ items: plans });
  });

  // 计划详情
  app.get('/api/hq/plans/:planId', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!isHqRole(role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const r = await ctx.pool().query(`SELECT * FROM action_plans WHERE plan_id = $1`, [req.params.planId]);
      if (!r.rows?.length) return res.status(404).json({ error: 'not_found' });
      return res.json(r.rows[0]);
    } catch (e) {
      return res.status(500).json({ error: e?.message });
    }
  });

  // 审批计划
  app.post('/api/hq/plans/:planId/approve', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const result = await approvePlan(ctx, req.params.planId, req.user?.username, { requestId: req.requestId });
    return res.json(result);
  });

  // 驳回计划
  app.post('/api/hq/plans/:planId/reject', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const result = await rejectPlan(ctx, req.params.planId, req.user?.username, req.body?.reason);
    return res.json(result);
  });

  // 门店健康度
  app.get('/api/hq/store-health/:store', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!isHqRole(role)) return res.status(403).json({ error: 'forbidden' });
    const overview = await getStoreHealthOverview(req.params.store, Number(req.query?.days) || 30);
    return res.json(overview);
  });

  // 因果链查询
  app.get('/api/hq/causal-chain', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!isHqRole(role)) return res.status(403).json({ error: 'forbidden' });
    const { entityType, entityId, maxDepth, daysBack } = req.query || {};
    if (!entityType || !entityId) return res.status(400).json({ error: 'missing entityType/entityId' });
    const chain = await traceCausalChain(entityType, entityId, Number(maxDepth) || 3, Number(daysBack) || 30);
    return res.json({ chain, formatted: formatGraphContextForLLM(chain) });
  });

  // 跨门店对比
  app.post('/api/hq/compare-stores', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!isHqRole(role)) return res.status(403).json({ error: 'forbidden' });
    const { stores, daysBack } = req.body || {};
    if (!Array.isArray(stores) || stores.length < 2) return res.status(400).json({ error: 'need at least 2 stores' });
    const result = await crossStoreComparison(stores, Number(daysBack) || 30);
    return res.json(result);
  });

  // 图谱统计
  app.get('/api/hq/graph-stats', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!isHqRole(role)) return res.status(403).json({ error: 'forbidden' });
    const { getGraphStats } = await import('../../knowledge-graph.js');
    const stats = await getGraphStats();
    return res.json(stats);
  });

  // 算力统计
  app.get('/api/hq/cost-stats', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const { getCostStats } = await import('../../hq-brain-config.js');
    return res.json(getCostStats(Number(req.query?.days) || 7));
  });
}
