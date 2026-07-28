/**
 * 角色工作台 HTTP 路由：只读聚合 + 批量推广菜品这一个薄写路径。
 */
import { childLogger } from '../../utils/logger.js';
import { getWorkspaceHome, promoteDishToStores } from './service.js';

const log = childLogger({ domain: 'workspace', handler: 'routes' });

/**
 * @param {{ pool: import('pg').Pool, resolveTenantIdDefault: (req)=>string }} deps
 */
export function registerWorkspaceRoutes(app, authRequired, deps) {
  const { pool, resolveTenantIdDefault } = deps;

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

  app.post('/api/workspace/promote-dish', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const tenantId = resolveTenantIdDefault(req.tenantId);
    try {
      const result = await promoteDishToStores(pool, {
        dishName: req.body?.dishName,
        sourceStore: req.body?.sourceStore,
        targetStores: req.body?.targetStores,
        note: req.body?.note,
        actorUsername: req.user?.username,
        tenantId,
      });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      log.error({ msg: 'workspace_promote_dish_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });
}
