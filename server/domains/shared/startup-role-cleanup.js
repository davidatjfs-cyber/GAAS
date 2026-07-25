/**
 * Listen-time role normalization for default tenant (Wave M3 peel from index.js).
 * 含马己仙/洪潮历史姓名映射，不得扩散到商业租户。
 */
import { childLogger } from '../../utils/logger.js';
import { cleanupLegacyTestState } from './legacy-test-cleanup.js';

const log = childLogger({ domain: 'shared', handler: 'startup-role-cleanup' });

export const ALLOWED_STARTUP_ROLES = [
  'admin',
  'hq_manager',
  'store_manager',
  'store_employee',
  'cashier',
  'hr_manager',
  'store_production_manager',
  'front_manager',
];

export const STARTUP_ROLE_MAP = {
  hq_employee: 'hr_manager',
  总部人员: 'hr_manager',
  总部人事: 'hr_manager',
  人事经理: 'hr_manager',
  总部HR: 'hr_manager',
  总部营运: 'hq_manager',
  总部经理: 'hq_manager',
  总部管理层: 'hq_manager',
  总部管理: 'hq_manager',
  出纳: 'cashier',
  custom_出纳: 'cashier',
  总部出纳: 'cashier',
  门店店长: 'store_manager',
  店长: 'store_manager',
  门店出品经理: 'store_production_manager',
  出品经理: 'store_production_manager',
  门店员工: 'store_employee',
  员工: 'store_employee',
  管理员: 'admin',
  系统管理员: 'admin',
  前厅经理: 'front_manager',
  门店前厅经理: 'front_manager',
};

/** default 租户历史姓名 → 内置角色（不得用于商业租户） */
export const STARTUP_USER_ROLE_OVERRIDES = {
  徐彬: 'hq_manager',
  李艳玲: 'cashier',
  高赟: 'hr_manager',
  喻峰: 'store_manager',
  黎永荣: 'store_production_manager',
  李丽丽: 'store_employee',
  田海伶: 'front_manager',
  武静静: 'front_manager',
};

/**
 * @param {string} tok
 * @param {{ roleMap?: Record<string,string>, allowedRoles?: string[] }} [opts]
 */
export function normalizeApprovalFlowToken(tok, opts = {}) {
  const ROLE_MAP = opts.roleMap || STARTUP_ROLE_MAP;
  const ALLOWED_ROLES = opts.allowedRoles || ALLOWED_STARTUP_ROLES;
  const t = String(tok || '').trim();
  if (!t) return '';
  if (t === 'manager') return 'manager';
  if (t.startsWith('username:')) return t;
  if (t.startsWith('role:')) {
    const rid0 = t.slice('role:'.length).trim();
    const rid = ROLE_MAP[rid0] || rid0;
    if (rid === 'store_employee') return 'role:store_employee';
    if (ALLOWED_ROLES.includes(rid)) return 'role:' + rid;
    return 'role:store_employee';
  }
  const mapped = ROLE_MAP[t] || t;
  if (ALLOWED_ROLES.includes(mapped)) return mapped;
  if (mapped === 'hr_manager') return 'hr_manager';
  if (mapped === 'hq_manager') return 'hq_manager';
  if (mapped === 'cashier') return 'cashier';
  if (mapped === 'store_manager') return 'store_manager';
  if (mapped === 'store_production_manager') return 'store_production_manager';
  if (mapped === 'store_employee') return 'store_employee';
  return 'store_employee';
}

/**
 * Mutates a shallow-cloned state shape; returns whether anything changed + log lines.
 * @param {object} state0
 */
