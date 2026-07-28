/**
 * 角色工作台 HTTP 路由：只读聚合 + 批量推广菜品这一个薄写路径。
 */
import { childLogger } from '../../utils/logger.js';
import { getWorkspaceHome, promoteDishToStores } from './service.js';
import { getBossOverview } from './overview.js';
import { getMarketingSuggestions } from './marketing-suggestions.js';
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
  if (role === 'admin') return [];
  if (WS_STORE_LEVEL_ROLES.includes(role)) {
    const own = String(req.user?.current_store || req.user?.store || '').trim();
    return own ? [own] : [];
  }
  const allowed = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores.filter(Boolean) : [];
  return allowed;
}

/**
 * @param {{ pool: import('pg').Pool, resolveTenantIdDefault: (req)=>string }} deps
 */
export function registerWorkspaceRoutes(app, authRequired, deps) {
  const { pool, resolveTenantIdDefault, getSharedState } = deps;

  app.get('/api/workspace/home', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      const scope = String(req.query?.scope || '').trim() === 'notable' ? 'notable' : 'mine';
      const data = await getWorkspaceHome(pool, tenantId, username, { scope });
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
      const data = await getBossOverview(pool, tenantId, storeFilter);
      if (!data.ok) return res.status(500).json({ error: data.error });
      res.json(data);
    } catch (e) {
      log.error({ msg: 'workspace_overview_failed', request_id: req.requestId, err: e?.message });
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

  app.get('/api/workspace/bad-reviews', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const items = await getBadReviewFeed(pool, tenantId, {
        store: String(req.query?.store || '').trim(),
        startDate: String(req.query?.startDate || '').trim(),
        endDate: String(req.query?.endDate || '').trim(),
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
}
