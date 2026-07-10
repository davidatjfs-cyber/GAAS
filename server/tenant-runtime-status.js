/**
 * Tenant login gate: status + license (TenantMode / LICENSE_ENFORCE aware).
 * Extracted from index.js for unit testing (phase F).
 */
import { isLicenseEnforced, isLicenseExemptTenant } from './safety.js';

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @returns {Promise<{
 *   exists: boolean,
 *   loginAllowed: boolean,
 *   reason?: string,
 *   status?: string,
 *   license?: object|null,
 *   licenseStatus?: string,
 *   expiresAt?: string|Date|null
 * }>}
 */
export async function loadTenantRuntimeStatus(pool, tenantId) {
  const id = String(tenantId || '').trim();
  const tenantR = await pool.query(
    'SELECT tenant_id, status FROM tenants WHERE tenant_id = $1 LIMIT 1',
    [id]
  );
  const tenant = tenantR.rows?.[0] || null;
  if (!tenant) {
    return { exists: false, loginAllowed: false, reason: 'tenant_not_found' };
  }

  const status = String(tenant.status || '').trim().toLowerCase();
  if (status !== 'active') {
    return { exists: true, loginAllowed: false, reason: 'tenant_inactive', status };
  }

  const licenseR = await pool.query(
    `SELECT status, expires_at
       FROM licenses
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [id]
  );
  const license = licenseR.rows?.[0] || null;
  if (license) {
    const licenseStatus = String(license.status || '').trim().toLowerCase();
    const expiresAt = license.expires_at ? new Date(license.expires_at) : null;
    if (licenseStatus && !['active', 'trial'].includes(licenseStatus)) {
      return { exists: true, loginAllowed: false, reason: 'license_inactive', status, licenseStatus };
    }
    if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return { exists: true, loginAllowed: false, reason: 'license_expired', status, expiresAt: license.expires_at };
    }
  } else if (isLicenseEnforced() && !isLicenseExemptTenant(id)) {
    return { exists: true, loginAllowed: false, reason: 'license_missing', status };
  }

  return { exists: true, loginAllowed: true, status, license };
}

/**
 * Public subscription summary for tenant admins (no license_key).
 */
export function summarizeLicenseForTenant(license, now = Date.now()) {
  if (!license) {
    return { has_license: false, status: null, expires_at: null, days_remaining: null, expired: false };
  }
  const status = String(license.status || '').trim().toLowerCase() || null;
  const expiresAt = license.expires_at ? new Date(license.expires_at) : null;
  const expired = !!(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() < now);
  let daysRemaining = null;
  if (expiresAt && Number.isFinite(expiresAt.getTime())) {
    daysRemaining = Math.ceil((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000));
  }
  return {
    has_license: true,
    status,
    expires_at: license.expires_at || null,
    days_remaining: daysRemaining,
    expired,
  };
}
