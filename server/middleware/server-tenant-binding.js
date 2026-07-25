import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'tenant-binding' });

export async function verifyServerTenantBinding(pool, req, { tenantId, storeId } = {}) {
  const tid = String(tenantId || '').trim() || 'default';
  const sid = String(storeId || '').trim();
  const serverCode = String(req.headers['x-server-code'] || '').trim();
  const signed = Boolean(req.headers['x-signature'] || req.headers['x-request-id'] || req.headers['x-timestamp']);

  // Legacy traffic is retained only for the platform default tenant. Any named
  // tenant must arrive through a server identity with an active DB binding.
  if (tid === 'default' && !signed && !serverCode) return { ok: true, legacy: true };
  if (!serverCode) return { ok: false, status: 403, error: 'server_code_required' };
  if (!sid) return { ok: false, status: 400, error: 'store_id_required' };

  try {
    const result = await pool.query(
      `SELECT 1 FROM server_tenant_bindings
        WHERE server_code = $1 AND tenant_id = $2 AND status = 'active'
        LIMIT 1`,
      [serverCode, tid]
    );
    if (!result.rows.length) return { ok: false, status: 403, error: 'server_tenant_binding_inactive' };
    return { ok: true, serverCode, tenantId: tid, storeId: sid };
  } catch (error) {
    log.error({ msg: 'fail_closed', err: error?.message || String(error) });
    return { ok: false, status: 503, error: 'tenant_binding_unavailable' };
  }
}
