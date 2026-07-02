/**
 * 数据库工具模块
 * 统一数据库连接和基础操作
 */
import { AsyncLocalStorage } from 'node:async_hooks';

// 跨文件共享的租户上下文：index.js的authRequired中间件按请求设置(tenantContext.run)，
// agents.js/performance-jobs.js等没有HTTP req对象的深层工具函数靠resolveTenantIdDefault()
// 读取这个上下文，不用给这些函数的所有调用点都加tenantId参数。未登录/无上下文(后台任务)
// 时落回'default'，行为不变。必须放在index.js/agents.js都能import的共享模块里，
// 否则两边各自new一个AsyncLocalStorage会变成互不相通的两份上下文。
export const tenantContext = new AsyncLocalStorage();
export const SYSTEM_TENANT_ID = '__system__';
export const BOOTSTRAP_TENANT_ID = 'default';
export function resolveTenantIdDefault(tenantId) {
  return String(tenantId || tenantContext.getStore() || 'default').trim() || 'default';
}

// RLS专用、故意跟resolveTenantIdDefault分开的严格版本：读不到明确的租户身份(既没有
// 显式tenantId参数也没有ALS上下文)时，返回一个保证不会匹配任何真实tenant_id的哨兵值，
// 而不是退回'default'。
//
// 为什么不能跟resolveTenantIdDefault共用：那个函数是给app层"找不到就按default处理"
// 这种业务兜底用的，今晚到处都在用它保证"零行为变化"。如果RLS的会话变量也读同一个
// 函数，那么app层任何一个忘记正确传租户身份的bug，会同时让RLS也悄悄退回'default'——
// 等于数据库这层完全没有提供任何app代码bug之外的额外保护，RLS就白做了。
// 用一个独立、严格的函数，才能保证：哪怕app层某处疏忽，数据库这层依然会因为
// 查不到匹配的tenant_id而返回空，而不是把数据算给错误的租户。
const RLS_NO_TENANT_SENTINEL = '__rls_no_tenant_context__';
export function resolveTenantIdStrict(tenantId) {
  const v = String(tenantId || tenantContext.getStore() || '').trim();
  return v || RLS_NO_TENANT_SENTINEL;
}

// 平台级表(tenants/licenses/全局参考表)可用 system context 包裹，避免误落入某个租户。
export async function runWithSystemTenantContext(fn) {
  return await tenantContext.run(SYSTEM_TENANT_ID, fn);
}

// 启动迁移 / seed / bootstrap 写入 tenant-owned RLS 表时，必须明确钉到一个真实租户；
// 当前历史数据与宿主初始化统一落在 default 租户。不要用 system tenant 去写 RLS 业务表，
// 否则 WITH CHECK 会因为 tenant_id 不匹配而被拒绝。
export async function runWithBootstrapTenantContext(fn, tenantId = BOOTSTRAP_TENANT_ID) {
  return await tenantContext.run(resolveTenantIdDefault(tenantId), fn);
}

let _pool = null;
export function setPool(p) {
  _pool = p;
  wrapPoolForTenantContext(p);
}
export function pool() {
  if (!_pool) throw new Error('database: pool not set');
  return _pool;
}

/**
 * RLS(行级安全)上线的前置基础设施：原地包装传入的pg.Pool实例，让全代码库现有的
 * pool().query(...)/pool().connect()写法不用改一行，就能自动把当前请求/cron的租户身份
 * 通过 SET 告诉数据库会话(走 set_config，参数化传值，不拼字符串，没有SQL注入风险)。
 *
 * 设计取舍——用session级set_config(...,false)而不是事务级SET LOCAL：
 * 后台到处是 client.query('BEGIN')...COMMIT 这种显式多语句事务(safeTransaction等)，
 * 也到处是单次pool.query()自动单语句提交；用SET LOCAL只在显式BEGIN之后才生效，
 * 单次查询场景就要额外包一层事务，开销更大且要侵入式检测调用方是否已经BEGIN过。
 * 改用session级设置：每次从池子checkout连接时设一次(覆盖checkout期间的所有查询，
 * 不管调用方是单次查询还是手动BEGIN/COMMIT)，release前清空——清空是安全网，
 * 防止这条连接被池子复用给别的请求时还带着上一个请求的租户身份。
 *
 * 这一步本身只是给会话设置一个GUC变量，在任何表实际打开RLS策略之前是完全无害的
 * (没有策略读它，等于没设)。真正的隔离生效在Phase1给具体表加CREATE POLICY之后。
 */
