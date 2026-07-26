/**
 * Training stores / search-employees routes.
 */
import { pool, isManager, getUserStore, getAssignableRoles } from './shared.js';

export function registerTrainingAssignmentsSearchRoutes(app, authMiddleware, _uploadMiddleware) {
  app.get('/api/training/stores', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) return res.status(403).json({ error: '无权限' });
      const userRole = req.user?.role;
      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        const userStore = await getUserStore(req.user?.username);
        if (userStore) return res.json({ success: true, stores: [userStore] });
      }
      const result = await pool().query(`SELECT DISTINCT store FROM employees WHERE store != '' AND status != 'inactive' AND tenant_id = $1 ORDER BY store`, [req.tenantId || req.user?.tenant_id || 'default']);
      res.json({ success: true, stores: result.rows.map(r => r.store) });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });

  app.get('/api/training/search-employees', authMiddleware, async (req, res) => {
    try {
      if (!isManager(req.user?.role)) {
        return res.status(403).json({ error: '无权限' });
      }
      const q = (req.query.q || '').trim();
      const filterStore = (req.query.store || '').trim();
      const filterPosition = (req.query.position || '').trim();
      const assignableRoles = getAssignableRoles(req.user?.role);
      const userRole = req.user?.role;

      const clauses = [`status != 'inactive'`];
      const params = [];
      params.push(req.tenantId || req.user?.tenant_id || 'default');
      clauses.push(`tenant_id = $${params.length}`);

      if (assignableRoles !== null) {
        params.push(assignableRoles);
        clauses.push(`role = ANY($${params.length})`);
      }

      if (['store_manager', 'store_production_manager'].includes(userRole)) {
        const userStore = await getUserStore(req.user?.username);
        if (userStore) {
          params.push(userStore);
          clauses.push(`store = $${params.length}`);
        }
      } else if (filterStore) {
        params.push(filterStore);
        clauses.push(`store = $${params.length}`);
      }

      if (filterPosition) {
        params.push('%' + filterPosition + '%');
        clauses.push(`position ILIKE $${params.length}`);
      }

      if (q) {
        params.push('%' + q + '%');
        clauses.push(`(name ILIKE $${params.length} OR username ILIKE $${params.length})`);
      }

      const sql = `SELECT username, name, role, position, store FROM employees WHERE ${clauses.join(' AND ')} ORDER BY store, name LIMIT 50`;
      const result = await pool().query(sql, params);
      res.json({ success: true, employees: result.rows });
    } catch (e) {
      res.json({ success: false, error: e?.message });
    }
  });
}
