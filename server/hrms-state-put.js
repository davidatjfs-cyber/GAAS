/**
 * PUT /api/state 白名单写入。
 *
 * 历史事故根因：前端 localStorage 整份 PUT 覆盖 hrms_state（last-write-wins），
 * 抹掉服务端刚写入的审批流/积分/薪酬等。黑名单保护块只会越加越长且永远漏字段。
 *
 * 策略：以服务端 existing 为底，仅 overlay 白名单字段。白名单外的键一律保留服务端值。
 * 字段落表后从 STATE_PUT_WHITELIST 删除；清空 = 坑填完。
 */

/** 仍允许经 PUT /api/state 写入的顶层字段（未落表 / 仍走前端 saveState 的业务数据） */
/** A3：白名单收敛为配置/内容类；已有独立 API 的业务事实一律 SERVER_OWNED */
export const STATE_PUT_WHITELIST = Object.freeze([
  'users',
  'roles',
  'settings',
  'examAssignments',
  'questionBank',
  'questionSets',
  'announcements',
  'trainingTasks',
  'trainingMaterials',
  'promotionTracks',
]);

/**
 * 服务端权威字段（禁止 PUT 覆盖）。有独立 API 或由 mergeSharedStateFields / 审批终审写入。
 * 2026-07 Week2-3：pointRecords → point_records 表；
 * payrollAdjustments / salaryAdjustments / monthlyConfirmations → hrms_payroll_domain。
 * 2026-07 A1：employees → employees 表。
 * 2026-07 A2：roleModules / approvalFlows / paymentFlowByStore → hr_rating_configs。
 * 2026-07 A3：pointRules / forecast* 移出白名单（已有窄 API）。
 * 2026-07 A3续：knowledge / examResults / notifications 表权威；
 *   exams / promotionRequests / promotionAbilityRequirements / rewardPunishments 死字段移出。
 * 2026-07 A3再续：stores 走窄 API（含 DELETE），禁止 PUT /api/state 覆盖。
 * 2026-07 A3再续2：brands / gmMailbox 走窄 API，禁止 PUT 覆盖。
 * 2026-07 A3再续3：paymentSettings / paymentBudgets 走 /api/payment-config。
 * GET /api/state 会用表覆盖这些镜像字段。运行时靠「不在白名单」生效。
 */
export const STATE_PUT_SERVER_OWNED = Object.freeze([
  'employees',
  'stores',
  'brands',
  'gmMailbox',
  'paymentSettings',
  'paymentBudgets',
  'roleModules',
  'approvalFlows',
  'paymentFlowByStore',
  'pointRules',
  'forecastCoreProducts',
  'forecastProductAliasRules',
  'forecastGrossProfitProfiles',
  'knowledge',
  'examResults',
  'notifications',
  'exams',
  'promotionRequests',
  'promotionAbilityRequirements',
  'rewardPunishments',
  'pointRecords',
  'pointsAppliedApprovals',
  'payrollAdjustments',
  'payrollAudits',
  'salaryAdjustments',
  'salaryChangeHistory',
  'leaveRecords',
  'leaveBalanceOverrides',
  'leaveBalanceAdjustments',
  'leaveCumulativeCloseSnapshots',
  'monthlyConfirmations',
  'dailyReports',
  'inventoryForecastHistory',
  'inventoryForecastEvaluations',
  'inventoryForecastPredictions',
  'monthlyRemindersSent',
  'birthdayGreetingsSent',
  'birthdayRemindersSent',
  'schemaVersion',
  'exportedAt',
]);

export function mergeEmployeesForStatePut(incomingEmployees, existingEmployees) {
  const norm = (u) => String(u || '').trim().toLowerCase();
  const inc = Array.isArray(incomingEmployees) ? incomingEmployees : [];
  const ex = Array.isArray(existingEmployees) ? existingEmployees : [];
  const exMap = new Map();
  for (const e of ex) {
    const k = norm(e?.username);
    if (k) exMap.set(k, e);
  }
  const seen = new Set();
  const out = [];
  for (const e of inc) {
    const k = norm(e?.username);
    if (!k) continue;
    seen.add(k);
    const base = exMap.get(k) || {};
    out.push({ ...base, ...e });
  }
  for (const e of ex) {
    const k = norm(e?.username);
    if (!k || seen.has(k)) continue;
    out.push(e);
  }
  return out;
}

function mergeStoresPreserveLocation(incomingStores, existingStores) {
  const existing = Array.isArray(existingStores) ? existingStores : [];
  const incoming = Array.isArray(incomingStores) ? incomingStores : [];
  if (!existing.length || !incoming.length) return incoming;
  const locMap = new Map();
  for (const s of existing) {
    const name = String(s?.name || '').trim();
    if (name && (Number.isFinite(s?.latitude) || Number.isFinite(s?.longitude) || s?.address)) {
      locMap.set(name, { latitude: s.latitude, longitude: s.longitude, address: s.address });
    }
  }
  if (!locMap.size) return incoming;
  return incoming.map((s) => {
    const name = String(s?.name || '').trim();
    const loc = locMap.get(name);
    if (!loc) return s;
    return {
      ...s,
      latitude: Number.isFinite(s?.latitude) ? s.latitude : loc.latitude,
      longitude: Number.isFinite(s?.longitude) ? s.longitude : loc.longitude,
      address: s.address || loc.address || '',
    };
  });
}

/**
 * @param {object|null|undefined} existingState 服务端当前 hrms_state.data
 * @param {object} incomingData 经 deepRepair 后的请求体 data
 * @returns {{ next: object, appliedKeys: string[], ignoredKeys: string[] }}
 */
export function applyStatePutWhitelist(existingState, incomingData) {
  const existing = existingState && typeof existingState === 'object' ? { ...existingState } : {};
  const incoming = incomingData && typeof incomingData === 'object' ? incomingData : {};
  const next = { ...existing };
  const appliedKeys = [];
  const ignoredKeys = [];

  for (const key of Object.keys(incoming)) {
    if (!STATE_PUT_WHITELIST.includes(key)) {
      ignoredKeys.push(key);
      continue;
    }
    if (key === 'stores') {
      next.stores = mergeStoresPreserveLocation(incoming.stores, existing.stores);
    } else {
      next[key] = incoming[key];
    }
    appliedKeys.push(key);
  }

  return { next, appliedKeys, ignoredKeys };
}
