/**
 * Points HTTP routes (behavior-preserving extract from index.js).
 * registerPointsRoutes(app, deps)
 */
import {
  bindPointsRuntimeDeps,
} from './helpers.js';

export {
  canApplyPointsByRole,
  dedupeGlobalSocialMediaPointRules,
  ensureGlobalSocialMediaPointRule,
} from './helpers.js';

import { registerPointsRecordsRoutes } from './routes-records.js';
import { registerPointsRankingRoutes } from './routes-ranking.js';
import { registerPointsRulesRoutes } from './routes-rules.js';
import { registerPointsMyRoutes } from './routes-my.js';

export function registerPointsRoutes(app, deps) {
  const {
    getSharedState,
    saveSharedState,
    mergeSharedStateFields,
    hrmsNowISO,
  } = deps;

  bindPointsRuntimeDeps({
    getSharedState,
    saveSharedState,
    mergeSharedStateFields,
    hrmsNowISO,
  });

  registerPointsRecordsRoutes(app, deps);
  registerPointsRankingRoutes(app, deps);
  registerPointsRulesRoutes(app, deps);
  registerPointsMyRoutes(app, deps);
}
