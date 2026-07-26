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

export function registerPointsRankingRoutes(app, deps) {
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
}
