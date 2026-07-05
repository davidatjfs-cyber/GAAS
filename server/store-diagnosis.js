/**
 * 门店经营诊断模块
 * 
 * 从结果（营业额下降/差评增加/离职增加）出发，
 * 做贡献度分析→根因关联→输出个人级建议
 */
import { fetchDineMetrics, storeNameToId } from './utils/dine-metrics.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

const normalizeStore = s => String(s || '').trim();

async function fetchCustomerNewReturning(pool, storeName, startDate, endDate) {
  const storeId = storeNameToId(storeName);
  if (!storeId) return { new_customers: 0, returning_customers: 0, total_customers: 0, new_pct: 0, returning_pct: 0 };
  const nvrR = await pool.query(`
    WITH customer_window AS (
      SELECT phone, COUNT(*)::int AS order_cnt
      FROM pos_orders
      WHERE phone IS NOT NULL AND phone <> '' AND store_id = $1
        AND biz_date >= $2 AND biz_date <= $3
      GROUP BY phone
    ), customer_life AS (
      SELECT cw.phone, MIN(po.biz_date) AS lifetime_first_order_date
      FROM customer_window cw
      JOIN pos_orders po ON po.phone = cw.phone AND po.phone IS NOT NULL AND po.phone <> ''
        AND po.store_id = $1
      GROUP BY cw.phone
    )
    SELECT
      COUNT(*) FILTER (WHERE lifetime_first_order_date >= $2::date)::int AS new_customers,
      COUNT(*) FILTER (WHERE lifetime_first_order_date < $2::date)::int AS returning_customers,
      COUNT(*)::int AS total_customers
    FROM customer_life
  `, [storeId, startDate, endDate]);
  const nvr = nvrR.rows[0] || {};
  const totalCustomers = Number(nvr.total_customers || 0);
  const newCount = Number(nvr.new_customers || 0);
  return {
    new_customers: newCount,
    returning_customers: Number(nvr.returning_customers || 0),
    total_customers: totalCustomers,
    new_pct: totalCustomers > 0 ? Math.round((newCount / totalCustomers) * 1000) / 10 : 0,
    returning_pct: totalCustomers > 0 ? Math.round((Number(nvr.returning_customers || 0) / totalCustomers) * 1000) / 10 : 0,
  };
}

const CATEGORY_LABELS = {
  water: '水吧',
  soup: '汤品',
  roast: '烧腊/卤水',
  wok: '炒锅',
  sashimi: '刺身',
};

function normalizeReportCategories(raw) {
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_) { return []; }
  }
  if (Array.isArray(data)) {
    return data
      .filter(c => c && (c.name || c.key))
      .map(c => ({
        key: String(c.key || c.name || '').trim(),
        name: String(c.name || CATEGORY_LABELS[c.key] || c.key || '').trim(),
        amt: Number(c.amt ?? c.sales ?? c.revenue ?? c.amount ?? 0),
        qty: Number(c.qty ?? c.quantity ?? 0),
      }));
  }
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([key, val]) => ({
      key,
      name: CATEGORY_LABELS[key] || key,
      amt: Number(val?.amt ?? val?.amount ?? val?.sales ?? 0),
      qty: Number(val?.qty ?? val?.quantity ?? 0),
    }));
  }
  return [];
}

function contributionItem(factor, magnitude, unit, detail, direction) {
  const mag = String(magnitude);
  let impact;
  if (direction === 'up') impact = `+${mag}${unit}`;
  else if (direction === 'down') impact = `-${mag}${unit}`;
  else impact = `${mag}${unit}`;
  return { factor, impact, detail, direction: direction || null };
}

function sortContributions(list) {
  list.sort((a, b) => Math.abs(parseFloat(b.impact) || 0) - Math.abs(parseFloat(a.impact) || 0) || 0);
}

function inferActionSource(actionType, createdBy) {
  const t = String(actionType || '').toLowerCase();
  const c = String(createdBy || '').toLowerCase();
  if (t === 'pllm_task' || c.includes('pllm')) return 'PLLM';
  if (t === 'ai_suggestion' || t.includes('ai') || c.includes('ai')) return 'AI';
  return '规则建议';
}

async function loadActionSuggestions(pool, storeName, startDate, endDate) {
  const conditions = [];
  const params = [];
  let idx = 1;
  conditions.push(`created_at::date >= $${idx++}`);
  params.push(startDate);
  conditions.push(`created_at::date <= $${idx++}`);
  params.push(endDate);
  if (storeName) {
    conditions.push(`(
      store_id ILIKE $${idx}
      OR title ILIKE $${idx}
      OR detail ILIKE $${idx}
      OR payload::text ILIKE $${idx}
    )`);
    params.push(`%${storeName}%`);
    idx += 1;
  }
  conditions.push(`action_type IN ('pllm_task', 'ai_suggestion', 'manual_campaign', 'campaign_activate', 'send_voucher', 'create_content', 'promo_task')`);
  conditions.push(`status IN ('proposed', 'pending', 'active', 'executed')`);

  const r = await pool.query(
    `SELECT action_key, action_type, status, store_id, title, detail, payload, created_by, created_at, executed_at
     FROM growth_actions
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 8`,
    params
  );

  return (r.rows || []).map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const source = inferActionSource(row.action_type, row.created_by);
    const priority = /high|urgent|critical/.test(String(row.status || '').toLowerCase()) ? 'high' : 'medium';
    return {
      action_key: row.action_key,
      source,
      action_type: row.action_type,
      status: row.status,
      title: cleanText(row.title || payload.title || 'AI建议行动', 120),
      detail: cleanText(row.detail || payload.description || payload.note || '', 360),
      created_at: row.created_at,
      executed_at: row.executed_at,
      priority,
      target_metric: cleanText(payload.target_metric || '', 80),
      target_value: payload.target_value != null ? payload.target_value : null,
      budget_amount: payload.budget_amount != null ? payload.budget_amount : null,
      duration_days: payload.duration_days != null ? payload.duration_days : null,
      actions: Array.isArray(payload.actions) ? payload.actions : [],
    };
  });
}

/**
 * 获取门店诊断结果
 * 数据源：anomaly_triggers + daily_reports + pos_orders + employees + training
 */
