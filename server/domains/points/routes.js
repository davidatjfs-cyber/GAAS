/**
 * Points HTTP routes (behavior-preserving extract from index.js).
 * registerPointsRoutes(app, deps)
 */
import {
  bindPointsRuntimeDeps,
  normalizePointsAdminRecordStatus,
  mapApprovalRowToPointsAdminItem,
  isTripleSocialMediaPointRuleItem,
  dedupePointRulesApiItems,
  canonicalizeStoreKeyForPoints,
} from './helpers.js';

export {
  canApplyPointsByRole,
  dedupeGlobalSocialMediaPointRules,
  ensureGlobalSocialMediaPointRule,
} from './helpers.js';

export function registerPointsRoutes(app, deps) {
  const {
    pool,
    authRequired,
    getSharedState,
    saveSharedState,
    mergeSharedStateFields,
    pickMyStoreFromState,
    safeDateOnly,
    safeMonthOnly,
    safeNumber,
    hrmsNowISO,
    randomUUID,
  } = deps;

  bindPointsRuntimeDeps({
    getSharedState,
    saveSharedState,
    mergeSharedStateFields,
    hrmsNowISO,
  });

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

  app.get('/api/points/ranking', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });

    const month = safeMonthOnly(req.query?.month) || hrmsNowISO().slice(0, 7);
    const store = String(req.query?.store || '').trim();

    try {
      const state0 = (await getSharedState()) || {};
      const monthStart = `${month}-01`;
      const pointRows = await pool.query(
        `SELECT username, name, store, points, amount, approved_at
       FROM point_records
       WHERE approved_at >= $1::date
         AND approved_at < ($1::date + interval '1 month')
         AND tenant_id = $2
       ORDER BY approved_at DESC NULLS LAST, created_at DESC`,
        [monthStart, req.tenantId || req.user?.tenant_id || 'default']
      );
      let list = (pointRows.rows || []).map((r) => ({
        username: r.username || '',
        name: r.name || '',
        store: r.store || '',
        points: Number(r.points) || 0,
        amount: Number(r.amount) || 0,
        approvedAt: r.approved_at ? String(r.approved_at) : ''
      }));
      if (store) {
        const want = canonicalizeStoreKeyForPoints(store);
        list = list.filter(x => canonicalizeStoreKeyForPoints(x?.store) === want);
      }

      const map = {};
      for (const r of list) {
        const u = String(r?.username || '').trim().toLowerCase();
        const name = String(r?.name || '').trim() || u;
        const pts = Number(r?.points || 0);
        if (!u) continue;
        if (!map[u]) map[u] = { username: u, name, store: String(r?.store || '').trim(), position: '', totalPoints: 0, count: 0 };
        map[u].totalPoints += pts;
        map[u].count += 1;
        if (name && name !== u) map[u].name = name;
      }

      // enrich position from employees
      const employees = Array.isArray(state0.employees) ? state0.employees : [];
      for (const key of Object.keys(map)) {
        const emp = employees.find(e => String(e?.username || '').trim().toLowerCase() === key);
        if (emp) {
          if (!map[key].name || map[key].name === key) map[key].name = String(emp?.name || '').trim() || key;
          map[key].position = String(emp?.position || '').trim();
          if (!map[key].store) map[key].store = String(emp?.store || '').trim();
        }
      }

      const ranking = Object.values(map).sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name, 'zh-Hans-CN'));
      let rank = 0, prevPts = -1;
      for (let i = 0; i < ranking.length; i++) {
        if (ranking[i].totalPoints !== prevPts) { rank = i + 1; prevPts = ranking[i].totalPoints; }
        ranking[i].rank = rank;
        ranking[i].amount = Number((ranking[i].totalPoints * 0.5).toFixed(2));
      }

      const myEntry = ranking.find(x => x.username === username.toLowerCase());
      return res.json({ month, ranking, myRank: myEntry?.rank || null, myPoints: myEntry?.totalPoints || 0, total: ranking.length });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/points/rules', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQ = String(req.query?.store || '').trim();
    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const store = storeQ || myStore;
      let items = (Array.isArray(state0.pointRules) ? state0.pointRules : [])
        .filter(x => {
          if (!x || typeof x !== 'object') return false;
          const st = String(x?.store || '').trim();
          // 空 store = 全部门店通用（否则仅匹配门店的规则会「消失」）
          return !store || !st || st === store;
        })
        .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
      items = dedupePointRulesApiItems(items);
      return res.json({ store: store || '', items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/points/rules', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!(role === 'admin' || role === 'hr_manager')) return res.status(403).json({ error: 'forbidden' });

    const store = String(req.body?.store || '').trim();
    const itemName = String(req.body?.itemName || '').trim();
    const points = safeNumber(req.body?.points);
    const enabled = req.body?.enabled !== false;
    if (!store) return res.status(400).json({ error: 'missing_store' });
    if (!itemName) return res.status(400).json({ error: 'missing_item_name' });
    if (points == null || points <= 0) return res.status(400).json({ error: 'invalid_points' });

    try {
      const state0 = (await getSharedState()) || {};
      const list = Array.isArray(state0.pointRules) ? state0.pointRules.slice() : [];
      if (isTripleSocialMediaPointRuleItem({ itemName })) {
        const dup = list.some((r) => isTripleSocialMediaPointRuleItem(r));
        if (dup) {
          return res.status(400).json({
            error: 'duplicate_triple_social_rule',
            message: '「抖音/小红书/大众点评」宣传积分为系统统一事项，列表中已存在时请勿重复新增；请编辑唯一一条。'
          });
        }
      }
      const item = {
        id: randomUUID(),
        store,
        itemName,
        points,
        enabled,
        updatedBy: username,
        updatedAt: hrmsNowISO()
      };
      list.unshift(item);
      await saveSharedState({ ...state0, pointRules: list });
      return res.json({ ok: true, item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/points/rules/:id', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const id = String(req.params?.id || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!(role === 'admin' || role === 'hr_manager')) return res.status(403).json({ error: 'forbidden' });
    if (!id) return res.status(400).json({ error: 'missing_id' });

    const nextStore = req.body?.store == null ? null : String(req.body?.store || '').trim();
    const nextItemName = req.body?.itemName == null ? null : String(req.body?.itemName || '').trim();
    const nextPoints = req.body?.points == null ? null : safeNumber(req.body?.points);
    const nextEnabled = req.body?.enabled;

    try {
      const state0 = (await getSharedState()) || {};
      const list = Array.isArray(state0.pointRules) ? state0.pointRules.slice() : [];
      const idx = list.findIndex(x => String(x?.id || '').trim() === id);
      if (idx < 0) return res.status(404).json({ error: 'not_found' });
      const merged = {
        ...list[idx],
        ...(nextStore != null ? { store: nextStore } : {}),
        ...(nextItemName != null ? { itemName: nextItemName } : {}),
        ...(nextPoints != null ? { points: nextPoints } : {}),
        ...(typeof nextEnabled === 'boolean' ? { enabled: nextEnabled } : {}),
        updatedBy: username,
        updatedAt: hrmsNowISO()
      };
      // store 可为空：与 GET /api/points/rules 一致，表示全部门店通用（如系统统一「抖音/小红书/大众点评」事项）
      if (!String(merged?.itemName || '').trim()) return res.status(400).json({ error: 'missing_item_name' });
      if (safeNumber(merged?.points) == null || safeNumber(merged?.points) <= 0) return res.status(400).json({ error: 'invalid_points' });
      if (isTripleSocialMediaPointRuleItem(merged)) {
        const dupOther = list.findIndex((x, i) => i !== idx && isTripleSocialMediaPointRuleItem(x));
        if (dupOther >= 0) {
          return res.status(400).json({
            error: 'duplicate_triple_social_rule',
            message: '已存在「抖音/小红书/大众点评」宣传积分事项，请勿将多条规则改为同名。'
          });
        }
      }
      list[idx] = merged;
      await saveSharedState({ ...state0, pointRules: list });
      return res.json({ ok: true, item: merged });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/points/my', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    try {
      const state0 = (await getSharedState()) || {};
      const list = Array.isArray(state0.pointRecords) ? state0.pointRecords : [];
      const mine = list.filter(x => String(x?.username || '').trim().toLowerCase() === username.toLowerCase());
      const month = hrmsNowISO().slice(0, 7);
      const monthPoints = mine
        .filter(x => String(x?.approvedAt || x?.createdAt || '').slice(0, 7) === month)
        .reduce((s, x) => s + (safeNumber(x?.points) || 0), 0);
      const monthAmount = Number((monthPoints * 0.5).toFixed(2));
      return res.json({ month, monthPoints, monthAmount, items: mine });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
