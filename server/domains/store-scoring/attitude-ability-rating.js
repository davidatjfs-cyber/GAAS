/**
 * 员工评分「工作态度」+「工作能力」评级计算。
 * 从 new-scoring-model.js 拆出。
 */
import { pool } from '../../utils/database.js';
import { inferBrandFromStoreName } from '../../agents.js';
import { resolveAgentCanonicalStore, toFeishuStoreName } from '../../v2-store-alignment.js';
import { safeErrorLog } from '../../utils/error-handler.js';
import { childLogger } from '../../utils/logger.js';
import { scoringStoreAggregateIlikePatterns, periodDateRange } from './store-match-helpers.js';
import { getRuntimeEmployeeRatingConfig, DEFAULT_EMPLOYEE_RATING_CONFIG } from './config.js';

const log = childLogger({ domain: 'store-scoring', handler: 'attitude-ability-rating' });

/**
 * 当月「工作态度」关联任务备案数（与 agents-service-v2 催办/审核链路一致）：
 * master_tasks 中 assignee 命中、来源含抽检/定时/BI 任务卡/数据审计/协作，且已打标 hr_performance_recorded
 *（满 3 次催办仍未闭环、或审核 3 次不通过等；催办路径不向 agent_scores 扣分，仅态度统计）。
 */
/** 当月工作态度备案次数（与 agents 统计一致；已 performance_invalidation 的 task_id 不计入） */
export async function getIncompleteTaskCount(username, period) {
  const un = String(username || '').trim();
  if (!un) return 0;
  const { startDate, endDate } = periodDateRange(period);
  const sources = ['random_inspection', 'scheduled_inspection', 'bi_anomaly', 'auto_collab', 'data_auditor'];
  try {
    const result = await pool().query(
      `SELECT COUNT(DISTINCT task_id)::int AS c
       FROM master_tasks
       WHERE LOWER(TRIM(COALESCE(assignee_username, ''))) = LOWER(TRIM($1))
         AND source = ANY($2::text[])
         AND COALESCE(hr_performance_recorded, false) = true
         AND NOT EXISTS (
           SELECT 1 FROM performance_invalidation_records pir
           WHERE pir.source_type = 'master_tasks_filing'
             AND pir.source_id = master_tasks.task_id
         )
         AND (dispatched_at AT TIME ZONE 'Asia/Shanghai')::date >= $3::date
         AND (dispatched_at AT TIME ZONE 'Asia/Shanghai')::date <= $4::date`,
      [un, sources, startDate, endDate]
    );
    return Number(result.rows[0]?.c || 0);
  } catch (e) {
    safeErrorLog('[attitude] getIncompleteTaskCount', e);
    return 0;
  }
}

// ─────────────────────────────────────────────
// 工作态度评级计算
// ─────────────────────────────────────────────
export async function calculateAttitudeRating(username, period) {
  try {
    const cfg = await getRuntimeEmployeeRatingConfig();
    const t = cfg?.attitude || DEFAULT_EMPLOYEE_RATING_CONFIG.attitude;
    // 获取该用户在period期间未完成的agent任务次数
    const incompleteCount = await getIncompleteTaskCount(username, period);
    
    // 根据未完成任务次数确定评级
    if (incompleteCount <= Number(t.A_max_incomplete)) return 'A';
    else if (incompleteCount <= Number(t.B_max_incomplete)) return 'B';
    else if (incompleteCount <= Number(t.C_max_incomplete ?? 8)) return 'C';
    else return 'D';
    
  } catch (error) {
    log.error({ msg: 'attitude_rating_failed', err: error?.message || String(error) });
    return null;
  }
}

/**
 * 出品经理工作能力用：读 monthly_margins 实际毛利率 + 目标。
 * 根因修复（2026-04）：
 * - 飞书/Bitable 写入的 store 常为「马己仙大宁店」，HRMS 员工表为「马己仙上海音乐广场店」，
 *   原先 `WHERE m.store = $1` 精确匹配会查不到行 → actual 空 → 能力固定 C。
 * - margin_targets 可能未维护某月行，LEFT JOIN 后 target_margin 为空 → 旧逻辑同样判缺省 → C。
 * 与 agents-service `getPMAbilityRating` 口径对齐：别名多键尝试 + 无表目标时按品牌默认（马己仙 64 / 洪潮 69）。
 */
