/**
 * 增长方案指标计算（外提自 growth-solutions.js）。
 * 具名函数接收 getPool；createGrowthSolutionMetrics 只做薄装配。
 */
import { SHARED_TABLES } from '@gaas/shared';
import {
  brandKeyOf,
  lookupCost,
  normalizeBiz,
  normalizeDishName,
  quadrantsForChannel,
  round2,
} from './metrics-helpers.js';

export async function metricStaffEfficiency(getPool, store, startDate, endDate) {
  const r = await getPool().query(
    `SELECT pre_discount_revenue, staff FROM ${SHARED_TABLES.DAILY_REPORTS}
     WHERE store = $1 AND date >= $2 AND date <= $3`,
    [store, startDate, endDate]
  );
  let revenue = 0;
  let personDays = 0;
  for (const row of r.rows) {
    revenue += Number(row.pre_discount_revenue || 0);
    const staff = row.staff || {};
    for (const arr of Object.values(staff)) {
      if (!Array.isArray(arr)) continue;
      for (const p of arr) personDays += Number(p?.days || 0);
    }
  }
  const value = personDays > 0 ? revenue / personDays : 0;
  return {
    value: round2(value),
    detail: { pre_discount_revenue: round2(revenue), person_days: round2(personDays), days: r.rows.length },
  };
}

export async function metricRevenue(getPool, store, startDate, endDate) {
  const r = await getPool().query(
    `SELECT COALESCE(SUM(actual_revenue),0) AS rev, COUNT(*) AS days
     FROM ${SHARED_TABLES.DAILY_REPORTS} WHERE store = $1 AND date >= $2 AND date <= $3`,
    [store, startDate, endDate]
  );
  const storeCode = store.includes('马己仙') ? '51866138' : (store.includes('洪潮') ? '64822111' : '');
  let sleepingHigh = 0;
  let sleepingMedium = 0;
  if (storeCode) {
    const c = await getPool().query(
      `SELECT risk_level, COUNT(*) AS n FROM growth_churn_predictions
       WHERE store_code = $1 AND risk_level IN ('high','critical','medium','高','极高','中')
         AND prediction_date = (SELECT MAX(prediction_date) FROM growth_churn_predictions WHERE store_code = $1)
       GROUP BY risk_level`,
      [storeCode]
    );
    for (const row of c.rows) {
      if (/high|critical|高/.test(row.risk_level)) sleepingHigh += Number(row.n);
      else sleepingMedium += Number(row.n);
    }
  }
  return {
    value: round2(r.rows[0]?.rev),
    detail: {
      days: Number(r.rows[0]?.days || 0),
      sleeping_customers: sleepingHigh + sleepingMedium,
      sleeping_high: sleepingHigh,
      sleeping_medium: sleepingMedium,
    },
  };
}

export async function metricKitchenStandard(getPool, store, startDate, endDate) {
  const maps = await getPool().query(
    `SELECT scheduled_times FROM dish_station_mapping WHERE store = $1 AND enabled = TRUE`,
    [store]
  );
  let slotsPerDay = 0;
  for (const row of maps.rows) {
    const raw = Array.isArray(row.scheduled_times)
      ? row.scheduled_times
      : String(row.scheduled_times || '').split(/[，,\s]+/);
    const n = raw.map((x) => String(x || '').trim()).filter((x) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(x)).length;
    slotsPerDay += n || 1;
  }
  const dayCount = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);
  const expected = slotsPerDay * dayCount;
  const logs = await getPool().query(
    `SELECT COUNT(*) AS n FROM kitchen_exec_logs WHERE store = $1 AND task_date >= $2 AND task_date <= $3`,
    [store, startDate, endDate]
  );
  const confirmed = Number(logs.rows[0]?.n || 0);
  const rate = expected > 0 ? Math.min(100, (confirmed / expected) * 100) : 0;
  return { value: round2(rate), detail: { expected, confirmed, mappings: maps.rows.length } };
}

