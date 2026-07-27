/**
 * 门店评级计算：达成率 → A~D，并落库 store_ratings。
 * 从 new-scoring-model.js 拆出。
 */
import { pool, resolveTenantIdDefault } from '../../utils/database.js';
import { inferBrandFromStoreName } from '../../agents.js';
import { resolveAgentCanonicalStore } from '../../v2-store-alignment.js';
import { childLogger } from '../../utils/logger.js';
import { scoringStoreAggregateIlikePatterns, scoringStoreMatchPatterns, periodDateRange } from './store-match-helpers.js';

const log = childLogger({ domain: 'store-scoring', handler: 'store-rating' });

// 检查是否为新门店
async function checkIfNewStore(store, period) {
  // 旧逻辑：仅依赖 store_ratings 是否已有更早月份记录。
  // 但如果历史 store_ratings 表未回填/未生成，会把“实际有经营数据的老门店”误判为新门店，从而导致本月 store_rating 空值。
  // 新逻辑：检查 daily_reports 在该月开始日期之前是否已有数据。
  const [year, month] = String(period || '').split('-');
  if (!year || !month) return true;
  const startDate = `${year}-${month}-01`;
  const pats = scoringStoreMatchPatterns(store);
  const result = await pool().query(
    `SELECT COUNT(*)::int AS count
     FROM daily_reports
     WHERE date < $1::date
       AND store ILIKE ANY($2::text[])`,
    [startDate, pats]
  );

  return Number(result.rows[0]?.count || 0) === 0;
}

// 获取月度实际营业额
async function getMonthlyActualRevenue(store, period) {
  const { startDate, endDate } = periodDateRange(period);
  const pats = scoringStoreAggregateIlikePatterns(store);

  const result = await pool().query(`
    SELECT COALESCE(SUM(actual_revenue), 0) as total_revenue
    FROM daily_reports 
    WHERE date >= $1 AND date <= $2
      AND store ILIKE ANY($3::text[])
  `, [startDate, endDate, pats]);
  
  return Number(result.rows[0]?.total_revenue || 0);
}

// 获取月度目标营业额
async function getMonthlyTargetRevenue(store, period) {
  const pats = scoringStoreAggregateIlikePatterns(store);
  const result = await pool().query(`
    SELECT target_revenue FROM revenue_targets 
    WHERE period = $1 AND store ILIKE ANY($2::text[])
    ORDER BY LENGTH(store) DESC NULLS LAST
    LIMIT 1
  `, [period, pats]);
  
  const direct = Number(result.rows[0]?.target_revenue || 0);
  if (direct > 0) return direct;

  // 当月目标未录入时，回落到该门店不晚于当月的最近一期目标（避免评级任务因缺行而跳过）
  const fallback = await pool().query(`
    SELECT target_revenue FROM revenue_targets
    WHERE period <= $1 AND store ILIKE ANY($2::text[])
    ORDER BY period DESC NULLS LAST, LENGTH(store) DESC NULLS LAST
    LIMIT 1
  `, [period, pats]);
  return Number(fallback.rows[0]?.target_revenue || 0);
}

/** revenue_targets 仅按品牌维护一行或简称与规范店名不一致时的兜底 */
async function getMonthlyTargetRevenueByBrand(brand, period, canonStore) {
  const b = String(brand || '').trim();
  if (!b) return 0;
  const needle = String(canonStore || '').replace(/%/g, '').trim();
  const r = await pool().query(
    `SELECT target_revenue, store FROM revenue_targets
     WHERE period = $1 AND brand = $2
     ORDER BY
       CASE WHEN $3 <> '' AND store ILIKE '%' || $3 || '%' THEN 0 ELSE 1 END,
       LENGTH(store) DESC NULLS LAST
     LIMIT 1`,
    [period, b, needle]
  );
  return Number(r.rows[0]?.target_revenue || 0);
}

// 保存门店评级
async function saveStoreRating(store, brand, period, actualRevenue, targetRevenue, achievementRate, rating) {
  const tenantId = resolveTenantIdDefault();
  await pool().query(`
    INSERT INTO store_ratings 
    (store, brand, period, actual_revenue, target_revenue, achievement_rate, rating, tenant_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (store, brand, period, tenant_id)
    DO UPDATE SET 
      actual_revenue = EXCLUDED.actual_revenue,
      target_revenue = EXCLUDED.target_revenue,
      achievement_rate = EXCLUDED.achievement_rate,
      rating = EXCLUDED.rating
  `, [store, brand, period, actualRevenue, targetRevenue, achievementRate, rating, tenantId]);
}

// ─────────────────────────────────────────────
// 门店评级计算函数
// ─────────────────────────────────────────────
export async function calculateStoreRating(store, brand, period) {
  try {
    const canon = String(resolveAgentCanonicalStore(String(store || '').trim()) || String(store || '').trim()).trim();
    if (!canon) {
      return { rating: null, reason: '门店名为空' };
    }
    const brandUse = String(brand || '').trim() || inferBrandFromStoreName(canon);

    // 1. 新门店原规则：第一个月不评级
    // 为满足 4/1 起正式执行时「门店评级必须能显示」，这里不再早退。
    // （仍保留 checkIfNewStore 供后续扩展/审计使用）
    await checkIfNewStore(canon, period);
    
    // 2. 获取实际营业额（从daily_reports汇总）
    const actualRevenue = await getMonthlyActualRevenue(canon, period);
    
    // 3. 获取目标营业额（从revenue_targets；门店名多种写法 + 按品牌回退）
    let targetRevenue = await getMonthlyTargetRevenue(canon, period);
    if (!targetRevenue || targetRevenue <= 0) {
      targetRevenue = await getMonthlyTargetRevenueByBrand(brandUse, period, canon);
    }
    
    if (!targetRevenue || targetRevenue <= 0) {
      return { rating: null, reason: '目标营业额未设置或为0' };
    }
    
    // 4. 计算达成率
    const achievementRate = Number((actualRevenue / targetRevenue * 100).toFixed(2));
    
    // 5. 确定评级
    let rating = 'D';
    if (achievementRate > 95) rating = 'A';
    else if (achievementRate > 90) rating = 'B';
    else if (achievementRate >= 85) rating = 'C';
    
    // 6. 保存结果（统一规范门店名，避免飞书简称与日报全称各写一行导致「我的档案」读不到）
    await saveStoreRating(canon, brandUse, period, actualRevenue, targetRevenue, achievementRate, rating);
    
    return { rating, achievementRate, actualRevenue, targetRevenue };
    
  } catch (error) {
    log.error({ msg: 'store_rating_failed', err: error?.message || String(error) });
    return { rating: null, reason: error.message };
  }
}