async function getMarginData(store, period) {
  const s = String(store || '').trim();
  const canon = resolveAgentCanonicalStore(s);
  const candidates = [...new Set([s, canon, toFeishuStoreName(s), toFeishuStoreName(canon)].filter(Boolean))];

  for (const storeKey of candidates) {
    const result = await pool().query(
      `SELECT m.actual_margin, t.target_margin, m.brand
       FROM monthly_margins m
       LEFT JOIN margin_targets t ON m.store = t.store AND m.period = t.period
       WHERE m.store = $1 AND m.period = $2
       LIMIT 1`,
      [storeKey, period]
    );
    const row = result.rows?.[0];
    if (row == null || row.actual_margin == null) continue;

    let targetMargin = row.target_margin;
    if (targetMargin == null) {
      const b = String(row.brand || '');
      const inferred = inferBrandFromStoreName(canon || s);
      if (b.includes('洪潮') || inferred === '洪潮') targetMargin = 69;
      else if (b.includes('马己仙') || inferred === '马己仙') targetMargin = 64;
    }

    return {
      actual_margin: row.actual_margin,
      target_margin: targetMargin
    };
  }

  return { actual_margin: null, target_margin: null };
}

// 获取大众点评星级：固定取当月 **9 日** 营业日报「今日点评星级」（与 agents `getManagerAbilityRating` 一致）
async function getMonthlyDianpingRating(store, period) {
  const [year, month] = period.split('-');
  const targetDate = `${year}-${month}-09`;
  const pats = scoringStoreAggregateIlikePatterns(store);

  const result = await pool().query(
    `SELECT dianping_rating FROM daily_reports
     WHERE date = $1::date AND dianping_rating IS NOT NULL
       AND store ILIKE ANY($2::text[])
     LIMIT 1`,
    [targetDate, pats]
  );

  return Number(result.rows[0]?.dianping_rating) || null;
}

// ─────────────────────────────────────────────
// 工作能力评级计算
// ─────────────────────────────────────────────
export async function calculateAbilityRating(store, username, role, period) {
  try {
    const cfg = await getRuntimeEmployeeRatingConfig();
    if (role === 'store_production_manager') {
      // 出品经理：基于毛利率
      const marginData = await getMarginData(store, period);
      const actualM = Number(marginData.actual_margin);
      const targetM = Number(marginData.target_margin);
      if (!Number.isFinite(actualM) || !Number.isFinite(targetM)) {
        return null;
      }

      const diff = actualM - targetM;
      const t = cfg?.ability?.store_production_manager || DEFAULT_EMPLOYEE_RATING_CONFIG.ability.store_production_manager;
      
      if (diff >= Number(t.A_min_diff)) return 'A';
      else if (diff >= Number(t.B_min_diff) && diff <= Number(t.B_max_diff)) return 'B';
      else if (diff >= Number(t.C_min_diff) && diff <= Number(t.C_max_diff)) return 'C';
      else return 'D';
    }
    
    if (role === 'store_manager') {
      // 店长：基于大众点评星级
      const rating = await getMonthlyDianpingRating(store, period);
      const brand = inferBrandFromStoreName(store);
      
      if (!rating) return null;

      const key = brand === '洪潮' ? 'hongchao' : 'majixian';
      const rules = cfg?.ability?.store_manager?.[key] || DEFAULT_EMPLOYEE_RATING_CONFIG.ability.store_manager[key];
      if (!rules) return null;
      
      if (rating >= Number(rules.A_min_rating)) return 'A';
      else if (rating >= Number(rules.B_min_rating)) return 'B';
      else if (rating >= Number(rules.C_min_rating)) return 'C';
      else return 'D';
    }
    
    return null;

  } catch (error) {
    log.error({ msg: 'ability_rating_failed', err: error?.message || String(error) });
    return null;
  }
}
