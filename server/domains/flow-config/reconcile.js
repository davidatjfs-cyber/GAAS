/**
 * flow-config 表（hr_rating_configs）vs hrms_state 镜像对账。
 */
import { SHARED_TABLES } from '@gaas/shared';
import {
  FLOW_CONFIG_KEYS,
  loadConfigByKey,
  normalizeApprovalFlows,
  normalizePaymentFlowByStore,
  normalizeRoleModules,
} from './service.js';

const FIELD_SPECS = Object.freeze([
  { field: 'roleModules', configKey: FLOW_CONFIG_KEYS.roleModules, normalize: normalizeRoleModules },
  { field: 'approvalFlows', configKey: FLOW_CONFIG_KEYS.approvalFlows, normalize: normalizeApprovalFlows },
  {
    field: 'paymentFlowByStore',
    configKey: FLOW_CONFIG_KEYS.paymentFlowByStore,
    normalize: normalizePaymentFlowByStore,
  },
]);

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalize(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * 对已 normalize 的配置做稳定 hash（递归排序 key 后 JSON.stringify）。
 * @param {unknown} value
 */
export function stableConfigHash(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * @param {Record<string, unknown>|null|undefined} norm
 */
function isEmptyNormalized(norm) {
  return !norm || typeof norm !== 'object' || Object.keys(norm).length === 0;
}

/**
 * @param {Record<string, unknown>|null|undefined} tableNorm
 * @param {Record<string, unknown>|null|undefined} mirrorNorm
 */
function reconcileOneField(tableNorm, mirrorNorm) {
  const tablePresent = !isEmptyNormalized(tableNorm);
  const mirrorPresent = !isEmptyNormalized(mirrorNorm);

  if (!tablePresent && !mirrorPresent) {
    return { ok: true, tablePresent: false, mirrorPresent: false };
  }
  if (tablePresent && !mirrorPresent) {
    return { ok: false, tablePresent: true, mirrorPresent: false, reason: 'only_table' };
  }
  if (!tablePresent && mirrorPresent) {
    return { ok: false, tablePresent: false, mirrorPresent: true, reason: 'only_mirror' };
  }

  const tableHash = stableConfigHash(tableNorm);
  const mirrorHash = stableConfigHash(mirrorNorm);
  if (tableHash !== mirrorHash) {
    return {
      ok: false,
      tablePresent: true,
      mirrorPresent: true,
      reason: 'content_hash_mismatch',
    };
  }
  return { ok: true, tablePresent: true, mirrorPresent: true };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 */
export async function reconcileFlowConfigMirror(pool, tenantId) {
  const tid = String(tenantId || 'default');

  const stateR = await pool.query(
    `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`,
    [tid]
  );
  const stateData = stateR.rows?.[0]?.data;
  const mirrorRoot = stateData && typeof stateData === 'object' && !Array.isArray(stateData) ? stateData : {};

  /** @type {Record<string, { ok: boolean, tablePresent: boolean, mirrorPresent: boolean, reason?: string }>} */
  const fields = {};
  /** @type {{ field: string, reason: string }[]} */
  const drifts = [];

  for (const spec of FIELD_SPECS) {
    const tableRaw = await loadConfigByKey(pool, tid, spec.configKey);
    const tableNorm = spec.normalize(tableRaw);
    const mirrorNorm = spec.normalize(mirrorRoot[spec.field]);

    const result = reconcileOneField(tableNorm, mirrorNorm);
    fields[spec.field] = {
      ok: result.ok,
      tablePresent: result.tablePresent,
      mirrorPresent: result.mirrorPresent,
      ...(result.reason ? { reason: result.reason } : {}),
    };
    if (!result.ok && result.reason) {
      drifts.push({ field: spec.field, reason: result.reason });
    }
  }

  return {
    tenantId: tid,
    ok: drifts.length === 0,
    fields,
    drifts,
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {(p: import('pg').Pool) => Promise<string[]>} getActiveTenantIds
 */
export async function reconcileFlowConfigMirrorAllTenants(pool, getActiveTenantIds) {
  const tenantIds = await getActiveTenantIds(pool);
  const reports = [];
  for (const tid of tenantIds) {
    reports.push(await reconcileFlowConfigMirror(pool, tid));
  }
  return reports;
}
