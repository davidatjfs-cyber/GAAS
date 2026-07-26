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

export function registerPointsRulesRoutes(app, deps) {
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
}
