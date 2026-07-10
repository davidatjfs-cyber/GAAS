/**
 * Tenant-facing subscription / branding helpers (phase G).
 * Kept out of index.js monolith (phase H).
 */
import { summarizeLicenseForTenant } from './tenant-runtime-status.js';

/**
 * @param {import('express').Express} app
 * @param {{ pool: import('pg').Pool, authRequired: Function }} deps
 */
export function registerTenantSubscriptionRoutes(app, { pool, authRequired }) {
  app.get('/api/tenant/subscription', authRequired, async (req, res) => {
    try {
      const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
      const tenantR = await pool.query(
        `SELECT tenant_id, name, status, mode FROM tenants WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
      const tenant = tenantR.rows?.[0] || null;
      if (!tenant) {
        return res.status(404).json({ error: 'tenant_not_found' });
      }
      const licenseR = await pool.query(
        `SELECT status, expires_at
           FROM licenses
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [tenantId]
      );
      const license = licenseR.rows?.[0] || null;
      return res.json({
        ok: true,
        tenant_id: tenant.tenant_id,
        tenant_status: tenant.status,
        mode: tenant.mode,
        license: summarizeLicenseForTenant(license),
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });
}
