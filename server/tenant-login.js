import { SYSTEM_TENANT_ID } from './utils/database.js';

const TENANT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Reads an explicitly-supplied tenant id off a login request (body or header).
 * Returns null when the client didn't send one — callers should then resolve
 * the tenant by looking up the username, since a single shared login domain
 * (no per-tenant subdomain/path) has no other way to know which tenant a
 * request belongs to.
 */
export function resolveExplicitTenantId(req = {}) {
  const raw = req?.body?.tenant_id ?? req?.body?.tenantId
    ?? req?.headers?.['x-tenant-id'] ?? req?.headers?.['X-Tenant-Id'];
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // '__system__' 是内部专用哨兵值(见 utils/database.js runWithSystemTenantContext)，
  // 用来让内部代码在没有真实租户身份的场景下绕过部分表的RLS(如系统级批处理、
  // 跨租户查找)。这个值只应该由服务端代码在AsyncLocalStorage里设置，绝不能
  // 接受客户端声称"我是系统身份"——否则配合RLS里对'__system__'的例外策略，
  // 客户端能直接越权读写本该跨租户隔离的表(如 users/tenant_integrations)。
  if (!TENANT_ID_RE.test(trimmed) || trimmed === SYSTEM_TENANT_ID) {
    const error = new Error('invalid_tenant_id');
    error.code = 'invalid_tenant_id';
    throw error;
  }
  return trimmed;
}

export function createEmptyTenantState({ tenantId, tenantName, adminUsername, adminName }) {
  return {
    tenant: {
      tenantId,
      name: tenantName,
      initializedAt: new Date().toISOString(),
    },
    employees: adminUsername ? [{
      username: adminUsername,
      name: adminName || adminUsername,
      role: 'admin',
      status: 'active',
      store: '',
    }] : [],
    users: [],
    stores: [],
    brands: [],
  };
}
