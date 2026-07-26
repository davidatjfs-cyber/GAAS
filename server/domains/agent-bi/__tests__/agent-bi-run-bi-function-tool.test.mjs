import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunBiFunctionTool } from '../run-bi-function-tool.js';
import { scoredRevenueForecast } from '../exec-bi-tools-helpers.js';

function makeRunner(queryImpl, overrides = {}) {
  const audits = [];
  const run = createRunBiFunctionTool({
    pool: () => ({
      query: async (sql, params) => queryImpl(sql, params),
    }),
    normalizeStoreLike: (v) => `%${String(v || '').replace(/\s+/g, '').toLowerCase()}%`,
    formatDate: (d) => {
      const dt = d instanceof Date ? d : new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    },
    logAgentOperation: async (_db, row) => { audits.push(row); },
    getBadReviewTableId: () => '',
    normalizeBitableDateValue: () => '2026-07-20',
    extractBitableFieldText: (v) => String(v || ''),
    isLikelySameStore: () => true,
    inDateRangeInclusive: () => true,
    loadUnifiedTableVisitRowsByStore: async () => [],
    ...overrides,
  });
  return { run, audits };
}

test('unknown tool returns ok:false', async () => {
  const { run, audits } = makeRunner(async () => ({ rows: [] }));
  const r = await run('nope', '洪潮久光店', {});
  assert.equal(r.ok, false);
  assert.match(r.text, /不支持的工具/);
  assert.ok(audits.some((a) => a.status === 'started'));
  assert.ok(audits.some((a) => a.status === 'error'));
});

test('empty store short-circuits sales ranking', async () => {
  const { run } = makeRunner(async () => ({ rows: [] }));
  const r = await run('query_sales_ranking', '', {});
  assert.equal(r.ok, false);
  assert.match(r.text, /未绑定门店/);
});

test('sales ranking success with dinein filter', async () => {
  const { run } = makeRunner(async (sql) => {
    if (/FROM pos_sales_detail/i.test(sql) && /GROUP BY s\.dish_name/i.test(sql)) {
      return {
        rows: [
          { dish_name: '牛肉面', total_qty: 10, total_sales: 200, total_revenue: 180 },
          { dish_name: '米饭', total_qty: 5, total_sales: 50, total_revenue: 45 },
        ],
      };
    }
    return { rows: [] };
  });
  const r = await run(
    'query_sales_ranking',
    '洪潮久光店',
    { period_days: 7, biz_type: 'dinein', metric: 'qty', sort_order: 'asc' },
    '近7天堂食销量'
  );
  assert.equal(r.ok, true);
  assert.equal(r.source, 'pos_sales_detail');
  assert.match(r.text, /牛肉面/);
  assert.match(r.text, /堂食/);
});

test('sales ranking empty then fallback range', async () => {
  let n = 0;
  const { run } = makeRunner(async (sql) => {
    n += 1;
    if (/MAX\(date\)/i.test(sql)) {
      return { rows: [{ max_d: '2026-07-10', min_d: '2026-06-01' }] };
    }
    if (/GROUP BY s\.dish_name/i.test(sql)) {
      // first period query empty; fallback has rows
      if (n <= 2) return { rows: [] };
      return { rows: [{ dish_name: '旧菜', total_qty: 2, total_sales: 20, total_revenue: 18 }] };
    }
    return { rows: [] };
  });
  const r = await run('query_sales_ranking', '洪潮久光店', { period_days: 7 }, '近7天销售');
  assert.equal(r.ok, true);
  assert.match(r.text, /暂无销售数据|旧菜|最近可用/);
});

test('complaint ranking from agent_messages + table visit', async () => {
  const { run } = makeRunner(async (sql) => {
    if (/agent_messages/i.test(sql)) {
      return {
        rows: [
          {
            fields: { 差评门店: '洪潮久光店', 差评产品: '汤面', 差评日期: '2026-07-20' },
            created_at: '2026-07-20T00:00:00Z',
          },
        ],
      };
    }
    return { rows: [] };
  }, {
    getBadReviewTableId: () => '',
    loadUnifiedTableVisitRowsByStore: async () => [
      { dissatisfaction_dish: '汤面,米饭' },
    ],
  });
  const r = await run('query_complaint_product_ranking', '洪潮久光店', { period_days: 30 }, '近30天投诉');
  assert.equal(r.ok, true);
  assert.match(r.text, /汤面/);
});

