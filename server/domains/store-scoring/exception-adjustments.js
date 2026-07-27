/**
 * 员工评分「异常加分/扣分」+「人效扣分」计算。
 * 从 new-scoring-model.js 拆出。
 */
import { pool, resolveTenantIdDefault } from '../../utils/database.js';
import { getBrandConfigSync } from '../../utils/brand-config-loader.js';
import { scoringStoreAggregateIlikePatterns, periodDateRange, parseJsonArrayMaybe, getDaysInPeriod } from './store-match-helpers.js';

// 异常扣分规则：按类别+严重度+频率计算
// 只有毛利率异常不在周度anomaly_rollups中，需要额外扣分；其余已在周度扣分中体现
const DEDUCTION_RULES = {
  '总实收毛利率异常': { high: 40, medium: 20, low: 0, frequency: 'monthly' },
};

// 兜底值，仅在 brand_configs.config_json 里查不到 laborEfficiencyThresholds 时使用
const LABOR_EFFICIENCY_THRESHOLDS = {
  '洪潮': { high: { below: 1000, points: 20 }, medium: { below: 1100, points: 10 } },
  '马己仙': { high: { below: 1400, points: 20 }, medium: { below: 1500, points: 10 } },
};

function getLaborEfficiencyThresholds(brandZh) {
  return getBrandConfigSync(brandZh, resolveTenantIdDefault())?.laborEfficiencyThresholds || LABOR_EFFICIENCY_THRESHOLDS[brandZh];
}

function inferBrandFromStore(store) {
  if (/洪潮/.test(store)) return '洪潮';
  return '马己仙';
}

// 根据频率计算一个月内最多触发次数
function getMaxTriggers(frequency, period) {
  const days = getDaysInPeriod(period);
  if (frequency === 'daily') return days;        // 每天1次
  if (frequency === 'weekly') return Math.ceil(days / 7); // 每周1次（约4-5次）
  return 1; // monthly: 每月1次
}

// 计算零异常加分
export async function calculateExceptionBonus(username, period) {
  // 检查该用户在period期间是否有异常；使用上海时区转换，避免跨月归属错误
  const { startDate, endDate } = periodDateRange(period);
  const result = await pool().query(`
    SELECT COUNT(*) as count FROM agent_issues 
    WHERE assignee_username = $1 AND (created_at AT TIME ZONE 'Asia/Shanghai')::date >= $2::date AND (created_at AT TIME ZONE 'Asia/Shanghai')::date <= $3::date
  `, [username, startDate, endDate]);
  
  const exceptionCount = Number(result.rows[0]?.count || 0);
  if (exceptionCount > 0) return 0;

  // 兜底：当前业务主链路异常主要落在 anomaly_triggers -> 周度 anomaly_rollups_v2
  // 若本月周度扣分明细已有异常，不应再给“零异常+10”。
  const weekly = await pool().query(
    `SELECT deductions
     FROM agent_scores
     WHERE lower(username) = lower($1)
       AND score_model = 'anomaly_rollups_v2'
       AND COALESCE(is_invalidated, false) = false
       AND period LIKE 'week_%'
       AND substring(period from 6 for 10)::date >= $2::date
       AND substring(period from 6 for 10)::date <= $3::date`,
    [username, startDate, endDate]
  );
  for (const row of weekly.rows || []) {
    const arr = parseJsonArrayMaybe(row.deductions);
    const hasPositive = arr.some((d) => Number(d?.points || 0) > 0);
    if (hasPositive) return 0;
  }
  return 10; // 零异常加10分
}

// 计算异常扣分
export async function calculateExceptionDeduction(username, period) {
  // 按类别+严重度分组查询；使用上海时区转换，避免跨月归属错误
  const { startDate, endDate } = periodDateRange(period);
  const result = await pool().query(`
    SELECT category, severity, COUNT(*) as count FROM agent_issues 
    WHERE assignee_username = $1 AND (created_at AT TIME ZONE 'Asia/Shanghai')::date >= $2::date AND (created_at AT TIME ZONE 'Asia/Shanghai')::date <= $3::date
    GROUP BY category, severity
  `, [username, startDate, endDate]);
  
  let totalDeduction = 0;
  for (const row of result.rows) {
    const rule = DEDUCTION_RULES[row.category];
    if (!rule) continue;
    const sev = String(row.severity || '').toLowerCase();
    if (sev === 'low') continue; // low不扣分
    const pointsPerTrigger = rule[sev] || 0;
    if (pointsPerTrigger === 0) continue;
    // 按频率限制最多触发次数
    const maxTriggers = getMaxTriggers(rule.frequency, period);
    const actualTriggers = Math.min(Number(row.count), maxTriggers);
    totalDeduction += actualTriggers * pointsPerTrigger;
  }

  return totalDeduction;
}

export async function getLaborEfficiencyDeduction(store, period) {
  const { startDate, endDate } = periodDateRange(period);
  const pats = scoringStoreAggregateIlikePatterns(store);
  const result = await pool().query(
    `SELECT AVG(efficiency) AS avg_eff FROM daily_reports WHERE store ILIKE ANY($1::text[]) AND date >= $2::date AND date <= $3::date AND efficiency > 0`,
    [pats, startDate, endDate]
  );
  const avgEff = parseFloat(result.rows[0]?.avg_eff || 0);
  if (!avgEff) return { deduction: 0, severity: null, avgEff: 0 };
  const brand = inferBrandFromStore(store);
  const thresholds = getLaborEfficiencyThresholds(brand);
  if (!thresholds) return { deduction: 0, severity: null, avgEff: Math.round(avgEff) };
  if (avgEff < thresholds.high.below) return { deduction: thresholds.high.points, severity: 'high', avgEff: Math.round(avgEff) };
  if (avgEff < thresholds.medium.below) return { deduction: thresholds.medium.points, severity: 'medium', avgEff: Math.round(avgEff) };
  return { deduction: 0, severity: null, avgEff: Math.round(avgEff) };
}