function wrapPoolForTenantContext(rawPool) {
  if (!rawPool || rawPool.__tenantContextWrapped) return;
  rawPool.__tenantContextWrapped = true;

  const originalConnect = rawPool.connect.bind(rawPool);
  const originalQuery = rawPool.query.bind(rawPool);

  async function setSessionTenant(client, tenantId) {
    await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId]);
  }
  async function clearSessionTenant(client) {
    try {
      await client.query("SELECT set_config('app.tenant_id', '', false)");
    } catch (_e) {
      // 清空失败不应该阻止连接归还池子；最坏情况下这条连接下次被复用前还带着旧租户标记，
      // 但下次checkout时setSessionTenant会立刻覆盖掉，窗口期极短且只发生在清空报错这种边缘情况。
    }
  }

  rawPool.connect = async function (...args) {
    const tenantId = resolveTenantIdStrict();
    const client = await originalConnect(...args);
    await setSessionTenant(client, tenantId);
    const originalRelease = client.release.bind(client);
    client.release = async (...releaseArgs) => {
      await clearSessionTenant(client);
      return originalRelease(...releaseArgs);
    };
    return client;
  };

  rawPool.query = async function (text, params) {
    const tenantId = resolveTenantIdStrict();
    const client = await originalConnect();
    try {
      await setSessionTenant(client, tenantId);
      return await client.query(text, params);
    } finally {
      await clearSessionTenant(client);
      client.release();
    }
  };

  // 保留逃生通道：极少数确实需要绕开这层包装、直接用原始pool方法的场景(目前没有已知调用方，
  // 留着是为了排障方便，比如怀疑包装本身有问题时可以临时切回来对比)。
  rawPool.__unwrappedConnect = originalConnect;
  rawPool.__unwrappedQuery = originalQuery;
}

// 多租户后台任务用：取所有激活租户的tenant_id列表。
// 查询失败时兜底返回['default']而不是空数组——避免数据库瞬时抖动导致某次tick
// 一个租户都不处理；这样最差情况下退化为"只处理default"，即改造前的行为，不会更差。
const ACTIVE_TENANTS_CACHE_MS = 60 * 1000;
let _activeTenantIds = [];
let _activeTenantIdsLoadedAt = 0;
export async function getActiveTenantIds(p) {
  if (Date.now() - _activeTenantIdsLoadedAt < ACTIVE_TENANTS_CACHE_MS) return _activeTenantIds;
  try {
    // tenants表开启RLS后，必须用__system__上下文才能跨租户读全量列表；
    // 不用resolveTenantIdDefault兜底'default'——那样RLS上线后只能看到default租户自己的行。
    const r = await runWithSystemTenantContext(() =>
      (p || pool()).query("SELECT tenant_id FROM tenants WHERE status = 'active' ORDER BY tenant_id")
    );
    if (r.rows?.length) {
      _activeTenantIds = r.rows.map((row) => row.tenant_id);
      _activeTenantIdsLoadedAt = Date.now();
    }
  } catch (e) {
    // A tenant-owned background job must never quietly process `default` when
    // tenant discovery is unavailable. Keep the last confirmed list; at cold
    // start it is empty and callers must fail closed.
    console.error('[database] getActiveTenantIds failed, retaining previous tenant list:', e?.message || e);
  }
  return _activeTenantIds;
}

/** Runs one tenant-owned background operation per active tenant, sequentially.
 * Sequential execution avoids context bleed and prevents a large tenant from
 * starving connection-pool capacity for the others. */
export async function runForActiveTenants(
  work,
  {
    p,
    getTenantIds = getActiveTenantIds,
    continueOnError = false,
    onError = null,
  } = {}
) {
  const tenantIds = await getTenantIds(p);
  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    throw new Error('no_active_tenants');
  }
  const results = [];
  const errors = [];
  for (const tenantId of tenantIds) {
    try {
      const value = await tenantContext.run(tenantId, () => work(tenantId));
      if (continueOnError) {
        results.push({ tenantId, ok: true, value });
      } else {
        results.push(value);
      }
    } catch (error) {
      if (!continueOnError) throw error;
      const detail = { tenantId, ok: false, error };
      errors.push(detail);
      try {
        await onError?.(detail);
      } catch (_handlerError) {
        // Avoid an alert hook failure masking the original tenant job failure.
      }
    }
  }
  if (continueOnError) return { results, errors };
  return results;
}

// 安全的数据库查询包装
export async function safeQuery(query, params = []) {
  try {
    const result = await pool().query(query, params);
    return result;
  } catch (error) {
    console.error('[database] Query failed:', error.message);
    console.error('[database] Query:', query);
    console.error('[database] Params:', params);
    throw error;
  }
}

// 安全的数据库事务包装
export async function safeTransaction(callback) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[database] Transaction failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}