test('complaint ranking empty store / empty data / bitable path', async () => {
  const empty = await makeRunner(async () => ({ rows: [] })).run('query_complaint_product_ranking', '', {});
  assert.equal(empty.ok, false);

  const none = await makeRunner(async () => ({ rows: [] })).run(
    'query_complaint_product_ranking',
    '洪潮久光店',
    { period_days: 7 }
  );
  assert.equal(none.ok, true);
  assert.match(none.text, /暂无投诉/);

  const bitable = await makeRunner(async (sql) => {
    if (/feishu_generic_records/i.test(sql)) {
      return {
        rows: [{
          fields: { 差评门店: '洪潮久光店', 差评产品: '烤鱼', 差评日期: '2026-07-21' },
          created_at: '2026-07-21',
        }],
      };
    }
    return { rows: [] };
  }, { getBadReviewTableId: () => 'tblBad' }).run(
    'query_complaint_product_ranking',
    '洪潮久光店',
    { period_days: 30, sort_order: 'asc' }
  );
  assert.equal(bitable.ok, true);
  assert.match(bitable.text, /烤鱼|投诉/);
});

test('revenue summary with daily_reports rows', async () => {
  const { run } = makeRunner(async (sql) => {
    if (/FROM daily_reports/i.test(sql)) {
      return {
        rows: [
          { date: '2026-07-26', actual_revenue: 1000, target_revenue: 2000, actual_margin: 40 },
          { date: '2026-07-25', actual_revenue: 500, target_revenue: 2000, actual_margin: 50 },
        ],
      };
    }
    return { rows: [] };
  });
  const r = await run('query_revenue_summary', '洪潮久光店', { period_days: 7 }, '近7天营业');
  assert.equal(r.ok, true);
  assert.equal(r.source, 'daily_reports');
  assert.match(r.text, /营业汇总/);
  assert.match(r.text, /1500/);
  assert.match(r.text, /达成率/);
});

test('revenue summary falls back to pos_sales_detail', async () => {
  const { run } = makeRunner(async (sql) => {
    if (/FROM daily_reports/i.test(sql)) return { rows: [] };
    if (/FROM pos_sales_detail/i.test(sql)) {
      return {
        rows: [
          { date: '2026-07-26', day_revenue: 800, day_sales: 900 },
          { date: '2026-07-25', day_revenue: 700, day_sales: 750 },
        ],
      };
    }
    return { rows: [] };
  });
  const r = await run('query_revenue_summary', '洪潮久光店', { period_days: 7 });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'pos_sales_detail');
  assert.match(r.text, /累计实收/);
});

test('revenue summary empty store and no data', async () => {
  assert.equal((await makeRunner(async () => ({ rows: [] })).run('query_revenue_summary', '', {})).ok, false);
  const none = await makeRunner(async () => ({ rows: [] })).run('query_revenue_summary', '洪潮久光店', {});
  assert.equal(none.ok, true);
  assert.match(none.text, /暂无营业数据/);
});

test('table visit empty rows', async () => {
  const { run } = makeRunner(async () => ({ rows: [] }), {
    loadUnifiedTableVisitRowsByStore: async () => [],
  });
  const r = await run('query_table_visit', '洪潮久光店', { period_days: 7 });
  assert.equal(r.ok, true);
  assert.match(r.text, /暂无桌访数据/);
});

