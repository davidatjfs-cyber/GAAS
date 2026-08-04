/**
 * hrms_state read/write hub (optimistic-lock merge / save / remove employees).
 * Instantiated after account-gate + payroll/leave schedule + dual-write;
 * index keeps late-bind wrappers for early register*(..., getSharedState).
 */
import { childLogger } from '../../utils/logger.js';
import { isInactiveStatus } from '../employees/account-gate.js';
import { hydrateAuthoritativeState as defaultHydrateAuthoritativeState } from './hydrate-authoritative-state.js';
import { getAppEnv } from '../../safety.js';

const log = childLogger({ domain: 'shared', handler: 'hrms-state-store' });

/**
 * hrms_state.data 常年是几 MB 的大 JSON（如 default 租户 ~4.3MB），getSharedState 在整个
 * 代码库里被高频调用（打卡/考勤/门店等几乎所有读路径都会经过）。没有缓存时每次调用都要重新
 * 从 pg 拉整个 blob + 反序列化，2026-07-29 实测把这台 2 核服务器的 node 进程打到 100%+ CPU，
 * 导致所有接口（含打卡）响应从毫秒级劣化到 15~36 秒。TTL 设短是为了让写后读尽量新鲜。
 *
 * 缓存策略（方案 B）：缓存的是 hydrate 后的结果。blob 写路径成功后 invalidate（不回填未 hydrate
 * 的 raw），权威表写路径也必须调用 invalidateSharedStateCache，否则最多 2s 读旧。
 *
 * 2026-07-29 补充修复（cache stampede）：上面这层 TTL 缓存只缓存"已完成"的结果，不会缓存
 * "进行中"的 fetch——生产实测同一个 2 秒窗口内出现过 35 个并发 /api/unread-counts 请求，
 * 全部同时判定"未命中缓存"，于是各自独立发起一次这个几 MB blob 的拉取+hydrate，35 份完全
 * 重复的重活挤在同一个单线程事件循环里排队执行，才是这台 2 核服务器被打满、几乎所有接口
 * 响应时间飙到 15~109 秒的真正机制（不是缓存不存在，是缓存没有去重"正在进行中"的请求）。
 * 修复：命中缓存未命中时，把这次 fetch 产生的 Promise 立即（同步）存入 _inFlight，后续在
 * 同一窗口内到达的并发调用改成一起 await 这同一个 Promise，只真正拉取一次。
 */
const STATE_CACHE_TTL_MS = 2000;
const _stateCache = new Map(); // key -> { data, expiresAt }
const _inFlight = new Map(); // key -> Promise（去重并发 cache-miss，见上方补充说明）
// 集成测试里大量测试助手(如 server/test/integration/helpers/db.mjs 的 appendStateEmployee)
// 是跨进程直接对 hrms_state 表做原始SQL写入的——被测应用进程内存里的这份缓存完全不知道
// 这次写入，2秒TTL内后续请求会读到写入前的旧快照，导致"刚插入的员工/manager查不到"这类
// 大批假失败(missing_manager/no_targets_found等)。测试环境(APP_ENV=test)关掉缓存，
// 不改变生产环境的缓存行为。
const STATE_CACHE_DISABLED = getAppEnv() === 'test';

function readStateCache(key) {
  if (STATE_CACHE_DISABLED) return undefined;
  const entry = _stateCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.data;
}

function writeStateCache(key, data) {
  if (STATE_CACHE_DISABLED) return;
  _stateCache.set(key, { data, expiresAt: Date.now() + STATE_CACHE_TTL_MS });
}

function invalidateStateCacheKey(key) {
  _stateCache.delete(key);
  _inFlight.delete(key);
}

async function fetchAndHydrateState(pool, hydrateFn, key) {
  const r = await pool.query('select data from hrms_state where key = $1 limit 1', [key]);
  const row = r.rows?.[0] || null;
  const data = row?.data && typeof row.data === 'object' ? row.data : null;
  if (!data) return null;
  return hydrateFn(pool, data, key);
}

async function getSharedStateImpl(pool, resolveTenantIdDefault, hydrateFn, tenantId) {
  const key = resolveTenantIdDefault(tenantId);
  const cached = readStateCache(key);
  if (cached !== undefined) return cached;

  if (STATE_CACHE_DISABLED) {
    return fetchAndHydrateState(pool, hydrateFn, key);
  }

  let inflight = _inFlight.get(key);
  if (!inflight) {
    inflight = fetchAndHydrateState(pool, hydrateFn, key)
      .then((hydrated) => {
        writeStateCache(key, hydrated);
        return hydrated;
      })
      .finally(() => {
        _inFlight.delete(key);
      });
    _inFlight.set(key, inflight);
  }
  return inflight;
}

/**
 * 这些字段的权威来源是真表，getSharedState 每次都会用表数据整体覆盖 blob 里的副本
 * （见 hydrate-authoritative-state.js）。也就是说 blob 里存的那一份永远不会被读到，
 * 纯粹是白白增加每次 getSharedState 的拉取+解析开销。
 *
 * 2026-08-04：手工把 dailyReports 从 blob 删掉（5247→3835 kB）后几分钟就涨了回来——
 * 因为业务代码普遍是「getSharedState() 拿到 hydrate 后的完整 state → 改一点 → saveSharedState()」，
 * 于是 hydrate 填进来的表数据又被原样写回 blob。只删数据不改写入路径是堵不住的。
 *
 * 只列「表非空且 hydrate 无条件整体覆盖」的字段：
 *   - dailyReports：hydrateDailyReportsFromTable 里 `if (fromTable.length > 0) base.dailyReports = fromTable`，
 *     生产实测 blob 311 条 == daily_reports 表 311 条，且 CLAUDE.md 明确 daily_reports 唯一写入方是 GAAS。
 * 不要顺手加 inventoryForecastHistory：那张表当前是空的（0 行），hydrate 会保留 blob 副本，
 * 剥离等于丢数据；要先回填表再考虑。
 */
const TABLE_AUTHORITATIVE_FIELDS = ['dailyReports'];

function stripTableAuthoritativeFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  let hit = false;
  for (const f of TABLE_AUTHORITATIVE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) { hit = true; break; }
  }
  if (!hit) return obj;
  const out = { ...obj };
  for (const f of TABLE_AUTHORITATIVE_FIELDS) delete out[f];
  return out;
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

      // 两边都剥：nextData 挡住「hydrate 后原样写回」，current 顺手清掉 blob 里的历史残留
      const merged = stripTableAuthoritativeFields({ ...current, ...nextData });

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
        [key, JSON.stringify(stripTableAuthoritativeFields(next)), prevUpdatedAt]
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
