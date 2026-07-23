import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTenantRuntimeStatus, summarizeLicenseForTenant } from './tenant-runtime-status.js';

const OLD = { ...process.env };

function clearLicenseEnv() {
  delete process.env.TENANT_MODE;
  delete process.env.LICENSE_ENFORCE;
  delete process.env.LICENSE_ENFORCE_EXEMPT_TENANTS;
}

function mockPool({ tenant, license } = {}) {
  return {
    async query(sql, _params) {
      const s = String(sql);
      if (/FROM tenants/i.test(s)) {
        if (!tenant) return { rows: [] };
        return { rows: [tenant] };
      }
      if (/FROM licenses/i.test(s)) {
        if (!license) return { rows: [] };
        return { rows: [license] };
      }
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    },
  };
}

test.afterEach(() => {
  clearLicenseEnv();
  Object.assign(process.env, OLD);
});

test('tenant_not_found', async () => {
  clearLicenseEnv();
  const r = await loadTenantRuntimeStatus(mockPool({}), 'missing');
  assert.equal(r.loginAllowed, false);
  assert.equal(r.reason, 'tenant_not_found');
});

test('tenant_inactive', async () => {
  clearLicenseEnv();
  const r = await loadTenantRuntimeStatus(
    mockPool({ tenant: { tenant_id: 't1', status: 'provisioning' } }),
    't1'
  );
  assert.equal(r.loginAllowed, false);
  assert.equal(r.reason, 'tenant_inactive');
});

test('single mode: active tenant without license allowed', async () => {
  clearLicenseEnv();
  process.env.TENANT_MODE = 'single';
  const r = await loadTenantRuntimeStatus(
    mockPool({ tenant: { tenant_id: 'default', status: 'active' } }),
    'default'
  );
  assert.equal(r.loginAllowed, true);
});

test('multi enforce: license_missing blocks non-exempt', async () => {
  clearLicenseEnv();
  process.env.TENANT_MODE = 'multi';
  const r = await loadTenantRuntimeStatus(
    mockPool({ tenant: { tenant_id: 'cust_a', status: 'active' } }),
    'cust_a'
  );
  assert.equal(r.loginAllowed, false);
  assert.equal(r.reason, 'license_missing');
});

test('multi enforce: default exempt without license allowed', async () => {
  clearLicenseEnv();
  process.env.TENANT_MODE = 'multi';
  const r = await loadTenantRuntimeStatus(
    mockPool({ tenant: { tenant_id: 'default', status: 'active' } }),
    'default'
  );
  assert.equal(r.loginAllowed, true);
});

test('license_expired blocks', async () => {
  clearLicenseEnv();
  process.env.TENANT_MODE = 'single';
  const r = await loadTenantRuntimeStatus(
    mockPool({
      tenant: { tenant_id: 't1', status: 'active' },
      license: { status: 'active', expires_at: new Date(Date.now() - 86400000).toISOString() },
    }),
    't1'
  );
  assert.equal(r.loginAllowed, false);
  assert.equal(r.reason, 'license_expired');
});

test('license_inactive blocks', async () => {
  clearLicenseEnv();
  const r = await loadTenantRuntimeStatus(
    mockPool({
      tenant: { tenant_id: 't1', status: 'active' },
      license: { status: 'revoked', expires_at: null },
    }),
    't1'
  );
  assert.equal(r.loginAllowed, false);
  assert.equal(r.reason, 'license_inactive');
});

test('active trial license allows', async () => {
  clearLicenseEnv();
  process.env.TENANT_MODE = 'multi';
  const r = await loadTenantRuntimeStatus(
    mockPool({
      tenant: { tenant_id: 'cust_a', status: 'active' },
      license: { status: 'trial', expires_at: new Date(Date.now() + 86400000 * 10).toISOString() },
    }),
    'cust_a'
  );
  assert.equal(r.loginAllowed, true);
});

test('summarizeLicenseForTenant hides key and computes days', () => {
  const now = Date.UTC(2026, 6, 10);
  const s = summarizeLicenseForTenant(
    { status: 'active', expires_at: new Date(Date.UTC(2026, 6, 20)).toISOString() },
    now
  );
  assert.equal(s.has_license, true);
  assert.equal(s.days_remaining, 10);
  assert.equal(s.expired, false);
  assert.equal(s.license_key, undefined);
});