export async function complaintDishes(getPool, store, startDate, endDate) {
  const brand = brandKeyOf(store);
  const r = await getPool().query(
    `SELECT trim(dissatisfaction_dish) AS dish, COUNT(*) AS n
     FROM table_visit_records
     WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3
       AND coalesce(trim(dissatisfaction_dish), '') <> ''
     GROUP BY trim(dissatisfaction_dish) ORDER BY n DESC LIMIT 20`,
    [brand, startDate, endDate]
  );
  return r.rows.map((x) => ({ dish: x.dish, count: Number(x.n) }));
}

export async function loadCostMap(getPool, store) {
  const brand = brandKeyOf(store);
  const r = await getPool().query(
    `SELECT dish_name, unit_cost, biz_type FROM dish_library_costs
     WHERE enabled = TRUE AND (brand = $1 OR brand = '*')`,
    [brand]
  );
  const map = { takeaway: new Map(), dinein: new Map(), any: new Map() };
  for (const row of r.rows) {
    const key = normalizeDishName(row.dish_name);
    if (!key) continue;
    const cost = Number(row.unit_cost || 0);
    const biz = String(row.biz_type || '').trim();
    if (/外卖|takeaway|delivery/i.test(biz)) {
      if (!map.takeaway.has(key)) map.takeaway.set(key, cost);
    } else if (/堂食|dinein|店内/i.test(biz)) {
      if (!map.dinein.has(key)) map.dinein.set(key, cost);
    } else if (!map.any.has(key)) {
      map.any.set(key, cost);
    }
  }
  return map;
}

export async function dishAggregates(getPool, store, startDate, endDate) {
  const brand = brandKeyOf(store);
  const r = await getPool().query(
    `SELECT dish_name, category, biz_type,
            SUM(qty) AS qty, SUM(revenue) AS revenue
     FROM ${SHARED_TABLES.POS_SALES_DETAIL}
     WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3
       AND coalesce(trim(dish_name), '') <> ''
     GROUP BY dish_name, category, biz_type`,
    [brand, startDate, endDate]
  );
  const costMap = await loadCostMap(getPool, store);
  return r.rows.map((row) => {
    const biz = normalizeBiz(row.biz_type);
    const key = normalizeDishName(row.dish_name);
    const qty = Number(row.qty || 0);
    const revenue = Number(row.revenue || 0);
    const unitCost = lookupCost(costMap, biz, key);
    const cost = unitCost != null ? unitCost * qty : null;
    return {
      dish: row.dish_name,
      category: row.category || '未分类',
      biz,
      qty,
      revenue: round2(revenue),
      cost: cost != null ? round2(cost) : null,
      profit: cost != null ? round2(revenue - cost) : null,
      margin: cost != null && revenue > 0 ? round2(((revenue - cost) / revenue) * 100) : null,
    };
  });
}

export async function metricMenuOptimization(getPool, store, startDate, endDate) {
  const [complaints, dishes] = await Promise.all([
    complaintDishes(getPool, store, startDate, endDate),
    dishAggregates(getPool, store, startDate, endDate),
  ]);
  const dinein = quadrantsForChannel(dishes.filter((d) => d.biz === 'dinein'));
  const takeaway = quadrantsForChannel(dishes.filter((d) => d.biz === 'takeaway'));
  const issueCount = new Set([
    ...complaints.map((c) => normalizeDishName(c.dish)),
    ...dinein.eliminate.map((d) => normalizeDishName(d.dish)),
    ...takeaway.eliminate.map((d) => normalizeDishName(d.dish)),
  ]).size;
  return {
    value: issueCount,
    detail: { complaint_dishes: complaints, quadrants: { dinein, takeaway } },
  };
}

export async function metricGrossMargin(getPool, store, startDate, endDate) {
  const dishes = await dishAggregates(getPool, store, startDate, endDate);
  const matched = dishes.filter((d) => d.cost != null);
  const rev = matched.reduce((s, d) => s + d.revenue, 0);
  const cost = matched.reduce((s, d) => s + d.cost, 0);
  const margin = rev > 0 ? ((rev - cost) / rev) * 100 : 0;
  const lowMargin = matched
    .filter((d) => d.revenue > 0 && d.qty >= 5)
    .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))
    .slice(0, 10)
    .map((d) => ({
      dish: d.dish,
      category: d.category,
      biz: d.biz,
      qty: d.qty,
      revenue: d.revenue,
      margin: d.margin,
    }));
  const unmatched = dishes.filter((d) => d.cost == null).length;
  return {
    value: round2(margin),
    detail: {
      matched_dishes: matched.length,
      unmatched_dishes: unmatched,
      matched_revenue: round2(rev),
      low_margin_top: lowMargin,
    },
  };
}

