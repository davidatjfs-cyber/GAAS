/**
 * 增长流失预测：growth_churn_predictions 读写（从 growth-phases 外提）。
 * 不接触 req/res。
 */
import { cleanText } from '../growth-phase-auth.js';

function todayShanghaiYmd() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export function safeDateOnly(value) {
  const s = cleanText(value, 32);
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ storeCode?: string, riskLevel?: string, predDate?: string, limit?: number }} opts
 */
export async function listChurnPredictions(pool, opts = {}) {
  const storeCode = cleanText(opts.storeCode || '', 128);
  const riskLevel = cleanText(opts.riskLevel || '', 20);
  const predDate = safeDateOnly(opts.predDate || '');
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
  const r = await pool.query(
    `SELECT * FROM growth_churn_predictions
      WHERE ($1 = '' OR store_code = $1)
        AND ($2 = '' OR risk_level = $2)
        AND ($3 = '' OR prediction_date = $3::date)
      ORDER BY prediction_date DESC, churn_score ASC
      LIMIT $4`,
    [storeCode, riskLevel, predDate, limit]
  );
  const summary = { total: r.rows.length, high: 0, medium: 0, low: 0 };
  r.rows.forEach((x) => {
    if (summary[x.risk_level] !== undefined) summary[x.risk_level]++;
  });
  return { predictions: r.rows, summary };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} storeCode
 * @param {string} [tenantId='default']
 */
export async function computeChurnScores(pool, storeCode, tenantId = 'default') {
  const store = cleanText(storeCode, 128);
  const today = todayShanghaiYmd();

  const r = await pool.query(
    `WITH customer_visits AS (
       SELECT
         gc.id AS customer_id,
         gc.phone,
         COALESCE(NULLIF(gc.meta->>'title',''), NULLIF(gcp.source_signals->>'name',''), NULLIF(gc.meta->>'name',''), '') AS customer_name,
         COALESCE(gcp.store_id, gc.last_store_id, '') AS store_code,
         COUNT(po.id)::int AS total_orders,
         MAX(po.biz_date) AS last_visit,
         AVG(po.amount_after_discount) AS avg_spend,
         COALESCE(SUM(po.amount_after_discount) FILTER (WHERE po.biz_date >= CURRENT_DATE - INTERVAL '30 day'), 0) AS spend_30d,
         COALESCE(SUM(po.amount_after_discount) FILTER (WHERE po.biz_date >= CURRENT_DATE - INTERVAL '60 day' AND po.biz_date < CURRENT_DATE - INTERVAL '30 day'), 0) AS spend_30_60d,
         COUNT(po.id) FILTER (WHERE po.biz_date >= CURRENT_DATE - INTERVAL '30 day')::int AS visits_30d,
         COUNT(po.id) FILTER (WHERE po.biz_date >= CURRENT_DATE - INTERVAL '60 day' AND po.biz_date < CURRENT_DATE - INTERVAL '30 day')::int AS visits_30_60d
       FROM growth_customers gc
       LEFT JOIN growth_customer_profiles gcp ON gcp.customer_id = gc.id AND gcp.tenant_id = $2
       LEFT JOIN pos_orders po
         ON (po.customer_id = gc.id OR (po.customer_id IS NULL AND po.phone = gc.phone))
       WHERE ($1 = '' OR COALESCE(gcp.store_id, gc.last_store_id, '') = $1)
         AND gc.phone IS NOT NULL AND gc.phone <> ''
         AND po.biz_date IS NOT NULL
         AND gc.tenant_id = $2
       GROUP BY gc.id, gc.phone, customer_name, store_code
       HAVING COUNT(po.id) >= 2
     )
     SELECT *,
       (CURRENT_DATE - last_visit)::int AS days_since_last,
       CASE WHEN total_orders > 1
         THEN ROUND(
           (last_visit - MIN(last_visit) OVER (PARTITION BY customer_id))::numeric / GREATEST(total_orders - 1, 1)
         )
         ELSE 30 END AS avg_cycle_days
     FROM customer_visits`,
    [store, tenantId]
  );

  const predictions = [];
  for (const row of r.rows || []) {
    let score = 100;
    const factors = [];
    const daysSince = Number(row.days_since_last || 0);
    const avgCycle = Math.max(Number(row.avg_cycle_days || 30), 7);
    const spend30 = Number(row.spend_30d || 0);
    const spend3060 = Number(row.spend_30_60d || 0);
    const visits30 = Number(row.visits_30d || 0);
    const visits3060 = Number(row.visits_30_60d || 0);

    if (daysSince > avgCycle) {
      score -= 20;
      factors.push(`超过平均回访周期${Math.round((daysSince / avgCycle) * 10) / 10}倍`);
    }
    if (daysSince > avgCycle * 2) {
      score -= 20;
      factors.push('超过平均回访周期2倍');
    }

    if (spend3060 > 0 && spend30 < spend3060 * 0.7) {
      const pct = Math.round((1 - spend30 / spend3060) * 100);
      score -= 20;
      factors.push(`消费金额环比下降${pct}%`);
    }

    if (visits3060 > 0 && visits30 < visits3060) {
      score -= 20;
      factors.push(`到店次数减少（近30天${visits30}次 vs 前30天${visits3060}次）`);
    }

    const spendTrendPct = spend3060 > 0
      ? Number(((spend30 - spend3060) / spend3060 * 100).toFixed(2))
      : 0;

    const riskLevel = score <= 40 ? 'high' : score <= 60 ? 'medium' : 'low';
    predictions.push({
      prediction_date: today,
      store_code: cleanText(row.store_code, 128),
      customer_id: Number(row.customer_id),
      phone: cleanText(row.phone, 32),
      customer_name: cleanText(row.customer_name, 80),
      churn_score: Math.max(0, score),
      risk_level: riskLevel,
      factors: JSON.stringify(factors),
      last_visit_days: daysSince,
      avg_visit_cycle_days: avgCycle,
      spend_trend_pct: spendTrendPct,
      visit_trend: visits30 - visits3060,
    });
  }

  let saved = 0;
  for (const p of predictions) {
    await pool.query(
      `INSERT INTO growth_churn_predictions
         (prediction_date, store_code, customer_id, phone, customer_name,
          churn_score, risk_level, factors, last_visit_days, avg_visit_cycle_days,
          spend_trend_pct, visit_trend, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)
       ON CONFLICT (prediction_date, store_code, customer_id, tenant_id)
       DO UPDATE SET
         churn_score = EXCLUDED.churn_score,
         risk_level = EXCLUDED.risk_level,
         factors = EXCLUDED.factors,
         last_visit_days = EXCLUDED.last_visit_days,
         spend_trend_pct = EXCLUDED.spend_trend_pct,
         visit_trend = EXCLUDED.visit_trend`,
      [p.prediction_date, p.store_code, p.customer_id, p.phone, p.customer_name,
        p.churn_score, p.risk_level, p.factors, p.last_visit_days,
        p.avg_visit_cycle_days, p.spend_trend_pct, p.visit_trend, tenantId]
    ).catch(() => {});
    saved++;
  }
  return { total: predictions.length, saved, high_risk: predictions.filter((p) => p.risk_level === 'high').length };
}
