import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildBiDeterministicDailyReportReply } from '../build-daily-report-reply.js';

function makeBuilder(queryImpl) {
  const calls = { sql: [] };
  const build = createBuildBiDeterministicDailyReportReply({
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params });
        return queryImpl(sql, params, calls.sql.length);
      },
    }),
    resolveDateRangeFromQuestion: () => ({
      start: '2026-07-01',
      end: '2026-07-07',
      label: '近7天',
    }),
    normalizeStoreLike: (v) => `%${String(v || '').replace(/\s+/g, '').toLowerCase()}%`,
    normalizeStoreKey: (v) => String(v || '').replace(/\s+/g, '').toLowerCase(),
  });
  return { build, calls };
}

test('empty store → empty string', async () => {
  const { build } = makeBuilder(async () => ({ rows: [] }));
  assert.equal(await build('', '营业额'), '');
});

test('non matching text → empty string', async () => {
  const { build } = makeBuilder(async () => ({ rows: [] }));
  assert.equal(await build('洪潮久光店', '天气怎么样'), '');
});

test('no daily_reports, pos fallback with data', async () => {
  const { build } = makeBuilder(async (sql) => {
    if (/FROM daily_reports WHERE/i.test(sql) && /ORDER BY date DESC/.test(sql)) {
      return { rows: [] };
    }
    if (/FROM pos_sales_detail/i.test(sql) && /GROUP BY s\.date/.test(sql)) {
      return {
        rows: [
          { date: '2026-07-07', day_revenue: 100, day_sales: 120 },
          { date: '2026-07-06', day_revenue: 80, day_sales: 90 },
        ],
      };
    }
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '近7天营业额');
  assert.match(r, /营收分析/);
  assert.match(r, /pos_sales_detail/);
  assert.match(r, /180\.00|180/);
});

test('no data anywhere → 暂无', async () => {
  const { build } = makeBuilder(async () => ({ rows: [] }));
  const r = await build('洪潮久光店', '营收');
  assert.match(r, /暂无营业数据/);
});

test('single day detailed reply', async () => {
  const { build } = makeBuilder(async (sql) => {
    if (/ORDER BY date DESC LIMIT 60/.test(sql)) {
      return {
        rows: [
          {
            date: '2026-07-07',
            actual_revenue: 1000,
            pre_discount_revenue: 1200,
            total_discount: 200,
            budget: 0,
            actual_margin: 55.5,
            dianping_rating: 4.5,
            efficiency: 200,
            labor_total: 5,
          },
        ],
      };
    }
    if (/COALESCE\(SUM\(actual_revenue\)/.test(sql)) {
      return {
        rows: [{ cum_rev: 5000, cum_pre: 6000, budget: 10000, days: 7, cum_labor: 40 }],
      };
    }
    if (/FROM revenue_targets/.test(sql)) {
      return { rows: [{ target_revenue: 20000 }] };
    }
    if (/GROUP BY s\.biz_type/.test(sql)) {
      return {
        rows: [
          { biz_type: 'dinein', total_revenue: 700, total_qty: 30 },
          { biz_type: 'takeaway', total_revenue: 300, total_qty: 20 },
        ],
      };
    }
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '昨天营业额');
  assert.match(r, /实收营业额/);
  assert.match(r, /实收达成率/);
  assert.match(r, /毛利率/);
  assert.match(r, /大众点评/);
  assert.match(r, /今日人效值/);
  assert.match(r, /堂食\/外卖拆分/);
  assert.match(r, /堂食/);
  assert.match(r, /外卖/);
});

test('single day efficiency from labor fallback', async () => {
  const { build } = makeBuilder(async (sql) => {
    if (/ORDER BY date DESC LIMIT 60/.test(sql)) {
      return {
        rows: [
          {
            date: '2026-07-07',
            actual_revenue: 1000,
            pre_discount_revenue: 0,
            total_discount: 0,
            budget: 5000,
            actual_margin: null,
            dianping_rating: null,
            efficiency: 0,
            labor_total: 10,
          },
        ],
      };
    }
    if (/COALESCE\(SUM\(actual_revenue\)/.test(sql)) {
      return { rows: [{ cum_rev: 1000, cum_pre: 0, budget: 5000, days: 1, cum_labor: 10 }] };
    }
    if (/FROM revenue_targets/.test(sql)) return { rows: [] };
    if (/GROUP BY s\.biz_type/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '日报');
  assert.match(r, /实收÷工时/);
  assert.match(r, /毛利率.*暂无/);
});

test('multi-day summary with trend', async () => {
  const days = [];
  for (let i = 0; i < 5; i++) {
    days.push({
      date: `2026-07-0${i + 1}`,
      actual_revenue: 100 + i * 10,
      pre_discount_revenue: 120 + i * 10,
      total_discount: 20,
      actual_margin: 50,
      dianping_rating: 4.2,
      efficiency: 150,
      labor_total: 8,
    });
  }
  const { build } = makeBuilder(async (sql) => {
    if (/ORDER BY date DESC LIMIT 60/.test(sql)) return { rows: days };
    if (/COALESCE\(SUM\(actual_revenue\)/.test(sql)) {
      return { rows: [{ cum_rev: 800, cum_pre: 900, budget: 3000, days: 5, cum_labor: 40 }] };
    }
    if (/FROM revenue_targets/.test(sql)) return { rows: [] };
    if (/GROUP BY s\.biz_type/.test(sql)) {
      return { rows: [{ biz_type: '堂食', total_revenue: 400, total_qty: 10 }] };
    }
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '近7天经营情况');
  assert.match(r, /天合计/);
  assert.match(r, /日均实收/);
  assert.match(r, /平均毛利率/);
  assert.match(r, /近期趋势/);
  assert.match(r, /堂食/);
});

test('top-level query throw → failure message', async () => {
  const { build } = makeBuilder(async () => {
    throw new Error('db boom');
  });
  const r = await build('洪潮久光店', '营业额');
  assert.match(r, /营收分析查询失败/);
  assert.match(r, /db boom/);
});

test('month aggregate / revenue_targets errors ignored', async () => {
  const { build } = makeBuilder(async (sql) => {
    if (/ORDER BY date DESC LIMIT 60/.test(sql)) {
      return {
        rows: [
          {
            date: '2026-07-07',
            actual_revenue: 100,
            pre_discount_revenue: 0,
            total_discount: 0,
            budget: 1000,
            actual_margin: null,
            efficiency: null,
            labor_total: null,
          },
        ],
      };
    }
    if (/COALESCE\(SUM\(actual_revenue\)/.test(sql)) throw new Error('month fail');
    if (/FROM revenue_targets/.test(sql)) throw new Error('rt fail');
    if (/GROUP BY s\.biz_type/.test(sql)) throw new Error('biz fail');
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '营收');
  assert.match(r, /实收营业额/);
  assert.match(r, /今日人效值.*暂无/);
});

test('pos fallback query error falls through to 暂无', async () => {
  const { build } = makeBuilder(async (sql) => {
    if (/FROM daily_reports WHERE/i.test(sql) && /ORDER BY date DESC/.test(sql)) {
      return { rows: [] };
    }
    if (/FROM pos_sales_detail/i.test(sql)) throw new Error('pos fail');
    return { rows: [] };
  });
  const r = await build('洪潮久光店', '生意怎么样');
  assert.match(r, /暂无营业数据/);
});