export async function metricTrainingReplication(getPool, store) {
  const brand = brandKeyOf(store);
  const emps = await getPool().query(
    `SELECT username, name, position FROM ${SHARED_TABLES.EMPLOYEES}
     WHERE store ILIKE '%' || $1 || '%'
       AND coalesce(status,'') NOT IN ('inactive','disabled','resigned','离职','禁用','停用')
       AND coalesce(trim(position), '') <> ''`,
    [brand]
  );
  const topics = await getPool().query(
    `SELECT id, title, position FROM training_topics WHERE is_active = TRUE AND promotion_required = TRUE`
  );
  const certs = await getPool().query(
    `SELECT employee_username, topic_id FROM training_certifications
     WHERE coalesce(manager_verdict, ai_verdict, '') IN ('pass','approved','通过')`
  );
  const certSet = new Set(certs.rows.map((c) => `${c.employee_username}@@${c.topic_id}`));
  let required = 0;
  let covered = 0;
  const gaps = [];
  for (const e of emps.rows) {
    const myTopics = topics.rows.filter((t) => {
      const positions = String(t.position || '').split(',').map((x) => x.trim());
      return positions.includes(String(e.position || '').trim());
    });
    for (const t of myTopics) {
      required += 1;
      if (certSet.has(`${e.username}@@${t.id}`)) covered += 1;
      else gaps.push({
        username: e.username,
        name: e.name,
        position: e.position,
        topic_id: t.id,
        topic: t.title,
      });
    }
  }
  const rate = required > 0 ? (covered / required) * 100 : 0;
  return {
    value: round2(rate),
    detail: { required, covered, gaps: gaps.slice(0, 50), gap_count: gaps.length },
  };
}

export async function computeMetric(getPool, problemKey, store, startDate, endDate) {
  switch (problemKey) {
    case 'staff_efficiency':
      return metricStaffEfficiency(getPool, store, startDate, endDate);
    case 'revenue':
      return metricRevenue(getPool, store, startDate, endDate);
    case 'kitchen_standard':
      return metricKitchenStandard(getPool, store, startDate, endDate);
    case 'menu_optimization':
      return metricMenuOptimization(getPool, store, startDate, endDate);
    case 'gross_margin':
      return metricGrossMargin(getPool, store, startDate, endDate);
    case 'training_replication':
      return metricTrainingReplication(getPool, store);
    default:
      throw new Error(`unknown problem_key: ${problemKey}`);
  }
}

/**
 * @param {{ pool: () => import('pg').Pool }} deps
 */
export function createGrowthSolutionMetrics(deps) {
  const { pool } = deps;
  return {
    computeMetric: (problemKey, store, startDate, endDate) =>
      computeMetric(pool, problemKey, store, startDate, endDate),
    metricStaffEfficiency: (store, startDate, endDate) =>
      metricStaffEfficiency(pool, store, startDate, endDate),
    metricRevenue: (store, startDate, endDate) => metricRevenue(pool, store, startDate, endDate),
    metricKitchenStandard: (store, startDate, endDate) =>
      metricKitchenStandard(pool, store, startDate, endDate),
    complaintDishes: (store, startDate, endDate) => complaintDishes(pool, store, startDate, endDate),
    loadCostMap: (store) => loadCostMap(pool, store),
    dishAggregates: (store, startDate, endDate) => dishAggregates(pool, store, startDate, endDate),
    metricMenuOptimization: (store, startDate, endDate) =>
      metricMenuOptimization(pool, store, startDate, endDate),
    metricGrossMargin: (store, startDate, endDate) =>
      metricGrossMargin(pool, store, startDate, endDate),
    metricTrainingReplication: (store) => metricTrainingReplication(pool, store),
  };
}
