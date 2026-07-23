/**
 * 员工表权威 + hrms_state.employees 镜像：同事务写入，避免表提交后镜像失败导致分叉。
 */
import { SHARED_TABLES } from '@gaas/shared';

/**
 * @param {import('pg').Pool} pool
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withEmployeesWriteTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 在已开启的事务 client 上合并 employees 镜像（不做 BEGIN/COMMIT）。
 * @param {import('pg').PoolClient} client
 * @param {object[]} emps
 * @param {string} tenantId
 */
export async function mergeEmployeesMirrorOnClient(client, emps, tenantId) {
  const key = String(tenantId || 'default');
  const patchList = Array.isArray(emps) ? emps.filter((e) => e?.username) : [];
  if (!patchList.length) return;

  const r = await client.query(
    `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 FOR UPDATE`,
    [key]
  );
  const current = r.rows?.[0]?.data && typeof r.rows[0].data === 'object' ? r.rows[0].data : {};
  const existing = Array.isArray(current.employees) ? current.employees.slice() : [];
  const byUser = new Map(existing.map((e) => [String(e?.username || '').trim().toLowerCase(), e]));
  for (const item of patchList) {
    const u = String(item.username || '').trim().toLowerCase();
    if (!u) continue;
    byUser.set(u, item);
  }
  const patchKeys = new Set(patchList.map((e) => String(e.username || '').trim().toLowerCase()));
  const retained = existing.filter((e) => !patchKeys.has(String(e?.username || '').trim().toLowerCase()));
  const nextEmployees = [...patchList, ...retained];
  const next = { ...current, employees: nextEmployees };

  if (r.rows?.[0]) {
    await client.query(
      `UPDATE ${SHARED_TABLES.HRMS_STATE} SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`,
      [key, JSON.stringify(next)]
    );
  } else {
    await client.query(
      `INSERT INTO ${SHARED_TABLES.HRMS_STATE} (key, data, updated_at) VALUES ($1, $2::jsonb, NOW())`,
      [key, JSON.stringify(next)]
    );
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string[]} usernames
 * @param {string} tenantId
 */
export async function removeEmployeesMirrorOnClient(client, usernames, tenantId) {
  const key = String(tenantId || 'default');
  const removeSet = new Set(
    (Array.isArray(usernames) ? usernames : []).map((u) => String(u || '').trim().toLowerCase()).filter(Boolean)
  );
  if (!removeSet.size) return;

  const r = await client.query(
    `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 FOR UPDATE`,
    [key]
  );
  if (!r.rows?.[0]) return;
  const current = r.rows[0].data && typeof r.rows[0].data === 'object' ? r.rows[0].data : {};
  const existing = Array.isArray(current.employees) ? current.employees : [];
  const nextEmployees = existing.filter((e) => !removeSet.has(String(e?.username || '').trim().toLowerCase()));
  const next = { ...current, employees: nextEmployees };
  await client.query(
    `UPDATE ${SHARED_TABLES.HRMS_STATE} SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`,
    [key, JSON.stringify(next)]
  );
}

/**
 * 表 vs 镜像对账：username 集合不一致则返回 diff。
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 */
export async function reconcileEmployeesMirror(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const tableR = await pool.query(
    `SELECT lower(trim(username)) AS u FROM ${SHARED_TABLES.EMPLOYEES} WHERE tenant_id = $1 AND username IS NOT NULL AND trim(username) <> ''`,
    [tid]
  );
  const stateR = await pool.query(`SELECT data->'employees' AS emps FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`, [
    tid,
  ]);
  const tableSet = new Set((tableR.rows || []).map((r) => r.u).filter(Boolean));
  const emps = stateR.rows?.[0]?.emps;
  const mirrorSet = new Set(
    (Array.isArray(emps) ? emps : [])
      .map((e) => String(e?.username || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const onlyTable = [...tableSet].filter((u) => !mirrorSet.has(u)).sort();
  const onlyMirror = [...mirrorSet].filter((u) => !tableSet.has(u)).sort();
  return {
    tenantId: tid,
    tableCount: tableSet.size,
    mirrorCount: mirrorSet.size,
    onlyTable,
    onlyMirror,
    ok: onlyTable.length === 0 && onlyMirror.length === 0,
  };
}
