/**
 * Master task assignee resolution — pure helpers (testable without DB).
 */
import { normalizeStoreKey } from '../shared/time-number.js';

export function normalizeTaskSourceData(sourceData) {
  if (!sourceData) return {};
  if (typeof sourceData === 'string') {
    try {
      return JSON.parse(sourceData);
    } catch (_e) {
      return {};
    }
  }
  return sourceData;
}

/** 数据审计 → master_tasks：厨房/出品类只派出品经理；服务/前厅类只派店长 */
export const MASTER_TASK_PM_EXCLUSIVE_CATEGORIES = new Set([
  '桌访产品异常',
  '产品差评异常',
  '总实收毛利率异常',
]);
export const MASTER_TASK_SM_EXCLUSIVE_CATEGORIES = new Set([
  '服务差评异常',
  '桌访占比异常',
  '充值异常',
  '实收营收异常',
  '洪潮久光包房使用异常',
]);

function collectPeople(state) {
  return [
    ...(Array.isArray(state?.employees) ? state.employees : []),
    ...(Array.isArray(state?.users) ? state.users : []),
  ];
}

function toAssigneeRecord(user, store) {
  return {
    username: String(user.username || '').trim(),
    name: String(user.name || '').trim(),
    role: String(user.role || '').trim(),
    store,
  };
}

/**
 * Resolve assignee from HRMS state + category role map (no I/O).
 * Returns { assignee, warnings } where assignee is null if none found.
 */
export function pickAssigneeForCategory({
  category,
  store,
  existingAssignee,
  sourceData,
  state,
  roleMap,
}) {
  const warnings = [];
  const normalizedStore = normalizeStoreKey(store);
  const sd = normalizeTaskSourceData(sourceData);
  const all = collectPeople(state);

  if (existingAssignee) {
    const user = all.find(
      (u) => String(u?.username || '').trim() === String(existingAssignee).trim()
    );
    if (user && normalizeStoreKey(user.store) === normalizedStore) {
      return { assignee: toAssigneeRecord(user, store), warnings };
    }
    if (user) {
      warnings.push(
        `cross_store:${existingAssignee}:${user.store}:${store}`
      );
    } else {
      warnings.push(`missing_user:${existingAssignee}`);
    }
  }

  let targetRole = roleMap[category] || 'store_manager';
  const auditeeRole = String(sd?._auditee_role || '').trim();
  if (
    category === '人效值异常' &&
    ['store_manager', 'store_production_manager'].includes(auditeeRole)
  ) {
    targetRole = auditeeRole;
  }

  const storeMembers = all.filter(
    (u) => normalizeStoreKey(u?.store) === normalizedStore
  );
  let assignee = storeMembers.find(
    (u) => String(u?.role || '').trim() === targetRole
  );

  const cat = String(category || '').trim();
  const pmExclusive = MASTER_TASK_PM_EXCLUSIVE_CATEGORIES.has(cat);
  const smExclusive = MASTER_TASK_SM_EXCLUSIVE_CATEGORIES.has(cat);
  const allowCrossRoleFallback = !pmExclusive && !smExclusive;

  if (
    !assignee &&
    targetRole === 'store_production_manager' &&
    allowCrossRoleFallback
  ) {
    assignee = storeMembers.find(
      (u) => String(u?.role || '').trim() === 'store_manager'
    );
  }
  if (!assignee && targetRole === 'store_manager' && allowCrossRoleFallback) {
    assignee = storeMembers.find(
      (u) => String(u?.role || '').trim() === 'store_production_manager'
    );
  }
  if (!assignee && allowCrossRoleFallback) {
    assignee = storeMembers.find((u) =>
      ['store_manager', 'store_production_manager'].includes(
        String(u?.role || '').trim()
      )
    );
  }

  if (!assignee) {
    return { assignee: null, warnings: [...warnings, `no_match:${store}:${targetRole}`] };
  }

  return { assignee: toAssigneeRecord(assignee, store), warnings };
}
