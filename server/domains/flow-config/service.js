/**
 * 流程/权限配置域：hr_rating_configs 为权威，hrms_state 仅为镜像。
 *
 * - roleModules         → config_key = role_module_config
 * - approvalFlows       → config_key = approval_flows
 * - paymentFlowByStore  → config_key = payment_flow_by_store
 */

import { HR_RATING_CONFIG_KEYS, SHARED_TABLES } from '@gaas/shared';

export const FLOW_CONFIG_KEYS = Object.freeze({
  roleModules: HR_RATING_CONFIG_KEYS.ROLE_MODULES,
  approvalFlows: HR_RATING_CONFIG_KEYS.APPROVAL_FLOWS,
  paymentFlowByStore: HR_RATING_CONFIG_KEYS.PAYMENT_FLOW_BY_STORE,
});

export function normalizeApprovalFlows(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [type, cfg] of Object.entries(raw)) {
    const t = String(type || '').trim();
    if (!t) continue;
    if (Array.isArray(cfg)) {
      out[t] = { steps: cfg.map((x) => String(x || '').trim()).filter(Boolean) };
      continue;
    }
    if (cfg && typeof cfg === 'object') {
      const steps = Array.isArray(cfg.steps) ? cfg.steps.map((x) => String(x || '').trim()).filter(Boolean) : [];
      const stores = Array.isArray(cfg.stores) ? cfg.stores.map((x) => String(x || '').trim()).filter(Boolean) : undefined;
      out[t] = stores && stores.length ? { steps, stores } : { steps };
    }
  }
  return out;
}

export function normalizePaymentFlowByStore(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [store, cfg] of Object.entries(raw)) {
    const name = String(store || '').trim();
    if (!name) continue;
    if (Array.isArray(cfg)) {
      out[name] = { approvers: cfg.map((x) => String(x || '').trim()).filter(Boolean) };
      continue;
    }
    if (cfg && typeof cfg === 'object') {
      const approvers = Array.isArray(cfg.approvers)
        ? cfg.approvers.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      const cashier = cfg.cashier != null ? String(cfg.cashier || '').trim() : '';
      out[name] = cashier ? { approvers, cashier } : { approvers };
    }
  }
  return out;
}

export function normalizeRoleModules(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [role, pages] of Object.entries(raw)) {
    const r = String(role || '').trim();
    if (!r || !Array.isArray(pages)) continue;
    const list = pages.map((p) => String(p || '').trim()).filter(Boolean);
    if (!list.includes('training')) list.push('training');
    out[r] = list;
  }
  return out;
}

export async function loadConfigByKey(pool, tenantId, configKey) {
  const tid = String(tenantId || 'default');
  const key = String(configKey || '').trim();
  if (!key) return null;
  const r = await pool.query(
    `SELECT config FROM ${SHARED_TABLES.HR_RATING_CONFIGS}
      WHERE config_key = $1 AND tenant_id = $2 AND enabled = true
      LIMIT 1`,
    [key, tid]
  );
  const cfg = r.rows?.[0]?.config;
  if (cfg && typeof cfg === 'object') return cfg;
  if (typeof cfg === 'string') {
    try {
      const parsed = JSON.parse(cfg);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function upsertConfigByKey(pool, tenantId, configKey, value) {
  const tid = String(tenantId || 'default');
  const key = String(configKey || '').trim();
  if (!key) throw new Error('missing_config_key');
  const payload = value && typeof value === 'object' ? value : {};
  await pool.query(
    `INSERT INTO ${SHARED_TABLES.HR_RATING_CONFIGS} (config_key, config, enabled, updated_at, tenant_id)
     VALUES ($1, $2::jsonb, true, NOW(), $3)
     ON CONFLICT (config_key, tenant_id)
     DO UPDATE SET config = EXCLUDED.config, enabled = true, updated_at = NOW()`,
    [key, JSON.stringify(payload), tid]
  );
  return payload;
}

export async function loadFlowConfigBundle(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const [roleModulesRaw, approvalFlowsRaw, paymentFlowRaw] = await Promise.all([
    loadConfigByKey(pool, tid, FLOW_CONFIG_KEYS.roleModules),
    loadConfigByKey(pool, tid, FLOW_CONFIG_KEYS.approvalFlows),
    loadConfigByKey(pool, tid, FLOW_CONFIG_KEYS.paymentFlowByStore),
  ]);
  return {
    roleModules: roleModulesRaw ? normalizeRoleModules(roleModulesRaw) : null,
    approvalFlows: approvalFlowsRaw ? normalizeApprovalFlows(approvalFlowsRaw) : null,
    paymentFlowByStore: paymentFlowRaw ? normalizePaymentFlowByStore(paymentFlowRaw) : null,
  };
}

/**
 * 表有数据时覆盖 state 镜像；表空保留 state（兼容迁移中）。
 */
export async function hydrateFlowConfigFromTable(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  try {
    const bundle = await loadFlowConfigBundle(pool, tenantId);
    if (bundle.roleModules && Object.keys(bundle.roleModules).length) {
      base.roleModules = bundle.roleModules;
    }
    if (bundle.approvalFlows && Object.keys(bundle.approvalFlows).length) {
      base.approvalFlows = bundle.approvalFlows;
    }
    if (bundle.paymentFlowByStore && Object.keys(bundle.paymentFlowByStore).length) {
      base.paymentFlowByStore = bundle.paymentFlowByStore;
    }
  } catch (e) {
    console.error('[flow-config] hydrate failed:', e?.message || e);
  }
  return base;
}

export async function saveRoleModules(pool, tenantId, config) {
  const normalized = normalizeRoleModules(config);
  await upsertConfigByKey(pool, tenantId, FLOW_CONFIG_KEYS.roleModules, normalized);
  return normalized;
}

export async function saveApprovalFlows(pool, tenantId, flows) {
  const normalized = normalizeApprovalFlows(flows);
  await upsertConfigByKey(pool, tenantId, FLOW_CONFIG_KEYS.approvalFlows, normalized);
  return normalized;
}

export async function savePaymentFlowByStore(pool, tenantId, map) {
  const normalized = normalizePaymentFlowByStore(map);
  await upsertConfigByKey(pool, tenantId, FLOW_CONFIG_KEYS.paymentFlowByStore, normalized);
  return normalized;
}