export async function getStoreDiagnosis(pool, store, dateRange) {
  const storeName = normalizeStore(store);
  const endDate = dateRange?.end || new Date().toISOString().slice(0, 10);
  const startDate = dateRange?.start || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  // 1. 拉取该门店最近异常
  const anomalies = await pool.query(
    `SELECT anomaly_key, severity, status, trigger_date, trigger_value, threshold_value,
            assigned_role, updated_at
     FROM anomaly_triggers
     WHERE store = $1 AND trigger_date >= $2 AND trigger_date <= $3
     ORDER BY trigger_date DESC, severity DESC`,
    [storeName, startDate, endDate]
  );

  // 2. 拉取该门店日报数据（含staff/segments/categories/评分/转化）
  const reports = await pool.query(
    `SELECT date, store, actual_revenue, budget_rate, dine_traffic, dine_orders,
            delivery_actual, efficiency, pre_discount_revenue, recharge_count,
            segments, categories, delivery_detail, staff, schedule_next_day,
            bad_reviews_dianping, dianping_rating
     FROM daily_reports
     WHERE store = $1 AND date >= $2 AND date <= $3
     ORDER BY date DESC`,
    [storeName, startDate, endDate]
  );

  // 3. 周对比（上周同期 vs 本周同期）
  const weekAgoStart = new Date(new Date(startDate).getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const weekAgoEnd = new Date(new Date(startDate).getTime() - 86400000).toISOString().slice(0, 10);
  const prevReports = await pool.query(
    `SELECT date, actual_revenue, pre_discount_revenue, dine_traffic, dine_orders, efficiency,
            bad_reviews_dianping, dianping_rating
     FROM daily_reports
     WHERE store = $1 AND date >= $2 AND date <= $3
     ORDER BY date DESC`,
    [storeName, weekAgoStart, weekAgoEnd]
  );

  // 4. 新客 vs 老客分析（通过 pos_orders），同时取上周同期做环比
  const customerAnalysis = await pool.query(
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
  );
  const prevCustomerAnalysis = await pool.query(
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
  );

  // 5. 获取在职员工列表（排除已离职/停用，避免离职员工混入培训/排班统计）
  const ACTIVE_STATUS_FILTER = `coalesce(status, '') not in ('inactive','disabled','disable','off','0','resigned','leave','left','离职','禁用','停用')`;
  const employees = await pool.query(
    `SELECT username, name, store, position, status, join_date,
            extra_json
     FROM employees
     WHERE (store ILIKE '%' || $1 || '%' OR $1 = '') AND ${ACTIVE_STATUS_FILTER}
     ORDER BY position, name`,
    [storeName.includes('马己仙') ? '马己仙' : (storeName.includes('洪潮') ? '洪潮' : storeName)]
  );

  // 6. 培训完成状态（同样只看在职员工）
  const trainingStatus = await pool.query(
    `SELECT ta.employee_username, ta.topic_id, ta.source AS assignment_status,
            tt.title AS topic_title, tt.position AS topic_position,
            tc.status AS cert_status
     FROM training_assignments ta
     LEFT JOIN training_topics tt ON ta.topic_id = tt.id
     LEFT JOIN training_certifications tc ON ta.employee_username = tc.employee_username AND ta.topic_id = tc.topic_id
     WHERE ta.employee_username = ANY(
       SELECT e.username FROM employees e WHERE e.store ILIKE '%' || $1 || '%' AND ${ACTIVE_STATUS_FILTER}
     )`,
    [storeName.includes('马己仙') ? '马己仙' : (storeName.includes('洪潮') ? '洪潮' : storeName)]
  );

  // 7. 桌访问题产品（dissatisfaction_dish 非空记录数 + 最常见菜品），本期 vs 上期
  const brandKey = storeName.includes('马己仙') ? '马己仙' : (storeName.includes('洪潮') ? '洪潮' : storeName);
  const tableVisitCurrent = await pool.query(
    `SELECT COUNT(*) AS total_visits,
            COUNT(*) FILTER (WHERE coalesce(trim(dissatisfaction_dish), '') <> '') AS issue_count,
            MAX(date) FILTER (WHERE coalesce(trim(dissatisfaction_dish), '') <> '') AS latest_issue_date
     FROM table_visit_records
     WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3`,
    [brandKey, startDate, endDate]
  );
  const tableVisitPrev = await pool.query(
    `SELECT COUNT(*) AS total_visits,
            COUNT(*) FILTER (WHERE coalesce(trim(dissatisfaction_dish), '') <> '') AS issue_count
     FROM table_visit_records
     WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3`,
    [brandKey, weekAgoStart, weekAgoEnd]
  );
  const topDissatisfiedDish = await pool.query(
    `SELECT trim(dissatisfaction_dish) AS dish, COUNT(*) AS n
     FROM table_visit_records
     WHERE store ILIKE '%' || $1 || '%' AND date >= $2 AND date <= $3
       AND coalesce(trim(dissatisfaction_dish), '') <> ''
     GROUP BY trim(dissatisfaction_dish) ORDER BY n DESC LIMIT 1`,
    [brandKey, startDate, endDate]
  );

  // 8. 会员消费占比（pos_orders 中 customer_id 非空订单的实收 / 总实收），本期 vs 上期
  const memberRevenueCurrent = await pool.query(
    `SELECT SUM(amount_after_discount) FILTER (WHERE customer_id IS NOT NULL) AS member_rev,
            SUM(amount_after_discount) AS total_rev
     FROM pos_orders
     WHERE store_id = (CASE WHEN $1 LIKE '%马己仙%' THEN '51866138' WHEN $1 LIKE '%洪潮%' THEN '64822111' ELSE '' END)
       AND biz_date >= $2 AND biz_date <= $3`,
    [storeName, startDate, endDate]
  );
  const memberRevenuePrev = await pool.query(
    `SELECT SUM(amount_after_discount) FILTER (WHERE customer_id IS NOT NULL) AS member_rev,
            SUM(amount_after_discount) AS total_rev
     FROM pos_orders
     WHERE store_id = (CASE WHEN $1 LIKE '%马己仙%' THEN '51866138' WHEN $1 LIKE '%洪潮%' THEN '64822111' ELSE '' END)
       AND biz_date >= $2 AND biz_date <= $3`,
    [storeName, weekAgoStart, weekAgoEnd]
  );

  // === 开始组装诊断结果 ===

  const result = {
    store: storeName,
    period: { start: startDate, end: endDate },
    summary: {},
    revenue: {},
    customer: {},
    anomalies: [],
    staffing: {},
    training: {},
    recommendations: [],
  };

  const [dineMetrics, customerMetrics] = await Promise.all([
    fetchDineMetrics(pool, storeName, startDate, endDate),
    fetchCustomerNewReturning(pool, storeName, startDate, endDate),
  ]);
  const [prevDineMetrics, prevCustomerMetrics] = await Promise.all([
    fetchDineMetrics(pool, storeName, weekAgoStart, weekAgoEnd),
    fetchCustomerNewReturning(pool, storeName, weekAgoStart, weekAgoEnd),
  ]);

  // ── A. 营业额分析 ──
  if (reports.rows.length > 0) {
    const totalRevenue = reports.rows.reduce((s, r) => s + Number(r.actual_revenue || 0), 0);
    const totalPreDiscountRevenue = reports.rows.reduce((s, r) => s + Number(r.pre_discount_revenue || 0), 0);
    const avgDailyRevenue = totalRevenue / reports.rows.length;
    const totalTraffic = dineMetrics.dine_traffic;
    const avgDailyTraffic = dineMetrics.report_days > 0 ? Math.round(totalTraffic / dineMetrics.report_days) : 0;
    const totalOrders = dineMetrics.dine_orders;
    const avgSpendPerPerson = dineMetrics.avg_spend_per_person;
    const avgTableSpend = dineMetrics.avg_table_spend;
    const avgOrderValue = avgTableSpend;
    const effRows = reports.rows.filter(r => Number(r.efficiency) > 0);
    const avgEfficiency = effRows.length > 0
      ? effRows.reduce((s, r) => s + Number(r.efficiency), 0) / effRows.length
      : 0;
    const totalDeliveryRevenue = reports.rows.reduce((s, r) => s + Number(r.delivery_actual || 0), 0);
    const avgDeliveryShare = totalRevenue > 0 ? (totalDeliveryRevenue / totalRevenue) * 100 : 0;

    let prevTotalRevenue = 0, prevTotalPreDiscountRevenue = 0, prevTotalTraffic = 0, prevTotalOrders = 0, prevAvgEfficiency = 0;
    let prevTotalDeliveryRevenue = 0;
    let prevAvgTableSpend = 0;
    if (prevReports.rows.length > 0) {
      prevTotalRevenue = prevReports.rows.reduce((s, r) => s + Number(r.actual_revenue || 0), 0);
      prevTotalPreDiscountRevenue = prevReports.rows.reduce((s, r) => s + Number(r.pre_discount_revenue || 0), 0);
      prevTotalTraffic = prevDineMetrics.dine_traffic;
      prevAvgTableSpend = prevDineMetrics.avg_table_spend;
      prevTotalOrders = prevDineMetrics.dine_orders;
      const prevEffRows = prevReports.rows.filter(r => Number(r.efficiency) > 0);
      prevAvgEfficiency = prevEffRows.length > 0
        ? prevEffRows.reduce((s, r) => s + Number(r.efficiency), 0) / prevEffRows.length
        : 0;
      prevTotalDeliveryRevenue = prevReports.rows.reduce((s, r) => s + Number(r.delivery_actual || 0), 0);
    }

    const revenueChange = prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue * 100).toFixed(1) : 0;
    const trafficChange = prevTotalTraffic > 0 ? ((totalTraffic - prevTotalTraffic) / prevTotalTraffic * 100).toFixed(1) : 0;
    const ordersChange = prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100).toFixed(1) : 0;
    const efficiencyChange = prevAvgEfficiency > 0 ? ((avgEfficiency - prevAvgEfficiency) / prevAvgEfficiency * 100).toFixed(1) : 0;
    const deliveryChange = prevTotalDeliveryRevenue > 0 ? ((totalDeliveryRevenue - prevTotalDeliveryRevenue) / prevTotalDeliveryRevenue * 100).toFixed(1) : 0;

    result.revenue = {
      total: Math.round(totalRevenue),
      total_pre_discount_revenue: Math.round(totalPreDiscountRevenue),
      avg_daily: Math.round(avgDailyRevenue),
      avg_order_value: Math.round(avgOrderValue),
      avg_table_spend: Math.round(avgTableSpend),
      avg_spend_per_person: Math.round(avgSpendPerPerson),
      avg_efficiency: Math.round(avgEfficiency),
      total_traffic: Math.round(totalTraffic),
      avg_daily_traffic: Math.round(avgDailyTraffic),
      report_days: dineMetrics.report_days,
      dine_before_revenue: dineMetrics.dine_before_revenue,
      dine_data_source: dineMetrics.data_source,
      total_delivery_revenue: Math.round(totalDeliveryRevenue),
      delivery_share_pct: Number(avgDeliveryShare.toFixed(1)),
      prev_total: Math.round(prevTotalRevenue),
      change_pct: Number(revenueChange),
      traffic_change_pct: Number(trafficChange),
      orders_change_pct: Number(ordersChange),
      efficiency_change_pct: Number(efficiencyChange),
      delivery_change_pct: Number(deliveryChange),
      is_decline: Number(revenueChange) < 0,
    };

    // ── B. 贡献度分析（数据存在且变化≥1%才纳入，方向不限，全面反映本期经营情况） ──
    const contributions = [];
    if (prevTotalTraffic > 0 && Math.abs(Number(trafficChange)) >= 1) {
      const isUp = Number(trafficChange) > 0;
      contributions.push(contributionItem(
        isUp ? '客流量增长' : '客流量下降',
        Math.abs(trafficChange), '%',
        `到店客流从${prevTotalTraffic}${isUp ? '增至' : '降至'}${totalTraffic}人次，${isUp ? '增加' : '减少'}${Math.abs(totalTraffic - prevTotalTraffic)}人次`,
        isUp ? 'up' : 'down',
      ));
    }
    if (prevTotalOrders > 0 && Math.abs(Number(ordersChange)) >= 1) {
      const isUp = Number(ordersChange) > 0;
      contributions.push(contributionItem(
        isUp ? '订单量增长' : '订单量下降',
        Math.abs(ordersChange), '%',
        `日均订单从${Math.round(prevTotalOrders / (prevReports.rows.length || 1))}${isUp ? '增至' : '降至'}${Math.round(totalOrders / reports.rows.length)}`,
        isUp ? 'up' : 'down',
      ));
    }
    if (prevAvgEfficiency > 0 && Math.abs(Number(efficiencyChange)) >= 1) {
      const isUp = Number(efficiencyChange) > 0;
      contributions.push(contributionItem(
        isUp ? '人效提升' : '人效下降',
        Math.abs(efficiencyChange), '%',
        `人效从${Math.round(prevAvgEfficiency)}元/人${isUp ? '增至' : '降至'}${Math.round(avgEfficiency)}元/人`,
        isUp ? 'up' : 'down',
      ));
    }
    if (prevAvgTableSpend > 0 && avgTableSpend > 0) {
      const tableSpendChange = ((avgTableSpend - prevAvgTableSpend) / prevAvgTableSpend * 100).toFixed(1);
      if (Math.abs(Number(tableSpendChange)) >= 1) {
        const isUp = Number(tableSpendChange) > 0;
        contributions.push(contributionItem(
          isUp ? '堂食桌均提升' : '堂食桌均下降',
          Math.abs(tableSpendChange), '%',
          `堂食桌均从¥${Math.round(prevAvgTableSpend)}${isUp ? '增至' : '降至'}¥${Math.round(avgTableSpend)}（堂食折前营业额/堂食订单数），可能与折扣力度或菜品结构变化有关`,
          isUp ? 'up' : 'down',
        ));
      }
    }
    const prevAvgSpendPerPerson = prevDineMetrics.avg_spend_per_person;
    if (prevAvgSpendPerPerson > 0 && avgSpendPerPerson > 0) {
      const personSpendChange = ((avgSpendPerPerson - prevAvgSpendPerPerson) / prevAvgSpendPerPerson * 100).toFixed(1);
      if (Math.abs(Number(personSpendChange)) >= 1) {
        const isUp = Number(personSpendChange) > 0;
        contributions.push(contributionItem(
          isUp ? '堂食人均提升' : '堂食人均下降',
          Math.abs(personSpendChange), '%',
          `堂食人均从¥${Math.round(prevAvgSpendPerPerson)}${isUp ? '增至' : '降至'}¥${Math.round(avgSpendPerPerson)}（折前营业额/堂食客流），可能与客流结构或套餐选择变化有关`,
          isUp ? 'up' : 'down',
        ));
      }
    }

    if (prevTotalDeliveryRevenue > 0) {
      const deliveryShare = totalRevenue > 0 ? (totalDeliveryRevenue / totalRevenue) * 100 : 0;
      const prevDeliveryShare = prevTotalRevenue > 0 ? (prevTotalDeliveryRevenue / prevTotalRevenue) * 100 : 0;
      const deliveryShareChange = deliveryShare - prevDeliveryShare;
      result.revenue.delivery_share_change_pct = Number(deliveryShareChange.toFixed(1));
      if (Math.abs(deliveryShareChange) >= 2) {
        const isUp = deliveryShareChange > 0;
        contributions.push(contributionItem(
          isUp ? '外卖占比上升' : '外卖占比下降',
          Math.abs(deliveryShareChange).toFixed(1), '个百分点',
          `外卖收入占比从${prevDeliveryShare.toFixed(1)}%${isUp ? '升至' : '降至'}${deliveryShare.toFixed(1)}%`,
          isUp ? 'up' : 'down',
        ));
      }
    }

    // 到店转化率（订单数/客流，反映收银下单成功率）
    const ratedDays = reports.rows.filter(r => Number(r.dine_traffic) > 0);
    const prevRatedDays = prevReports.rows.filter(r => Number(r.dine_traffic) > 0);
    if (ratedDays.length > 0 && prevRatedDays.length > 0) {
      const conv = ratedDays.reduce((s, r) => s + Number(r.dine_orders || 0) / Number(r.dine_traffic), 0) / ratedDays.length;
      const prevConv = prevRatedDays.reduce((s, r) => s + Number(r.dine_orders || 0) / Number(r.dine_traffic), 0) / prevRatedDays.length;
      const convChange = prevConv > 0 ? ((conv - prevConv) / prevConv * 100).toFixed(1) : 0;
      if (Number(convChange) <= -5) {
        contributions.push(contributionItem(
          '到店转化率下降',
          Math.abs(convChange), '%',
          `到店转化率（下单/客流）从${(prevConv * 100).toFixed(1)}%降至${(conv * 100).toFixed(1)}%，建议复核收银引导与点单话术`,
          'down',
        ));
      }
    }

    // 服务评分（大众点评）
    const ratingDays = reports.rows.filter(r => Number(r.dianping_rating) > 0);
    const prevRatingDays = prevReports.rows.filter(r => Number(r.dianping_rating) > 0);
    if (ratingDays.length > 0 && prevRatingDays.length > 0) {
      const avgRating = ratingDays.reduce((s, r) => s + Number(r.dianping_rating), 0) / ratingDays.length;
      const prevAvgRating = prevRatingDays.reduce((s, r) => s + Number(r.dianping_rating), 0) / prevRatingDays.length;
      const ratingChange = prevAvgRating > 0 ? ((avgRating - prevAvgRating) / prevAvgRating * 100).toFixed(1) : 0;
      result.revenue.rating_change_pct = Number(ratingChange);
      result.revenue.avg_rating = Number(avgRating.toFixed(2));
      if (Number(ratingChange) <= -3) {
        contributions.push(contributionItem(
          '服务评分下降',
          Math.abs(ratingChange), '%',
          `大众点评评分从${prevAvgRating.toFixed(2)}降至${avgRating.toFixed(2)}`,
          'down',
        ));
      }
    }
    const totalBadReviews = reports.rows.reduce((s, r) => s + Number(r.bad_reviews_dianping || 0), 0);
    const prevTotalBadReviews = prevReports.rows.reduce((s, r) => s + Number(r.bad_reviews_dianping || 0), 0);
    if (totalBadReviews !== prevTotalBadReviews) {
      const isUp = totalBadReviews > prevTotalBadReviews;
      const badReviewPct = prevTotalBadReviews > 0
        ? ((totalBadReviews - prevTotalBadReviews) / prevTotalBadReviews * 100).toFixed(1)
        : null;
      contributions.push(contributionItem(
        isUp ? '差评增加' : '差评下降',
        badReviewPct !== null ? Math.abs(badReviewPct) : Math.abs(totalBadReviews - prevTotalBadReviews),
        badReviewPct !== null ? '%' : '条',
        `大众点评差评从${prevTotalBadReviews}条${isUp ? '增至' : '降至'}${totalBadReviews}条`,
        isUp ? 'up' : 'down',
      ));
    }

    // 桌访问题产品数量变化
    const tvCurTotal = Number(tableVisitCurrent.rows[0]?.total_visits || 0);
    const tvCurIssue = Number(tableVisitCurrent.rows[0]?.issue_count || 0);
    const tvPrevTotal = Number(tableVisitPrev.rows[0]?.total_visits || 0);
    const tvPrevIssue = Number(tableVisitPrev.rows[0]?.issue_count || 0);
    result.revenue.table_visit = { current_issue_count: tvCurIssue, current_total: tvCurTotal, prev_issue_count: tvPrevIssue, prev_total: tvPrevTotal, latest_issue_date: tableVisitCurrent.rows[0]?.latest_issue_date || null };
    if (tvCurIssue !== tvPrevIssue && (tvCurTotal > 0 || tvPrevTotal > 0)) {
      const isUp = tvCurIssue > tvPrevIssue;
      const tvPct = tvPrevIssue > 0 ? ((tvCurIssue - tvPrevIssue) / tvPrevIssue * 100).toFixed(1) : null;
      const dishHint = topDissatisfiedDish.rows[0]?.dish ? `，本期最多被反馈的菜品是「${topDissatisfiedDish.rows[0].dish.slice(0, 12)}」` : '';
      contributions.push(contributionItem(
        isUp ? '桌访问题产品增加' : '桌访问题产品下降',
        tvPct !== null ? Math.abs(tvPct) : Math.abs(tvCurIssue - tvPrevIssue),
        tvPct !== null ? '%' : '单',
        `桌访反馈不满意菜品从${tvPrevIssue}单${isUp ? '增至' : '降至'}${tvCurIssue}单（共${tvCurTotal}次桌访）${dishHint}`,
        isUp ? 'up' : 'down',
      ));
    }

    // 会员消费占比变化
    const memberRev = Number(memberRevenueCurrent.rows[0]?.member_rev || 0);
    const totalRev = Number(memberRevenueCurrent.rows[0]?.total_rev || 0);
    const prevMemberRev = Number(memberRevenuePrev.rows[0]?.member_rev || 0);
    const prevTotalRev = Number(memberRevenuePrev.rows[0]?.total_rev || 0);
    if (totalRev > 0 && prevTotalRev > 0) {
      const memberRatio = memberRev / totalRev * 100;
      const prevMemberRatio = prevMemberRev / prevTotalRev * 100;
      result.revenue.member_revenue_ratio = Number(memberRatio.toFixed(1));
      result.revenue.prev_member_revenue_ratio = Number(prevMemberRatio.toFixed(1));
      const ratioDiff = memberRatio - prevMemberRatio;
      if (Math.abs(ratioDiff) >= 2) {
        const isUp = ratioDiff > 0;
        contributions.push(contributionItem(
          isUp ? '会员消费占比上升' : '会员消费占比下降',
          Math.abs(ratioDiff).toFixed(1), '个百分点',
          `会员消费占比从${prevMemberRatio.toFixed(1)}%${isUp ? '升至' : '降至'}${memberRatio.toFixed(1)}%`,
          isUp ? 'up' : 'down',
        ));
      }
    }

    sortContributions(contributions);
    result.revenue.contributions = contributions;
  }

  // ── C. 新客 vs 老客分析（与增长看板 pos-stats new_vs_returning 同口径） ──
  if (dineMetrics.dine_traffic > 0 || customerMetrics.total_customers > 0 || customerAnalysis.rows.length > 0) {
    const totalNew = customerMetrics.new_customers || 0;
    const totalReturning = customerMetrics.returning_customers || 0;
    const totalOrders = customerMetrics.total_customers || 0;
    const newRatio = customerMetrics.new_pct || 0;

    result.customer = {
      new_customers: totalNew,
      returning_customers: totalReturning,
      total_orders: totalOrders,
      new_ratio: Number(newRatio),
      returning_ratio: customerMetrics.returning_pct || 0,
      daily: customerAnalysis.rows.map(r => ({
        date: r.biz_date,
        new: Number(r.new_customers || 0),
        returning: Number(r.returning_customers || 0),
        total: Number(r.total_orders || 0),
      })),
    };

    const prevNewRatio = prevCustomerMetrics.total_customers > 0 ? prevCustomerMetrics.new_pct : null;
    result.revenue.contributions = result.revenue.contributions || [];

    if (prevNewRatio !== null && prevNewRatio > 0) {
      const newRatioChangePct = ((Number(newRatio) - prevNewRatio) / prevNewRatio * 100).toFixed(1);
      result.customer.prev_new_ratio = Number(prevNewRatio.toFixed(1));
      result.customer.new_ratio_change_pct = Number(newRatioChangePct);
      if (Number(newRatioChangePct) <= -10) {
        result.revenue.contributions.push(contributionItem(
          '新客占比下降',
          Math.abs(newRatioChangePct), '%',
          `新客占比从${prevNewRatio.toFixed(1)}%降至${newRatio}%，可能私域引流不足或门店获客能力下降`,
          'down',
        ));
      }
    } else if (Number(newRatio) < 20) {
      result.revenue.contributions.push(contributionItem(
        '新客占比低',
        newRatio, '%',
        `本周新客比例仅${newRatio}%，可能私域引流不足或门店获客能力下降`,
        null,
      ));
    }
    sortContributions(result.revenue.contributions);
  }

  // ── D. 异常分析 ──
  const anomalyGroups = {};
  for (const a of anomalies.rows) {
    const key = a.anomaly_key;
    if (!anomalyGroups[key]) {
      anomalyGroups[key] = { key, severity: a.severity, count: 0, latest_date: a.trigger_date, detail: '', records: [] };
    }
    anomalyGroups[key].count++;
    if (a.trigger_date > anomalyGroups[key].latest_date) {
      anomalyGroups[key].latest_date = a.trigger_date;
    }
    let parsedValue = {};
    if (a.trigger_value) {
      try {
        parsedValue = typeof a.trigger_value === 'string' ? JSON.parse(a.trigger_value) : a.trigger_value;
        if (parsedValue.detail) anomalyGroups[key].detail = parsedValue.detail;
        if (parsedValue.consecutiveDown) anomalyGroups[key].detail = `连续${parsedValue.consecutiveDown}周下降(${parsedValue.changePct}%)`;
      } catch (_) {}
    }
    anomalyGroups[key].records.push({
      date: a.trigger_date,
      severity: a.severity,
      status: a.status || '',
      assigned_role: a.assigned_role || '',
      threshold_value: (() => {
        let v = a.threshold_value;
        if (typeof v === 'string') {
          try { v = JSON.parse(v); } catch (_) {}
        }
        return v;
      })(),
      trigger_value: parsedValue,
      detail: parsedValue.detail || '',
    });
  }

  result.anomalies = Object.values(anomalyGroups).map(g => ({
    type: mapAnomalyType(g.key),
    key: g.key,
    severity: g.severity,
    count: g.count,
    latest_date: g.latest_date,
    detail: g.detail || getAnomalyDescription(g.key),
    description: getAnomalyDescription(g.key),
    records: (g.records || []).slice(0, 20),
  }));

  // 若评分本期下降明显，且异常引擎尚未记录该差评异常，直接由真实评分数据补一条，
  // 这样下方"差评→定位在岗员工→培训建议"链路不依赖异常引擎是否已触发
  if (Number(result.revenue?.rating_change_pct) <= -3 && !result.anomalies.some(a => a.key === 'bad_review_service')) {
    const worstDay = reports.rows
      .filter(r => Number(r.dianping_rating) > 0)
      .sort((a, b) => Number(a.dianping_rating) - Number(b.dianping_rating))[0];
    if (worstDay) {
      result.anomalies.push({
        type: mapAnomalyType('bad_review_service'),
        key: 'bad_review_service',
        severity: 'high',
        count: 1,
        latest_date: worstDay.date,
        detail: `服务评分较上周下降${Math.abs(result.revenue.rating_change_pct)}%（${worstDay.date}评分${Number(worstDay.dianping_rating).toFixed(2)}最低）`,
      });
    }
  }

  // 桌访产品问题：用真实桌访数据补充/覆盖异常详情，并在引擎未触发时直接补一条，
  // 确保"差评菜品→厨房在岗→培训"链路有真实数据支撑
  const tv = result.revenue?.table_visit;
  if (tv && tv.current_issue_count > 0) {
    const tvDetailText = `本期桌访反馈不满意菜品${tv.current_issue_count}单（上期${tv.prev_issue_count}单，共${tv.current_total}次桌访）`;
    const existingTvAnomaly = result.anomalies.find(a => a.key === 'table_visit_product');
    if (existingTvAnomaly) {
      existingTvAnomaly.detail = tvDetailText;
    } else if (tv.current_issue_count > tv.prev_issue_count) {
      result.anomalies.push({
        type: mapAnomalyType('table_visit_product'),
        key: 'table_visit_product',
        severity: 'medium',
        count: tv.current_issue_count,
        latest_date: tv.latest_issue_date || reports.rows[0]?.date || endDate,
        detail: tvDetailText,
      });
    }
  }

  // ── E. 排班/在岗分析 ──
  if (reports.rows.length > 0) {
    const latestReport = reports.rows[0];
    const staff = latestReport.staff || {};
    const onDuty = [];
    const staffByArea = {};
    for (const [area, people] of Object.entries(staff)) {
      if (Array.isArray(people)) {
        staffByArea[area] = people.map(p => ({ name: p.name, user: p.user, days: p.days }));
        for (const p of people) {
          if (p.name && p.user) onDuty.push({ name: p.name, user: p.user, area, days: p.days });
        }
      }
    }

    // 排班不足检测
    const totalStaff = onDuty.length;
    const frontStaff = (staffByArea.front || []).length;
    const kitchenStaff = (staffByArea.kitchen || staffByArea.restStaff || []).length;

    result.staffing = {
      latest_date: latestReport.date,
      total_on_duty: totalStaff,
      front_count: frontStaff,
      kitchen_count: kitchenStaff,
      by_area: staffByArea,
      is_understaffed: totalStaff < 5,
      issues: [],
    };

    // 晚班排班不足检测：segments 是各时段营收(noon/afternoon/night)，
    // 用晚市营收占比 vs 前厅人手数交叉判断，而非营收绝对值
    const segments = latestReport.segments || {};
    const noonRev = Number(segments.noon || 0);
    const afternoonRev = Number(segments.afternoon || 0);
    const nightRev = Number(segments.night || 0);
    const segTotal = noonRev + afternoonRev + nightRev;
    if (segTotal > 0) {
      const nightShare = nightRev / segTotal;
      result.staffing.night_revenue_share = Number((nightShare * 100).toFixed(1));
      if (nightShare >= 0.45 && frontStaff < 3) {
        result.staffing.issues.push(`晚市营收占比${(nightShare * 100).toFixed(0)}%但前厅仅${frontStaff}人在岗，晚班前厅人手不足`);
      }
    }

    // 人效 vs 排班 关联
    if (result.revenue.is_decline && result.revenue.efficiency_change_pct < 0) {
      result.staffing.issues.push(`人效下降${Math.abs(result.revenue.efficiency_change_pct)}%，需关注排班合理性`);
    }
  }

  // ── F. 培训状态分析 ──
  const trainingByEmployee = {};
  for (const t of trainingStatus.rows) {
    const user = t.employee_username;
    if (!trainingByEmployee[user]) {
      trainingByEmployee[user] = { username: user, assignments: [], missing_certs: [] };
    }
    trainingByEmployee[user].assignments.push({
      topic_id: t.topic_id,
      title: t.topic_title,
      assignment_status: t.assignment_status,
      cert_status: t.cert_status,
    });
    if (t.cert_status !== 'valid') {
      trainingByEmployee[user].missing_certs.push(t.topic_title);
    }
  }

  // 找到未完成培训的员工名
  const employeesWithoutTraining = [];
  for (const e of employees.rows) {
    const training = trainingByEmployee[e.username];
    if (!training || training.assignments.length === 0) {
      const joinDate = new Date(e.join_date || '2026-01-01');
      const daysSinceJoin = Math.floor((Date.now() - joinDate.getTime()) / 86400000);
      employeesWithoutTraining.push({
        username: e.username,
        name: e.name,
        position: e.position,
        days_since_join: daysSinceJoin,
        is_new: daysSinceJoin < 90,
      });
    }
  }

  result.training = {
    total_assignments: trainingStatus.rows.length,
    by_employee: Object.values(trainingByEmployee),
    employees_without_training: employeesWithoutTraining,
    scope_label: `截至 ${endDate}，在职且从未被指派任何培训任务`,
    empty_label: '全员均已指派培训任务，无漏培人员',
  };

  // ── G. 品类分析（categories） ──
  if (reports.rows.length > 0) {
    const categoryData = {};
    for (const r of reports.rows) {
      const cats = normalizeReportCategories(r.categories);
      for (const c of cats) {
        if (!c.name) continue;
        if (!categoryData[c.key]) {
          categoryData[c.key] = { key: c.key, name: c.name, total: 0, qty_total: 0, days: 0 };
        }
        categoryData[c.key].total += c.amt;
        categoryData[c.key].qty_total += c.qty;
        if (c.amt > 0 || c.qty > 0) categoryData[c.key].days++;
      }
    }
    const storeTotalRevenue = Number(result.revenue.total || 0);
    const categories = Object.values(categoryData)
      .filter(c => c.total > 0 || c.qty_total > 0)
      .sort((a, b) => b.total - a.total)
      .map(c => ({
        ...c,
        avg_daily: Math.round(c.total / Math.max(c.days, 1)),
        avg_qty_daily: Math.round(c.qty_total / Math.max(c.days, 1)),
        share_pct: storeTotalRevenue > 0 ? Number((c.total / storeTotalRevenue * 100).toFixed(1)) : 0,
      }));
    if (categories.length) result.revenue.categories = categories;
  }

  // ── H. 生成个人级建议（核心） ──
  result.recommendations = await generateRecommendations({
    store: storeName,
    revenue: result.revenue,
    customer: result.customer,
    anomalies: result.anomalies,
    staffing: result.staffing,
    training: result.training,
    employees: employees.rows,
    reports: reports.rows,
  });

  result.action_suggestions = await loadActionSuggestions(pool, storeName, startDate, endDate).catch(() => []);
  result.action_suggestions_count = result.action_suggestions.length;

  // ── I. 摘要：把贡献度分析拼成一句"为什么下降"的因果说明 ──
  const topAnomaly = result.anomalies.find(a => a.severity === 'high') || result.anomalies[0];
  const topContributions = (result.revenue.contributions || []).slice(0, 3);

  let headline;
  if (result.revenue.is_decline) {
    const reasonText = topContributions.length > 0
      ? topContributions.map(c => `${c.factor}${c.impact}`).join('、')
      : '';
    headline = reasonText
      ? `本周营业额下降${Math.abs(result.revenue.change_pct)}%，主要受${reasonText}影响`
      : `本周营业额下降${Math.abs(result.revenue.change_pct)}%`;
  } else {
    headline = `本周营业额稳定（${result.revenue.change_pct >= 0 ? '+' : ''}${result.revenue.change_pct}%）`;
  }

  result.summary = {
    headline,
    top_issue: topAnomaly ? topAnomaly.type : '无明显异常',
    top_contributions: topContributions,
    revenue_decline: result.revenue.is_decline ? `${result.revenue.change_pct}%` : null,
    new_customer_ratio: result.customer.new_ratio ? `${result.customer.new_ratio}%` : null,
    anomaly_count: result.anomalies.length,
    staffing_issue: result.staffing.issues?.[0] || null,
    recommendation_count: result.recommendations.length,
    action_suggestion_count: result.action_suggestions.length,
  };

  return result;
}

