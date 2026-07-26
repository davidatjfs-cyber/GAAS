/**
 * hrms_state read/write hub (optimistic-lock merge / save / remove employees).
 * Instantiated after account-gate + payroll/leave schedule + dual-write;
 * index keeps late-bind wrappers for early register*(..., getSharedState).
 */
import { childLogger } from '../../utils/logger.js';
import { isInactiveStatus } from '../employees/account-gate.js';

const log = childLogger({ domain: 'shared', handler: 'hrms-state-store' });

async function getSharedStateImpl(pool, resolveTenantIdDefault, tenantId) {
  const key = resolveTenantIdDefault(tenantId);
  const r = await pool.query('select data from hrms_state where key = $1 limit 1', [key]);
  const row = r.rows?.[0] || null;
  return row?.data && typeof row.data === 'object' ? row.data : null;
}

async function saveSharedStateImpl(deps, nextData, tenantId) {
  const { pool, resolveTenantIdDefault, schedulePayrollDomainSync, scheduleLeaveDomainSync, dualWriteStateToDB } = deps;
  if (!nextData || typeof nextData !== 'object' || !Object.keys(nextData).length) return;
  const key = resolveTenantIdDefault(tenantId);

  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        'SELECT data, updated_at FROM hrms_state WHERE key = $1 FOR UPDATE',
        [key]
      );
      const current =
        r.rows?.[0]?.data && typeof r.rows[0].data === 'object' ? r.rows[0].data : {};
      const prevUpdatedAt = r.rows?.[0]?.updated_at;

      const merged = { ...current, ...nextData };

      const result = await client.query(
        `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1 AND updated_at = $3`,
        [key, JSON.stringify(merged), prevUpdatedAt]
      );
      if (result.rowCount > 0) {
        await client.query('COMMIT');
        client.release();
        schedulePayrollDomainSync();
        scheduleLeaveDomainSync();
        await dualWriteStateToDB(merged);
        return;
      }
      await client.query('ROLLBACK');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw e;
    }
  }
  throw new Error('saveSharedState: max retries exceeded');
}

/**
 * 仅原子合并 hrms_state 中的特定顶层字段，避免 Read-Modify-Write 竞态覆盖其他字段。
 */
