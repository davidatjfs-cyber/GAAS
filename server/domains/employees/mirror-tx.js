/**
 * 员工表权威 + hrms_state.employees 镜像：同事务写入，避免表提交后镜像失败导致分叉。
 */
import { SHARED_TABLES } from '@gaas/shared';
import {
  mergeStateFieldsOnClient,
  patchHrmsStateFieldsOnClient,
  readHrmsStateForUpdate,
  withMirrorWriteTx,
} from '../shared/mirror-tx.js';
import { employeeRowToStateShape } from './service.js';

/** 保留存量 import 名 */
export const withEmployeesWriteTx = withMirrorWriteTx;

const RECONCILE_HASH_KEYS = ['username', 'status', 'role', 'store', 'name', 'department', 'position'];

/**
 * @param {object|null|undefined} emp
 */
function normalizeEmployeeForReconcileHash(emp) {
  if (!emp || typeof emp !== 'object') return {};
  const out = {};
  for (const k of RECONCILE_HASH_KEYS) {
    if (emp[k] != null && String(emp[k]).trim() !== '') {
      out[k] = String(emp[k]).trim().toLowerCase();
    }
  }
  return out;
}

/**
 * @param {object|null|undefined} emp
 */
function employeeContentHash(emp) {
  const norm = normalizeEmployeeForReconcileHash(emp);
  const sorted = {};
  for (const k of Object.keys(norm).sort()) {
    sorted[k] = norm[k];
  }
  return JSON.stringify(sorted);
}

/**
 * 在已开启的事务 client 上合并 employees 镜像（不做 BEGIN/COMMIT）。
 * @param {import('pg').PoolClient} client
 * @param {object[]} emps
 * @param {string} tenantId
 */
export async function mergeEmployeesMirrorOnClient(client, emps, tenantId) {
  const patchList = Array.isArray(emps) ? emps.filter((e) => e?.username) : [];
  if (!patchList.length) return;
  await mergeStateFieldsOnClient(client, tenantId, { employees: patchList }, { employees: 'username' });
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string[]} usernames
 * @param {string} tenantId
 */
export async function removeEmployeesMirrorOnClient(client, usernames, tenantId) {
  const removeSet = new Set(
    (Array.isArray(usernames) ? usernames : []).map((u) => String(u || '').trim().toLowerCase()).filter(Boolean)
  );
  if (!removeSet.size) return;

  const { current } = await readHrmsStateForUpdate(client, tenantId);
  const existing = Array.isArray(current.employees) ? current.employees : [];
  const nextEmployees = existing.filter((e) => !removeSet.has(String(e?.username || '').trim().toLowerCase()));
  await patchHrmsStateFieldsOnClient(client, tenantId, { employees: nextEmployees });
}

/**
 * 表 vs 镜像对账：username 集合 + 关键字段内容 hash。
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 */
export async function reconcileEmployeesMirror(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const tableR = await pool.query(
    `SELECT id, username, name, role, store, department, position, status, gender, phone, email,
            join_date, birthday, salary, password_hash, manager_username, id_card_number, bank_card,
            extra_json, created_at, updated_at
       FROM ${SHARED_TABLES.EMPLOYEES}
      WHERE tenant_id = $1 AND username IS NOT NULL AND trim(username) <> ''`,
    [tid]
  );
  const stateR = await pool.query(
    `SELECT data->'employees' AS emps FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`,
    [tid]
  );

  const tableByUser = new Map();
  for (const row of tableR.rows || []) {
    const shaped = employeeRowToStateShape(row);
    const u = String(shaped?.username || '').trim().toLowerCase();
    if (u) tableByUser.set(u, shaped);
  }

  const mirrorByUser = new Map();
  const emps = stateR.rows?.[0]?.emps;
  for (const e of Array.isArray(emps) ? emps : []) {
    const u = String(e?.username || '').trim().toLowerCase();
    if (u) mirrorByUser.set(u, e);
  }

  const tableSet = new Set(tableByUser.keys());
  const mirrorSet = new Set(mirrorByUser.keys());
  const onlyTable = [...tableSet].filter((u) => !mirrorSet.has(u)).sort();
  const onlyMirror = [...mirrorSet].filter((u) => !tableSet.has(u)).sort();

  /** @type {{ username: string, reason: string }[]} */
  const fieldDrift = [];
  for (const u of [...tableSet].filter((x) => mirrorSet.has(x)).sort()) {
    const tableHash = employeeContentHash(tableByUser.get(u));
    const mirrorHash = employeeContentHash(mirrorByUser.get(u));
    if (tableHash !== mirrorHash) {
      fieldDrift.push({ username: tableByUser.get(u)?.username || u, reason: 'content_hash_mismatch' });
    }
  }

  return {
    tenantId: tid,
    tableCount: tableSet.size,
    mirrorCount: mirrorSet.size,
    onlyTable,
    onlyMirror,
    fieldDrift,
    ok: onlyTable.length === 0 && onlyMirror.length === 0 && fieldDrift.length === 0,
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {(p: import('pg').Pool) => Promise<string[]>} getActiveTenantIds
 */
export async function reconcileEmployeesMirrorAllTenants(pool, getActiveTenantIds) {
  const tenantIds = await getActiveTenantIds(pool);
  const reports = [];
  for (const tid of tenantIds) {
    reports.push(await reconcileEmployeesMirror(pool, tid));
  }
  return reports;
}
