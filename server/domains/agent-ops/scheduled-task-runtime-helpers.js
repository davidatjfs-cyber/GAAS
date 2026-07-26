/**
 * Pure helpers for ops scheduled-task filters / inspection interval (P2 peel from agents.js).
 */

/** 全角数字 → 半角，避免「１１２２３３」绕过测试过滤 */
export function normalizeDigitsForOpsFilter(input) {
  return String(input || '').replace(/[\uFF10-\uFF19]/g, (ch) => String(ch.charCodeAt(0) - 0xff10));
}

/**
 * 测试/遗留 V1 巡检项：不注册定时器、不下发飞书（与 agents-service-v2 deterministic-replies 口径对齐）
 */
export function isBlockedOpsChecklistPattern(checkType, taskKey = '') {
  const blob = normalizeDigitsForOpsFilter(`${checkType || ''}\n${taskKey || ''}`);
  const t = String(checkType || '').trim();
  if (/112233/i.test(blob)) return true;
  if (/测试\s*112233|112233\s*检查/i.test(blob)) return true;
  if (/测试/.test(t) && /检查/.test(t) && /112233/i.test(blob)) return true;
  if (/agent[\s_-]*v1/i.test(blob)) return true;
  if (/^test$/i.test(t) || /^测试$/i.test(t)) return true;
  return false;
}

export function getInspectionIntervalDays(config) {
  const frequency = String(config?.frequency || 'daily').trim();
  if (frequency === 'weekly') return 7;
  if (frequency === 'biweekly') return 14;
  if (frequency === 'monthly') return 30;
  if (frequency === 'custom') return Math.max(1, Math.floor(Number(config?.customIntervalDays) || 1));
  return 1;
}

/** @returns {boolean} true = skip send */
export function shouldSkipHrmsScheduledChecklistBody(config, { env = process.env, log, isBlocked = isBlockedOpsChecklistPattern } = {}) {
  const legacyEnable = String(env.HRMS_ENABLE_LEGACY_SCHEDULED_CHECKLIST || '').trim().toLowerCase();
  if (!(legacyEnable === '1' || legacyEnable === 'true' || legacyEnable === 'yes')) {
    return true;
  }
  const dis = String(env.HRMS_DISABLE_SCHEDULED_CHECKLIST || '').trim().toLowerCase();
  if (dis === '1' || dis === 'true' || dis === 'yes') {
    log?.info?.('[ops] sendScheduledChecklist skipped (HRMS_DISABLE_SCHEDULED_CHECKLIST)');
    return true;
  }
  if (isBlocked(config?.checkType, config?.taskKey)) {
    log?.info?.('[ops] sendScheduledChecklist skipped (test/legacy pattern):', config?.checkType, config?.taskKey || '');
    return true;
  }
  return false;
}
