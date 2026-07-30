import test from 'node:test';
import assert from 'node:assert/strict';
import { revenueRollup, operationalMetrics } from '../overview.js';

// 2026-07-30：业务方反复反馈"今日营收"应该是"昨日营收"，且周/月环比同比一直对不上——
// 根因是当前区间的结束日一直锚在today（当天日报几乎必然还没出，永远是0，把当周/当月
// 拉低，制造假的环比下跌）。这里用固定的today（不依赖真实系统时间）锁定：当前区间和
// 对比区间的结束日都改锚在yesterday。

function makePool(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM daily_reports/.test(sql)) return { rows: [rows.daily || {}] };
      if (/FROM revenue_targets/.test(sql)) return { rows: [{ target: 0 }] };
      if (/FROM pos_orders/.test(sql)) return { rows: [rows.pos || {}] };
      return { rows: [] };
    },
  };
}

function makeMultiStorePool({ dailyRows = [], posRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM daily_reports/.test(sql)) return { rows: dailyRows };
      if (/FROM pos_orders/.test(sql)) return { rows: posRows };
      return { rows: [] };
    },
  };
}

test('revenueRollup：普通工作日，本周至今和上周同期都锚在"昨天"，长度一致', async () => {
  // 2026-07-30 是周四；weekStart(本周一)=07-27，yesterday=07-29
  const pool = makePool({ daily: {} });
  await revenueRollup(pool, 'default', '2026-07-30', []);
  const dailyCall = pool.calls.find((c) => /FROM daily_reports/.test(c.sql));
  const [, , , , weekStart, weekEnd, weekStartLW, weekEndLW] = dailyCall.params;
  assert.equal(weekStart, '2026-07-27');
  assert.equal(weekEnd, '2026-07-29'); // 昨天，不是today(07-30)
  assert.equal(weekStartLW, '2026-07-20');
  assert.equal(weekEndLW, '2026-07-22'); // 上周一起同样3天(07-20~07-22)，不是整周
});

test('revenueRollup：今天是周一时，本周至今是0天（昨天还在上周），退化成空区间', async () => {
  const pool = makePool({ daily: {} });
  await revenueRollup(pool, 'default', '2026-07-27', []); // 07-27 是周一
  const dailyCall = pool.calls.find((c) => /FROM daily_reports/.test(c.sql));
  const [, , , , weekStart, weekEnd, , weekEndLW] = dailyCall.params;
  assert.equal(weekStart, '2026-07-27');
  assert.equal(weekEnd, null);
  assert.equal(weekEndLW, null);
});

test('revenueRollup：返回字段是 yesterday 不是 today，mom跟前天比，yoy跟去年昨天比', async () => {
  const pool = makePool({
    daily: {
      yesterday_revenue: 100,
      day_before_yesterday_revenue: 80,
      yesterday_ly_revenue: 50,
      week_revenue: 0, week_lw_revenue: 0, week_ly_revenue: 0,
      month_revenue: 0, month_lm_revenue: 0, month_ly_revenue: 0,
    },
  });
  const result = await revenueRollup(pool, 'default', '2026-07-30', []);
  assert.ok(result.yesterday, '应该有 yesterday 字段');
  assert.equal(result.today, undefined, '不应该再有 today 字段');
  assert.equal(result.yesterday.revenue, 100);
  assert.equal(result.yesterday.mom, 25); // (100-80)/80*100
  assert.equal(result.yesterday.yoy, 100); // (100-50)/50*100
});

test('operationalMetrics：本月至今同样锚在昨天，不含today', async () => {
  const pool = makeMultiStorePool({});
  await operationalMetrics(pool, 'default', '2026-07-30', []);
  const dailyCall = pool.calls.find((c) => /FROM daily_reports/.test(c.sql));
  const posCall = pool.calls.find((c) => /FROM pos_orders/.test(c.sql));
  assert.equal(dailyCall.params[2], '2026-07-29'); // monthEnd = yesterday
  assert.equal(posCall.params[2], '2026-07-29');
});

test('operationalMetrics：按单店返回数组，堂食/外卖占比来自daily_reports的dine_orders/delivery_orders（不是pos_orders现数）', async () => {
  const pool = makeMultiStorePool({
    dailyRows: [
      { store: '洪潮大宁久光店', traffic: 100, dine_revenue: 10000, dine_orders: 80, delivery_orders: 20, traffic_lm: 90, traffic_ly: 80 },
      { store: '马己仙上海音乐广场店', traffic: 50, dine_revenue: 5000, dine_orders: 40, delivery_orders: 10, traffic_lm: 45, traffic_ly: 40 },
    ],
    posRows: [
      { store: '洪潮大宁久光店', p1: 10, p2: 20, p3_4: 30, p5_6: 5, p6plus: 5, dine_party_cnt: 70 },
    ],
  });
  const result = await operationalMetrics(pool, 'default', '2026-07-30', []);
  assert.equal(result.length, 2, '应该按店返回2条');
  const hc = result.find((r) => r.store === '洪潮大宁久光店');
  assert.equal(hc.dineInSharePct, 80); // 80/(80+20)*100，来自daily_reports的dine_orders/delivery_orders
  assert.equal(hc.deliverySharePct, 20);
  assert.equal(hc.partySizeSharePct.p2, 28.6); // 20/70*100，按pos_orders算（daily_reports没有分桌人数字段）
  const mjx = result.find((r) => r.store === '马己仙上海音乐广场店');
  assert.equal(mjx.dineInSharePct, 80); // 40/(40+10)*100
  assert.equal(mjx.partySizeSharePct.p1, null, '这家店pos_orders里没有匹配行，应该是null不是报错');
});
