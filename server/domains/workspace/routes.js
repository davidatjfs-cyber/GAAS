/**
 * 角色工作台 HTTP 路由：只读聚合 + 批量推广菜品这一个薄写路径。
 */
import { childLogger } from '../../utils/logger.js';
import { getWorkspaceHome, promoteDishToStores, respondToTask, confirmTaskResponse, getPendingConfirmations, ackTask, resolveFoodSafetyTask, getMyRecentlyResolvedTasks } from './service.js';
import { getBossOverview, getMonthlyTargetActuals } from './overview.js';
import { getMarketingSuggestions, getMarketingReviewQueue } from './marketing-suggestions.js';
import { getBadReviewFeed } from './bad-review-feed.js';

const log = childLogger({ domain: 'workspace', handler: 'routes' });

/**
 * 老板=admin 看全部门店（不过滤）；hq_manager/其他角色只看自己被分配到的门店范围
 * （req.user.allowed_stores，由 authRequired 中间件在登录/刷新时算好挂在 JWT 上，
 * 目前来自 store-duty-bindings/权限组的 storeScope）。
 * ⚠️ 这里有个还没跟业务方确认的空白：现有 allowed_stores 机制是给"同店多岗位员工"设计的，
 * 不确定"总部营运经理负责某个区域/品牌"这种场景是否已经通过权限组的门店范围在配置——
 * 如果 hq_manager 账号没配过 storeScope，allowed_stores 会是空数组，这里会退回到"不过滤"，
 * 等同于老板视角，这不一定是对的，需要业务方确认这些账号有没有配过范围。
 */
const WS_STORE_LEVEL_ROLES = ['store_manager', 'store_production_manager', 'front_manager', 'front_supervisor'];

function resolveOverviewStoreFilter(req) {
  const role = String(req.user?.role || '').trim();
  if (role === 'admin') {
    // 2026-08-02：admin/hq_manager工作台新增"门店目标追踪"模块（跟店长/出品经理一样），
    // 但那个模块的营业日目标/毛利目标是单店口径，admin默认不限门店(storeFilter=[])聚合
    // 出来的是全公司汇总，不能直接拿来当"某家店的目标追踪"用。只在前端显式传了?store=
    // 时才收窄到那一家店，不传时保持原有全公司聚合行为不变。
    const qStore = String(req.query?.store || '').trim();
    return qStore ? [qStore] : [];
  }
  if (WS_STORE_LEVEL_ROLES.includes(role)) {
    const own = String(req.user?.current_store || req.user?.store || '').trim();
    return own ? [own] : [];
  }
  const allowed = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores.filter(Boolean) : [];
  // hq_manager同款?store=收窄，但只允许收窄到自己allowed_stores范围内的门店，不能越权查看
  // 范围外的门店（跟admin不同，admin本来就不限门店，hq_manager是有范围的）。
  const qStore = String(req.query?.store || '').trim();
  if (qStore && allowed.includes(qStore)) return [qStore];
  return allowed;
}

/**
 * 2026-07-30：新增两个路由后 registerWorkspaceRoutes 超过函数行数棘轮上限——按纪律拆成
 * 两个薄注册函数（本体只保留首页聚合类只读路由），任务相关的路由（提交证据/确认/ack/
 * 判罚/最近完成）外提到 registerWorkspaceTaskRoutes，不是重新设计路由，只是搬家。
 * @param {{ pool: import('pg').Pool, resolveTenantIdDefault: (req)=>string }} deps
 */