function mapAnomalyType(key) {
  const map = {
    revenue_achievement: '营收未达标',
    revenue_achievement_monthly: '月度营收未达标',
    labor_efficiency: '人效不足',
    recharge_zero: '无充值记录',
    table_visit_product: '桌访产品问题',
    table_visit_ratio: '桌访率异常',
    gross_margin: '毛利率不达标',
    bad_review_product: '产品差评',
    bad_review_service: '服务差评',
    hongchao_jiuguang_private_room: '包厢利用率低',
    food_safety: '食品安全',
    weekday_trend: '营收趋势下降',
    meal_balance: '午晚市失衡',
    dish_decline: '菜品销量下降',
  };
  return map[key] || key;
}

function getAnomalyDescription(key) {
  const map = {
    revenue_achievement: '本周营收未达到目标值的80%',
    labor_efficiency: '门店人效（元/人）低于品牌阈值',
    recharge_zero: '连续多日无会员充值记录',
    table_visit_product: '桌访中发现产品问题',
    table_visit_ratio: '桌访覆盖率/合格率偏低',
    gross_margin: '月度毛利率未达标',
    bad_review_product: '客如云系统出现产品类差评',
    bad_review_service: '客如云系统出现服务类差评',
    hongchao_jiuguang_private_room: '洪潮久光包厢利用率偏低',
    food_safety: '食品安全相关关键词命中',
    weekday_trend: '同周几营收连续3周以上下降',
    meal_balance: '午市营收占比持续低于阈值',
    dish_decline: '菜品销量连续2周下降超过20%',
  };
  return map[key] || key;
}

