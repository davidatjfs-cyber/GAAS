/**
 * 业态分层基准库：跨租户但不跨business_type混算——AI诊断永远只跟同类型同规模同价格带的门店比较。
 * 这是"多租户数据管道反哺AI"的核心资产：具体用哪个LLM生成话术不影响这份基准库的价值。
 */
import { classifyBusinessType, classifyScale, classifyPriceBand, getKpiWeights as getDefaultKpiWeights } from './store-segments.js';

const BENCHMARK_WINDOW_DAYS = 90;
const MIN_SAMPLE_SIZE = 20; // 样本量(门店数)不足时不生成platform基准，避免用几个租户的个案冒充规律

// 没有平台真实数据时的行业参考值兜底(粗略区间，来源:公开餐饮行业报告，非本平台专属数据)。
// 明确标注 source='industry_reference'，跟真实基准区分，绝不能混着展示成"我们的数据"。
const INDUSTRY_REFERENCE_BENCHMARKS = {
  hotpot: { avg_ticket_price: { p25: 45, p50: 65, p75: 95, p90: 130 }, table_turnover_rate: { p25: 1.2, p50: 1.6, p75: 2.1, p90: 2.8 }, gross_margin_rate: { p25: 0.55, p50: 0.62, p75: 0.68, p90: 0.72 } },
  cafe: { avg_ticket_price: { p25: 30, p50: 45, p75: 65, p90: 90 }, gross_margin_rate: { p25: 0.6, p50: 0.68, p75: 0.75, p90: 0.8 } },
  banquet: { avg_ticket_price: { p25: 120, p50: 180, p75: 260, p90: 380 }, gross_margin_rate: { p25: 0.5, p50: 0.58, p75: 0.65, p90: 0.7 } },
  casual_dining: { avg_ticket_price: { p25: 45, p50: 65, p75: 90, p90: 130 }, table_turnover_rate: { p25: 1.0, p50: 1.4, p75: 1.9, p90: 2.4 }, gross_margin_rate: { p25: 0.55, p50: 0.63, p75: 0.7, p90: 0.75 } },
  mixed: { avg_ticket_price: { p25: 45, p50: 65, p75: 90, p90: 130 }, gross_margin_rate: { p25: 0.55, p50: 0.63, p75: 0.7, p90: 0.75 } },
};

// 目前有可靠数据来源、能真正算出来的指标；权重矩阵里定义的其它KPI(如customer_satisfaction/nps/
// member_active_rate)还没有对应数据源，先在taxonomy里声明权重，等对应数据接入后再加进这里。
const METRIC_EXPRESSIONS = {
  avg_ticket_price: `NULLIF(dine_revenue,0) / NULLIF(dine_orders,0)`,
  table_turnover_rate: `NULLIF(dine_orders,0)::numeric / NULLIF(dine_traffic,0)`,
  gross_margin_rate: `NULLIF(actual_margin,0)`,
};

/**
 * 用 growth_ontology_stores.business_type 原始文本 + daily_reports 真实经营数据，
 * 回填标准化的 business_type/scale/price_band。幂等，可反复跑；不改动租户自己填的原文。
 */
export async function classifyAllStores(pool) {
  const stores = await pool.query(
    `SELECT store_id, tenant_id, business_type AS raw_business_type FROM growth_ontology_stores WHERE status = 'active'`
  );
  let updated = 0;
  for (const row of stores.rows || []) {
    const businessType = classifyBusinessType(row.raw_business_type);
    const statsR = await pool.query(
      `SELECT AVG(actual_revenue) AS avg_daily_revenue, AVG(NULLIF(dine_revenue,0) / NULLIF(dine_orders,0)) AS avg_ticket
         FROM daily_reports
        WHERE tenant_id = $1 AND store = (SELECT name FROM growth_ontology_stores WHERE store_id = $2)
          AND date >= CURRENT_DATE - $3::int`,
      [row.tenant_id, row.store_id, BENCHMARK_WINDOW_DAYS]
    );
    const stats = statsR.rows?.[0] || {};
    const scale = classifyScale({ avgDailyRevenue: stats.avg_daily_revenue });
    const priceBand = classifyPriceBand(stats.avg_ticket);
    await pool.query(
      `UPDATE growth_ontology_stores SET business_type = $2, scale = $3, price_band = $4, updated_at = NOW() WHERE store_id = $1`,
      [row.store_id, businessType, scale, priceBand]
    );
    updated += 1;
  }
  return { ok: true, updated };
}

/**
 * 按 business_type + scale + price_band 分组，用真实 daily_reports 数据算完整统计分布
 * (百分位 + 均值 + 标准差)，不是单一均值。样本量(不同门店数)不足 MIN_SAMPLE_SIZE 时不写入
 * platform基准，避免个别租户的数据被当成"这个业态的通用规律"。
 */