test('table visit with rows', async () => {
  const { run } = makeRunner(async () => ({ rows: [] }), {
    loadUnifiedTableVisitRowsByStore: async () => [
      {
        dissatisfaction_dish: '汤',
        unsatisfied_items: '上菜慢',
      },
      {
        dissatisfaction_dish: '汤,米饭',
        unsatisfied_items: '上菜慢',
      },
    ],
  });
  const r = await run('query_table_visit', '洪潮久光店', { period_days: 7 }, '近7天桌访');
  assert.equal(r.ok, true);
  assert.match(r.text, /上菜慢/);
  assert.match(r.text, /汤/);
});

test('table visit empty store and load error', async () => {
  assert.equal((await makeRunner(async () => ({ rows: [] })).run('query_table_visit', '', {})).ok, false);
  const { run } = makeRunner(async () => ({ rows: [] }), {
    loadUnifiedTableVisitRowsByStore: async () => { throw new Error('tv fail'); },
  });
  const r = await run('query_table_visit', '洪潮久光店', {});
  assert.equal(r.ok, false);
  assert.match(r.text, /失败/);
});

test('forecast from daily_reports samples', async () => {
  const { run } = makeRunner(async (sql) => {
    if (/FROM daily_reports/i.test(sql)) {
      return {
        rows: [
          { date: '2026-07-20', actual_revenue: 1000 },
          { date: '2026-07-21', actual_revenue: 1100 },
          { date: '2026-07-22', actual_revenue: 900 },
          { date: '2026-07-23', actual_revenue: 1200 },
        ],
      };
    }
    return { rows: [] };
  });
  const r = await run('query_revenue_forecast_next_day', '洪潮久光店', { lookback_days: 60 });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'daily_reports');
  assert.match(r.text, /明日营业额预测/);
});

test('forecast falls back to pos then long window', async () => {
  const { run } = makeRunner(async (sql) => {
    if (/FROM daily_reports/i.test(sql)) return { rows: [] };
    if (/FROM pos_sales_detail/i.test(sql)) {
      return {
        rows: [
          { date: '2026-07-20', day_revenue: 1000 },
          { date: '2026-07-21', day_revenue: 1100 },
          { date: '2026-07-22', day_revenue: 900 },
        ],
      };
    }
    return { rows: [] };
  });
  const r = await run('query_revenue_forecast_next_day', '洪潮久光店', {});
  assert.equal(r.ok, true);
  assert.equal(r.source, 'pos_sales_detail');
  assert.match(r.text, /预测值/);
});

test('forecast empty store and insufficient samples', async () => {
  assert.equal(
    (await makeRunner(async () => ({ rows: [] })).run('query_revenue_forecast_next_day', '', {})).ok,
    false
  );
  const low = await makeRunner(async () => ({ rows: [{ date: '2026-07-20', day_revenue: 1 }] })).run(
    'query_revenue_forecast_next_day',
    '洪潮久光店',
    {}
  );
  assert.equal(low.ok, true);
  assert.match(low.text, /样本不足/);
});

test('query error paths return ok:false', async () => {
  const { run } = makeRunner(async () => {
    throw new Error('db down');
  });
  const sales = await run('query_sales_ranking', '洪潮久光店', {});
  assert.equal(sales.ok, false);
  const summary = await run('query_revenue_summary', '洪潮久光店', {});
  assert.equal(summary.ok, false);
  const forecast = await run('query_revenue_forecast_next_day', '洪潮久光店', {});
  assert.equal(forecast.ok, false);
});

test('scoredRevenueForecast weights same weekday', () => {
  const tomorrow = new Date(2026, 6, 27); // Monday
  const rows = [
    { date: '2026-07-20', actual_revenue: 1000 }, // Mon
    { date: '2026-07-21', actual_revenue: 500 }, // Tue
    { date: '2026-07-13', actual_revenue: 2000 }, // Mon
  ];
  const f = scoredRevenueForecast(rows, 'actual_revenue', tomorrow, 1);
  assert.ok(f.pred > 500);
  assert.equal(f.sameDow, 2);
  assert.equal(f.min, 500);
  assert.equal(f.max, 2000);
  assert.deepEqual(scoredRevenueForecast([], 'actual_revenue', tomorrow, 1), {
    pred: 0, min: 0, max: 0, sameDow: 0,
  });
});
