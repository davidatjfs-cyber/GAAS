/**
 * 增长 A/B 测试、经验库、定价测试 — 业务逻辑外观（拆分到本目录下各 sibling 模块）。
 */
export {
  createLearning,
  listLearnings,
  seedLearnings,
} from './learning-service.js';

export { AB_TEMPLATES, getAbTemplate } from './ab-templates.js';
export { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';

export {
  abMetricValue,
  evalAbMetric,
  formatPercent,
  interpolateAbContent,
  isAbManualInput,
  listAbTemplates,
  sanitizeFields,
  sanitizeMetricDef,
  stableVariant,
} from './ab-metrics.js';

export {
  listAbAudienceForSendDate,
  queueAbSmsAssignments,
} from './ab-audience-service.js';

export {
  computeAbTestOutcome,
  refreshAbTestResults,
} from './ab-outcome-service.js';

export {
  evaluateAbTask,
  maybeWriteAbLearning,
  promoteAbWinner,
} from './ab-evaluation-service.js';

export {
  createAbTest,
  listAbTests,
  loadAbBoundRule,
  promoteAbTest,
  refreshAbTest,
  submitAbTestResults,
} from './ab-tests-service.js';

export {
  createPriceTest,
  listPriceTests,
} from './ab-price-tests-service.js';
