/**
 * R52：new-scoring-model.js (983 行) 拆分至 domains/store-scoring/*，挂 extracted 地板。
 * 各拆分模块直接用 utils/database.js 的 pool() 单例（原文件亦如此），
 * 测试通过 setPool() 注入 mock pool。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setPool } from '../utils/database.js';

import {
  scoringStoreMatchPatterns,
  scoringStoreExactKeys,
  scoringStoreAggregateIlikePatterns,
  getDaysInPeriod,
  periodDateRange,
  parseJsonArrayMaybe
} from '../domains/store-scoring/store-match-helpers.js';
import {
  EMPLOYEE_RATING_PENDING,
  STORE_RATING_CONFIG,
  BONUS_CONFIG,
  EMPLOYEE_SCORE_CONFIG,
  DEFAULT_EMPLOYEE_RATING_CONFIG,
  getRuntimeEmployeeRatingConfig
} from '../domains/store-scoring/config.js';
import { calculateStoreRating } from '../domains/store-scoring/store-rating.js';
import { getMonthlyAnomalyRollupAverageScore, calculateEmployeeScore } from '../domains/store-scoring/employee-score.js';
import { calculateExecutionRating } from '../domains/store-scoring/execution-rating.js';
import { calculateAttitudeRating, calculateAbilityRating, getIncompleteTaskCount } from '../domains/store-scoring/attitude-ability-rating.js';
import { calculateExceptionBonus, calculateExceptionDeduction, getLaborEfficiencyDeduction } from '../domains/store-scoring/exception-adjustments.js';
import { calculateBonus } from '../domains/store-scoring/bonus.js';
import {
  getKitchenReportsCount,
  getMaterialReceivingReportsCount,
  getStoreMeetingReports,
  hasGlobalKitchenOrMaterialInPeriod,
  hasGlobalMeetingReportsInPeriod
} from '../domains/store-scoring/legacy-unused-helpers.js';

// re-export barrel (behavior-preserving) 也要能正常工作
import * as barrel from '../new-scoring-model.js';

// setPool() 会用 wrapPoolForTenantContext 原地包装传入对象：pool().query(...) 实际会
// 走 connect() 拿到的 client.query(...)，因此 mock 必须同时提供可用的 connect()，
// 否则包装阶段 `rawPool.connect.bind(rawPool)` 会直接抛错。
function makeMockPool(matchers = []) {
  const dispatch = async (sql, params) => {
    const s = String(sql);
    for (const [pattern, handler] of matchers) {
      if (pattern.test(s)) return handler(s, params);
    }
    return { rows: [] };
  };
  return {
    query: dispatch,
    connect: async () => ({ query: dispatch, release: () => {} }),
  };
}

function makeThrowingPool(message) {
  return {
    query: async () => { throw new Error(message); },
    connect: async () => { throw new Error(message); },
  };
}

// ───────────────────────── store-match-helpers.js ─────────────────────────

test('store-match-helpers: 门店匹配 pattern 生成', () => {
  assert.deepEqual(scoringStoreMatchPatterns(''), ['%']);
  assert.ok(scoringStoreMatchPatterns('洪潮大宁久光店').length > 0);

  assert.deepEqual(scoringStoreExactKeys(''), []);
  const keys = scoringStoreExactKeys('洪潮大宁久光店');
  assert.ok(keys.includes('洪潮大宁久光店'));
  assert.ok(keys.includes('洪潮久光店')); // feishu 简称

  assert.deepEqual(scoringStoreAggregateIlikePatterns(''), ['%']);
  const aggPats = scoringStoreAggregateIlikePatterns('洪潮大宁久光店');
  assert.ok(aggPats.some((p) => p.includes('洪潮久光店')));
});

test('store-match-helpers: 周期计算', () => {
  assert.equal(getDaysInPeriod('2026-02'), 28);
  assert.equal(getDaysInPeriod('2026-01'), 31);
  assert.deepEqual(periodDateRange('2026-02'), { startDate: '2026-02-01', endDate: '2026-02-28' });
});

test('store-match-helpers: parseJsonArrayMaybe 各类型输入', () => {
  assert.deepEqual(parseJsonArrayMaybe([1, 2]), [1, 2]);
  assert.deepEqual(parseJsonArrayMaybe('[1,2]'), [1, 2]);
  assert.deepEqual(parseJsonArrayMaybe('不是JSON'), []);
  assert.deepEqual(parseJsonArrayMaybe(null), []);
});

// ───────────────────────── config.js ─────────────────────────

test('config: 静态配置结构完整', () => {
  assert.equal(EMPLOYEE_RATING_PENDING, '待定');
  assert.equal(STORE_RATING_CONFIG.type, 'store_rating');
  assert.equal(BONUS_CONFIG['洪潮'].base, 2000);
  assert.equal(EMPLOYEE_SCORE_CONFIG.type, 'employee_score');
  assert.ok(DEFAULT_EMPLOYEE_RATING_CONFIG.execution.store_production_manager);
});

test('config: getRuntimeEmployeeRatingConfig 命中/未命中/异常均兜底正确', async () => {
  const custom = { attitude: { A_max_incomplete: 1 } };
  setPool(makeMockPool([
    [/from hr_rating_configs/i, async () => ({ rows: [{ config: custom }] })],
  ]));
  assert.deepEqual(await getRuntimeEmployeeRatingConfig(), custom);

  setPool(makeMockPool([
    [/from hr_rating_configs/i, async () => ({ rows: [] })],
  ]));
  assert.deepEqual(await getRuntimeEmployeeRatingConfig(), DEFAULT_EMPLOYEE_RATING_CONFIG);

  setPool(makeThrowingPool('db_down'));
  assert.deepEqual(await getRuntimeEmployeeRatingConfig(), DEFAULT_EMPLOYEE_RATING_CONFIG);
});

// ───────────────────────── bonus.js ─────────────────────────

test('bonus: calculateBonus 各评级分支', () => {
  assert.deepEqual(calculateBonus('洪潮', 'D', 90), { bonus: 0, salaryMultiplier: 0.8, reason: '门店D级，工资8折' });
  assert.deepEqual(calculateBonus('马己仙', null, 90), { bonus: 0, salaryMultiplier: 0.8, reason: '门店D级，工资8折' });
  assert.deepEqual(calculateBonus('马己仙', 'C', 90), { bonus: 0, salaryMultiplier: 1.0, reason: '门店C级，奖金归0' });
  const a = calculateBonus('洪潮', 'A', 100);
  assert.equal(a.bonus, 2000);
  const b = calculateBonus('马己仙', 'B', 50);
  assert.equal(b.bonus, 750);
});

// ───────────────────────── store-rating.js ─────────────────────────

test('store-rating: calculateStoreRating 门店名为空直接返回', async () => {
  const r = await calculateStoreRating('', '洪潮', '2026-06');
  assert.equal(r.rating, null);
  assert.equal(r.reason, '门店名为空');
});

test('store-rating: calculateStoreRating 目标营业额缺失', async () => {
  setPool(makeMockPool([
    [/FROM daily_reports/, async () => ({ rows: [{ count: '1', total_revenue: '1000' }] })],
    [/FROM revenue_targets/, async () => ({ rows: [] })],
  ]));
  const r = await calculateStoreRating('洪潮大宁久光店', '洪潮', '2026-06');
  assert.equal(r.rating, null);
  assert.equal(r.reason, '目标营业额未设置或为0');
});

test('store-rating: calculateStoreRating 正常路径（品牌回退目标）', async () => {
  let saved = null;
  setPool(makeMockPool([
    [/SELECT COUNT\(\*\)::int AS count\s+FROM daily_reports/, async () => ({ rows: [{ count: '0' }] })],
    [/SELECT COALESCE\(SUM\(actual_revenue\)/, async () => ({ rows: [{ total_revenue: '96000' }] })],
    [/SELECT target_revenue FROM revenue_targets\s+WHERE period = \$1 AND store/, async () => ({ rows: [] })],
    [/SELECT target_revenue FROM revenue_targets\s+WHERE period <= \$1/, async () => ({ rows: [] })],
    [/SELECT target_revenue, store FROM revenue_targets/, async () => ({ rows: [{ target_revenue: '100000', store: '洪潮' }] })],
    [/INSERT INTO store_ratings/, async (sql, params) => { saved = params; return { rows: [] }; }],
  ]));
  const r = await calculateStoreRating('洪潮大宁久光店', '洪潮', '2026-06');
  assert.equal(r.rating, 'A');
  assert.equal(r.achievementRate, 96);
  assert.ok(saved && saved[6] === 'A');
});

test('store-rating: calculateStoreRating 异常时返回 reason', async () => {
  setPool(makeThrowingPool('conn_reset'));
  const r = await calculateStoreRating('洪潮大宁久光店', '洪潮', '2026-06');
  assert.equal(r.rating, null);
  assert.equal(r.reason, 'conn_reset');
});

// ───────────────────────── employee-score.js ─────────────────────────

test('employee-score: getMonthlyAnomalyRollupAverageScore 命中/未命中/非法period', async () => {
  assert.equal(await getMonthlyAnomalyRollupAverageScore('u1', ''), 100);

  setPool(makeMockPool([
    [/FROM agent_scores/, async () => ({ rows: [{ total_score: '77' }] })],
  ]));
  assert.equal(await getMonthlyAnomalyRollupAverageScore('u1', '2026-06'), 77);

  setPool(makeMockPool([
    [/FROM agent_scores/, async () => ({ rows: [] })],
  ]));
  assert.equal(await getMonthlyAnomalyRollupAverageScore('u1', '2026-06'), 100);
});

test('employee-score: calculateEmployeeScore 综合路径（店长-洪潮）', async () => {
  setPool(makeMockPool([
    [/FROM agent_scores/, async () => ({ rows: [{ total_score: '90' }] })],
    [/FROM agent_issues.*count/is, async () => ({ rows: [{ count: '0' }] })],
    [/deductions\s+FROM agent_scores/, async () => ({ rows: [] })],
    [/AVG\(efficiency\)/, async () => ({ rows: [{ avg_eff: '0' }] })],
    [/SUM\(new_wechat_members\)/, async () => ({ rows: [{ total: '410' }] })],
    [/FROM master_tasks/, async () => ({ rows: [{ c: '1' }] })],
    [/dianping_rating FROM daily_reports/, async () => ({ rows: [{ dianping_rating: '4.7' }] })],
    [/INSERT INTO employee_scores/, async () => ({ rows: [] })],
  ]));
  const result = await calculateEmployeeScore('洪潮大宁久光店', 'u1', 'store_manager', '2026-06');
  assert.equal(result.base_score, 90);
  assert.equal(result.execution_rating, 'A'); // 410 新会员 >= 400
  assert.equal(result.attitude_rating, 'A'); // 1次备案 <= A阈值
  assert.equal(result.ability_rating, 'A'); // 4.7分 >= 洪潮A阈值4.6
  assert.equal(result.total_score, 100); // 90 + 10 零异常加分
});

test('employee-score: calculateEmployeeScore 顶层异常兜底返回 pending', async () => {
  setPool(makeThrowingPool('db_down'));
  const result = await calculateEmployeeScore('洪潮大宁久光店', 'u1', 'store_manager', '2026-06');
  assert.equal(result.base_score, null);
  assert.equal(result.execution_rating, EMPLOYEE_RATING_PENDING);
  assert.equal(result.attitude_rating, EMPLOYEE_RATING_PENDING);
  assert.equal(result.ability_rating, EMPLOYEE_RATING_PENDING);
});

// ───────────────────────── execution-rating.js ─────────────────────────

test('execution-rating: 出品经理 / 洪潮店长 / 马己仙店长 / 未知角色', async () => {
  setPool(makeMockPool([
    [/FROM agent_messages/, async () => ({ rows: [] })],
    [/SUM\(new_wechat_members\)/, async () => ({ rows: [{ total: '0' }] })],
    [/FROM daily_reports/, async () => ({ rows: [{ c: '0' }] })],
  ]));

  // 出品经理：0达标天数 -> nonCompliantDays = 全月天数 -> D
  const pm = await calculateExecutionRating('洪潮大宁久光店', 'u1', 'store_production_manager', '2026-06');
  assert.equal(pm, 'D');

  // 洪潮店长：0新会员，且无daily_reports兜底数据 -> null
  const hcNull = await calculateExecutionRating('洪潮大宁久光店', 'u1', 'store_manager', '2026-06');
  assert.equal(hcNull, null);

  // 马己仙店长：无例会记录 -> totalMissing=全月天数 -> D
  const mx = await calculateExecutionRating('马己仙上海音乐广场店', 'u1', 'store_manager', '2026-06');
  assert.equal(mx, 'D');

  const unknown = await calculateExecutionRating('洪潮大宁久光店', 'u1', 'unknown_role', '2026-06');
  assert.equal(unknown, null);
});

test('execution-rating: 洪潮店长有daily_reports兜底数据时不返回null', async () => {
  setPool(makeMockPool([
    [/SUM\(new_wechat_members\)/, async () => ({ rows: [{ total: '0' }] })],
    [/FROM daily_reports/, async () => ({ rows: [{ c: '5' }] })],
  ]));
  const r = await calculateExecutionRating('洪潮大宁久光店', 'u1', 'store_manager', '2026-06');
  assert.equal(r, 'D'); // 0新会员 < C阈值 -> D
});

test('execution-rating: 异常时返回null', async () => {
  setPool(makeThrowingPool('boom'));
  const r = await calculateExecutionRating('洪潮大宁久光店', 'u1', 'store_production_manager', '2026-06');
  assert.equal(r, null);
});

// ───────────────────────── attitude-ability-rating.js ─────────────────────────

test('attitude-ability-rating: getIncompleteTaskCount 空用户名/命中/异常', async () => {
  assert.equal(await getIncompleteTaskCount('', '2026-06'), 0);

  setPool(makeMockPool([
    [/FROM master_tasks/, async () => ({ rows: [{ c: '3' }] })],
  ]));
  assert.equal(await getIncompleteTaskCount('u1', '2026-06'), 3);

  setPool(makeThrowingPool('boom'));
  assert.equal(await getIncompleteTaskCount('u1', '2026-06'), 0);
});

test('attitude-ability-rating: calculateAttitudeRating 各评级分支', async () => {
  setPool(makeMockPool([
    [/FROM master_tasks/, async () => ({ rows: [{ c: '0' }] })],
  ]));
  assert.equal(await calculateAttitudeRating('u1', '2026-06'), 'A');

  setPool(makeMockPool([
    [/FROM master_tasks/, async () => ({ rows: [{ c: '9' }] })],
  ]));
  assert.equal(await calculateAttitudeRating('u1', '2026-06'), 'D');
});

test('attitude-ability-rating: calculateAbilityRating 出品经理/店长/未知角色', async () => {
  setPool(makeMockPool([
    [/FROM monthly_margins/, async () => ({ rows: [{ actual_margin: '66', target_margin: '64', brand: '马己仙' }] })],
  ]));
  const pmAbility = await calculateAbilityRating('马己仙上海音乐广场店', 'u1', 'store_production_manager', '2026-06');
  assert.equal(pmAbility, 'A'); // diff=2 >= 1.01

  setPool(makeMockPool([
    [/FROM monthly_margins/, async () => ({ rows: [] })],
  ]));
  // 无 monthly_margins 数据时 getMarginData 返回 {actual_margin:null,target_margin:null}；
  // Number(null)===0（有限数），因此不会早退 null，diff=0-0=0 落入 B 档（保留原文件既有行为）。
  const pmAbilityNoData = await calculateAbilityRating('马己仙上海音乐广场店', 'u1', 'store_production_manager', '2026-06');
  assert.equal(pmAbilityNoData, 'B');

  setPool(makeMockPool([
    [/dianping_rating FROM daily_reports/, async () => ({ rows: [{ dianping_rating: '4.6' }] })],
  ]));
  const smAbility = await calculateAbilityRating('洪潮大宁久光店', 'u1', 'store_manager', '2026-06');
  assert.equal(smAbility, 'A');

  setPool(makeMockPool([
    [/dianping_rating FROM daily_reports/, async () => ({ rows: [] })],
  ]));
  const smAbilityNull = await calculateAbilityRating('洪潮大宁久光店', 'u1', 'store_manager', '2026-06');
  assert.equal(smAbilityNull, null);

  const unknown = await calculateAbilityRating('洪潮大宁久光店', 'u1', 'unknown_role', '2026-06');
  assert.equal(unknown, null);
});

// ───────────────────────── exception-adjustments.js ─────────────────────────

test('exception-adjustments: calculateExceptionBonus 有异常/周度已扣分/零异常加分', async () => {
  setPool(makeMockPool([
    [/FROM agent_issues/, async () => ({ rows: [{ count: '2' }] })],
  ]));
  assert.equal(await calculateExceptionBonus('u1', '2026-06'), 0);

  setPool(makeMockPool([
    [/FROM agent_issues/, async () => ({ rows: [{ count: '0' }] })],
    [/deductions\s+FROM agent_scores/, async () => ({ rows: [{ deductions: JSON.stringify([{ points: 5 }]) }] })],
  ]));
  assert.equal(await calculateExceptionBonus('u1', '2026-06'), 0);

  setPool(makeMockPool([
    [/FROM agent_issues/, async () => ({ rows: [{ count: '0' }] })],
    [/deductions\s+FROM agent_scores/, async () => ({ rows: [] })],
  ]));
  assert.equal(await calculateExceptionBonus('u1', '2026-06'), 10);
});

test('exception-adjustments: calculateExceptionDeduction 按频率封顶', async () => {
  setPool(makeMockPool([
    [/category, severity, COUNT/, async () => ({ rows: [{ category: '总实收毛利率异常', severity: 'high', count: '3' }] })],
  ]));
  // monthly 频率封顶1次 -> 40分
  assert.equal(await calculateExceptionDeduction('u1', '2026-06'), 40);

  setPool(makeMockPool([
    [/category, severity, COUNT/, async () => ({ rows: [{ category: '总实收毛利率异常', severity: 'low', count: '3' }] })],
  ]));
  assert.equal(await calculateExceptionDeduction('u1', '2026-06'), 0);

  setPool(makeMockPool([
    [/category, severity, COUNT/, async () => ({ rows: [{ category: '未知类别', severity: 'high', count: '3' }] })],
  ]));
  assert.equal(await calculateExceptionDeduction('u1', '2026-06'), 0);
});

test('exception-adjustments: getLaborEfficiencyDeduction 高/中/无异常分档', async () => {
  setPool(makeMockPool([
    [/AVG\(efficiency\)/, async () => ({ rows: [{ avg_eff: '900' }] })],
  ]));
  const high = await getLaborEfficiencyDeduction('洪潮大宁久光店', '2026-06');
  assert.equal(high.severity, 'high');
  assert.equal(high.deduction, 20);

  setPool(makeMockPool([
    [/AVG\(efficiency\)/, async () => ({ rows: [{ avg_eff: '1050' }] })],
  ]));
  const medium = await getLaborEfficiencyDeduction('洪潮大宁久光店', '2026-06');
  assert.equal(medium.severity, 'medium');

  setPool(makeMockPool([
    [/AVG\(efficiency\)/, async () => ({ rows: [{ avg_eff: '0' }] })],
  ]));
  const none = await getLaborEfficiencyDeduction('洪潮大宁久光店', '2026-06');
  assert.equal(none.deduction, 0);

  setPool(makeMockPool([
    [/AVG\(efficiency\)/, async () => ({ rows: [{ avg_eff: '2000' }] })],
  ]));
  const ok = await getLaborEfficiencyDeduction('马己仙上海音乐广场店', '2026-06');
  assert.equal(ok.deduction, 0);
  assert.equal(ok.severity, null);
});

// ───────────────────────── legacy-unused-helpers.js ─────────────────────────
// 拆分前原文件里就未被调用的死代码，按纪律原样保留（改为具名导出满足 lint），这里补最小行为验证。

test('legacy-unused-helpers: 各函数按门店/周期查询并在空 key 时提前返回', async () => {
  assert.equal(await getKitchenReportsCount('', '2026-06', 'opening'), 0);
  assert.equal(await getMaterialReceivingReportsCount('', '2026-06'), 0);
  assert.deepEqual(await getStoreMeetingReports('', '2026-06'), []);

  setPool(makeMockPool([
    [/FROM kitchen_reports/, async () => ({ rows: [{ count: '2' }] })],
    [/FROM material_receiving_reports/, async () => ({ rows: [{ count: '1' }] })],
    [/FROM store_meeting_reports/, async () => ({ rows: [{ submitted: true, meeting_score: 8 }] })],
  ]));
  assert.equal(await getKitchenReportsCount('洪潮大宁久光店', '2026-06', 'opening'), 2);
  assert.equal(await getMaterialReceivingReportsCount('洪潮大宁久光店', '2026-06'), 1);
  assert.equal((await getStoreMeetingReports('洪潮大宁久光店', '2026-06')).length, 1);

  setPool(makeMockPool([
    [/FROM kitchen_reports/, async () => ({ rows: [{ kc: '1', mc: '0' }] })],
  ]));
  assert.equal(await hasGlobalKitchenOrMaterialInPeriod('2026-06'), true);

  setPool(makeMockPool([
    [/FROM store_meeting_reports/, async () => ({ rows: [{ c: '0' }] })],
  ]));
  assert.equal(await hasGlobalMeetingReportsInPeriod('2026-06'), false);
});

// ───────────────────────── new-scoring-model.js（re-export barrel） ─────────────────────────

test('new-scoring-model.js barrel: 原有 import 路径仍可用', () => {
  assert.equal(typeof barrel.calculateStoreRating, 'function');
  assert.equal(typeof barrel.calculateEmployeeScore, 'function');
  assert.equal(typeof barrel.calculateBonus, 'function');
  assert.equal(typeof barrel.getMonthlyAnomalyRollupAverageScore, 'function');
  assert.equal(typeof barrel.calculateExecutionRating, 'function');
  assert.equal(typeof barrel.calculateAttitudeRating, 'function');
  assert.equal(typeof barrel.calculateAbilityRating, 'function');
  assert.equal(typeof barrel.getIncompleteTaskCount, 'function');
  assert.equal(barrel.EMPLOYEE_RATING_PENDING, '待定');
  assert.equal(barrel.STORE_RATING_CONFIG.type, 'store_rating');
  assert.ok(barrel.BONUS_CONFIG['马己仙']);
  assert.equal(barrel.EMPLOYEE_SCORE_CONFIG.type, 'employee_score');
});