async function generateRecommendations(ctx) {
  const recs = [];
  const { store, revenue, customer, anomalies, staffing, training, employees, reports } = ctx;

  // 1. 营业额下降 + 客流下降 → 新客引流建议
  if (revenue.is_decline && Number(revenue.change_pct) < -5) {
    for (const c of (revenue.contributions || [])) {
      if (c.factor === '客流量下降') {
        recs.push({
          type: 'marketing',
          source: 'rule_engine',
          priority: 'high',
          title: '加强新客引流',
          detail: `客流量下降${c.impact}，建议增加私域引流活动（扫码领券、社群裂变）`,
          target: '店长',
          related_anomaly: 'revenue_achievement',
        });
      }
    }
  }

  // 2. 人效下降 → 排班优化建议
  if (Number(revenue.efficiency_change_pct) < -10) {
    const underDuty = (staffing.total_on_duty || 0);
    recs.push({
      type: 'staffing',
      source: 'rule_engine',
      priority: 'medium',
      title: '优化排班结构',
      detail: `人效下降${Math.abs(revenue.efficiency_change_pct)}%，当前在岗${underDuty}人。建议核对排班与客流高峰时段是否匹配`,
      target: '店长',
      related_anomaly: 'labor_efficiency',
    });
  }

  // 3. 晚班人手不足 → 补充排班
  if (staffing.issues && staffing.issues.length > 0) {
    for (const issue of staffing.issues) {
      if (issue.includes('晚班')) {
        recs.push({
          type: 'staffing',
          source: 'rule_engine',
          priority: 'high',
          title: '增加晚班前厅人手',
          detail: issue,
          target: '店长',
        });
      }
    }
  }

  // 4. 差评 → 定位到个人 → 培训建议（核心）
  const badAnomalies = anomalies.filter(a =>
    a.key === 'bad_review_service' || a.key === 'bad_review_product'
  );

  if (badAnomalies.length > 0 && reports.length > 0) {
    // 获取差评发生当天的在岗员工
    for (const anomaly of badAnomalies) {
      const anomalyDate = anomaly.latest_date;
      const anomalyDateStr = anomalyDate instanceof Date ? anomalyDate.toISOString().slice(0, 10) : String(anomalyDate).slice(0, 10);
      const reportForDate = reports.find(r => {
        const rDateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10);
        return rDateStr === anomalyDateStr;
      });
      if (!reportForDate || !reportForDate.staff) continue;

      const staff = reportForDate.staff;
      const onDutyNames = [];
      for (const [area, people] of Object.entries(staff)) {
        if (Array.isArray(people)) {
          for (const p of people) {
            if (p.name && p.name !== '休息') {
              onDutyNames.push({ name: p.name, user: p.user, area });
            }
          }
        }
      }

      // 按异常类型筛选相关岗位的在岗员工
      // 产品差评→厨房人员，服务差评→前厅人员
      const relevantAreas = anomaly.key === 'bad_review_product'
        ? new Set(['kitchen', 'kitchen_area', 'restStaff', 'kitchenSupport', '后厨', '出品', '烧味', '点心', '打荷', '上什'])
        : new Set(['front', 'frontSupport', 'frontRestStaff', '前厅', 'service']);
      const relevantStaff = onDutyNames.filter(s => relevantAreas.has(s.area));

      // 匹配培训主题
      let topicTitle = '';
      let topicTarget = '';
      if (anomaly.key === 'bad_review_service') {
        topicTitle = '客诉处置实操认证';
        topicTarget = '前厅';
      } else if (anomaly.key === 'bad_review_product') {
        topicTarget = '厨房';
        if (store.includes('马己仙')) {
          topicTitle = '烧鸭';
        } else if (store.includes('洪潮')) {
          topicTitle = '油温控制';
        }
      }

      // 生成个人级建议
      if (relevantStaff.length > 0) {
        // 找出未完成相关培训的在岗员工
        const untrainedStaff = relevantStaff.filter(s => {
          if (!s.user) return false;
          const empTraining = training.by_employee?.find(t => t.username === s.user);
          if (!empTraining) return true;
          return empTraining.missing_certs.includes(topicTitle);
        });

        if (untrainedStaff.length > 0) {
          const names = untrainedStaff.slice(0, 5).map(s => s.name).join('、');
          const more = untrainedStaff.length > 5 ? `等${untrainedStaff.length}名${topicTarget}人员` : '';
          recs.push({
            type: 'training',
            source: 'rule_engine',
            priority: 'high',
            title: `建议给${names}${more}补《${topicTitle}》培训`,
            detail: `${anomalyDate}出现${anomaly.type}（${anomaly.detail || ''}），上述${topicTarget}人员当天在岗且未完成《${topicTitle}》认证`,
            target: topicTarget,
            target_users: untrainedStaff.map(s => s.user),
            topic_title: topicTitle,
            related_anomaly: anomaly.key,
          });
        } else {
          const names = relevantStaff.slice(0, 3).map(s => s.name).join('、');
          recs.push({
            type: 'training',
            source: 'rule_engine',
            priority: 'medium',
            title: `建议复核${names}等${topicTarget}人员的SOP执行`,
            detail: `${anomalyDate}出现${anomaly.type}，${topicTarget}人员当天在岗且已有培训认证，建议复核实际执行情况`,
            target: topicTarget,
            target_users: relevantStaff.map(s => s.user),
            related_anomaly: anomaly.key,
          });
        }
      }
    }
  }

  // 5. 新客占比低/下降 → 会员营销技巧培训
  const newRatioDeclined = Number(customer.new_ratio_change_pct) <= -10;
  const newRatioLow = customer.new_ratio > 0 && customer.new_ratio < 20;
  if (newRatioDeclined || newRatioLow) {
    // 找店长
    const manager = employees.find(e =>
      e.position?.includes('店长') || e.position?.includes('manager')
    );
    const managerName = manager?.name || '店长';
    const reasonDetail = newRatioDeclined
      ? `新客占比从${customer.prev_new_ratio}%降至${customer.new_ratio}%（环比下降${Math.abs(customer.new_ratio_change_pct)}%）`
      : `新客占比仅${customer.new_ratio}%，低于行业基准20%`;
    recs.push({
      type: 'training',
      source: 'rule_engine',
      priority: 'high',
      title: `建议给${managerName}补《会员营销技巧》培训`,
      detail: `${reasonDetail}。建议通过《会员营销技巧》培训提升门店获客与会员转化能力`,
      target: managerName,
      target_users: manager ? [manager.username] : [],
      topic_title: '会员营销技巧',
    });
  }

  // 5b. 到店转化率下降 → 前厅收银引导培训
  const convContribution = (revenue.contributions || []).find(c => c.factor === '到店转化率下降');
  if (convContribution && reports.length > 0) {
    const latestStaff = reports[0].staff || {};
    const frontNames = [];
    for (const area of ['front', 'frontRestStaff']) {
      for (const p of (latestStaff[area] || [])) {
        if (p.name && p.user) frontNames.push({ name: p.name, user: p.user });
      }
    }
    if (frontNames.length > 0) {
      const names = frontNames.slice(0, 5).map(s => s.name).join('、');
      recs.push({
        type: 'training',
        source: 'rule_engine',
        priority: 'medium',
        title: `建议给${names}补《收银引导与点单话术》培训`,
        detail: `${convContribution.detail}，当前在岗前厅人员建议加强收银转化话术训练`,
        target: '前厅',
        target_users: frontNames.map(s => s.user),
        topic_title: '收银引导与点单话术',
        related_anomaly: null,
      });
    }
  }

  // 6. 无充值记录 → 储值推广建议
  const rechargeAnomaly = anomalies.find(a => a.key === 'recharge_zero');
  if (rechargeAnomaly) {
    recs.push({
      type: 'marketing',
      source: 'rule_engine',
      priority: 'high',
      title: '启动储值卡推广活动',
      detail: `连续多日无会员充值记录，建议推出储值优惠（充500送50）并培训前厅话术`,
      target: '店长',
      related_anomaly: 'recharge_zero',
    });
  }

  // 7. 趋势下降 → 结构性建议
  const trendAnomaly = anomalies.find(a => a.key === 'weekday_trend');
  if (trendAnomaly && trendAnomaly.detail) {
    recs.push({
      type: 'strategy',
      source: 'rule_engine',
      priority: 'high',
      title: '周同比持续下降需结构性调整',
      detail: trendAnomaly.detail,
      target: '店长',
      related_anomaly: 'weekday_trend',
    });
  }

  // 8. 新员工未培训
  const newEmployees = (training.employees_without_training || []).filter(e => e.is_new);
  if (newEmployees.length > 0) {
    const names = newEmployees.map(e => e.name).join('、');
    recs.push({
      type: 'training',
      source: 'rule_engine',
      priority: 'medium',
      title: `新员工${names}尚未完成入职培训`,
      detail: `${names}入职未满90天且无培训记录，建议立即安排入职SOP培训`,
      target: names,
      target_users: newEmployees.map(e => e.username),
      topic_title: '新员工入职SOP',
    });
  }

  return recs;
}

