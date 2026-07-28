/**
 * L1：租户告警 / 登录入口 / 验收纯路径（mock pool）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTenantAlerts,
  buildTenantLoginAccess,
  buildTenantLoginUrl,
  getTenantPrimaryAdminUsername,
  runTenantAcceptance,
} from '../helpers.js';

function mockReq({ host = 'nnyx.cc', proto = 'https' } = {}) {
  return {
    protocol: 'http',
    get(name) {
      const k = String(name || '').toLowerCase();
      if (k === 'x-forwarded-proto') return proto;
      if (k === 'x-forwarded-host' || k === 'host') return host;
      return undefined;
    },
  };
}

test('buildTenantAlerts: 缺许可证 / 飞书 / 品牌 / 未激活', () => {
  const alerts = buildTenantAlerts(
    { status: 'suspended' },
    null,
    { system_name: '' },
    { configured: false }
  );
  const keys = alerts.map((a) => a.key);
  assert.ok(keys.includes('license_missing'));
  assert.ok(keys.includes('feishu_missing'));
  assert.ok(keys.includes('branding_missing'));
  assert.ok(keys.includes('tenant_inactive'));
});

test('buildTenantAlerts: 许可证临近到期与已过期', () => {
  const soon = new Date(Date.now() + 5 * 86400000).toISOString();
  const warn = buildTenantAlerts(
    { status: 'active' },
    { license_expires_at: soon },
    { system_name: '洪潮' },
    { configured: true }
  );
  assert.equal(warn.find((a) => a.key === 'license_expiring')?.level, 'warn');

  const past = new Date(Date.now() - 2 * 86400000).toISOString();
  const err = buildTenantAlerts(
    { status: 'active' },
    { expires_at: past },
    { system_name: '洪潮' },
    { configured: true }
  );
  assert.equal(err.find((a) => a.key === 'license_expiring')?.level, 'error');
});

test('buildTenantLoginUrl / buildTenantLoginAccess', async () => {
  assert.equal(
    buildTenantLoginUrl(mockReq({ host: '' }), 't1'),
    '/working-fixed.html?tenant_id=t1'
  );
  assert.equal(
    buildTenantLoginUrl(mockReq({ host: 'a.example', proto: 'https' }), 't2'),
    'https://a.example/working-fixed.html?tenant_id=t2'
  );

  const pool = {
    query: async () => ({ rows: [{ username: 'admin_t' }] }),
  };
  const withPw = await buildTenantLoginAccess(pool, mockReq(), 'tenant-x', { password: 'secret' });
  assert.equal(withPw.username, 'admin_t');
  assert.equal(withPw.password, 'secret');
  assert.match(withPw.login_url, /tenant_id=tenant-x/);

  const hint = await buildTenantLoginAccess(pool, mockReq(), 'tenant-x', {});
  assert.ok(hint.password_hint);
  assert.match(hint.password_hint, /重置管理员密码/);
  assert.equal(hint.password, undefined);

  assert.equal(await getTenantPrimaryAdminUsername({ query: async () => ({ rows: [] }) }, 'x'), '');
});

test('generateTenantAdminTempPassword / resetTenantAdminPassword', async () => {
  const { generateTenantAdminTempPassword, resetTenantAdminPassword } = await import('../helpers.js');
  const pw = generateTenantAdminTempPassword();
  assert.match(pw, /^Gaas[a-f0-9]+!$/);
  assert.ok(pw.length >= 8);

  const missing = await resetTenantAdminPassword(
    { query: async () => ({ rows: [] }) },
    't-missing'
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'admin_not_found');

  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT username FROM users/i.test(sql)) return { rows: [{ username: 'admin1' }] };
      if (/UPDATE users/i.test(sql)) return { rows: [{ username: 'admin1', real_name: '管理员' }] };
      return { rows: [] };
    },
  };
  const ok = await resetTenantAdminPassword(pool, 'tenant-a', { password: 'ResetPass9' });
  assert.equal(ok.ok, true);
  assert.equal(ok.username, 'admin1');
  assert.equal(ok.temp_password, 'ResetPass9');
  assert.ok(calls.some((c) => /UPDATE users/i.test(c.sql)));
});

test('runTenantAcceptance: tenant 不存在；基础 checks', async () => {
  const missing = await runTenantAcceptance(
    { query: async () => ({ rows: [] }) },
    'nope',
    { tenantIntegrationEncryptionKey: '', requiredTenantFeishuTableKeys: [] }
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.checks[0].key, 'tenant_exists');

  const calls = [];
  const pool = {
    query: async (sql, _params) => {
      calls.push(sql);
      if (sql.includes('FROM tenants')) {
        return { rows: [{ tenant_id: 't1', name: '甲', mode: 'demo', status: 'active' }] };
      }
      if (sql.includes('FROM hrms_state')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM users')) return { rows: [{ count: 1 }] };
      if (sql.includes('FROM licenses')) {
        return { rows: [{ status: 'active', expires_at: null }] };
      }
      return { rows: [] };
    },
  };
  const ok = await runTenantAcceptance(pool, 't1', {
    tenantIntegrationEncryptionKey: '',
    requiredTenantFeishuTableKeys: ['employees'],
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.checks.some((c) => c.key === 'state_seeded' && c.ok));
  assert.ok(ok.checks.some((c) => c.key === 'admin_ready' && c.ok));
  assert.ok(ok.checks.some((c) => c.key === 'license_present' && c.ok));
  assert.ok(calls.some((s) => s.includes('FROM tenants')));
});
