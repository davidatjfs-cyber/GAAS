/**
 * hrms_state read/write hub (optimistic-lock merge / save / remove employees).
 * Instantiated after account-gate + payroll/leave schedule + dual-write;
 * index keeps late-bind wrappers for early register*(..., getSharedState).
 */
import { childLogger } from '../../utils/logger.js';
import { isInactiveStatus } from '../employees/account-gate.js';
import { hydrateAuthoritativeState as defaultHydrateAuthoritativeState } from './hydrate-authoritative-state.js';

const log = childLogger({ domain: 'shared', handler: 'hrms-state-store' });

/**
 * hrms_state.data 常年是几 MB 的大 JSON（如 default 租户 ~4.3MB），getSharedState 在整个
 * 代码库里被高频调用（打卡/考勤/门店等几乎所有读路径都会经过）。没有缓存时每次调用都要重新
 * 从 pg 拉整个 blob + 反序列化，2026-07-29 实测把这台 2 核服务器的 node 进程打到 100%+ CPU，
 * 导致所有接口（含打卡）响应从毫秒级劣化到 15~36 秒。TTL 设短是为了让写后读尽量新鲜。
 *
 * 缓存策略（方案 B）：缓存的是 hydrate 后的结果。blob 写路径成功后 invalidate（不回填未 hydrate
 * 的 raw），权威表写路径也必须调用 invalidateSharedStateCache，否则最多 2s 读旧。
 */
const STATE_CACHE_TTL_MS = 2000;
const _stateCache = new Map(); // key -> { data, expiresAt }

function readStateCache(key) {
  const entry = _stateCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.data;
}

function writeStateCache(key, data) {
  _stateCache.set(key, { data, expiresAt: Date.now() + STATE_CACHE_TTL_MS });
}

function invalidateStateCacheKey(key) {
  _stateCache.delete(key);
}

async function getSharedStateImpl(pool, resolveTenantIdDefault, hydrateFn, tenantId) {
  const key = resolveTenantIdDefault(tenantId);
  const cached = readStateCache(key);
  if (cached !== undefined) return cached;
  const r = await pool.query('select data from hrms_state where key = $1 limit 1', [key]);
  const row = r.rows?.[0] || null;
  const data = row?.data && typeof row.data === 'object' ? row.data : null;
  if (!data) {
    writeStateCache(key, null);
    return null;
  }
  const hydrated = await hydrateFn(pool, data, key);
  writeStateCache(key, hydrated);
  return hydrated;
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
        // 方案 B：不缓存未 hydrate 的 raw merge，下次 getSharedState 会重新拉表覆盖权威字段
        invalidateStateCacheKey(key);
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
        invalidateStateCacheKey(key);
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
        invalidateStateCacheKey(key);
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
  const hydrateFn =
    typeof deps.hydrateAuthoritativeState === 'function'
      ? deps.hydrateAuthoritativeState
      : defaultHydrateAuthoritativeState;
  return {
    getSharedState: (tenantId) => getSharedStateImpl(pool, resolveTenantIdDefault, hydrateFn, tenantId),
    saveSharedState: (nextData, tenantId) => saveSharedStateImpl(deps, nextData, tenantId),
    mergeSharedStateFields: (patches, arrayIdFields, tenantId) =>
      mergeSharedStateFieldsImpl(deps, patches, arrayIdFields, tenantId),
    removeEmployeesFromSharedState: (usernames, tenantId) =>
      removeEmployeesFromSharedStateImpl(pool, resolveTenantIdDefault, usernames, tenantId),
    invalidateSharedStateCache: (tenantId) => {
      invalidateStateCacheKey(resolveTenantIdDefault(tenantId));
    },
  };
}