export function applyStartupRoleCleanup(state0) {
  const state = state0 && typeof state0 === 'object' ? { ...state0 } : {};
  let changed = false;
  const messages = [];

  const cleanup = cleanupLegacyTestState(state);
  if (cleanup.changed) {
    Object.assign(state, cleanup.state);
    changed = true;
    messages.push('[migration] Removed legacy built-in test accounts/data');
  }

  const ALLOWED_ROLES = ALLOWED_STARTUP_ROLES;
  const ROLE_MAP = STARTUP_ROLE_MAP;
  const USER_ROLE_OVERRIDES = STARTUP_USER_ROLE_OVERRIDES;

  // Clone list arrays we mutate so callers can keep original if needed
  if (Array.isArray(state.users)) state.users = state.users.map((u) => ({ ...u }));
  if (Array.isArray(state.employees)) state.employees = state.employees.map((u) => ({ ...u }));

  for (const list of [state.users, state.employees]) {
    if (!Array.isArray(list)) continue;
    for (const u of list) {
      const name = String(u?.name || '').trim();
      const oldRole = String(u?.role || '').trim();
      if (USER_ROLE_OVERRIDES[name]) {
        if (oldRole !== USER_ROLE_OVERRIDES[name]) {
          messages.push(`[migration] ${name}: ${oldRole} -> ${USER_ROLE_OVERRIDES[name]}`);
          u.role = USER_ROLE_OVERRIDES[name];
          changed = true;
        }
        continue;
      }
      if (ROLE_MAP[oldRole]) {
        messages.push(`[migration] ${name}: ${oldRole} -> ${ROLE_MAP[oldRole]}`);
        u.role = ROLE_MAP[oldRole];
        changed = true;
        continue;
      }
      if (oldRole && !ALLOWED_ROLES.includes(oldRole)) {
        messages.push(`[migration] ${name}: ${oldRole} -> store_employee (unknown role)`);
        u.role = 'store_employee';
        changed = true;
      }
    }
  }

  if (state.approvalFlows && typeof state.approvalFlows === 'object') {
    const flows = { ...state.approvalFlows };
    for (const k of Object.keys(flows)) {
      const cfg = flows[k];
      if (!cfg || typeof cfg !== 'object') continue;
      const steps = Array.isArray(cfg.steps) ? cfg.steps : [];
      if (!steps.length) continue;
      const nextSteps = steps.map((s) => normalizeApprovalFlowToken(s)).filter(Boolean);
      const same =
        nextSteps.length === steps.length && nextSteps.every((v, i) => String(v) === String(steps[i]));
      if (!same) {
        flows[k] = { ...cfg, steps: nextSteps };
        changed = true;
        messages.push(`[migration] Normalized approvalFlows.${k}.steps`);
      }
    }
    state.approvalFlows = flows;
  }

  if (state.orgDict && Array.isArray(state.orgDict.roles)) {
    const before = state.orgDict.roles.length;
    state.orgDict = { ...state.orgDict, roles: [] };
    if (before > 0) {
      changed = true;
      messages.push(`[migration] Cleared ${before} custom roles from orgDict`);
    }
  }

  return { state, changed, messages };
}

/**
 * @param {{
 *   getSharedState: Function,
 *   saveSharedState: Function,
 *   runWithBootstrapTenantContext: Function,
 * }} deps
 */
export async function runStartupRoleCleanup(deps) {
  const { getSharedState, saveSharedState, runWithBootstrapTenantContext } = deps;
  try {
    await runWithBootstrapTenantContext(async () => {
      const state0 = (await getSharedState()) || {};
      const { state, changed, messages } = applyStartupRoleCleanup(state0);
      for (const m of messages) log.info({ msg: 'role_cleanup', detail: m });
      if (!changed) return;
      const freshState = (await getSharedState()) || {};
      if (state.users) freshState.users = state.users;
      if (state.employees) freshState.employees = state.employees;
      if (state.approvalFlows) freshState.approvalFlows = state.approvalFlows;
      if (state.orgDict) freshState.orgDict = state.orgDict;
      if (state.pointRecords) freshState.pointRecords = state.pointRecords;
      if (state.salaryAdjustments) freshState.salaryAdjustments = state.salaryAdjustments;
      if (state.payrollAdjustments) freshState.payrollAdjustments = state.payrollAdjustments;
      await saveSharedState(freshState);
      log.info({ msg: 'role_cleanup', detail: '[migration] Role cleanup complete' });
    });
  } catch (e) {
    log.error({
      msg: 'role_cleanup_failed',
      detail: ['[migration] role cleanup failed:', e?.message || e]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
  }
}
