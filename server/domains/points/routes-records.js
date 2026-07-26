/**
 * Points HTTP routes (behavior-preserving extract from index.js).
 * registerPointsRoutes(app, deps)
 */
import {
  normalizePointsAdminRecordStatus,
  mapApprovalRowToPointsAdminItem,
  canonicalizeStoreKeyForPoints,
} from './helpers.js';

export {
  canApplyPointsByRole,
  dedupeGlobalSocialMediaPointRules,
  ensureGlobalSocialMediaPointRule,
} from './helpers.js';

export function registerPointsRecordsRoutes(app, deps) {
  const {
    pool,
    authRequired,
    getSharedState,
    pickMyStoreFromState,
    safeDateOnly,
  } = deps;

  app.get('/api/points/records', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager' || role === 'front_manager' || role === 'front_supervisor')) return res.status(403).json({ error: 'forbidden' });

    const store = String(req.query?.store || '').trim();
    const name = String(req.query?.name || '').trim().toLowerCase();
    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    const recordStatus = normalizePointsAdminRecordStatus(req.query?.recordStatus || req.query?.status);

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = role === 'store_manager' ? String(pickMyStoreFromState(state0, username) || '').trim() : '';
      const _allowedStores2405 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore2405 = String(req.user?.current_store || '').trim();
      const effectiveStore = role === 'store_manager'
        ? (store && _allowedStores2405.includes(store) ? store : (_currentStore2405 || myStore))
        : store;

      let list = [];

      if (recordStatus === 'approved') {
        const params = [];
        const where = [];
        if (start) {
          params.push(start);
          where.push(`approved_at >= $${params.length}::date`);
        }
        if (end) {
          params.push(end);
          where.push(`approved_at < ($${params.length}::date + interval '1 day')`);
        }
        if (name) {
          params.push(`%${name}%`);
          where.push(`(lower(coalesce(name, '')) LIKE $${params.length} OR lower(coalesce(username, '')) LIKE $${params.length})`);
        }
        params.push(req.tenantId || req.user?.tenant_id || 'default');
        where.push(`tenant_id = $${params.length}`);
        const sql = `
      SELECT id::text, approval_id, username, name, store, item_name, reason, points, amount, approved_at, approved_by
      FROM point_records
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY approved_at DESC NULLS LAST, created_at DESC
    `;
        list = (await pool.query(sql, params)).rows.map((r) => ({
          id: r.id,
          sourceType: 'point_record',
          recordStatusZh: '已审批',
          approvalId: r.approval_id || '',
          username: r.username || '',
          name: r.name || '',
          store: r.store || '',
          itemName: r.item_name || '',
          reason: r.reason || '',
          points: Number(r.points) || 0,
          amount: Number(r.amount) || 0,
          approvedAt: r.approved_at ? String(r.approved_at) : '',
          approvedBy: r.approved_by || '',
          createdAt: ''
        }));
        if (effectiveStore) {
          const want = canonicalizeStoreKeyForPoints(effectiveStore);
          list = list.filter(x => canonicalizeStoreKeyForPoints(x?.store) === want);
        }
        list.sort((a, b) => String(b?.approvedAt || '').localeCompare(String(a?.approvedAt || '')));
      } else {
        const params2 = [req.tenantId || req.user?.tenant_id || 'default'];
        const where2 = [`type = 'points'`, `tenant_id = $1`];
        if (recordStatus === 'pending') {
          where2.push(`lower(status) = 'pending'`);
        }
        if (start) {
          params2.push(start);
          where2.push(`(timezone('Asia/Shanghai', created_at))::date >= $${params2.length}::date`);
        }
        if (end) {
          params2.push(end);
          where2.push(`(timezone('Asia/Shanghai', created_at))::date <= $${params2.length}::date`);
        }
        if (name) {
          params2.push(`%${name}%`);
          where2.push(`(lower(coalesce(applicant_username, '')) like $${params2.length} OR lower(payload::text) like $${params2.length})`);
        }
        const sql2 = `
        SELECT id, status, applicant_username, payload, created_at, updated_at, executed_at
        FROM approval_requests
        WHERE ${where2.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 3000
      `;
        const rows = (await pool.query(sql2, params2)).rows || [];
        list = rows.map(mapApprovalRowToPointsAdminItem);
        if (effectiveStore) {
          const want = canonicalizeStoreKeyForPoints(effectiveStore);
          list = list.filter(x => canonicalizeStoreKeyForPoints(x?.store) === want);
        }
        list.sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
      }

      const totalPoints = list.reduce((s, x) => s + (Number(x?.points || 0) || 0), 0);
      const totalAmount = Number((totalPoints * 0.5).toFixed(2));
      const uniqueUsernames = new Set(
        list.map(x => String(x?.username || '').trim().toLowerCase()).filter(Boolean)
      );
      return res.json({
        items: list,
        total: list.length,
        summary: {
          totalPoints,
          totalAmount,
          recordCount: list.length,
          employeeCount: uniqueUsernames.size,
          recordStatus: recordStatus === 'pending' ? '未审批' : (recordStatus === 'applied' ? '已申请' : '已审批')
        }
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
