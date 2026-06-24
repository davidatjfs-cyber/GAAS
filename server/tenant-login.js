const TENANT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Resolves an unauthenticated login to one tenant before identity data is read.
 * Legacy clients without a tenant id stay on the existing production tenant.
 */
export function resolveLoginTenantId(req = {}) {
  const raw = String(
    req?.body?.tenant_id
      ?? req?.body?.tenantId
      ?? req?.headers?.['x-tenant-id']
      ?? req?.headers?.['X-Tenant-Id']
      ?? 'default'
  ).trim() || 'default';

  if (!TENANT_ID_RE.test(raw)) {
    const error = new Error('invalid_tenant_id');
    error.code = 'invalid_tenant_id';
    throw error;
  }
  return raw;
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