/**
 * 获取所有门店的诊断概览
 */
export async function getAllStoresDiagnosis(pool, dateRange) {
  const endDate = dateRange?.end || new Date().toISOString().slice(0, 10);
  const startDate = dateRange?.start || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const stores = await pool.query(
    `SELECT DISTINCT store FROM daily_reports WHERE date >= $1 AND date <= $2 AND store IS NOT NULL AND store <> '' ORDER BY store`,
    [startDate, endDate]
  );

  const results = [];
  for (const s of stores.rows) {
    try {
      const diag = await getStoreDiagnosis(pool, s.store, dateRange);
      results.push({
        store: s.store,
        summary: diag.summary,
        revenue: {
          total: diag.revenue.total,
          total_pre_discount_revenue: diag.revenue.total_pre_discount_revenue,
          avg_order_value: diag.revenue.avg_order_value,
          avg_table_spend: diag.revenue.avg_table_spend,
          avg_spend_per_person: diag.revenue.avg_spend_per_person,
          avg_daily_traffic: diag.revenue.avg_daily_traffic,
          total_traffic: diag.revenue.total_traffic,
          report_days: diag.revenue.report_days,
          avg_efficiency: diag.revenue.avg_efficiency,
          total_delivery_revenue: diag.revenue.total_delivery_revenue,
          delivery_share_pct: diag.revenue.delivery_share_pct,
          change_pct: diag.revenue.change_pct,
          is_decline: diag.revenue.is_decline,
          contributions: diag.revenue.contributions,
        },
        anomalies: diag.anomalies.map(a => ({ type: a.type, severity: a.severity, count: a.count })),
        recommendations: [
          ...diag.recommendations.map(r => ({ type: r.type, title: r.title, priority: r.priority, source: r.source || 'rule_engine', detail: r.detail })),
          ...(diag.action_suggestions || []).map(a => ({ type: a.action_type || 'pllm_task', title: a.title, priority: a.priority || 'medium', source: a.source || 'AI', detail: a.detail }))
        ].slice(0, 8),
        action_suggestion_count: diag.action_suggestions?.length || 0,
      });
    } catch (e) {
      console.error(`[diagnosis] store ${s.store} failed:`, e?.message || e);
    }
  }
  return results;
}

/**
 * 注册诊断路由
 */
export function registerDiagnosisRoutes(app, pool, authRequired) {
  app.get('/api/diagnosis/store/:store', authRequired, async (req, res) => {
    try {
      const store = cleanText(req.params.store, 128);
      if (!store) return res.status(400).json({ ok: false, error: 'store_required' });
      const dateRange = {};
      if (req.query.start) dateRange.start = cleanText(req.query.start, 10);
      if (req.query.end) dateRange.end = cleanText(req.query.end, 10);
      const result = await getStoreDiagnosis(pool, store, dateRange);
      return res.json({ ok: true, diagnosis: result });
    } catch (e) {
      console.error('[diagnosis] store error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/diagnosis/overview', authRequired, async (req, res) => {
    try {
      const dateRange = {};
      if (req.query.start) dateRange.start = cleanText(req.query.start, 10);
      if (req.query.end) dateRange.end = cleanText(req.query.end, 10);
      const result = await getAllStoresDiagnosis(pool, dateRange);
      return res.json({ ok: true, stores: result });
    } catch (e) {
      console.error('[diagnosis] overview error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