export function registerWorkspaceRoutes(app, authRequired, deps) {
  const { pool, resolveTenantIdDefault, getSharedState } = deps;

  app.get('/api/workspace/home', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      // 2026-07-30 修复：任务是否需要"抄送"由角色决定（只有食品安全类需要抄送总部经理/
      // 管理员），不能再由前端传的 scope 参数决定"看谁的任务"——那会导致任何角色只要传
      // scope=notable 就能看到全租户任务。改成服务端按 req.user.role 判断。
      const role = String(req.user?.role || '').trim();
      // 2026-08-01：门店红绿灯加月份筛选，?month=YYYY-MM，不传保持原行为(固定上个自然月)。
      const month = String(req.query?.month || '').trim();
      const data = await getWorkspaceHome(pool, tenantId, username, { role, month });
      res.json({ ok: true, ...data });
    } catch (e) {
      log.error({ msg: 'workspace_home_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/workspace/overview', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', ...WS_STORE_LEVEL_ROLES].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const storeFilter = resolveOverviewStoreFilter(req);
      // 2026-08-01：门店经营明细/营业额/客流量/人效排名加月份筛选，?month=YYYY-MM。
      const month = String(req.query?.month || '').trim();
      const data = await getBossOverview(pool, tenantId, storeFilter, month, role);
      if (!data.ok) return res.status(500).json({ error: data.error });
      res.json(data);
    } catch (e) {
      log.error({ msg: 'workspace_overview_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  // 2026-07-30：当月目标追踪里"目标管理"录入的其它目标项一直显示"系统暂未接入该指标的
  // 自动核算"——实际这些数据都在daily_reports里，只是没人接。这里只允许查自己allowed_stores
  // 范围内的门店(店长/出品经理只能查自己门店，admin/hq_manager不限)。
  app.get('/api/workspace/monthly-target-actuals', authRequired, async (req, res) => {
    const store = String(req.query?.store || '').trim();
    const ym = String(req.query?.ym || '').trim();
    if (!store || !/^\d{4}-\d{2}$/.test(ym)) return res.status(400).json({ error: 'missing_store_or_ym' });
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      const allowed = resolveOverviewStoreFilter(req);
      if (allowed.length && !allowed.includes(store)) return res.status(403).json({ error: 'forbidden' });
    }
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const actuals = await getMonthlyTargetActuals(pool, tenantId, store, ym);
      res.json({ ok: true, actuals });
    } catch (e) {
      log.error({ msg: 'workspace_monthly_target_actuals_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/workspace/marketing-suggestions', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const storeFilter = resolveOverviewStoreFilter(req);
      const items = await getMarketingSuggestions(pool, tenantId, storeFilter);
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'workspace_marketing_suggestions_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  // 统一营销审核队列（2026-08-07）：策略实验待审 + growth_actions(proposed) 聚合到一个端口
  app.get('/api/marketing/review-queue', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager'].includes(role)) return res.status(403).json({ error: 'forbidden' });
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const storeFilter = resolveOverviewStoreFilter(req);
      const items = await getMarketingReviewQueue(pool, tenantId, storeFilter);
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'marketing_review_queue_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/workspace/bad-reviews', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const items = await getBadReviewFeed(pool, tenantId, {
        store: String(req.query?.store || '').trim(),
        startDate: String(req.query?.startDate || '').trim(),
        endDate: String(req.query?.endDate || '').trim(),
        storeFilter: resolveOverviewStoreFilter(req),
        sourceType: String(req.query?.sourceType || '').trim(),
      });
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'workspace_bad_reviews_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/workspace/promote-dish', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const state = (await getSharedState(tenantId)) || {};
      const result = await promoteDishToStores(pool, {
        dishName: req.body?.dishName,
        sourceStore: req.body?.sourceStore,
        targetStores: req.body?.targetStores,
        note: req.body?.note,
        actorUsername: req.user?.username,
        tenantId,
        state,
      });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'workspace_promote_dish_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  registerWorkspaceTaskRoutes(app, authRequired, deps);
}

/**
 * 任务相关路由外提（提交证据/确认/ack/判罚/最近完成）——从registerWorkspaceRoutes搬出来，
 * 单纯是为了不超函数行数棘轮，行为完全不变，deps跟主函数用同一份。
 * @param {{ pool: import('pg').Pool, resolveTenantIdDefault: (req)=>string }} deps
 */
function registerWorkspaceTaskRoutes(app, authRequired, deps) {
  const { pool, resolveTenantIdDefault } = deps;

  // 2026-07-30：任务一旦resolved就从"任务栏"消失，责任人自己都没法回头确认"这件事到底有
  // 没有真的处理过"——尤其是通过飞书快速回复几秒内就closed的任务，工作台里几乎从来没
  // 出现过。补一个"最近完成"视图，默认查最近24小时。
  app.get('/api/workspace/tasks/recently-resolved', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      const hours = Number(req.query?.hours) || 24;
      const items = await getMyRecentlyResolvedTasks(pool, tenantId, username, hours);
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'workspace_recently_resolved_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  // 2026-07-29 新增：master_tasks 责任人自己提交完成证据（之前"确认完成/批准"按钮统一走
  // agent-task-board 的 admin-only /review，真正的责任人点击必定 403，而且"点一下就算完成"
  // 本身也不构成闭环——这里要求责任人必须提交文字说明或证据图片，不是空点。
  app.post('/api/workspace/tasks/:taskId/respond', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      const result = await respondToTask(pool, tenantId, {
        taskId: req.params.taskId,
        username,
        responseText: req.body?.responseText,
        responseImages: req.body?.responseImages,
      });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'workspace_task_respond_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/workspace/pending-confirmations', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const items = await getPendingConfirmations(pool, tenantId, req.user?.username, req.user?.role);
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'workspace_pending_confirmations_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  // 发起人（或 admin/hq_manager）确认责任人提交的证据，任务才真正闭环；打回则责任人重新收到
  // 任务+打回原因，不是直接判死。
  app.post('/api/workspace/tasks/:taskId/confirm-response', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const result = await confirmTaskResponse(pool, tenantId, {
        taskId: req.params.taskId,
        reviewerUsername: req.user?.username,
        reviewerRole: req.user?.role,
        decision: req.body?.decision,
        note: req.body?.note,
      });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'workspace_task_confirm_response_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  // 2026-07-30：任务栏是"要清空的队列"——cc(仅同步知悉)类食品安全任务，admin点"确认收到"
  // 只记一行per-user ack，不改任务本身状态(还抄送给别的admin/hq_manager)。
  app.post('/api/workspace/tasks/:taskId/ack', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const result = await ackTask(pool, tenantId, req.params.taskId, req.user?.username);
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'workspace_task_ack_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  // 总部经理对食品安全类任务输入判罚结果后，任务真正结案(resolved)，对所有cc收件人都消失。
  app.post('/api/workspace/tasks/:taskId/food-safety-verdict', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const result = await resolveFoodSafetyTask(pool, tenantId, {
        taskId: req.params.taskId,
        reviewerUsername: req.user?.username,
        reviewerRole: req.user?.role,
        verdict: req.body?.verdict,
      });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'workspace_food_safety_verdict_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });
}
