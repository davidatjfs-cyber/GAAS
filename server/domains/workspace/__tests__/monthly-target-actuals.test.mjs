import test from 'node:test';
import assert from 'node:assert/strict';
import { getMonthlyTargetActuals } from '../overview.js';

// 2026-07-30：当月目标追踪之前对每个目标项显示"系统暂未接入该指标的自动核算"——实际这些
// 数据都在daily_reports里(充值/堂食营收/点评星级/企微新增等)，毛利单独来自monthly_margins
// (每月10号前录入的飞书毛利记录表)。锁定：查询按store+ym聚合，日期区间是[月初,下月初)。

function makePool({ dailyRow = {}, marginRow = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM daily_reports/.test(sql)) return { rows: [dailyRow] };
      if (/FROM monthly_margins/.test(sql)) return { rows: marginRow ? [marginRow] : [] };
      return { rows: [] };
    },
  };
}

test('getMonthlyTargetActuals 按[月初,下月初)区间查daily_reports，month=7时下月初是08-01', async () => {
  const pool = makePool({ dailyRow: { actual: 600000 } });
  await getMonthlyTargetActuals(pool, 'default', '洪潮大宁久光店', '2026-07');
  const dailyCall = pool.calls.find((c) => /FROM daily_reports/.test(c.sql));
  assert.deepEqual(dailyCall.params, ['default', '洪潮大宁久光店', '2026-07-01', '2026-08-01']);
});

test('getMonthlyTargetActuals 跨年边界：month=12时下月初是下一年01-01', async () => {
  const pool = makePool({ dailyRow: {} });
  await getMonthlyTargetActuals(pool, 'default', '洪潮大宁久光店', '2026-12');
  const dailyCall = pool.calls.find((c) => /FROM daily_reports/.test(c.sql));
  assert.equal(dailyCall.params[3], '2027-01-01');
});

test('getMonthlyTargetActuals 返回daily_reports聚合值+monthly_margins的毛利，eleme/meituan分渠道明细如实返回null', async () => {
  const pool = makePool({
    dailyRow: { actual: 600000, recharge: 40000, rechargeCount: 12, dianpingRating: 4.5, wechatMonthNew: 400 },
    marginRow: { actual_margin: 65 },
  });
  const actuals = await getMonthlyTargetActuals(pool, 'default', '洪潮大宁久光店', '2026-07');
  assert.equal(actuals.actual, 600000);
  assert.equal(actuals.recharge, 40000);
  assert.equal(actuals.dianpingRating, 4.5);
  assert.equal(actuals.wechatMonthNew, 400);
  assert.equal(actuals.margin, 65, '毛利应该来自monthly_margins而不是daily_reports');
  assert.equal(actuals.elemeRevenue, null, 'daily_reports没有分平台字段，如实返回null不是编数字');
  assert.equal(actuals.meituanRevenue, null);
});

test('getMonthlyTargetActuals monthly_margins查不到数据时margin为null，不是0（区分"没数据"和"真的是0"）', async () => {
  const pool = makePool({ dailyRow: {}, marginRow: null });
  const actuals = await getMonthlyTargetActuals(pool, 'default', '洪潮大宁久光店', '2026-07');
  assert.equal(actuals.margin, null);
});
