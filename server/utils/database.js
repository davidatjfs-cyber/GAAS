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
export function resolveTenantIdDefault(tenantId) {
  return String(tenantId || tenantContext.getStore() || 'default').trim() || 'default';
}

let _pool = null;
export function setPool(p) { _pool = p; }
export function pool() { 
  if (!_pool) throw new Error('database: pool not set'); 
  return _pool; 
}

// 多租户后台任务用：取所有激活租户的tenant_id列表。
// 查询失败时兜底返回['default']而不是空数组——避免数据库瞬时抖动导致某次tick
// 一个租户都不处理；这样最差情况下退化为"只处理default"，即改造前的行为，不会更差。
const ACTIVE_TENANTS_CACHE_MS = 60 * 1000;
let _activeTenantIds = ['default'];
let _activeTenantIdsLoadedAt = 0;
export async function getActiveTenantIds(p) {
  if (Date.now() - _activeTenantIdsLoadedAt < ACTIVE_TENANTS_CACHE_MS) return _activeTenantIds;
  try {
    const r = await (p || pool()).query("SELECT tenant_id FROM tenants WHERE status = 'active' ORDER BY tenant_id");
    if (r.rows?.length) {
      _activeTenantIds = r.rows.map((row) => row.tenant_id);
      _activeTenantIdsLoadedAt = Date.now();
    }
  } catch (e) {
    console.error('[database] getActiveTenantIds failed, fallback to previous/[default]:', e?.message || e);
  }
  return _activeTenantIds;
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