export async function computeAllBenchmarks(pool) {
  await pool.query('BEGIN');
  try {
    let written = 0;
    for (const [metricName, expr] of Object.entries(METRIC_EXPRESSIONS)) {
      const r = await pool.query(
        `SELECT
           gos.business_type,
           gos.scale,
           gos.price_band,
           PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY v) AS p10,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY v) AS p25,
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY v) AS p50,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY v) AS p75,
           PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY v) AS p90,
           AVG(v) AS mean,
           STDDEV(v) AS std,
           COUNT(DISTINCT gos.store_id) AS sample_stores
         FROM daily_reports dr
         JOIN growth_ontology_stores gos
           ON gos.tenant_id = dr.tenant_id AND gos.name = dr.store
         CROSS JOIN LATERAL (SELECT ${expr} AS v) calc
         WHERE dr.date >= CURRENT_DATE - $1::int
           AND gos.business_type IS NOT NULL
           AND v IS NOT NULL AND v > 0
         GROUP BY gos.business_type, gos.scale, gos.price_band`,
        [BENCHMARK_WINDOW_DAYS]
      );
      for (const row of r.rows || []) {
        const sampleSize = Number(row.sample_stores);
        if (sampleSize < MIN_SAMPLE_SIZE) continue; // 样本不足，跳过，留给行业参考值兜底
        const confidenceScore = Math.min(1, sampleSize / 200); // 200家门店样本视为置信度拉满，可后续调整
        await pool.query(
          `INSERT INTO growth_ontology_benchmarks
             (business_type, scale, price_band, region, metric_name, sample_size, p10, p25, p50, p75, p90, mean, std, confidence_score, source, last_updated)
           VALUES ($1,$2,$3,'all',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'platform',NOW())
           ON CONFLICT (business_type, scale, price_band, region, metric_name, source)
           DO UPDATE SET sample_size=EXCLUDED.sample_size, p10=EXCLUDED.p10, p25=EXCLUDED.p25, p50=EXCLUDED.p50,
                         p75=EXCLUDED.p75, p90=EXCLUDED.p90, mean=EXCLUDED.mean, std=EXCLUDED.std,
                         confidence_score=EXCLUDED.confidence_score, last_updated=NOW()`,
          [row.business_type, row.scale, row.price_band, metricName, sampleSize, row.p10, row.p25, row.p50, row.p75, row.p90, row.mean, row.std, confidenceScore]
        );
        written += 1;
      }
    }
    await pool.query('COMMIT');
    return { ok: true, written };
  } catch (e) {
    await pool.query('ROLLBACK');
    throw e;
  }
}

/**
 * 给诊断/AI用的查询入口：优先用平台真实基准，样本不足时明确标注回退到行业参考值，
 * 绝不把两者混在一起说成"我们的数据"。
 */
export async function getBenchmarkForStore(pool, storeId, metricName) {
  const storeR = await pool.query(`SELECT business_type, scale, price_band FROM growth_ontology_stores WHERE store_id = $1`, [storeId]);
  const store = storeR.rows?.[0];
  if (!store?.business_type) return null;

  const platformR = await pool.query(
    `SELECT p10, p25, p50, p75, p90, mean, std, sample_size, confidence_score FROM growth_ontology_benchmarks
      WHERE business_type = $1 AND scale = $2 AND price_band = $3 AND metric_name = $4 AND source = 'platform'
      ORDER BY last_updated DESC LIMIT 1`,
    [store.business_type, store.scale, store.price_band, metricName]
  );
  if (platformR.rows?.[0]) {
    return { ...platformR.rows[0], business_type: store.business_type, scale: store.scale, price_band: store.price_band, source: 'platform' };
  }

  const industry = INDUSTRY_REFERENCE_BENCHMARKS[store.business_type]?.[metricName] || INDUSTRY_REFERENCE_BENCHMARKS.mixed?.[metricName];
  if (!industry) return null;
  return {
    ...industry,
    sample_size: 0,
    confidence_score: 0,
    business_type: store.business_type,
    scale: store.scale,
    price_band: store.price_band,
    source: 'industry_reference',
  };
}

/**
 * KPI权重：优先用平台运营人员在 growth_ontology_kpi_weights 里调整过的覆盖值，
 * 没有覆盖时用代码内置的默认矩阵(store-segments.js KPI_WEIGHTS)。
 */
export async function getKpiWeightsForBusinessType(pool, businessType) {
  const r = await pool.query(`SELECT weights FROM growth_ontology_kpi_weights WHERE business_type = $1`, [businessType]);
  if (r.rows?.[0]?.weights && Object.keys(r.rows[0].weights).length) return r.rows[0].weights;
  return getDefaultKpiWeights(businessType);
}