async function mergeSharedStateFieldsImpl(deps, patches, arrayIdFields = {}, tenantId) {
  const {
    pool,
    resolveTenantIdDefault,
    schedulePayrollDomainSync,
    scheduleLeaveDomainSync,
    applyHrmsUserAccountGateFromEmployee,
    upsertEmployeeFromStateShape,
    notifyAdminsDualWriteFailure,
  } = deps;
  if (!patches || typeof patches !== 'object' || !Object.keys(patches).length) return;
  const key = resolveTenantIdDefault(tenantId);

  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        'SELECT data, updated_at FROM hrms_state WHERE key = $1 FOR UPDATE',
        [key]
      );
      const row = r.rows?.[0];
      const current = row?.data && typeof row.data === 'object' ? row.data : {};
      const prevUpdatedAt = row?.updated_at;

      const next = { ...current };
      for (const [field, patchValue] of Object.entries(patches)) {
        if (Array.isArray(patchValue)) {
          const idSpec = arrayIdFields[field];
          const existing = Array.isArray(current[field]) ? current[field].slice() : [];
          if (idSpec) {
            const getKey = Array.isArray(idSpec)
              ? (item) => idSpec.map((k) => String(item?.[k] || '')).join('|')
              : (item) => String(item?.[idSpec] || '');
            const existingMap = new Map(existing.map((e) => [getKey(e), e]));
            for (const item of patchValue) {
              existingMap.set(getKey(item), item);
            }
            const patchKeys = new Set(patchValue.map(getKey));
            const retained = existing.filter((e) => !patchKeys.has(getKey(e)));
            next[field] = [...patchValue, ...retained];
          } else {
            next[field] = [...patchValue, ...existing];
          }
        } else if (patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue)) {
          next[field] = {
            ...(current[field] && typeof current[field] === 'object' ? current[field] : {}),
            ...patchValue,
          };
        } else {
          next[field] = patchValue;
        }
      }

      const updateResult = await client.query(
        `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1 AND updated_at = $3`,
        [key, JSON.stringify(next), prevUpdatedAt]
      );
      if (updateResult.rowCount > 0) {
        await client.query('COMMIT');
        if (
          Array.isArray(patches.employees) &&
          patches.employees.length &&
          arrayIdFields.employees === 'username'
        ) {
          const mergedEmps = Array.isArray(next.employees) ? next.employees : [];
          for (const item of patches.employees) {
            const u = String(item?.username || '').trim();
            if (!u) continue;
            const rec = mergedEmps.find(
              (e) => String(e?.username || '').trim().toLowerCase() === u.toLowerCase()
            );
            if (rec) {
              try {
                await applyHrmsUserAccountGateFromEmployee(rec);
              } catch (e) {
                log.error({
                  msg: 'merge_shared_state_account_gate_failed',
                  username: u,
                  err: e?.message || String(e),
                });
              }
              try {
                let toUpsert = rec;
                try {
                  const curR = await pool.query(
                    `SELECT status FROM employees WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1`,
                    [u, key]
                  );
                  const tableStatus = String(curR.rows?.[0]?.status || '').trim();
                  if (isInactiveStatus(tableStatus) && !isInactiveStatus(rec?.status)) {
                    toUpsert = { ...rec, status: tableStatus };
                  }
                } catch (_e) { /* ignore; fall through to upsert */ }
                await upsertEmployeeFromStateShape(pool, key, toUpsert);
              } catch (e) {
                log.error({
                  msg: 'merge_shared_state_employees_table_failed',
                  username: u,
                  err: e?.message || String(e),
                });
                void notifyAdminsDualWriteFailure('employees（mergeSharedStateFields）', e);
              }
            }
          }
        }
        schedulePayrollDomainSync();
        scheduleLeaveDomainSync();
        client.release();
        return;
      }
      await client.query('ROLLBACK');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw e;
    }
  }
  throw new Error('mergeSharedStateFields: max retries exceeded');
}

/** 从 hrms_state 镜像中移除员工（及 users 同账号），供 DELETE /api/employees 使用 */
async function removeEmployeesFromSharedStateImpl(pool, resolveTenantIdDefault, usernames, tenantId) {
  const want = new Set(
    (Array.isArray(usernames) ? usernames : [usernames])
      .map((u) => String(u || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (!want.size) return;
  const key = resolveTenantIdDefault(tenantId);
  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        'SELECT data, updated_at FROM hrms_state WHERE key = $1 FOR UPDATE',
        [key]
      );
      const row = r.rows?.[0];
      const current = row?.data && typeof row.data === 'object' ? row.data : {};
      const prevUpdatedAt = row?.updated_at;
      const next = { ...current };
      next.employees = (Array.isArray(current.employees) ? current.employees : []).filter(
        (e) => !want.has(String(e?.username || '').trim().toLowerCase())
      );
      next.users = (Array.isArray(current.users) ? current.users : []).filter(
        (u) => !want.has(String(u?.username || '').trim().toLowerCase())
      );
      const updateResult = await client.query(
        `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1 AND updated_at = $3`,
        [key, JSON.stringify(next), prevUpdatedAt]
      );
      if (updateResult.rowCount > 0) {
        await client.query('COMMIT');
        client.release();
        return;
      }
      await client.query('ROLLBACK');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw e;
    }
  }
  throw new Error('removeEmployeesFromSharedState: max retries exceeded');
}

export function createHrmsStateStoreHelpers(deps) {
  const { pool, resolveTenantIdDefault } = deps;
  return {
    getSharedState: (tenantId) => getSharedStateImpl(pool, resolveTenantIdDefault, tenantId),
    saveSharedState: (nextData, tenantId) => saveSharedStateImpl(deps, nextData, tenantId),
    mergeSharedStateFields: (patches, arrayIdFields, tenantId) =>
      mergeSharedStateFieldsImpl(deps, patches, arrayIdFields, tenantId),
    removeEmployeesFromSharedState: (usernames, tenantId) =>
      removeEmployeesFromSharedStateImpl(pool, resolveTenantIdDefault, usernames, tenantId),
  };
}
