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

  if (!TENANT_ID_RE.test(trimmed)) {
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
