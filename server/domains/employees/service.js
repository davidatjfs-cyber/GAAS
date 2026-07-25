/**
 * 员工域：employees 表为权威，hrms_state.employees 仅为镜像。
 *
 * GET /api/state 通过 hydrateEmployeesFromTable 覆盖 employees。
 * 写入经 upsertEmployeeFromStateShape / deleteEmployeeFromTable，
 * 并由调用方同步 mergeSharedStateFields 镜像（或窄 API 内完成）。
 */

import { SHARED_TABLES } from '@gaas/shared';

const STRUCTURED_KEYS = new Set([
  'id',
  'username',
  'name',
  'role',
  'store',
  'department',
  'position',
  'status',
  'gender',
  'phone',
  'email',
  'joinDate',
  'birthday',
  'salary',
  'password',
  'managerUsername',
  'idCardNumber',
  'bankCard',
  'createdAt',
  'updatedAt',
  'tenant_id',
  'tenantId',
]);

export function employeeRowToStateShape(row) {
  if (!row) return null;
  const extraRaw = row.extra_json && typeof row.extra_json === 'object' ? row.extra_json : {};
  // extra 不得覆盖结构化列（否则历史 extra_json.status 会盖掉表上的 inactive）
  const extra = {};
  for (const [k, v] of Object.entries(extraRaw)) {
    if (STRUCTURED_KEYS.has(k)) continue;
    extra[k] = v;
  }
  return {
    ...extra,
    id: row.id,
    username: String(row.username || '').trim(),
    name: String(row.name || '').trim(),
    role: String(row.role || '').trim(),
    store: String(row.store || '').trim(),
    department: String(row.department || '').trim(),
    position: String(row.position || '').trim(),
    status: String(row.status || 'active').trim(),
    gender: String(row.gender || '').trim(),
    phone: String(row.phone || '').trim(),
    email: String(row.email || '').trim(),
    joinDate: String(row.join_date || '').trim(),
    birthday: String(row.birthday || '').trim(),
    salary: String(row.salary || '').trim(),
    // 历史列名 password_hash，实际存的是 state 明文密码（供 admin 查看）
    password: String(row.password_hash || '').trim(),
    managerUsername: String(row.manager_username || '').trim(),
    idCardNumber: String(row.id_card_number || '').trim(),
    bankCard: String(row.bank_card || '').trim(),
    createdAt: row.created_at ? String(row.created_at) : '',
    updatedAt: row.updated_at ? String(row.updated_at) : '',
  };
}

export async function loadEmployeesFromTable(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const r = await pool.query(
    `SELECT id, username, name, role, store, department, position, status, gender, phone, email,
            join_date, birthday, salary, password_hash, manager_username, id_card_number, bank_card,
            extra_json, created_at, updated_at
       FROM ${SHARED_TABLES.EMPLOYEES}
      WHERE tenant_id = $1
      ORDER BY username`,
    [tid]
  );
  return (r.rows || []).map(employeeRowToStateShape).filter((e) => e?.username);
}

/**
 * 用权威表覆盖 state.employees。表无行时保留 state（兼容空库/迁移中）。
 */
export async function hydrateEmployeesFromTable(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  try {
    const fromTable = await loadEmployeesFromTable(pool, tenantId);
    if (fromTable.length > 0) {
      base.employees = fromTable;
    }
  } catch (e) {
    console.error('[employees-domain] load employees failed:', e?.message || e);
  }
  return base;
}

function splitStructuredAndExtra(emp) {
  const username = String(emp?.username || '').trim();
  const id = String(emp?.id || username).trim() || username;
  const rest = {};
  for (const [k, v] of Object.entries(emp || {})) {
    if (STRUCTURED_KEYS.has(k)) continue;
    rest[k] = v;
  }
  return {
    id,
    username,
    name: String(emp?.name || ''),
    role: String(emp?.role || ''),
    store: String(emp?.store || ''),
    department: String(emp?.department || ''),
    position: String(emp?.position || ''),
    status: String(emp?.status || 'active'),
    gender: String(emp?.gender || ''),
    phone: String(emp?.phone || ''),
    email: String(emp?.email || ''),
    joinDate: String(emp?.joinDate || ''),
    birthday: String(emp?.birthday || ''),
    salary: String(emp?.salary ?? ''),
    password: String(emp?.password || ''),
    managerUsername: String(emp?.managerUsername || ''),
    idCardNumber: String(emp?.idCardNumber || ''),
    bankCard: String(emp?.bankCard || ''),
    createdAt: emp?.createdAt,
    extra: rest,
  };
}

