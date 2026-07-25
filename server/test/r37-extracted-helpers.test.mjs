/**
 * R37：冲高 tenant helpers / agent-records / menu-health 等覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  platformAdminHtmlPath,
  agentsAdminHtmlPath,
  billingFontRegularPath,
  billingFontBoldPath,
  requireTenantIntegrationKey,
  getTenantPlatformAcceptanceReport,
  saveTenantPlatformAcceptanceReport,
  runTenantAcceptance,
  buildTenantLoginUrl,
  getTenantPrimaryAdminUsername,
  buildTenantLoginAccess,
} from '../domains/tenant-platform/helpers.js';
import {
  clampLimit,
  isStoreScopedRole,
  isRecordsAdminRole,
  listAgentIssues,
  listAgentScores,
  listVisualAudits,
  listAppeals,
  listAgentMessages,
  listFeishuUsers,
  listMyNotifications,
  getMyAgentScore,
  shanghaiCalendarYm,
  parseBreakdownObject,
} from '../domains/agent-records/service.js';
import {
  safeMonthOnly,
  listMenuHealthReports,
  getMenuHealthReportsByMonth,
  generateMenuHealthReport,
} from '../domains/growth-menu-health/service.js';

test('tenant-platform/helpers：路径 / acceptance / acceptance-run / login', async () => {
  assert.ok(platformAdminHtmlPath().endsWith('platform-admin.html'));
  assert.ok(agentsAdminHtmlPath().endsWith('agents-admin.html'));
  assert.ok(billingFontRegularPath().includes('NotoSansSC-Regular'));
  assert.ok(billingFontBoldPath().includes('NotoSansSC-Bold'));
  assert.throws(() => requireTenantIntegrationKey(''), (e) => e.statusCode === 500);
  assert.equal(requireTenantIntegrationKey('k'), 'k');

  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/platform_acceptance_report/.test(sql) && /SELECT/.test(sql)) {
        return { rows: [{ config_value: { ok: true } }] };
      }
      if (/FROM tenants/.test(sql)) {
        return { rows: [{ tenant_id: 't1', name: '甲', mode: 'std', status: 'active' }] };
      }
      if (/FROM hrms_state/.test(sql)) return { rows: [{ '?column?': 1 }] };
      if (/FROM users/.test(sql) && /COUNT/.test(sql)) return { rows: [{ count: 1 }] };
      if (/FROM licenses/.test(sql)) return { rows: [] };
      if (/FROM users/.test(sql) && /username/.test(sql)) return { rows: [{ username: 'admin1' }] };
      return { rows: [] };
    },
  };
  assert.deepEqual(await getTenantPlatformAcceptanceReport(db, 't1'), { ok: true });
  await saveTenantPlatformAcceptanceReport(db, 't1', { a: 1 });
  assert.ok(calls.some((c) => /INSERT INTO tenant_config/.test(c.sql)));

  const acc = await runTenantAcceptance(db, 't1', {
    tenantIntegrationEncryptionKey: '',
    requiredTenantFeishuTableKeys: [],
  });
  assert.equal(acc.ok, false);
  assert.ok(acc.checks.some((c) => c.key === 'license_present' && c.ok === false));

  const notFound = await runTenantAcceptance(
    {
      async query() {
        return { rows: [] };
      },
    },
    'missing',
    { tenantIntegrationEncryptionKey: '', requiredTenantFeishuTableKeys: [] }
  );
  assert.equal(notFound.ok, false);

  const url = buildTenantLoginUrl(
    { get: () => 'https', protocol: 'http', getHeader: () => null, headers: { host: 'example.com' } },
    't1'
  );
  // req.get may be used - ensure function exists
  const url2 = buildTenantLoginUrl(
    {
      get(h) {
        if (h === 'x-forwarded-proto') return 'https';
        if (h === 'host') return 'ex.com';
        return '';
      },
      protocol: 'http',
      headers: { host: 'ex.com' },
    },
    'tid'
  );
  assert.match(url2, /tid/);
  void url;

  assert.equal(await getTenantPrimaryAdminUsername(db, 't1'), 'admin1');
  const access = await buildTenantLoginAccess(db, {
    get(h) {
      if (h === 'host') return 'ex.com';
      return '';
    },
    protocol: 'https',
    headers: { host: 'ex.com' },
  }, 't1', { password: 'p' });
  assert.ok(access.login_url);
  assert.equal(access.username, 'admin1');
});

test('agent-records：list* + notifications + score fallback', async () => {
  assert.equal(clampLimit('x'), 50);
  assert.equal(isStoreScopedRole('store_manager'), true);
  assert.equal(isRecordsAdminRole('hq_manager'), true);
  assert.equal(shanghaiCalendarYm(new Date('2026-07-15T04:00:00Z')), '2026-07');
  assert.deepEqual(parseBreakdownObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseBreakdownObject(null), {});

  const pool = {
    async query(sql, params) {
      if (/hrms_user_notifications/.test(sql)) {
        if (params?.[0] === 'boom') {
          throw new Error('relation "hrms_user_notifications" does not exist');
        }
        return { rows: [{ id: 1 }] };
      }
      return { rows: [{ id: 1 }] };
    },
  };
  const opts = { role: 'admin', username: 'a', tenantId: 'default', limit: 5 };
  assert.equal((await listAgentIssues(pool, opts)).length, 1);
  assert.equal((await listAgentScores(pool, opts)).length, 1);
  assert.equal((await listVisualAudits(pool, opts)).length, 1);
  assert.equal((await listAppeals(pool, opts)).length, 1);
  assert.equal((await listFeishuUsers(pool)).length, 1);
  assert.equal((await listAgentMessages(pool, { role: 'admin', tenantId: 'default' })).length, 1);
  assert.equal((await listAgentMessages(pool, { role: 'store_employee', username: 'u' })).length, 1);

  assert.equal((await listMyNotifications(pool, '')).status, 400);
  assert.equal((await listMyNotifications(pool, 'u')).items.length, 1);
  assert.deepEqual((await listMyNotifications(pool, 'boom')).items, []);

  const scorePool = {
    async query(sql) {
      if (/FROM feishu_users/.test(sql)) throw new Error('x');
      if (/FROM employee_scores/.test(sql)) return { rows: [{ store: '洪潮店', total_score: 1 }] };
      if (/FROM agent_scores/.test(sql)) {
        return { rows: [{ breakdown: '{}', total_score: 2, store: '洪潮店' }] };
      }
      return { rows: [] };
    },
  };
  let calc = 0;
  let fetches = 0;
  const r2 = await getMyAgentScore(scorePool, {
    username: 'alice',
    now: new Date('2026-07-15T04:00:00Z'),
    getSharedState: async () => ({}),
    inferBrandFromStoreName: () => '洪潮',
    fetchStoreRatingForProfileDisplay: async () => {
      fetches += 1;
      return fetches === 1
        ? { rating: null, period: '2026-06', isFallback: false }
        : { rating: 'A', period: '2026-06', isFallback: true };
    },
    calculateStoreRating: async () => {
      calc += 1;
    },
  });
  assert.equal(r2.ok, true);
  assert.equal(calc, 1);
  assert.equal(r2.body.store_rating, 'A');
});

test('growth-menu-health：list/get/generate', async () => {
  assert.equal(safeMonthOnly('2026-07'), '2026-07');
  assert.equal(safeMonthOnly('bad'), '');

  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/WITH cur AS/.test(sql)) {
        return {
          rows: [
            {
              dish_name: 'A',
              category: '主菜',
              qty: 20,
              revenue: 1000,
              avg_price: 50,
              prev_qty: 10,
              prev_revenue: 500,
              total_rev: 1500,
              revenue_share_pct: 66,
              qty_mom_pct: 100,
              rev_mom_pct: 100,
            },
            {
              dish_name: 'B',
              category: '汤',
              qty: 5,
              revenue: 500,
              avg_price: 100,
              prev_qty: 20,
              prev_revenue: 800,
              total_rev: 1500,
              revenue_share_pct: 33,
              qty_mom_pct: -75,
              rev_mom_pct: -37,
            },
          ],
        };
      }
      if (/INSERT INTO growth_menu_health_reports/.test(sql)) {
        return { rows: [{ id: 9, report_month: params[0] }] };
      }
      return { rows: [{ id: 1 }] };
    },
  };
  assert.equal((await listMenuHealthReports(pool, { storeCode: 's', reportMonth: '2026-07' })).length, 1);
  assert.equal((await getMenuHealthReportsByMonth(pool, '2026-07', 's')).length, 1);
  const gen = await generateMenuHealthReport(pool, 's1', '2026-07', 'default');
  assert.equal(gen.id, 9);
  assert.ok(calls.some((c) => /WITH cur AS/.test(c.sql)));
});
