/**
 * 员工评分「工作执行力」评级计算。
 * 从 new-scoring-model.js 拆出。
 */
import { pool } from '../../utils/database.js';
import { inferBrandFromStoreName } from '../../agents.js';
import {
  countFullyCompliantPMDaysInRange,
  getMajixianMeetingExecutionStatsFromAgentMessages
} from '../../lib/pm-execution-for-scoring.js';
import { childLogger } from '../../utils/logger.js';
import { scoringStoreAggregateIlikePatterns, periodDateRange, getDaysInPeriod } from './store-match-helpers.js';
import { getRuntimeEmployeeRatingConfig, DEFAULT_EMPLOYEE_RATING_CONFIG } from './config.js';

const log = childLogger({ domain: 'store-scoring', handler: 'execution-rating' });

// 获取企微会员每月新增数量（洪潮店长执行力评级用）
async function getMonthlyNewWechatMembers(store, period) {
  const { startDate, endDate } = periodDateRange(period);
  
  try {
    const pats = scoringStoreAggregateIlikePatterns(store);
    const result = await pool().query(
      `SELECT COALESCE(SUM(new_wechat_members), 0) AS total
       FROM daily_reports
       WHERE date >= $1::date AND date <= $2::date
         AND store ILIKE ANY($3::text[])`,
      [startDate, endDate, pats]
    );
    
    return Number(result.rows[0]?.total || 0);
  } catch (e) {
    log.warn({ msg: 'wechat_members_query_error', err: e?.message });
    return 0;
  }
}

async function hasDailyReportsForStoreAggregate(store, period) {
  const { startDate, endDate } = periodDateRange(period);
  const pats = scoringStoreAggregateIlikePatterns(store);
  const r = await pool().query(
    `SELECT COUNT(*)::int AS c FROM daily_reports
     WHERE date >= $1::date AND date <= $2::date AND store ILIKE ANY($3::text[])`,
    [startDate, endDate, pats]
  );
  return (Number(r.rows[0]?.c) || 0) > 0;
}

// ─────────────────────────────────────────────
// 执行力评级计算
// ─────────────────────────────────────────────
export async function calculateExecutionRating(store, username, role, period) {
  try {
    const cfg = await getRuntimeEmployeeRatingConfig();
    if (role === 'store_production_manager') {
      // 出品经理：agent_messages（开档/收档/原料），按业务日
      const [year, month] = period.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = `${year}-${month}-${String(getDaysInPeriod(period)).padStart(2, '0')}`;
      const brandTag = inferBrandFromStoreName(store);
      const brandZh = brandTag === '洪潮' ? '洪潮' : '马己仙';
      const expectedDays = getDaysInPeriod(period);
      const compliantDays = await countFullyCompliantPMDaysInRange(store, brandZh, startDate, endDate);
      const nonCompliantDays = Math.max(0, expectedDays - compliantDays);
      const t = cfg?.execution?.store_production_manager || DEFAULT_EMPLOYEE_RATING_CONFIG.execution.store_production_manager;

      const maxA = Number(t.A_max_noncompliant_days ?? 2);
      const maxB = Number(t.B_max_noncompliant_days ?? 5);
      const maxC = Number(t.C_max_noncompliant_days ?? 10);
      if (nonCompliantDays <= maxA) return 'A';
      if (nonCompliantDays <= maxB) return 'B';
      if (nonCompliantDays <= maxC) return 'C';
      return 'D';
    }
    
    if (role === 'store_manager') {
      const brand = inferBrandFromStoreName(store);
      
      if (brand === '洪潮') {
        // 洪潮店长：企微会员每月新增数量
        const newMembers = await getMonthlyNewWechatMembers(store, period);
        if (newMembers <= 0 && !(await hasDailyReportsForStoreAggregate(store, period))) {
          return null;
        }
        const t = cfg?.execution?.store_manager?.hongchao || DEFAULT_EMPLOYEE_RATING_CONFIG.execution.store_manager.hongchao;
        if (newMembers >= Number(t.A_min_new_members)) return 'A';
        else if (newMembers >= Number(t.B_min_new_members)) return 'B';
        else if (newMembers >= Number(t.C_min_new_members)) return 'C';
        else return 'D';
      } else {
        const [y2, m2] = period.split('-');
        const ms = `${y2}-${m2}-01`;
        const me = `${y2}-${m2}-${String(getDaysInPeriod(period)).padStart(2, '0')}`;
        const mx = await getMajixianMeetingExecutionStatsFromAgentMessages(store, ms, me);
        const expectedDays = getDaysInPeriod(period);
        const totalMissing = Math.max(0, expectedDays - mx.totalMeetings);
        const lowScoreCount = mx.unqualifiedMeetings;
        const t = cfg?.execution?.store_manager?.majixian || DEFAULT_EMPLOYEE_RATING_CONFIG.execution.store_manager.majixian;
        if (totalMissing <= Number(t.A_max_missing) && lowScoreCount <= Number(t.A_max_low_score)) return 'A';
        else if (totalMissing <= Number(t.B_max_missing) && lowScoreCount <= Number(t.B_max_low_score)) return 'B';
        else if (totalMissing <= Number(t.C_max_missing) && lowScoreCount <= Number(t.C_max_low_score)) return 'C';
        else return 'D';
      }
    }
    
    return null;

  } catch (error) {
    log.error({ msg: 'execution_rating_failed', err: error?.message || String(error) });
    return null;
  }
}
