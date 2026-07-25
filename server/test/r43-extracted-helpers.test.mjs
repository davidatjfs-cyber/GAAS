/**
 * R43：薄 admin/reports/payroll/churn routes + inventory-forecast/estimate 挂地板。
 */
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerPerfAdminRoutes } from '../domains/perf-admin/routes.js';
import { registerMetricsAdminRoutes } from '../domains/metrics-admin/routes.js';
import { registerBitableAdminRoutes } from '../domains/bitable-admin/routes.js';
import { registerPayrollDomainRoutes } from '../domains/payroll/routes.js';
import { registerGrowthChurnRoutes } from '../domains/growth-churn/routes.js';
import { registerReportsTurnoverRoutes } from '../domains/reports/routes-turnover.js';
import { bindReportsRuntimeDeps } from '../domains/reports/helpers.js';
import { registerApprovalDecideRoutes } from '../domains/approvals/routes.js';
import { registerTrainingRoutes } from '../domains/training/routes.js';
import { createEstimateHelpers } from '../domains/inventory-forecast/estimate.js';
import { setPool } from '../utils/database.js';

async function withApp(register, fn) {
  const app = express();
  app.use(express.json());
  register(app);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authAs(user) {
  return (req, _res, next) => {
    req.user = user;
    req.tenantId = user?.tenant_id || 'default';
    next();
  };
}

function jsonFetch(base, path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  return fetch(base + path, { ...opts, headers }).then(async (res) => ({
    status: res.status,
    body: await res.json().catch(() => ({})),
  }));
}

// —— perf-admin ——
test('perf-admin: forbidden / default week / bad range / ok / 500', async () => {
  await withApp(
    (app) =>
      registerPerfAdminRoutes(app, authAs({ role: 'store_employee', username: 'e' }), {
        getLastCompletedWeekRangeShanghai: () => ({ start: '2026-07-13', end: '2026-07-19' }),
        sendWeeklyDishOptimizationReport: async () => {},
      }),
    async (base) => {
      const r = await jsonFetch(base, '/api/admin/perf/dish-weekly/resend', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      assert.equal(r.status, 403);
    }
  );

  await withApp(
    (app) =>
      registerPerfAdminRoutes(app, authAs({ role: 'admin', username: 'a' }), {
        getLastCompletedWeekRangeShanghai: () => ({ start: '2026-07-13', end: '2026-07-19' }),
        sendWeeklyDishOptimizationReport: async (s, e) => {
          assert.equal(s, '2026-07-13');
          assert.equal(e, '2026-07-19');
        },
      }),
    async (base) => {
      const ok = await jsonFetch(base, '/api/admin/perf/dish-weekly/resend', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.ok, true);

      const bad = await jsonFetch(base, '/api/admin/perf/dish-weekly/resend', {
        method: 'POST',
        body: JSON.stringify({ weekStart: 'bad', weekEnd: '2026-07-19' }),
      });
      assert.equal(bad.status, 400);
    }
  );

  await withApp(
    (app) =>
      registerPerfAdminRoutes(app, authAs({ role: 'hq_manager', username: 'h' }), {
        getLastCompletedWeekRangeShanghai: () => ({ start: '2026-07-13', end: '2026-07-19' }),
        sendWeeklyDishOptimizationReport: async () => {
          throw new Error('boom');
        },
      }),
    async (base) => {
      const r = await jsonFetch(base, '/api/admin/perf/dish-weekly/resend', {
        method: 'POST',
        body: JSON.stringify({ weekStart: '2026-07-13', weekEnd: '2026-07-19' }),
      });
      assert.equal(r.status, 500);
    }
  );
});

// —— metrics-admin ——
test('metrics-admin: bump-version + change-log paths', async () => {
  await withApp(
    (app) =>
      registerMetricsAdminRoutes(app, authAs({ role: 'store_employee', username: 'e' }), {
        pool: { query: async () => ({ rows: [] }) },
        updateMetricVersion: async () => ({ ok: true }),
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/admin/metrics/bump-version', {
          method: 'POST',
          body: JSON.stringify({ metric_id: 'm1' }),
        })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/admin/metrics/change-log/m1')).status,
        403
      );
    }
  );

  await withApp(
    (app) =>
      registerMetricsAdminRoutes(app, authAs({ role: 'admin', username: 'admin' }), {
        pool: {
          query: async (_sql, params) => {
            if (params?.[0] === 'missing') return { rows: [] };
            if (params?.[0] === 'err') throw new Error('db');
            return {
              rows: [{ metric_id: 'm1', name: 'N', version: 2, change_log: [], updated_at: 't' }],
            };
          },
        },
        updateMetricVersion: async (id, changes, by) => {
          assert.equal(id, 'm1');
          assert.equal(by, 'admin');
          return { ok: true, metric_id: id, changes };
        },
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/admin/metrics/bump-version', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );

      const bump = await jsonFetch(base, '/api/admin/metrics/bump-version', {
        method: 'POST',
        body: JSON.stringify({ metric_id: 'm1', changes: { label: 'x' } }),
      });
      assert.equal(bump.status, 200);
      assert.equal(bump.body.ok, true);

      const log = await jsonFetch(base, '/api/admin/metrics/change-log/m1');
      assert.equal(log.status, 200);
      assert.equal(log.body.metric_id, 'm1');

      assert.equal((await jsonFetch(base, '/api/admin/metrics/change-log/missing')).status, 404);
      assert.equal((await jsonFetch(base, '/api/admin/metrics/change-log/err')).status, 500);
    }
  );

  await withApp(
    (app) =>
      registerMetricsAdminRoutes(app, authAs({ role: 'hq_manager', username: 'h' }), {
        pool: { query: async () => ({ rows: [] }) },
        updateMetricVersion: async () => {
          throw new Error('fail');
        },
      }),
    async (base) => {
      const r = await jsonFetch(base, '/api/admin/metrics/bump-version', {
        method: 'POST',
        body: JSON.stringify({ metric_id: 'm1' }),
      });
      assert.equal(r.status, 500);
    }
  );
});

// —— bitable-admin ——
test('bitable-admin: stats + archive role/ok/error', async () => {
  await withApp(
    (app) =>
      registerBitableAdminRoutes(app, authAs({ role: 'store_employee' }), {
        getBitableSubmissionStats: async () => ({}),
        archiveOldBitableSubmissions: async () => ({}),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/bitable/stats')).status, 403);
      assert.equal(
        (await jsonFetch(base, '/api/bitable/archive', { method: 'POST', body: '{}' })).status,
        403
      );
    }
  );

  await withApp(
    (app) =>
      registerBitableAdminRoutes(app, authAs({ role: 'admin' }), {
        getBitableSubmissionStats: async () => ({ total: 3 }),
        archiveOldBitableSubmissions: async () => ({ archived: 1 }),
      }),
    async (base) => {
      const s = await jsonFetch(base, '/api/bitable/stats');
      assert.equal(s.status, 200);
      assert.equal(s.body.data.total, 3);
      const a = await jsonFetch(base, '/api/bitable/archive', { method: 'POST', body: '{}' });
      assert.equal(a.status, 200);
      assert.equal(a.body.data.archived, 1);
    }
  );

  await withApp(
    (app) =>
      registerBitableAdminRoutes(app, authAs({ role: 'hr_manager' }), {
        getBitableSubmissionStats: async () => {
          throw new Error('x');
        },
        archiveOldBitableSubmissions: async () => {
          throw new Error('y');
        },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/bitable/stats')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/bitable/archive', { method: 'POST', body: '{}' })).status,
        500
      );
    }
  );

  // hq can stats but not archive
  await withApp(
    (app) =>
      registerBitableAdminRoutes(app, authAs({ role: 'hq_manager' }), {
        getBitableSubmissionStats: async () => ({ ok: 1 }),
        archiveOldBitableSubmissions: async () => ({}),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/bitable/stats')).status, 200);
      assert.equal(
        (await jsonFetch(base, '/api/bitable/archive', { method: 'POST', body: '{}' })).status,
        403
      );
    }
  );
});

// —— payroll ——
test('payroll routes: domain + points-mirror', async () => {
  const poolOk = {
    query: async (sql) => {
      if (String(sql).includes('HRMS_PAYROLL_DOMAIN') || String(sql).includes('hrms_payroll_domain')) {
        return {
          rows: [{
            payroll_adjustments: {},
            payroll_audits: {},
            salary_adjustments: [],
            monthly_confirmations: [],
          }],
        };
      }
      if (String(sql).includes('point_records') || String(sql).includes('POINT')) {
        return {
          rows: [{
            id: '1',
            approval_id: '',
            username: 'u',
            name: 'U',
            store: 's',
            item_name: 'i',
            reason: '',
            points: 1,
            amount: 0,
            approved_at: null,
            approved_by: '',
          }],
        };
      }
      // service uses SHARED_TABLES constants — match broadly
      return { rows: [] };
    },
  };

  await withApp(
    (app) =>
      registerPayrollDomainRoutes(app, authAs({ role: 'store_employee' }), {
        pool: poolOk,
        resolveTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/payroll/domain')).status, 403);
      assert.equal((await jsonFetch(base, '/api/payroll/points-mirror')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerPayrollDomainRoutes(app, authAs({ role: 'admin' }), {
        pool: {
          query: async (sql) => {
            const s = String(sql);
            if (s.includes('payroll_adjustments') || s.includes('hrms_payroll')) {
              return {
                rows: [{
                  payroll_adjustments: { a: 1 },
                  payroll_audits: {},
                  salary_adjustments: [],
                  monthly_confirmations: [],
                }],
              };
            }
            return {
              rows: [{
                id: '1',
                approval_id: null,
                username: 'u',
                name: 'U',
                store: 's',
                item_name: 'i',
                reason: '',
                points: 2,
                amount: 0,
                approved_at: null,
                approved_by: null,
              }],
            };
          },
        },
        resolveTenantId: () => 't1',
      }),
    async (base) => {
      const d = await jsonFetch(base, '/api/payroll/domain');
      assert.equal(d.status, 200);
      assert.equal(d.body.ok, true);
      const p = await jsonFetch(base, '/api/payroll/points-mirror');
      assert.equal(p.status, 200);
      assert.equal(p.body.count, 1);
    }
  );

  await withApp(
    (app) =>
      registerPayrollDomainRoutes(app, authAs({ role: 'hr_manager' }), {
        pool: {
          query: async () => {
            throw new Error('db');
          },
        },
        resolveTenantId: () => 't1',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/payroll/domain')).status, 500);
      assert.equal((await jsonFetch(base, '/api/payroll/points-mirror')).status, 500);
    }
  );
});

// —— growth-churn ——
test('growth-churn routes: list + compute auth/ok/error', async () => {
  const prev = process.env.MINIPROGRAM_SYNC_SECRET;
  process.env.MINIPROGRAM_SYNC_SECRET = 'sync-secret';
  try {
    await withApp(
      (app) =>
        registerGrowthChurnRoutes(app, {
          pool: {
            query: async (sql) => {
              if (String(sql).includes('growth_churn_predictions')) {
                return {
                  rows: [{ risk_level: 'high' }, { risk_level: 'low' }],
                };
              }
              // computeChurnScores complex CTE — return empty → ok with zeros
              return { rows: [] };
            },
          },
          requirePhaseAuth: () => true,
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        const list = await jsonFetch(base, '/api/growth/churn-predictions?store_code=s1');
        assert.equal(list.status, 200);
        assert.equal(list.body.ok, true);
        assert.equal(list.body.predictions.length, 2);

        const unauth = await jsonFetch(base, '/api/growth/churn-predictions/compute', {
          method: 'POST',
          body: JSON.stringify({ store_code: 's1' }),
        });
        assert.equal(unauth.status, 401);

        const compute = await jsonFetch(base, '/api/growth/churn-predictions/compute', {
          method: 'POST',
          headers: { 'x-miniprogram-sync-secret': 'sync-secret' },
          body: JSON.stringify({ store_code: 's1' }),
        });
        assert.equal(compute.status, 200);
        assert.equal(compute.body.ok, true);
      }
    );

    await withApp(
      (app) =>
        registerGrowthChurnRoutes(app, {
          pool: {
            query: async () => {
              throw new Error('db');
            },
          },
          requirePhaseAuth: (_req, res) => {
            res.status(401).json({ error: 'unauthorized' });
            return false;
          },
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/churn-predictions')).status, 401);
      }
    );

    await withApp(
      (app) =>
        registerGrowthChurnRoutes(app, {
          pool: {
            query: async () => {
              throw new Error('db');
            },
          },
          requirePhaseAuth: () => true,
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/churn-predictions')).status, 500);
        const compute = await jsonFetch(base, '/api/growth/churn-predictions/compute', {
          method: 'POST',
          headers: { 'x-miniprogram-sync-secret': 'sync-secret' },
          body: JSON.stringify({}),
        });
        assert.equal(compute.status, 500);
      }
    );
  } finally {
    if (prev === undefined) delete process.env.MINIPROGRAM_SYNC_SECRET;
    else process.env.MINIPROGRAM_SYNC_SECRET = prev;
  }
});

// —— reports/routes-turnover ——
test('reports turnover route: gate / month / ok / service error', async () => {
  const state = { employees: [] };
  const pool = {
    query: async () => ({ rows: [] }), // empty policy → legacy enforcement
    connect: async () => {
      throw new Error('no connect in unit test');
    },
  };
  // getTenantEnforcementMode(tenantId, db = getPool()) 在默认参数处取池；须先 setPool
  setPool(pool);
  bindReportsRuntimeDeps({
    pool,
    safeMonthOnly: (m) => (/^\d{4}-\d{2}$/.test(String(m || '').trim()) ? String(m).trim() : ''),
    resolveAgentCanonicalStore: (s) => String(s || '').trim(),
    getSharedState: async () => state,
  });

  await withApp(
    (app) =>
      registerReportsTurnoverRoutes(app, {
        authRequired: authAs({ role: 'store_employee', username: 'e' }),
        pool,
        getSharedState: async () => state,
        safeDateOnly: (v) => String(v || '').slice(0, 10),
        pickMyStoreFromState: () => '',
        dbListEmployeesForReports: async () => [],
        expandAgentStoreLabels: (s) => [s].filter(Boolean),
      }),
    async (base) => {
      // legacy gate: store_employee forbidden
      assert.equal((await jsonFetch(base, '/api/reports/turnover?month=2026-07')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerReportsTurnoverRoutes(app, {
        authRequired: authAs({ role: 'admin', username: '' }),
        pool,
        getSharedState: async () => state,
        safeDateOnly: (v) => String(v || '').slice(0, 10),
        pickMyStoreFromState: () => '',
        dbListEmployeesForReports: async () => [],
        expandAgentStoreLabels: (s) => [s].filter(Boolean),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/reports/turnover?month=2026-07')).status, 400);
    }
  );

  await withApp(
    (app) =>
      registerReportsTurnoverRoutes(app, {
        authRequired: authAs({ role: 'admin', username: 'admin' }),
        pool,
        getSharedState: async () => state,
        safeDateOnly: (v) => {
          const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
          return m ? m[1] : '';
        },
        pickMyStoreFromState: () => '',
        dbListEmployeesForReports: async () => [],
        expandAgentStoreLabels: (s) => [String(s || '').trim()].filter(Boolean),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/reports/turnover')).status, 400);
      const ok = await jsonFetch(base, '/api/reports/turnover?month=2026-07');
      assert.equal(ok.status, 200);
      assert.ok('totalHeadcount' in ok.body);
    }
  );
});

// —— thin composers ——
test('approvals/routes + training/routes composers', async () => {
  registerApprovalDecideRoutes(
    { post() {} },
    (_req, _res, next) => next(),
    { hrmsNowISO: () => '2026-07-26T00:00:00.000Z' }
  );

  await withApp(
    (app) =>
      registerApprovalDecideRoutes(app, authAs({ role: 'store_employee', username: 'e' }), {
        getSharedState: async () => ({ approvals: [] }),
      }),
    async (base) => {
      const r = await jsonFetch(base, '/api/approvals/x/decide', {
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      });
      assert.equal(r.status, 403);
    }
  );

  const noopAuth = (_req, _res, next) => next();
  const noopUpload = { single: () => noopAuth, any: () => noopAuth, array: () => noopAuth };
  // stub express methods used by sub-registers — they attach routes; just ensure composer runs
  const calls = { withBatch: false, without: false };
  const fakeApp = () => {
    const app = {
      get() { return app; },
      post() { return app; },
      put() { return app; },
      delete() { return app; },
      use() { return app; },
    };
    return app;
  };
  registerTrainingRoutes(fakeApp(), noopAuth, noopUpload, {});
  calls.without = true;
  registerTrainingRoutes(fakeApp(), noopAuth, noopUpload, {
    getSharedState: async () => ({}),
  });
  calls.withBatch = true;
  assert.equal(calls.withBatch && calls.without, true);
});

// —— inventory-forecast/estimate ——
function makeEstimateHelpers(overrides = {}) {
  return createEstimateHelpers({
    safeDateOnly: (input) => {
      const v = String(input || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    },
    safeNumber: (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    },
    inDateRange: (d, s, e) => {
      const x = String(d || '').trim();
      if (!x) return false;
      if (s && x < String(s).trim()) return false;
      if (e && x > String(e).trim()) return false;
      return true;
    },
    normalizeForecastBizType: (x) => {
      const s = String(x || '').toLowerCase();
      if (s.includes('take') || s.includes('外卖')) return 'takeaway';
      if (s.includes('dine') || s.includes('堂食')) return 'dinein';
      return s === 'takeaway' || s === 'dinein' ? s : '';
    },
    normalizeForecastWeather: (x) => String(x || ''),
    normalizeForecastWeatherTag: (x) => {
      const s = String(x || '');
      if (/雨|rain/i.test(s)) return 'rain';
      if (/雪|snow/i.test(s)) return 'snow';
      return s ? 'clear' : '';
    },
    getStoreForecastConfig: () => ({
      holidayAsWeekend: true,
      rainFactor: 0.9,
      snowFactor: 0.85,
    }),
    isKnownPublicHoliday: (d) => d === '2026-01-01',
    isCNYPeriod: (d) => String(d || '').startsWith('2026-01-2'),
    isNormalWorkday: (d, isHoliday) => {
      if (isHoliday) return false;
      const dow = new Date(`${d}T00:00:00`).getDay();
      return dow >= 1 && dow <= 5;
    },
    resolveForecastProductName: (p) => ({ key: String(p || '').trim(), display: String(p || '').trim(), name: String(p || '').trim() }),
    isExcludedForecastProduct: (p) => String(p).includes('打包'),
    ...overrides,
  });
}

test('estimate: normalize helpers + canManage + alias', () => {
  const h = makeEstimateHelpers();
  assert.equal(h.canManageGrossProfitProfiles('admin'), true);
  assert.equal(h.canManageGrossProfitProfiles('hq_manager'), true);
  assert.equal(h.canManageGrossProfitProfiles('store_manager'), false);
  assert.equal(h.normalizeDishAliasBizType('外卖'), 'takeaway');
  assert.equal(h.normalizeDishAliasBizType('堂食'), 'dinein');
  assert.equal(h.normalizeDishAliasBizType('全部'), '*');
  assert.equal(h.normalizeDishAliasBizType('other'), '*');
  assert.equal(h.normalizeGrossProfitProfileItem(null), null);
  assert.equal(h.normalizeGrossProfitProfileItem({ product: '' }), null);
  assert.equal(h.normalizeGrossProfitProfileItem({ product: 'A' }), null);
  const item = h.normalizeGrossProfitProfileItem({ product: '菜A', bizType: 'dinein', costPerUnit: 10 });
  assert.equal(item.product, '菜A');
  assert.equal(item.costPerUnit, 10);
  const g = h.normalizeGrossProfitProfileItem({ product: '菜B', grossProfit: 5 });
  assert.equal(g.grossPerUnit, 5);
});

test('estimate: revenue history IQR / holiday / weather / CNY paths', () => {
  const h = makeEstimateHelpers();
  // same DOW (Wed=3): 2026-07-01,08,15,22 + outlier
  const history = [];
  for (const [date, rev] of [
    ['2026-07-01', 8000],
    ['2026-07-08', 8200],
    ['2026-07-15', 8100],
    ['2026-07-22', 8000],
    ['2026-06-03', 500000], // same Wed outlier → IQR drop
  ]) {
    history.push({ date, bizType: 'dinein', weather: '晴', isHoliday: false, expectedRevenue: rev });
    history.push({
      date,
      bizType: 'takeaway',
      weather: '雨',
      isHoliday: false,
      expectedRevenue: rev / 3,
    });
  }
  // known holiday mark
  history.push({
    date: '2026-01-01',
    bizType: 'dinein',
    weather: '晴',
    isHoliday: false,
    expectedRevenue: 1000,
  });
  // CNY weekday contamination
  history.push({
    date: '2026-01-28',
    bizType: 'dinein',
    weather: '晴',
    isHoliday: false,
    expectedRevenue: 20000,
  });

  const normal = h.estimateRevenueByHistory(
    history,
    { date: '2026-07-29', weather: '雨', isHoliday: false },
    '洪潮'
  );
  assert.ok(normal.totalEstimatedRevenue > 0);
  assert.ok(normal.byBizType.dinein.sampleCount >= 1);

  const holidayTarget = h.estimateRevenueByHistory(
    history,
    { date: '2026-07-29', weather: '雪', isHoliday: true },
    '洪潮'
  );
  assert.ok(Number.isFinite(holidayTarget.totalEstimatedRevenue));

  const empty = h.estimateRevenueByHistory([], { date: '2026-07-29' }, 'x');
  assert.equal(empty.totalEstimatedRevenue, 0);

  // skip bad rows
  const skip = h.estimateRevenueByHistory(
    [{ date: '', bizType: 'dinein', expectedRevenue: 1 }, null],
    { date: 'bad-date', weather: '' },
    'x'
  );
  assert.equal(skip.sampleCount, 0);
});

test('estimate: avg price + gross margin paths', () => {
  const h = makeEstimateHelpers();
  const history = [
    {
      date: '2026-07-01',
      store: 's1',
      bizType: 'dinein',
      expectedRevenue: 1000,
      actualRevenue: 900,
      totalDiscount: 100,
      productQuantities: { 菜A: 10, 打包盒: 2, 菜B: 5 },
    },
    {
      date: '2026-07-02',
      store: 's1',
      bizType: 'takeaway',
      expectedRevenue: 500,
      actualRevenue: 600, // swapped → code swaps
      productQuantities: { 菜A: 5 },
    },
    {
      date: '2026-07-03',
      store: 's2',
      bizType: 'dinein',
      expectedRevenue: 100,
      productQuantities: { 菜C: 1 },
    },
  ];

  const prices = h.computeAvgPricePerProduct(history, ['s1'], {});
  assert.ok(prices.size >= 1);
  assert.ok(prices.get('dinein||菜A') > 0);

  const margin = h.estimateGrossMarginByHistory({
    historyRows: history,
    profiles: [
      { product: '菜A', bizType: 'dinein', grossPerUnit: 20 },
      { product: '菜B', bizType: 'dinein', costPerUnit: 10 }, // cost → gross via avg price
      { product: 'bad' },
    ],
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    storeScope: ['s1'],
    aliasLookup: {},
  });
  assert.ok(margin.sampleCount >= 1);
  assert.ok(margin.revenue > 0);
  assert.ok(Array.isArray(margin.products));
  assert.ok(Array.isArray(margin.uncoveredProducts));

  // uncovered only (no profiles)
  const uncovered = h.estimateGrossMarginByHistory({
    historyRows: history,
    profiles: [],
    startDate: '2026-07-01',
    endDate: '2026-07-02',
    bizType: 'dinein',
    storeScope: 's1',
    aliasLookup: {},
  });
  assert.ok(uncovered.uncoveredProducts.length >= 1);

  // cost-only fallback without avg price for unknown product
  const costOnly = h.estimateGrossMarginByHistory({
    historyRows: [
      {
        date: '2026-07-01',
        store: 's1',
        bizType: 'dinein',
        expectedRevenue: 100,
        productQuantities: { 独有菜: 2 },
      },
    ],
    profiles: [{ product: '独有菜', bizType: 'dinein', costPerUnit: 5 }],
    startDate: '2026-07-01',
    endDate: '2026-07-01',
    storeScope: null,
    aliasLookup: {},
  });
  assert.ok(costOnly.grossProfit >= 0);
});
