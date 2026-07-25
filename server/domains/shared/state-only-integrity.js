/**
 * payment-config / stores / remaining-state：尚无独立表 SoT，权威仍在 hrms_state。
 * 无法做「表 ↔ 镜像」对账；改为日检 state 关键字段形状（类型 + 可规范化）。
 */

import {
  loadPaymentConfigFromState,
  normalizePaymentBudgets,
  normalizePaymentSettings,
} from '../payment-config/service.js';
import { normalizeUserRecord } from '../remaining-state/service.js';

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @returns {Promise<object|null>}
 */
async function loadHrmsStateData(pool, tenantId) {
  // hrms_state 主键是 key（租户 id / 特殊配置键），没有 tenant_id 列
  const r = await pool.query(
    `SELECT data FROM hrms_state WHERE key = $1 LIMIT 1`,
    [tenantId]
  );
  const data = r.rows[0]?.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

/**
 * @param {object|null} state
 */
export function checkPaymentConfigIntegrity(state) {
  const issues = [];
  if (state == null) {
    return { ok: true, domain: 'payment-config', issues: [], note: 'no_hrms_state_row' };
  }
  if (state.paymentSettings != null && typeof state.paymentSettings !== 'object') {
    issues.push({ field: 'paymentSettings', reason: 'not_object' });
  } else if (state.paymentSettings != null) {
    try {
      normalizePaymentSettings(state.paymentSettings);
    } catch (e) {
      issues.push({ field: 'paymentSettings', reason: 'normalize_failed', detail: String(e?.message || e) });
    }
  }
  if (state.paymentBudgets != null && !Array.isArray(state.paymentBudgets)) {
    issues.push({ field: 'paymentBudgets', reason: 'not_array' });
  } else if (state.paymentBudgets != null) {
    try {
      normalizePaymentBudgets(state.paymentBudgets);
      loadPaymentConfigFromState(state);
    } catch (e) {
      issues.push({ field: 'paymentBudgets', reason: 'normalize_failed', detail: String(e?.message || e) });
    }
  }
  return { ok: issues.length === 0, domain: 'payment-config', issues };
}

/**
 * @param {object|null} state
 */
export function checkStoresIntegrity(state) {
  const issues = [];
  if (state == null) {
    return { ok: true, domain: 'stores', issues: [], note: 'no_hrms_state_row' };
  }
  if (state.stores != null && !Array.isArray(state.stores)) {
    issues.push({ field: 'stores', reason: 'not_array' });
  } else if (Array.isArray(state.stores)) {
    for (let i = 0; i < state.stores.length; i++) {
      const s = state.stores[i];
      if (!s || typeof s !== 'object') {
        issues.push({ field: 'stores', reason: 'item_not_object', index: i });
        break;
      }
      if (!String(s.id || s.name || '').trim()) {
        issues.push({ field: 'stores', reason: 'item_missing_id_or_name', index: i });
        break;
      }
    }
  }
  return { ok: issues.length === 0, domain: 'stores', issues };
}

/**
 * @param {object|null} state
 */
export function checkRemainingStateIntegrity(state) {
  const issues = [];
  if (state == null) {
    return { ok: true, domain: 'remaining-state', issues: [], note: 'no_hrms_state_row' };
  }
  const arrayFields = [
    'announcements',
    'examAssignments',
    'trainingMaterials',
    'users',
    'questionBank',
    'questionSets',
  ];
  for (const field of arrayFields) {
    if (state[field] != null && !Array.isArray(state[field])) {
      issues.push({ field, reason: 'not_array' });
    }
  }
  if (Array.isArray(state.users)) {
    for (let i = 0; i < state.users.length; i++) {
      const u = state.users[i];
      if (u == null) continue;
      const normalized = normalizeUserRecord(u);
      if (!normalized) {
        issues.push({ field: 'users', reason: 'invalid_user_record', index: i });
        break;
      }
    }
  }
  return { ok: issues.length === 0, domain: 'remaining-state', issues };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 */
export async function checkStateOnlyDomainsIntegrity(pool, tenantId) {
  const state = await loadHrmsStateData(pool, tenantId);
  const payment = checkPaymentConfigIntegrity(state);
  const stores = checkStoresIntegrity(state);
  const remaining = checkRemainingStateIntegrity(state);
  const domains = [payment, stores, remaining];
  return {
    tenantId,
    ok: domains.every((d) => d.ok),
    domains,
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {(p: import('pg').Pool) => Promise<string[]>} getActiveTenantIds
 */
export async function checkStateOnlyDomainsIntegrityAllTenants(pool, getActiveTenantIds) {
  const tenantIds = await getActiveTenantIds(pool);
  const reports = [];
  for (const tenantId of tenantIds) {
    reports.push(await checkStateOnlyDomainsIntegrity(pool, tenantId));
  }
  return reports;
}

/** 审计用：这些域故意不做表↔镜像对账（无表 SoT）。 */
export const STATE_ONLY_MIRROR_DOMAINS = Object.freeze([
  'payment-config',
  'stores',
  'remaining-state',
]);
