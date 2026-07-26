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

export function registerPointsMyRoutes(app, deps) {
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