export async function upsertEmployeeFromStateShape(pool, tenantId, emp) {
  const tid = String(tenantId || 'default');
  const s = splitStructuredAndExtra(emp);
  if (!s.username) return null;
  const createdAt = s.createdAt ? new Date(s.createdAt).toISOString() : new Date().toISOString();
  const updatedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO ${SHARED_TABLES.EMPLOYEES} (id, username, name, role, store, department, position, status,
       gender, phone, email, join_date, birthday, salary, password_hash, manager_username,
       id_card_number, bank_card, extra_json, created_at, updated_at, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (username, tenant_id) DO UPDATE SET
       id=EXCLUDED.id,
       name=EXCLUDED.name, role=EXCLUDED.role, store=EXCLUDED.store,
       department=EXCLUDED.department, position=EXCLUDED.position, status=EXCLUDED.status,
       gender=EXCLUDED.gender, phone=EXCLUDED.phone, email=EXCLUDED.email,
       join_date=EXCLUDED.join_date, birthday=EXCLUDED.birthday, salary=EXCLUDED.salary,
       password_hash=EXCLUDED.password_hash, manager_username=EXCLUDED.manager_username,
       id_card_number=EXCLUDED.id_card_number, bank_card=EXCLUDED.bank_card,
       extra_json=EXCLUDED.extra_json, updated_at=NOW()`,
    [
      s.id,
      s.username,
      s.name,
      s.role,
      s.store,
      s.department,
      s.position,
      s.status,
      s.gender,
      s.phone,
      s.email,
      s.joinDate,
      s.birthday,
      s.salary,
      s.password,
      s.managerUsername,
      s.idCardNumber,
      s.bankCard,
      JSON.stringify(s.extra),
      createdAt,
      updatedAt,
      tid,
    ]
  );
  return { ...emp, id: s.id, username: s.username };
}

export async function upsertEmployeesFromStateShape(pool, tenantId, emps) {
  const list = Array.isArray(emps) ? emps : [];
  let n = 0;
  for (const emp of list) {
    const r = await upsertEmployeeFromStateShape(pool, tenantId, emp);
    if (r) n++;
  }
  return n;
}

/**
 * 改账号：先删旧 username 行，再 upsert 新行（保留 extra 等由调用方合并进 emp）。
 */
export async function renameEmployeeUsername(pool, tenantId, oldUsername, emp) {
  const tid = String(tenantId || 'default');
  const oldU = String(oldUsername || '').trim();
  const newU = String(emp?.username || '').trim();
  if (!oldU || !newU) throw new Error('missing_username');
  if (oldU.toLowerCase() === newU.toLowerCase()) {
    return upsertEmployeeFromStateShape(pool, tid, emp);
  }
  await pool.query(`DELETE FROM ${SHARED_TABLES.EMPLOYEES} WHERE lower(username) = lower($1) AND tenant_id = $2`, [oldU, tid]);
  return upsertEmployeeFromStateShape(pool, tid, emp);
}

export async function deleteEmployeeFromTable(pool, tenantId, username) {
  const tid = String(tenantId || 'default');
  const u = String(username || '').trim();
  if (!u) return 0;
  const r = await pool.query(`DELETE FROM ${SHARED_TABLES.EMPLOYEES} WHERE lower(username) = lower($1) AND tenant_id = $2`, [u, tid]);
  return r.rowCount || 0;
}

export async function patchEmployeeStatus(pool, tenantId, username, status, extraPatch = {}) {
  const tid = String(tenantId || 'default');
  const u = String(username || '').trim();
  const st = String(status || '').trim();
  if (!u || !st) throw new Error('missing_username_or_status');
  const list = await loadEmployeesFromTable(pool, tid);
  const cur = list.find((e) => String(e.username || '').toLowerCase() === u.toLowerCase());
  if (!cur) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  const next = { ...cur, ...extraPatch, status: st, username: cur.username };
  await upsertEmployeeFromStateShape(pool, tid, next);
  return next;
}
