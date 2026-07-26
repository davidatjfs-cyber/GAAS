/**
 * 门店诊断数据加载（getStoreDiagnosis 的 DB 查询层）。
 */
import { resolveBrandKey } from './diagnosis-helpers.js';

const ACTIVE_STATUS_FILTER = `coalesce(status, '') not in ('inactive','disabled','disable','off','0','resigned','leave','left','离职','禁用','停用')`;

export async function loadStoreDiagnosisData(pool, storeName, startDate, endDate) {
  const weekAgoStart = new Date(new Date(startDate).getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const weekAgoEnd = new Date(new Date(startDate).getTime() - 86400000).toISOString().slice(0, 10);
  const brandKey = resolveBrandKey(storeName);
  const storeFilter = storeName.includes('马己仙') ? '马己仙' : (storeName.includes('洪潮') ? '洪潮' : storeName);

  const [
    anomalies,
    reports,
    prevReports,
    customerAnalysis,
    _prevCustomerAnalysis,
    employees,
    trainingStatus,
    tableVisitCurrent,
    tableVisitPrev,
    topDissatisfiedDish,
    memberRevenueCurrent,
    memberRevenuePrev,
  ] = await Promise.all([
    pool.query(
      `SELECT anomaly_key, severity, status, trigger_date, trigger_value, threshold_value,
              assigned_role, updated_at
       FROM anomaly_triggers
       WHERE store = $1 AND trigger_date >= $2 AND trigger_date <= $3
       ORDER BY trigger_date DESC, severity DESC`,
      [storeName, startDate, endDate]
    ),
    pool.query(
      `SELECT date, store, actual_revenue, budget_rate, dine_traffic, dine_orders,
              delivery_actual, efficiency, pre_discount_revenue, recharge_count,
              segments, categories, delivery_detail, staff, schedule_next_day,
              bad_reviews_dianping, dianping_rating
       FROM daily_reports
       WHERE store = $1 AND date >= $2 AND date <= $3
       ORDER BY date DESC`,
      [storeName, startDate, endDate]
    ),
    pool.query(
      `SELECT date, actual_revenue, pre_discount_revenue, dine_traffic, dine_orders, efficiency,
              bad_reviews_dianping, dianping_rating
       FROM daily_reports
       WHERE store = $1 AND date >= $2 AND date <= $3
       ORDER BY date DESC`,
      [storeName, weekAgoStart, weekAgoEnd]
    ),
    pool.query(
      `WITH orders AS (
         SELECT o.biz_date, o.order_no, o.phone,
                CASE
                  WHEN NULLIF(o.phone, '') IS NOT NULL
                   AND MIN(o.biz_date) OVER (PARTITION BY o.store_id, o.phone) >= $2
                  THEN 'new'
                  ELSE 'returning'
                END AS customer_type
         FROM pos_orders o
         WHERE o.store_id = (CASE WHEN $1 LIKE '%马己仙%' THEN '51866138' WHEN $1 LIKE '%洪潮%' THEN '64822111' ELSE '' END)
           AND NULLIF(o.phone, '') IS NOT NULL
       )
       SELECT biz_date,
              COUNT(*) FILTER (WHERE customer_type = 'new') AS new_customers,
              COUNT(*) FILTER (WHERE customer_type = 'returning') AS returning_customers,
              COUNT(*) AS total_orders
       FROM orders
       WHERE biz_date >= $2 AND biz_date <= $3
       GROUP BY biz_date ORDER BY biz_date`,
      [storeName, startDate, endDate]
    ),
    pool.query(
      `WITH orders AS (
         SELECT o.biz_date,
                CASE
                  WHEN NULLIF(o.phone, '') IS NOT NULL
                   AND MIN(o.biz_date) OVER (PARTITION BY o.store_id, o.phone) >= $2
                  THEN 'new'
                  ELSE 'returning'
                END AS customer_type
         FROM pos_orders o
         WHERE o.store_id = (CASE WHEN $1 LIKE '%马己仙%' THEN '51866138' WHEN $1 LIKE '%洪潮%' THEN '64822111' ELSE '' END)
           AND NULLIF(o.phone, '') IS NOT NULL
       )
       SELECT COUNT(*) FILTER (WHERE customer_type = 'new') AS new_customers,
              COUNT(*) AS total_orders
       FROM orders
       WHERE biz_date >= $2 AND biz_date <= $3`,
      [storeName, weekAgoStart, weekAgoEnd]
    ),
    pool.query(
      `SELECT username, name, store, position, status, join_date,
              extra_json
       FROM employees
       WHERE (store ILIKE '%' || $1 || '%' OR $1 = '') AND ${ACTIVE_STATUS_FILTER}
       ORDER BY position, name`,
      [storeFilter]
    ),
    pool.query(
      `SELECT ta.employee_username, ta.topic_id, ta.source AS assignment_status,
              tt.title AS topic_title, tt.position AS topic_position,
              tc.status AS cert_status
       FROM training_assignments ta
       LEFT JOIN training_topics tt ON ta.topic_id = tt.id
       LEFT JOIN training_certifications tc ON ta.employee_username = tc.employee_username AND ta.topic_id = tc.topic_id
       WHERE ta.employee_username = ANY(
         SELECT e.username FROM employees e WHERE e.store ILIKE '%' || $1 || '%' AND ${ACTIVE_STATUS_FILTER}
       )`,
      [storeFilter]
    ),
    pool.query(
      `SELECT COUNT(*) AS total_visits,
              COUNT(*) FILTER (WHERE coalesce(trim(dissatisfaction_dish), '') <> '') AS issue_count,
              MAX(date) FILTER (WHERE coalesce(trim(dissatisfaction_dish), '') <> '') AS latest_issue_date
       FROM table_visit_records
       WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3`,
      [brandKey, startDate, endDate]
    ),
    pool.query(
      `SELECT COUNT(*) AS total_visits,
              COUNT(*) FILTER (WHERE coalesce(trim(dissatisfaction_dish), '') <> '') AS issue_count
       FROM table_visit_records
       WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3`,
      [brandKey, weekAgoStart, weekAgoEnd]
    ),
    pool.query(
      `SELECT trim(dissatisfaction_dish) AS dish, COUNT(*) AS n
       FROM table_visit_records
       WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3
         AND coalesce(trim(dissatisfaction_dish), '') <> ''
       GROUP BY trim(dissatisfaction_dish) ORDER BY n DESC LIMIT 1`,
      [brandKey, startDate, endDate]
    ),
    pool.query(
      `SELECT SUM(amount_after_discount) FILTER (WHERE customer_id IS NOT NULL) AS member_rev,
              SUM(amount_after_discount) AS total_rev
       FROM pos_orders
       WHERE store_id = (CASE WHEN $1 LIKE '%马己仙%' THEN '51866138' WHEN $1 LIKE '%洪潮%' THEN '64822111' ELSE '' END)
         AND biz_date >= $2 AND biz_date <= $3`,
      [storeName, startDate, endDate]
    ),
    pool.query(
      `SELECT SUM(amount_after_discount) FILTER (WHERE customer_id IS NOT NULL) AS member_rev,
              SUM(amount_after_discount) AS total_rev
       FROM pos_orders
       WHERE store_id = (CASE WHEN $1 LIKE '%马己仙%' THEN '51866138' WHEN $1 LIKE '%洪潮%' THEN '64822111' ELSE '' END)
         AND biz_date >= $2 AND biz_date <= $3`,
      [storeName, weekAgoStart, weekAgoEnd]
    ),
  ]);

  return {
    weekAgoStart,
    weekAgoEnd,
    anomalies: anomalies.rows,
    reports: reports.rows,
    prevReports: prevReports.rows,
    customerAnalysis: customerAnalysis.rows,
    employees: employees.rows,
    trainingStatus: trainingStatus.rows,
    tableVisitCurrent: tableVisitCurrent.rows[0] || {},
    tableVisitPrev: tableVisitPrev.rows[0] || {},
    topDissatisfiedDish: topDissatisfiedDish.rows[0] || null,
    memberRevenueCurrent: memberRevenueCurrent.rows[0] || {},
    memberRevenuePrev: memberRevenuePrev.rows[0] || {},
  };
}
