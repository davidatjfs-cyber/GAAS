import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'stores' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 */
export function registerStoreListRoute(app, authRequired, deps) {
  const { pool, normalizeBrandId } = deps;

  app.get('/api/stores', authRequired, async (req, res) => {
    try {
      const r = await pool.query('select data from hrms_state where key = $1 limit 1', [req.tenantId || req.user?.tenant_id || 'default']);
      const row = r.rows?.[0] || null;
      if (!row || !row.data) {
        return res.json({ items: [] });
      }

      const stateStores = Array.isArray(row.data.stores) ? row.data.stores : [];
      const items = stateStores.map(s => ({
        id: s.id || s.name,
        name: s.name,
        address: s.address || '',
        city: s.city || '',
        floor: s.floor || '',
        manager_name: s.manager || s.managerName || '',
        managerName: s.manager || s.managerName || '',
        phone: s.phone || '',
        openDate: s.openDate || s.open_date || '',
        brand: s.brand || s.brandName || '',
        brandName: s.brand || s.brandName || '',
        brandId: normalizeBrandId(s.brandId || s.brand || s.brandName),
        region: s.region || '',
        status: String(s.status || 'active') === 'active' ? 'active' : 'inactive',
        is_active: String(s.status || 'active') === 'active'
      }));

      log.debug({ msg: 'stores_list', names: items.map((s) => s.name) });
      return res.json({ items });
    } catch (e) {
      log.error({ msg: 'stores_list_failed', request_id: req.requestId, err: e?.message || String(e) });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
