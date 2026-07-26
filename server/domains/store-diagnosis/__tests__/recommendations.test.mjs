import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnomalyMarketingRecs,
  buildBadReviewTrainingRecs,
  buildConversionTrainingRecs,
  buildNewCustomerRatioRecs,
  buildNewEmployeeTrainingRecs,
  buildRevenueDeclineMarketingRecs,
  buildStaffingRecs,
  generateRecommendations,
} from '../recommendations.js';

test('buildRevenueDeclineMarketingRecs: traffic drop triggers marketing rec', () => {
  const recs = buildRevenueDeclineMarketingRecs({
    is_decline: true,
    change_pct: -8,
    contributions: [{ factor: '客流量下降', impact: '-12%' }],
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].title, '加强新客引流');
});

test('buildStaffingRecs: efficiency and night shift issues', () => {
  const recs = buildStaffingRecs(
    { efficiency_change_pct: -15 },
    { total_on_duty: 4, issues: ['晚市营收占比50%但前厅仅2人在岗，晚班前厅人手不足'] },
  );
  assert.equal(recs.length, 2);
  assert.ok(recs.some(r => r.title === '优化排班结构'));
  assert.ok(recs.some(r => r.title === '增加晚班前厅人手'));
});

test('buildBadReviewTrainingRecs: untrained kitchen staff on product bad review', () => {
  const recs = buildBadReviewTrainingRecs({
    store: '马己仙上海音乐广场店',
    anomalies: [{
      key: 'bad_review_product',
      type: '产品差评',
      latest_date: '2026-07-20',
      detail: '烧鸭偏柴',
    }],
    reports: [{
      date: '2026-07-20',
      staff: {
        kitchen: [{ name: '张三', user: 'zhangsan', area: 'kitchen' }],
      },
    }],
    training: { by_employee: [] },
  });
  assert.equal(recs.length, 1);
  assert.match(recs[0].title, /烧鸭/);
  assert.deepEqual(recs[0].target_users, ['zhangsan']);
});

test('buildNewCustomerRatioRecs + buildConversionTrainingRecs', () => {
  const ratioRecs = buildNewCustomerRatioRecs(
    { new_ratio: 12, prev_new_ratio: 20, new_ratio_change_pct: -40 },
    [{ name: '李店长', username: 'mgr1', position: '店长' }],
  );
  assert.match(ratioRecs[0].title, /会员营销技巧/);

  const convRecs = buildConversionTrainingRecs(
    { contributions: [{ factor: '到店转化率下降', detail: '转化率从40%降至30%' }] },
    [{ staff: { front: [{ name: '小王', user: 'wang' }] } }],
  );
  assert.match(convRecs[0].title, /收银引导与点单话术/);
});

test('buildAnomalyMarketingRecs + buildNewEmployeeTrainingRecs', () => {
  const marketing = buildAnomalyMarketingRecs([
    { key: 'recharge_zero' },
    { key: 'weekday_trend', detail: '连续3周周同比下降' },
  ]);
  assert.equal(marketing.length, 2);

  const training = buildNewEmployeeTrainingRecs({
    employees_without_training: [{ name: '小陈', username: 'chen', is_new: true }],
  });
  assert.match(training[0].title, /小陈/);
});

test('generateRecommendations merges all rule groups', () => {
  const recs = generateRecommendations({
    store: '洪潮大宁久光店',
    revenue: {
      is_decline: true,
      change_pct: -10,
      efficiency_change_pct: -12,
      contributions: [{ factor: '客流量下降', impact: '-8%' }],
    },
    customer: { new_ratio: 15, prev_new_ratio: 25, new_ratio_change_pct: -40 },
    anomalies: [{ key: 'recharge_zero' }],
    staffing: { total_on_duty: 6, issues: [] },
    training: { by_employee: [], employees_without_training: [] },
    employees: [{ name: '王店长', username: 'mgr', position: '店长' }],
    reports: [],
  });
  assert.ok(recs.length >= 3);
  assert.ok(recs.some(r => r.type === 'marketing'));
  assert.ok(recs.some(r => r.type === 'staffing'));
  assert.ok(recs.some(r => r.type === 'training'));
});
