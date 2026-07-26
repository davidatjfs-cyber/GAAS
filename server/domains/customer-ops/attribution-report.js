/**
 * AI 自动营销归因报表（从 customer-ops.js#buildAttributionReport 外提）。
 */

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 40).replace(/[^0-9]/g, '').slice(-11);
}

export function maskAttributionPhone(phone) {
  const s = cleanPhone(phone);
  if (s.length !== 11) return '';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

export function classifyAttributionAudience(row) {
  const text = `${row.campaign_type || ''} ${row.target_audience || ''} ${row.rule_key || ''} ${row.title || ''}`.toLowerCase();
  if (/vip|高价值|大客户/.test(text)) return '高价值客户';
  if (/储值|余额|充值/.test(text)) return '储值客户';
  if (/新客|二次|复购|one_time/.test(text)) return '新客二次回店';
  if (/生日|birth/.test(text)) return '生日客户';
  if (/沉睡|流失|召回|dormant|churn|risk/.test(text)) return '沉睡/流失召回';
  if (/自动|auto|规则/.test(text)) return '自动营销客户';
  return '其他维护客户';
}

export function attributionCostExpr(channelExpr = 'channel') {
  return `CASE WHEN lower(COALESCE(${channelExpr}, '')) IN ('sms', '短信') THEN 0.05 ELSE 0 END`;
}

export function friendlyAttributionTitle(value) {
  const s = cleanText(value || '', 200);
  const map = {
    active: '活跃客户维护',
    dormant: '沉睡客户召回',
    churned: '流失客户召回',
    one_time: '新客二次回店',
    vip: 'VIP客户维护',
    vip_gift: 'VIP客户权益邀约',
    mj_dinner_weekend: '周末晚市客户邀约',
    dormant_90_180: '沉睡90-180天客户召回',
    stored_value: '储值客户维护',
  };
  return map[s] || s || '自动营销触达';
}

function mapCampaignRow(r) {
  const cost = Number(r.touch_cost || 0);
  const revenue = Number(r.attributed_revenue || 0);
  const discountAmt = Number(r.discount_amount || 0);
  const touched = Number(r.touched_customers || 0);
  const returned = Number(r.returned_customers || 0);
  return {
    ...r,
    title: friendlyAttributionTitle(r.title),
    customer_type: classifyAttributionAudience(r),
    touches: Number(r.touches || 0),
    touched_customers: touched,
    returned_customers: returned,
    return_rate: touched > 0 ? returned / touched : 0,
    attributed_orders: Number(r.attributed_orders || 0),
    attributed_revenue: revenue,
    attributed_pre_discount_revenue: Number(r.attributed_pre_discount_revenue || 0),
    discount_amount: discountAmt,
    touch_cost: cost,
    roi: (cost + discountAmt) > 0 ? revenue / (cost + discountAmt) : null,
  };
}

function mapStoreRow(r) {
  const touched = Number(r.touched_customers || 0);
  const returned = Number(r.returned_customers || 0);
  const cost = Number(r.touch_cost || 0);
  const revenue = Number(r.attributed_revenue || 0);
  const discountAmt = Number(r.discount_amount || 0);
  return {
    ...r,
    touched_customers: touched,
    returned_customers: returned,
    return_rate: touched > 0 ? returned / touched : 0,
    attributed_orders: Number(r.attributed_orders || 0),
    attributed_revenue: revenue,
    discount_amount: discountAmt,
    touch_cost: cost,
    roi: (cost + discountAmt) > 0 ? revenue / (cost + discountAmt) : null,
  };
}

export function buildAttributionRecommendations({
  customerTypeRows,
  campaignRows,
  touchedCustomers,
  returnedCustomers,
  discountAmount,
}) {
  const bestType = customerTypeRows[0] || null;
  const bestCampaign = campaignRows[0] || null;
  return [
    '活跃客户维护投入产出比最高，建议下月继续加大触达。',
    '沉睡/流失客户回店率偏低，建议改为更强权益或人工企微跟进。',
    'VIP客户订单客单较高，建议单独建立店长一对一维护池。',
    bestType
      ? `优先加码「${bestType.customer_type}」：本期贡献归因实收¥${Math.round(bestType.attributed_revenue).toLocaleString()}，下月建议扩大同类客群触达并保留对照组。`
      : '先补齐触达日志与手机号匹配数据，保证下月能完整核算客户回店和收入。',
    bestCampaign
      ? `复用高效活动「${bestCampaign.title}」：回店${bestCampaign.returned_customers}人、归因实收¥${Math.round(bestCampaign.attributed_revenue).toLocaleString()}，建议复制到相似门店并微调权益。`
      : '活动执行后必须沉淀触达客户名单、渠道和成本，否则无法证明ROI。',
    discountAmount > 0
      ? `控制优惠效率：本期归因优惠金额¥${Math.round(discountAmount).toLocaleString()}，下月按客群拆分不同券额，避免高价值客户过度让利。`
      : '下月建议记录优惠券/折扣金额，形成“优惠成本 -> 回店营业额 -> ROI”的完整链路。',
    touchedCustomers > 0 && returnedCustomers / touchedCustomers < 0.08
      ? '回店率偏低时，优先优化触达时机和利益点，不建议单纯扩大群发人数。'
      : '保持触达节奏，重点追踪触达后7/14/30天回店差异，找到最适合品牌的归因窗口。',
  ];
}

export function assembleAttributionReport({
  queryResults,
  dateFrom,
  dateTo,
  storeId,
  storeFilter,
  windowDays,
}) {
  const [
    touchSummary,
    attributedSummary,
    byCampaign,
    byStore,
    byTypeRaw,
    trend,
    topCustomers,
    orderRecords,
    manualSummary,
  ] = queryResults;

  const ts = touchSummary.rows[0] || {};
  const as = attributedSummary.rows[0] || {};
  const manual = manualSummary.rows[0] || {};
  const touchedCustomers = Number(ts.touched_customers || 0);
  const touchCount = Number(ts.touch_count || 0);
  const returnedCustomers = Number(as.returned_customers || 0);
  const attributedRevenue = Number(as.attributed_revenue || 0);
  const touchCost = Number(ts.touch_cost || 0) || Number(manual.manual_cost || 0);
  const discountAmount = Number(as.discount_amount || 0);

  const byTypeMap = new Map();
  for (const row of byTypeRaw.rows) {
    const label = classifyAttributionAudience(row);
    const before = byTypeMap.get(label) || { customer_type: label, returned_customers: 0, attributed_orders: 0, attributed_revenue: 0 };
    before.returned_customers += Number(row.returned_customers || 0);
    before.attributed_orders += Number(row.attributed_orders || 0);
    before.attributed_revenue += Number(row.attributed_revenue || 0);
    byTypeMap.set(label, before);
  }
  const customerTypeRows = Array.from(byTypeMap.values()).sort((a, b) => b.attributed_revenue - a.attributed_revenue);
  const campaignRows = byCampaign.rows.map(mapCampaignRow);

  return {
    ok: true,
    report: {
      title: 'AI自动营销归因报表',
      period: {
        date_from: dateFrom,
        date_to: dateTo,
        store_id: storeId,
        store_filter: storeFilter.displayName,
        window_days: windowDays,
        generated_at: new Date().toISOString(),
      },
      summary: {
        campaign_count: Number(manual.campaign_count || 0),
        ai_suggested_customers: Number(manual.suggested_customers || 0),
        touch_count: touchCount,
        touched_customers: touchedCustomers,
        touch_rate: touchCount > 0 ? touchedCustomers / touchCount : 0,
        returned_customers: returnedCustomers,
        return_rate: touchedCustomers > 0 ? returnedCustomers / touchedCustomers : 0,
        attributed_orders: Number(as.attributed_orders || 0),
        attributed_revenue: attributedRevenue,
        attributed_pre_discount_revenue: Number(as.attributed_pre_discount_revenue || 0),
        discount_amount: discountAmount,
        touch_cost: touchCost,
        roi: (touchCost + discountAmount) > 0 ? attributedRevenue / (touchCost + discountAmount) : null,
        manual_recorded_revenue: Number(manual.manual_revenue || 0),
      },
      by_customer_type: customerTypeRows,
      by_campaign: campaignRows,
      by_store: byStore.rows.map(mapStoreRow),
      trend: trend.rows.map((r) => ({
        date: r.day ? String(r.day).slice(0, 10) : '',
        touched_customers: Number(r.touched_customers || 0),
        returned_customers: Number(r.returned_customers || 0),
        attributed_orders: Number(r.attributed_orders || 0),
        attributed_revenue: Number(r.attributed_revenue || 0),
      })),
      top_customers: topCustomers.rows.map((r) => ({
        phone: maskAttributionPhone(r.phone),
        store_id: r.store_id || '',
        store_name: r.store_name || r.store_id || '',
        last_touch_date: r.last_touch_date ? String(r.last_touch_date).slice(0, 10) : '',
        last_order_date: r.last_order_date ? String(r.last_order_date).slice(0, 10) : '',
        attributed_orders: Number(r.attributed_orders || 0),
        attributed_revenue: Number(r.attributed_revenue || 0),
      })),
      order_records: orderRecords.rows.map((r) => ({
        phone: maskAttributionPhone(r.phone),
        date: r.biz_date ? String(r.biz_date).slice(0, 10) : '',
        store_id: r.store_id || '',
        store_name: r.store_name || r.store_id || '',
        table_no: r.table_no || '',
        diners: Number(r.diners || 0),
        order_no: r.order_no || '',
        revenue: Number(r.revenue || 0),
        pre_discount_revenue: Number(r.pre_discount_revenue || 0),
        discount_amount: Number(r.discount_amount || 0),
      })),
      evidenceDetails: orderRecords.rows.map((r) => ({
        customerId: maskAttributionPhone(r.phone),
        customerName: '',
        campaignId: '',
        touchTime: '',
        channel: '',
        couponId: '',
        relatedOrderId: r.order_no || '',
        orderTime: r.biz_date ? String(r.biz_date).slice(0, 10) : '',
        orderAmount: Number(r.revenue || 0),
        attributionType: Number(r.discount_amount || 0) > 0 ? 'coupon' : 'assisted',
        couponUsed: Number(r.discount_amount || 0) > 0,
        attributionWindowDays: windowDays,
      })),
      recommendations: buildAttributionRecommendations({
        customerTypeRows,
        campaignRows,
        touchedCustomers,
        returnedCustomers,
        discountAmount,
      }),
      methodology: {
        attribution_rule: '统计周期内，收银订单会员手机号或会员ID与本期已发送客户一致，即计入归因结果；同一订单只归因一次。',
        revenue_rule: '归因营业额采用收银订单实收金额；同时保留折前营业额供复核。',
        roi_rule: '短信按0.05元/条估算触达成本；企微/小程序等零边际触达成本记为0，投入产出比为归因实收营业额/触达成本。',
        caution: '归因营业额代表被触达客户在归因周期内回店产生的消费，不等同于严格实验意义上的真实新增营业额。',
      },
    },
  };
}

function buildAttributionSql(tenantId, dateFrom, dateTo, storeFilter, storeId) {
  const touchParams = [tenantId, dateFrom, dateTo, storeFilter.posStoreIds, storeId];
  const touchesSql = `
    SELECT
      ('auto:' || COALESCE(NULLIF(dl.rule_key, ''), NULLIF(dl.action_key, ''), 'unknown') || ':' || dl.created_at::date::text) AS campaign_id,
      COALESCE(tr.name, NULLIF(dl.rule_key, ''), NULLIF(dl.action_key, ''), '自动营销触达') AS title,
      COALESCE(NULLIF(dl.channel, ''), 'unknown') AS channel,
      '自动营销' AS campaign_type,
      '系统规则圈选客户' AS target_audience,
      COALESCE(NULLIF(dl.rule_key, ''), '') AS rule_key,
      COALESCE(NULLIF(dl.store_id, ''), '') AS store_id,
      clean_phone.phone AS phone,
      dl.customer_id,
      dl.created_at AS touched_at,
      ${attributionCostExpr('dl.channel')}::numeric AS touch_cost
    FROM growth_delivery_logs dl
    LEFT JOIN growth_touch_rules tr ON tr.rule_key = dl.rule_key
    CROSS JOIN LATERAL (
      SELECT regexp_replace(COALESCE(dl.payload->>'phone', ''), '[^0-9]', '', 'g') AS phone
    ) clean_phone
    WHERE dl.tenant_id = $1
      AND dl.status = 'sent'
      AND dl.created_at::date >= $2::date
      AND dl.created_at::date <= $3::date
      AND ($5::text = '' OR dl.store_id = $5 OR dl.store_id = ANY($4::text[]))
      AND clean_phone.phone <> ''
  `;
  const attributedSql = `
    WITH touches AS (${touchesSql})
    SELECT DISTINCT ON (po.order_no)
      t.campaign_id,
      t.title,
      t.channel,
      t.campaign_type,
      t.target_audience,
      t.rule_key,
      COALESCE(NULLIF(t.store_id, ''), po.store_id, '') AS store_id,
      po.store_name,
      t.phone,
      t.customer_id,
      t.touched_at,
      po.order_no,
      po.biz_date,
      po.table_no,
      po.diners,
      COALESCE(po.amount_after_discount, 0)::numeric AS revenue,
      COALESCE(po.amount_before_discount, 0)::numeric AS pre_discount_revenue,
      ABS(COALESCE(po.total_discount, 0)::numeric) AS discount_amount
    FROM touches t
    JOIN pos_orders po
      ON (regexp_replace(COALESCE(po.phone, ''), '[^0-9]', '', 'g') = t.phone OR (t.customer_id IS NOT NULL AND po.customer_id = t.customer_id))
     AND po.biz_date >= $2::date
     AND po.biz_date <= $3::date
     AND ($5::text = '' OR po.store_id = ANY($4::text[]))
    WHERE po.order_no IS NOT NULL AND po.order_no <> ''
    ORDER BY po.order_no, t.touched_at DESC
  `;
  return { touchesSql, attributedSql, touchParams };
}

async function runAttributionQueries(pool, { touchesSql, attributedSql, touchParams }) {
  const params = touchParams;
  return Promise.all([
    pool.query(`WITH touches AS (${touchesSql}) SELECT COUNT(*)::int AS touch_count, COUNT(DISTINCT phone)::int AS touched_customers, COALESCE(SUM(touch_cost), 0)::numeric AS touch_cost FROM touches`, touchParams),
    pool.query(`WITH attributed AS (${attributedSql}) SELECT COUNT(DISTINCT order_no)::int AS attributed_orders, COUNT(DISTINCT phone)::int AS returned_customers, COALESCE(SUM(revenue), 0)::numeric AS attributed_revenue, COALESCE(SUM(pre_discount_revenue), 0)::numeric AS attributed_pre_discount_revenue, COALESCE(SUM(discount_amount), 0)::numeric AS discount_amount FROM attributed`, params),
    pool.query(`
      WITH touches AS (${touchesSql}), attributed AS (${attributedSql}),
      touch_agg AS (
        SELECT campaign_id, MAX(title) AS title, MAX(channel) AS channel, MAX(campaign_type) AS campaign_type,
               MAX(target_audience) AS target_audience, MAX(rule_key) AS rule_key, COUNT(*)::int AS touches,
               COUNT(DISTINCT phone)::int AS touched_customers, COALESCE(SUM(touch_cost), 0)::numeric AS touch_cost
        FROM touches GROUP BY campaign_id
      ),
      attr_agg AS (
        SELECT campaign_id, COUNT(DISTINCT order_no)::int AS orders, COUNT(DISTINCT phone)::int AS returned_customers,
               COALESCE(SUM(revenue), 0)::numeric AS revenue, COALESCE(SUM(pre_discount_revenue), 0)::numeric AS pre_discount_revenue,
               COALESCE(SUM(discount_amount), 0)::numeric AS discount_amount
        FROM attributed GROUP BY campaign_id
      )
      SELECT t.*, COALESCE(a.orders, 0)::int AS attributed_orders, COALESCE(a.returned_customers, 0)::int AS returned_customers,
             COALESCE(a.revenue, 0)::numeric AS attributed_revenue, COALESCE(a.pre_discount_revenue, 0)::numeric AS attributed_pre_discount_revenue,
             COALESCE(a.discount_amount, 0)::numeric AS discount_amount
      FROM touch_agg t LEFT JOIN attr_agg a ON a.campaign_id = t.campaign_id
      ORDER BY COALESCE(a.revenue, 0) DESC, t.touched_customers DESC LIMIT 50`, params),
    pool.query(`
      WITH touches AS (${touchesSql}), attributed AS (${attributedSql}),
      touch_agg AS (
        SELECT COALESCE(NULLIF(store_id, ''), '全部/未知') AS store_id, COUNT(*)::int AS touches,
               COUNT(DISTINCT phone)::int AS touched_customers, COALESCE(SUM(touch_cost), 0)::numeric AS touch_cost
        FROM touches GROUP BY COALESCE(NULLIF(store_id, ''), '全部/未知')
      ),
      attr_agg AS (
        SELECT COALESCE(NULLIF(store_id, ''), '全部/未知') AS store_id, MAX(store_name) AS store_name,
               COUNT(DISTINCT order_no)::int AS orders, COUNT(DISTINCT phone)::int AS returned_customers,
               COALESCE(SUM(revenue), 0)::numeric AS revenue, COALESCE(SUM(discount_amount), 0)::numeric AS discount_amount
        FROM attributed GROUP BY COALESCE(NULLIF(store_id, ''), '全部/未知')
      )
      SELECT t.store_id, COALESCE(a.store_name, t.store_id) AS store_name, t.touches, t.touched_customers, t.touch_cost,
             COALESCE(a.orders, 0)::int AS attributed_orders, COALESCE(a.returned_customers, 0)::int AS returned_customers,
             COALESCE(a.revenue, 0)::numeric AS attributed_revenue, COALESCE(a.discount_amount, 0)::numeric AS discount_amount
      FROM touch_agg t LEFT JOIN attr_agg a ON a.store_id = t.store_id
      ORDER BY COALESCE(a.revenue, 0) DESC, t.touched_customers DESC LIMIT 30`, params),
    pool.query(`WITH attributed AS (${attributedSql}) SELECT campaign_type, target_audience, rule_key, title, COUNT(DISTINCT phone)::int AS returned_customers, COUNT(DISTINCT order_no)::int AS attributed_orders, COALESCE(SUM(revenue), 0)::numeric AS attributed_revenue FROM attributed GROUP BY campaign_type, target_audience, rule_key, title`, params),
    pool.query(`
      WITH touches AS (${touchesSql}), attributed AS (${attributedSql}),
      touch_day AS (SELECT touched_at::date AS day, COUNT(DISTINCT phone)::int AS touched_customers FROM touches GROUP BY touched_at::date),
      attr_day AS (SELECT biz_date AS day, COUNT(DISTINCT phone)::int AS returned_customers, COUNT(DISTINCT order_no)::int AS orders, COALESCE(SUM(revenue), 0)::numeric AS revenue FROM attributed GROUP BY biz_date)
      SELECT COALESCE(t.day, a.day) AS day, COALESCE(t.touched_customers, 0)::int AS touched_customers, COALESCE(a.returned_customers, 0)::int AS returned_customers, COALESCE(a.orders, 0)::int AS attributed_orders, COALESCE(a.revenue, 0)::numeric AS attributed_revenue
      FROM touch_day t FULL JOIN attr_day a ON a.day = t.day ORDER BY day ASC`, params),
    pool.query(`
      WITH attributed AS (${attributedSql})
      SELECT phone, MAX(store_name) AS store_name, MAX(store_id) AS store_id, MAX(touched_at)::date AS last_touch_date,
             MAX(biz_date) AS last_order_date, COUNT(DISTINCT order_no)::int AS attributed_orders,
             COALESCE(SUM(revenue), 0)::numeric AS attributed_revenue
      FROM attributed GROUP BY phone ORDER BY attributed_revenue DESC LIMIT 20`, params),
    pool.query(`
      WITH attributed AS (${attributedSql})
      SELECT phone, biz_date, store_id, store_name, table_no, diners, order_no, revenue, pre_discount_revenue, discount_amount
      FROM attributed
      ORDER BY biz_date DESC, revenue DESC
      LIMIT 80`, params),
    pool.query(`
      SELECT COALESCE(SUM(c.target_count), 0)::int AS suggested_customers, COUNT(*)::int AS campaign_count,
             COALESCE(SUM(c.budget), 0)::numeric AS planned_budget, COALESCE(SUM(r.actual_send_count), 0)::int AS manual_send_count,
             COALESCE(SUM(r.actual_revenue), 0)::numeric AS manual_revenue, COALESCE(SUM(r.actual_cost), 0)::numeric AS manual_cost
      FROM marketing_campaigns c
      LEFT JOIN marketing_campaign_results r ON r.campaign_id = c.id AND r.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND COALESCE(c.planned_date, c.created_at::date) >= $2::date AND COALESCE(c.planned_date, c.created_at::date) <= $3::date
        AND ($5::text = '' OR c.store_ids = '[]'::jsonb OR c.store_ids @> to_jsonb(ARRAY[$5::text]) OR c.store_ids ?| $4::text[])`, touchParams),
  ]);
}

export function createBuildAttributionReport(deps) {
  const {
    resolveStoreFilter,
    ensureTables,
    syncCampaigns,
    log,
  } = deps;

  return async function buildAttributionReport(pool, tenantId, opts = {}) {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
    const dateTo = cleanText(opts.dateTo || today, 20);
    const storeId = cleanText(opts.storeId || '', 80);
    const windowDays = Math.max(1, Math.min(60, Number(opts.windowDays || 14)));
    const storeFilter = await resolveStoreFilter(pool, tenantId, storeId);

    await ensureTables(pool);
    await syncCampaigns(pool, tenantId).catch((e) => log.warn({
      msg: 'customer_ops_auto_campaign_sync_failed',
      err: e?.message,
    }));

    const { touchesSql, attributedSql, touchParams } = buildAttributionSql(tenantId, dateFrom, dateTo, storeFilter, storeId);
    const queryResults = await runAttributionQueries(pool, { touchesSql, attributedSql, touchParams });
    return assembleAttributionReport({
      queryResults,
      dateFrom,
      dateTo,
      storeId,
      storeFilter,
      windowDays,
    });
  };
}
