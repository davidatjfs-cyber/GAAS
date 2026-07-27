/**
 * 员工月度综合评分计算：绩效分 + 加减分 + 三项评级，并落库 employee_scores。
 * 从 new-scoring-model.js 拆出。
 */
import { pool, resolveTenantIdDefault } from '../../utils/database.js';
import { inferBrandFromStoreName } from '../../agents.js';
import { childLogger } from '../../utils/logger.js';
import { getDaysInPeriod } from './store-match-helpers.js';
import { EMPLOYEE_RATING_PENDING } from './config.js';
import { calculateExecutionRating } from './execution-rating.js';
import { calculateAttitudeRating, calculateAbilityRating } from './attitude-ability-rating.js';
import { calculateExceptionBonus, calculateExceptionDeduction, getLaborEfficiencyDeduction } from './exception-adjustments.js';

const log = childLogger({ domain: 'store-scoring', handler: 'employee-score' });

/**
  * 与 agents-service「月度综合」一致：上月最新自然周 `anomaly_rollups_v2` 的 total_score。
  * BI 异常经 periodic-scoring 已体现在周行扣分与 total_score 中；此处不再用 agent_issues 加减分混算 total_score，避免双口径。
  * 只有毛利率异常不在周度中体现，需额外扣除。
 */
export async function getMonthlyAnomalyRollupAverageScore(username, period) {
  const [year, month] = String(period || '').split('-');
  if (!year || !month) return 100;
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-${String(getDaysInPeriod(period)).padStart(2, '0')}`;
  const monthKey = `${year}${String(month).padStart(2, '0')}`;
  const r = await pool().query(
    `SELECT total_score
     FROM agent_scores
     WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
       AND score_model = 'anomaly_rollups_v2'
       AND COALESCE(is_invalidated, false) = false
       AND period LIKE 'week_%'
       AND (
         (POSITION('__' IN period) = 0
           AND substring(period from 6 for 10)::date >= $2::date
           AND substring(period from 6 for 10)::date <= $3::date)
         OR
         (POSITION('__' IN period) > 0 AND split_part(period, '__', 2) = $4)
       )
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [username, startDate, endDate, monthKey]
  );
  if (r.rows.length > 0) {
    return Number(r.rows[0].total_score);
  }
  return 100;
}

// 保存员工评分
async function saveEmployeeScore(store, username, role, period, scoreData) {
  await pool().query(`
    INSERT INTO employee_scores
    (store, brand, username, name, role, period, base_score, exception_bonus, exception_deduction,
     total_score, execution_rating, attitude_rating, ability_rating, execution_data, attitude_data, ability_data, tenant_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (store, username, role, period, tenant_id)
    DO UPDATE SET
      base_score = EXCLUDED.base_score,
      exception_bonus = EXCLUDED.exception_bonus,
      exception_deduction = EXCLUDED.exception_deduction,
      total_score = EXCLUDED.total_score,
      execution_rating = EXCLUDED.execution_rating,
      attitude_rating = EXCLUDED.attitude_rating,
      ability_rating = EXCLUDED.ability_rating,
      execution_data = EXCLUDED.execution_data,
      attitude_data = EXCLUDED.attitude_data,
      ability_data = EXCLUDED.ability_data,
      updated_at = NOW()
  `, [
    store, inferBrandFromStoreName(store), username, null, role, period,
    scoreData.base_score, scoreData.exception_bonus, scoreData.exception_deduction,
    scoreData.total_score, scoreData.execution_rating, scoreData.attitude_rating, scoreData.ability_rating,
    JSON.stringify(scoreData.execution_data || {}), JSON.stringify(scoreData.attitude_data || {}), JSON.stringify(scoreData.ability_data || {}),
    resolveTenantIdDefault()
  ]);
}

export async function calculateEmployeeScore(store, username, role, period) {
  try {
    const latestWeekScore = await getMonthlyAnomalyRollupAverageScore(username, period);
    const exceptionBonus = await calculateExceptionBonus(username, period);
    const exceptionDeduction = await calculateExceptionDeduction(username, period);
    const laborEffDeduction = await getLaborEfficiencyDeduction(store, period);
    const baseScore = latestWeekScore;
    const totalScore = Math.round(latestWeekScore + exceptionBonus - exceptionDeduction - laborEffDeduction.deduction);

    // 2～4：缺数据或无法判断 → 待定（禁止再用 C/D 当默认值误导）
    let executionRating = EMPLOYEE_RATING_PENDING;
    try {
      executionRating = (await calculateExecutionRating(store, username, role, period)) ?? EMPLOYEE_RATING_PENDING;
    } catch (e) {
      log.warn({ msg: 'employee_score_execution_rating_error', err: e?.message });
      executionRating = EMPLOYEE_RATING_PENDING;
    }

    let attitudeRating = EMPLOYEE_RATING_PENDING;
    try {
      attitudeRating = (await calculateAttitudeRating(username, period)) ?? EMPLOYEE_RATING_PENDING;
    } catch (e) {
      log.warn({ msg: 'employee_score_attitude_rating_error', err: e?.message });
      attitudeRating = EMPLOYEE_RATING_PENDING;
    }

    let abilityRating = EMPLOYEE_RATING_PENDING;
    try {
      abilityRating = (await calculateAbilityRating(store, username, role, period)) ?? EMPLOYEE_RATING_PENDING;
    } catch (e) {
      log.warn({ msg: 'employee_score_ability_rating_error', err: e?.message });
      abilityRating = EMPLOYEE_RATING_PENDING;
    }
    
    // 5. 保存结果
    try {
      await saveEmployeeScore(store, username, role, period, {
        base_score: baseScore,
        exception_bonus: exceptionBonus,
        exception_deduction: exceptionDeduction + laborEffDeduction.deduction,
        total_score: totalScore,
        execution_rating: executionRating,
        attitude_rating: attitudeRating,
        ability_rating: abilityRating
      });
    } catch (e) { log.warn({ msg: 'employee_score_save_error', err: e?.message }); }
    
    return {
      base_score: baseScore,
      total_score: totalScore,
      execution_rating: executionRating,
      attitude_rating: attitudeRating,
      ability_rating: abilityRating
    };
    
  } catch (error) {
    log.error({ msg: 'employee_score_failed', err: error?.message || String(error) });
    return {
      base_score: null,
      total_score: null,
      execution_rating: EMPLOYEE_RATING_PENDING,
      attitude_rating: EMPLOYEE_RATING_PENDING,
      ability_rating: EMPLOYEE_RATING_PENDING
    };
  }
}
