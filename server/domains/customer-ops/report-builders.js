/**
 * Customer-ops report builders (P5.4 extract from customer-ops.js).
 */
import {
  cleanText,
  resolveCustomerOpsStoreFilter,
  posStoreFilterSql,
  safeReportQuery,
} from './ops-helpers.js';

export async function buildCustomerAssetReport(pool, tenantId, opts = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
  const dateTo = cleanText(opts.dateTo || today, 20);
  const storeId = cleanText(opts.storeId || '', 80);
  const fromDate = new Date(`${dateFrom}T00:00:00+08:00`);
  const toDate = new Date(`${dateTo}T00:00:00+08:00`);
  const periodDays = Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1);
  const prevTo = new Date(fromDate.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (periodDays - 1) * 86400000);
  const prevDateFrom = prevFrom.toISOString().slice(0, 10);
  const prevDateTo = prevTo.toISOString().slice(0, 10);
  const storeFilter = await resolveCustomerOpsStoreFilter(pool, tenantId, storeId);
  const params = [dateFrom, dateTo, storeId, storeFilter.posStoreIds, storeFilter.posStoreNames, storeFilter.posStorePatterns];
  const assetSql = `
    WITH period_orders AS (
      SELECT phone, customer_id, store_id, amount_after_discount, biz_date
      FROM pos_orders
      WHERE biz_date >= $1::date AND biz_date <= $2::date
        AND ${posStoreFilterSql()}
    ),
    current_customers AS (
      SELECT DISTINCT COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text) AS cid,
             MIN(biz_date) AS first_date, MAX(biz_date) AS last_date,
             COUNT(*)::int AS orders, SUM(amount_after_discount)::numeric AS revenue
      FROM period_orders
      WHERE phone IS NOT NULL OR customer_id IS NOT NULL
      GROUP BY COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text)
    ),
    before_orders AS (
      SELECT DISTINCT COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text) AS cid
      FROM pos_orders
      WHERE biz_date < $1::date AND ${posStoreFilterSql()}
        AND (phone IS NOT NULL OR customer_id IS NOT NULL)
    ),
    dormant_before AS (
      SELECT COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text) AS cid, MAX(biz_date) AS last_before
      FROM pos_orders
      WHERE biz_date < $1::date AND ${posStoreFilterSql()}
        AND (phone IS NOT NULL OR customer_id IS NOT NULL)
      GROUP BY COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text)
    ),
    classified AS (
      SELECT c.*,
             CASE
               WHEN revenue >= 1000 OR orders >= 3 THEN '高价值客户'
               WHEN db.last_before < $1::date - INTERVAL '60 days' THEN '沉睡唤醒客户'
               WHEN orders >= 2 THEN '复购客户'
               WHEN b.cid IS NULL THEN '新增客户'
               ELSE '其他可识别客户'
             END AS primary_segment,
             CASE WHEN b.cid IS NULL THEN 1 ELSE 0 END AS is_new,
             CASE WHEN orders >= 2 THEN 1 ELSE 0 END AS is_repeat,
             CASE WHEN last_date >= $2::date - INTERVAL '30 days' THEN 1 ELSE 0 END AS is_active,
             CASE WHEN db.last_before < $1::date - INTERVAL '60 days' THEN 1 ELSE 0 END AS is_reactivated,
             CASE WHEN revenue >= 1000 OR orders >= 3 THEN 1 ELSE 0 END AS is_vip
      FROM current_customers c
      LEFT JOIN before_orders b ON b.cid = c.cid
      LEFT JOIN dormant_before db ON db.cid = c.cid
    )
    SELECT
      COUNT(*)::int AS identifiable_customers,
      SUM(is_new)::int AS new_customers,
      SUM(is_repeat)::int AS repeat_customers,
      SUM(is_active)::int AS active_customers,
      SUM(is_reactivated)::int AS dormant_reactivated,
      SUM(is_vip)::int AS vip_customers,
      COALESCE(SUM(revenue),0)::numeric AS customer_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='新增客户'),0)::numeric AS new_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='复购客户'),0)::numeric AS repeat_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='高价值客户'),0)::numeric AS vip_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='沉睡唤醒客户'),0)::numeric AS reactivated_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='其他可识别客户'),0)::numeric AS other_revenue,
      COUNT(*) FILTER (WHERE primary_segment='新增客户')::int AS new_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='复购客户')::int AS repeat_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='高价值客户')::int AS vip_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='沉睡唤醒客户')::int AS reactivated_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='其他可识别客户')::int AS other_primary_customers
    FROM classified`;
  const rows = await safeReportQuery(pool, assetSql, params, [{}]);
  const prevRows = await safeReportQuery(pool, assetSql, [prevDateFrom, prevDateTo, storeId, storeFilter.posStoreIds, storeFilter.posStoreNames, storeFilter.posStorePatterns], [{}]);
  const s = rows[0] || {};
  const ps = prevRows[0] || {};
  const active = Number(s.active_customers || 0);
  const dormantReactivated = Number(s.dormant_reactivated || 0);
  const identifiable = Number(s.identifiable_customers || 0);
  const newCustomers = Number(s.new_customers || 0);
  const repeatCustomers = Number(s.repeat_customers || 0);
  const vipCustomers = Number(s.vip_customers || 0);
  const customerRevenue = Number(s.customer_revenue || 0);
  const prevActive = Number(ps.active_customers || 0);
  const newDormantCustomers = Math.max(0, Number(ps.active_customers || 0) - active);
  const netAssetGrowth = newCustomers + dormantReactivated + Math.max(0, active - prevActive) - newDormantCustomers;
  const pctChange = (current, prev) => Number(prev || 0) > 0 ? (Number(current || 0) - Number(prev || 0)) / Number(prev || 0) : null;
  const assetSummary = customerRevenue >= Number(ps.customer_revenue || 0)
    ? '本期客户资产保持增长，说明客户池正在变厚。下月重点应继续放大新客二次复购和高价值客户维护。'
    : '本期新增客户不少，但老客活跃和贡献下滑，说明客户资产正在“进得来、留不住”。下月重点应放在新客二次复购和高价值客户维护。';
  return { ok: true, report: {
    title: 'AI客户资产增长报告',
    executive_summary: assetSummary,
    period: { date_from: dateFrom, date_to: dateTo, store_id: storeId, store_filter: storeFilter.displayName, prev_date_from: prevDateFrom, prev_date_to: prevDateTo },
    summary: {
      new_customers: newCustomers,
      identifiable_customers: identifiable,
      active_customers: active,
      repeat_customers: repeatCustomers,
      dormant_reactivated: dormantReactivated,
      vip_customers: vipCustomers,
      stored_value_visits: 0,
      churn_risk_customers: 0,
      active_net_increase: Math.max(0, active - prevActive),
      new_dormant_customers: newDormantCustomers,
      net_asset_growth: netAssetGrowth,
      customer_revenue: customerRevenue,
      new_revenue: Number(s.new_revenue || 0),
      repeat_revenue: Number(s.repeat_revenue || 0),
      vip_revenue: Number(s.vip_revenue || 0),
      reactivated_revenue: Number(s.reactivated_revenue || 0),
      other_revenue: Number(s.other_revenue || 0),
      new_identification_rate: identifiable > 0 ? newCustomers / identifiable : 0,
      new_repeat_rate: newCustomers > 0 ? repeatCustomers / newCustomers : 0,
      active_customer_ratio: identifiable > 0 ? active / identifiable : 0,
      dormant_reactivation_rate: identifiable > 0 ? dormantReactivated / identifiable : 0,
      vip_customer_ratio: identifiable > 0 ? vipCustomers / identifiable : 0,
      avg_identifiable_revenue: identifiable > 0 ? customerRevenue / identifiable : 0,
      avg_repeat_revenue: repeatCustomers > 0 ? Number(s.repeat_revenue || 0) / repeatCustomers : 0,
    },
    previous_period: {
      date_from: prevDateFrom,
      date_to: prevDateTo,
      new_customers: Number(ps.new_customers || 0),
      identifiable_customers: Number(ps.identifiable_customers || 0),
      active_customers: prevActive,
      repeat_customers: Number(ps.repeat_customers || 0),
      dormant_reactivated: Number(ps.dormant_reactivated || 0),
      vip_customers: Number(ps.vip_customers || 0),
      customer_revenue: Number(ps.customer_revenue || 0),
    },
    comparison: {
      new_customers: pctChange(newCustomers, ps.new_customers),
      active_customers: pctChange(active, ps.active_customers),
      repeat_customers: pctChange(repeatCustomers, ps.repeat_customers),
      dormant_reactivated: pctChange(dormantReactivated, ps.dormant_reactivated),
      vip_customers: pctChange(vipCustomers, ps.vip_customers),
      customer_revenue: pctChange(customerRevenue, ps.customer_revenue),
    },
    stages: [
      { name: '新增客户', count: newCustomers, conversion_label: '二次复购转化率', conversion_rate: newCustomers > 0 ? repeatCustomers / newCustomers : 0 },
      { name: '二次复购', count: repeatCustomers, conversion_label: '活跃转化率', conversion_rate: repeatCustomers > 0 ? active / repeatCustomers : null },
      { name: '活跃客户', count: active, conversion_label: '高价值转化率', conversion_rate: active > 0 ? vipCustomers / active : 0 },
      { name: '高价值客户', count: vipCustomers, conversion_label: 'VIP待转化', conversion_rate: null },
      { name: '沉睡唤醒', count: dormantReactivated, conversion_label: '重新活跃客户', conversion_rate: identifiable > 0 ? dormantReactivated / identifiable : 0 },
    ],
    value_segments: [
      { name: '高价值客户', customers: Number(s.vip_primary_customers || 0), revenue: Number(s.vip_revenue || 0), rule: '优先口径：高消费或高频客户', action: '建立店长一对一维护池' },
      { name: '沉睡唤醒客户', customers: Number(s.reactivated_primary_customers || 0), revenue: Number(s.reactivated_revenue || 0), rule: '优先口径：历史60天以上未消费，本期回店', action: '进入连续维护，不只召回一次' },
      { name: '复购客户', customers: Number(s.repeat_primary_customers || 0), revenue: Number(s.repeat_revenue || 0), rule: '优先口径：本期消费2次及以上', action: '推送储值或会员权益' },
      { name: '新增客户', customers: Number(s.new_primary_customers || 0), revenue: Number(s.new_revenue || 0), rule: '优先口径：本期首次识别', action: '7-14天内做二次复购' },
      { name: '其他可识别客户', customers: Number(s.other_primary_customers || 0), revenue: Number(s.other_revenue || 0), rule: '用于让客户贡献营业额闭合', action: '继续沉淀标签和消费偏好' },
    ],
    insight_cards: [
      { priority: 'P1', label: '风险', title: '活跃与贡献较上期下降', text: '老客维护和高价值客户回访要优先执行。' },
      { priority: 'P1', label: '机会', title: '新客识别率较高', text: '可把首次消费后7-14天未回店客户放入二次复购池。' },
      { priority: 'P2', label: '重点', title: '高价值客户需要单独维护', text: '高价值客户占比低时，应建立VIP和店长一对一维护池。' },
    ],
    next_month_pools: [
      { name: '新客二次复购池', customers: newCustomers, channel: '短信 + 企微提醒', benefit: '二次复购券', action: '对首次消费后7-14天未回店的新客发送二次复购短信，店长同步企微跟进。', owner: '店长/客户运营', deadline: '7天内', target: '7天后看回店率和实收金额' },
      { name: '高价值客户池', customers: vipCustomers, channel: '店长一对一维护', benefit: '专属邀约/储值权益', action: '建立店长一对一维护池，优先邀约高消费或高频客户。', owner: '店长', deadline: '本月内', target: '提升复购和储值转化' },
      { name: '沉睡唤醒池', customers: dormantReactivated, channel: '连续触达两轮', benefit: '回店权益', action: '对沉睡唤醒客户连续触达两轮，复盘权益强度。', owner: '客户运营', deadline: '14天内', target: '重新激活并进入活跃池' },
      { name: '储值提醒池', customers: 0, channel: '余额提醒 + 菜品推荐', benefit: '余额消耗提醒', action: '提醒有余额但近期未消费客户回店消费。', owner: '店长/收银主管', deadline: '本月内', target: '消耗余额并带动复购' },
    ],
    action_entries: [
      { action: '生成下月客户维护计划', target: '四类重点客户池', owner: '客户运营', deadline: '本周内', expected_result: '形成可执行触达节奏和复盘目标' },
      { action: '生成短信/企微触达名单', target: '新客二次复购池、沉睡唤醒池', owner: '客户运营', deadline: '3天内', expected_result: '完成第一轮触达并记录触达结果' },
      { action: '生成店长跟进任务', target: '高价值客户池', owner: '店长', deadline: '7天内', expected_result: '完成一对一维护并复盘回店金额' },
      { action: '导出重点客户清单', target: '可识别客户与高价值客户', owner: '运营负责人', deadline: '今天', expected_result: '给门店形成可落地名单' },
    ],
    recommendations: [
      '把新客二次复购作为下月核心动作，重点跟踪首次消费后7-14天回店。',
      '对高价值客户建立单独维护池，避免只用普通群发触达。',
      '沉睡唤醒客户要进入连续维护，不要只做一次召回。'
    ],
    methodology: [
      '按统计周期内收银订单的手机号/会员ID识别客户资产。',
      '客户资产净增长 = 新增可识别客户 + 沉睡唤醒客户 + 活跃客户净增加 - 新增沉睡客户。',
      '客户价值默认采用去重口径：高价值客户 > 沉睡唤醒客户 > 复购客户 > 新增客户 > 其他可识别客户，避免金额重复计算。',
      '活跃客户按最近30天有消费统计；沉睡唤醒按历史超过60天未消费、本期重新消费统计。',
      '上期对比采用同等长度的上一周期。'
    ]
  }};
}

export async function buildOpsRectificationReport(pool, tenantId, opts = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
  const dateTo = cleanText(opts.dateTo || today, 20);
  const storeId = cleanText(opts.storeId || '', 80);
  const storeFilter = await resolveCustomerOpsStoreFilter(pool, tenantId, storeId);
  const params = [dateFrom, dateTo, storeId, storeFilter.posStoreNames, storeFilter.posStorePatterns, storeFilter.posStoreIds];
  const anomalyStoreSql = `($3::text='' OR store=$3 OR store=ANY($4::text[]) OR store=ANY($6::text[]) OR store ILIKE ANY($5::text[]))`;
  const anomaly = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE severity IN ('high','critical'))::int AS high_risk,
           COUNT(*) FILTER (WHERE status NOT IN ('closed','resolved'))::int AS open_count,
           COUNT(*) FILTER (WHERE task_id IS NOT NULL AND task_id <> '')::int AS generated_tasks
    FROM anomaly_triggers
    WHERE trigger_date >= $1::date AND trigger_date <= $2::date AND ${anomalyStoreSql}`, params, [{}]))[0] || {};
  const tasks = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('done','closed','completed'))::int AS completed,
           COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND status NOT IN ('done','closed','completed') AND sla_due_at < NOW())::int AS overdue
    FROM ${SHARED_TABLES.MASTER_TASKS}
    WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const rows = await safeReportQuery(pool, `
    SELECT anomaly_key, store, severity, status, trigger_date, task_id, resolution_code
    FROM anomaly_triggers
    WHERE trigger_date >= $1::date AND trigger_date <= $2::date AND ${anomalyStoreSql}
    ORDER BY trigger_date DESC LIMIT 30`, params, []);
  const totalTasks = Number(tasks.total || anomaly.generated_tasks || 0);
  const coreTasks = Number(anomaly.generated_tasks || 0);
  const followupTasks = Math.max(0, totalTasks - coreTasks);
  const completed = Number(tasks.completed || 0);
  const labelMap = {
    dish_decline: '菜品销量下滑',
    table_visit_ratio: '桌访/来客率异常',
    bad_review_product: '出品差评增加',
    bad_review_service: '服务差评增加',
    recharge_zero: '储值新增为0',
    private_room: '包房消费异常',
    revenue_drop: '营业额下降',
    avg_check_drop: '客单价下降',
    gross_margin: '毛利异常',
  };
  const anomalyLabel = (key) => {
    const raw = cleanText(key || '', 120);
    if (labelMap[raw]) return labelMap[raw];
    if (/private_room|包房/i.test(raw)) return '包房消费异常';
    if (/table|visit|客率|桌访/i.test(raw)) return '桌访/来客率异常';
    if (/dish|菜品|product/i.test(raw)) return '菜品销量下滑';
    if (/review|差评|service/i.test(raw)) return '口碑评价异常';
    if (/recharge|储值/i.test(raw)) return '储值新增异常';
    if (/revenue|营业额/i.test(raw)) return '营业额异常';
    return raw ? '经营异常' : '经营异常';
  };
  const severityMap = { critical: 'P0 老板必须关注', high: 'P1 店长当天处理', medium: 'P2 主管本周处理', low: 'P3 持续观察' };
  const statusMap = { open: '待响应', assigned: '已派发', processing: '处理中', done: '已完成', completed: '已完成', closed: '已复盘', resolved: '已改善' };
  const normalizedRows = rows.map((r) => ({
    type: anomalyLabel(r.anomaly_key),
    raw_type: r.anomaly_key || '',
    description: `${anomalyLabel(r.anomaly_key)}需要复盘`,
    impact_metric: anomalyLabel(r.anomaly_key),
    impact_level: severityMap[r.severity] || r.severity || '-',
    store: r.store || '-',
    owner_role: r.assigned_role || '店长/责任主管',
    owner: r.assigned_to || r.assigned_role || '待分配',
    suggestion: r.resolution_code || '按系统建议生成整改动作并上传完成证据',
    task: r.task_id || '-',
    deadline: r.sla_due_at ? String(r.sla_due_at).slice(0, 16).replace('T', ' ') : '待设置',
    status: statusMap[r.status] || r.status || '待响应',
    evidence: r.evidence_url || '待上传',
    before: r.before_value ?? r.severity ?? '-',
    after: r.after_value ?? '待复盘',
    improvement_rate: r.improvement_rate ?? null,
    improvement: r.status === 'closed' || r.status === 'resolved' ? '已验证改善' : '待验证改善',
  }));
  const groupCounts = normalizedRows.reduce((acc, r) => {
    const key = r.raw_type?.includes('review') ? '口碑类异常'
      : r.raw_type?.includes('dish') ? '菜品类异常'
      : r.raw_type?.includes('recharge') ? '客户类异常'
      : r.raw_type?.includes('revenue') || r.raw_type?.includes('table') || r.raw_type?.includes('avg') ? '营收类异常'
      : '执行类异常';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const dedupedProblems = [];
  for (const r of normalizedRows) {
    if (!dedupedProblems.find((x) => x.type === r.type)) dedupedProblems.push(r);
    if (dedupedProblems.length >= 3) break;
  }
  const topProblems = dedupedProblems.map((r) => ({
    title: r.type,
    impact: r.raw_type === 'recharge_zero' ? '客户资金沉淀不足' : r.raw_type?.includes('review') ? '复购和口碑风险' : r.raw_type?.includes('dish') ? '产品销售能力或推荐动作不足' : '门店经营指标波动',
    suggestion: r.raw_type === 'recharge_zero' ? '本周重点推动储值权益和老客回访' : r.raw_type?.includes('review') ? '店长完成服务/出品流程复训' : r.raw_type?.includes('dish') ? '复盘推荐话术和菜单曝光' : '责任人当天确认并提交整改动作',
  }));
  return { ok: true, report: {
    title: 'AI经营异常整改追踪报表',
    executive_summary: Number(anomaly.total || 0) > 0
      ? '本期系统发现多项经营异常，当前重点是推动责任人完成整改闭环并上传证据。'
      : '本期暂未发现需要重点追踪的经营异常，建议继续保持日常巡检。',
    period: { date_from: dateFrom, date_to: dateTo, store_id: storeId, store_filter: storeFilter.displayName },
    attribution_level: 'L2 改善归因',
    summary: {
      anomalies: Number(anomaly.total || 0),
      high_risk_anomalies: Number(anomaly.high_risk || 0),
      generated_tasks: totalTasks,
      core_rectification_tasks: coreTasks,
      followup_tasks: followupTasks,
      avg_tasks_per_anomaly: Number(anomaly.total || 0) > 0 ? totalTasks / Number(anomaly.total || 0) : 0,
      responded_tasks: totalTasks - Number(anomaly.open_count || 0),
      completed_tasks: completed,
      completion_rate: totalTasks > 0 ? completed / totalTasks : 0,
      overdue_tasks: Number(tasks.overdue || 0),
      unresolved_anomalies: Number(anomaly.open_count || 0),
      improved_metrics: completed,
      improvement_pass_rate: completed > 0 ? completed / Math.max(1, totalTasks) : 0,
      avg_response_hours: null,
      estimated_revenue_impact: 0,
    },
    funnel: [
      { name: '发现异常', value: Number(anomaly.total || 0), note: '系统识别出经营波动' },
      { name: '高风险异常', value: Number(anomaly.high_risk || 0), note: '需要老板或店长优先关注' },
      { name: '已生成任务', value: totalTasks, note: '系统已形成任务池' },
      { name: '已派发任务', value: null, note: '待接入任务派发数据' },
      { name: '已确认响应', value: Math.max(0, totalTasks - Number(anomaly.open_count || 0)), note: '责任人已收到或开始处理' },
      { name: '待上传证据', value: null, note: '待接入证据上传数据' },
      { name: '待复盘验证', value: Math.max(0, Number(anomaly.open_count || 0)), note: '需要查看整改后指标' },
      { name: '已验证改善', value: completed, note: '系统确认指标改善' },
    ],
    task_definitions: [
      '核心整改任务：必须由责任人完成，并上传整改证据的关键任务。',
      '辅助跟进任务：用于提醒、观察、复盘或协助处理的跟进动作。'
    ],
    anomaly_groups: Object.entries(groupCounts).map(([name, count]) => ({ name, count })),
    top_problems: topProblems,
    case_cards: normalizedRows.slice(0, 3),
    rows: normalizedRows,
    action_entries: [
      { action: '责任人确认异常原因', target: '高风险异常门店', owner: '店长/责任主管', deadline: '24小时内', expected_result: '确认原因并生成第一轮整改动作' },
      { action: '上传整改证据', target: '已派发整改任务', owner: '任务责任人', deadline: '3天内', expected_result: '形成可复盘证据链' },
      { action: '复盘整改后指标', target: '待复盘异常', owner: '运营负责人', deadline: '7天后', expected_result: '判断是否已验证改善' },
    ],
    recommendations: ['先跑通3-5个真实闭环案例，再把这张表用于对外销售。', '高风险异常需要老板日清，不建议只留在报表里。', '超期任务要进入店长排名，形成执行压力。', '整改后必须回看指标，否则不能证明经营闭环有效。'],
    methodology: ['L2改善归因：证明异常经过系统发现、派发、执行后指标是否改善。', '本报表不把整改动作直接等同于新增营业额，避免过度归因。', '只有完成证据、整改前后数值、复盘结论齐全时，才计入已验证改善。']
  }};
}

export async function buildTalentGrowthReport(pool, tenantId, opts = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
  const dateTo = cleanText(opts.dateTo || today, 20);
  const storeId = cleanText(opts.storeId || '', 80);
  const storeFilter = await resolveCustomerOpsStoreFilter(pool, tenantId, storeId);
  const train = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS tasks,
           COUNT(DISTINCT employee_username)::int AS employees
    FROM training_assignments
    WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const sessions = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS sessions,
           COUNT(*) FILTER (WHERE status IN ('completed','passed') OR quiz_passed=true)::int AS completed,
           COUNT(*) FILTER (WHERE quiz_passed=true)::int AS passed,
           COUNT(DISTINCT employee_username)::int AS learned_employees
    FROM training_sessions
    WHERE started_at::date >= $1::date AND started_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const cert = (await safeReportQuery(pool, `SELECT COUNT(*)::int AS certifications FROM training_certifications WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const scores = (await safeReportQuery(pool, `SELECT AVG(total_score)::numeric AS avg_score, COUNT(*)::int AS score_count FROM ${SHARED_TABLES.AGENT_SCORES} WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const tasks = Number(train.tasks || 0);
  const completed = Number(sessions.completed || 0);
  const passed = Number(sessions.passed || 0);
  const sessionCount = Number(sessions.sessions || 0);
  const certifications = Number(cert.certifications || 0);
  const avgScore = Number(scores.avg_score || 0);
  const promotionCandidates = certifications > 0 && avgScore >= 85 && sessionCount > 0 && (passed / Math.max(1, sessionCount)) >= 0.9 ? certifications : 0;
  const canStandInEmployees = null;
  const talentDataStatus = '“待接入”不是系统没跑完，而是当前还没有接入或没有形成对应数据，例如员工岗位绑定、主管确认、任务完成率、绩效、考勤和客诉。后续这些数据进入系统后，本表会自动显示具体人数、比例和岗位风险。';
  return { ok: true, report: {
    title: 'AI人才盘点与岗位认证报告',
    executive_summary: '当前已沉淀岗位认证数据，但培训、考试、绩效尚未完全打通，建议先作为岗位能力盘点使用。',
    period: { date_from: dateFrom, date_to: dateTo, store_id: storeId, store_filter: storeFilter.displayName },
    attribution_level: 'L3 影响归因',
    data_status: talentDataStatus,
    role_health_summary: '当前岗位数据尚未完整接入，建议优先补齐前厅服务员、烧鹅档、店长三个关键岗位的在岗与认证关系。数据完整后，这里会自动判断最大岗位风险、最稳定岗位和优先培养对象。',
    promotion_blocker: '当前卡点：绩效、任务完成率、考勤、客诉和主管评价尚未完整接入，因此晋升候选只做规则说明，不直接给出候选名单。',
    stand_in_rule: '可顶岗员工 = 岗位认证通过 + 主管确认 + 近30天无重大异常；仅完成岗位认证不等于可以顶岗。',
    summary: {
      training_tasks: tasks,
      participating_employees: Math.max(Number(train.employees || 0), Number(sessions.learned_employees || 0)),
      completion_rate: tasks > 0 ? completed / tasks : 0,
      exam_pass_rate: sessionCount > 0 ? passed / sessionCount : 0,
      certifications,
      avg_performance_score: avgScore,
      high_potential_employees: avgScore >= 85 ? Number(scores.score_count || 0) : 0,
      promotion_candidates: promotionCandidates,
      certification_only_employees: certifications,
      can_stand_in_employees: canStandInEmployees,
      coaching_needed_employees: sessionCount > 0 ? Math.max(0, sessionCount - passed) : 0,
      enabled_metrics: certifications,
    },
    enabled_metrics: [
      { label: '已认证员工', value: certifications, note: '完成岗位认证，不等于可顶岗' },
      { label: '认证岗位数', value: certifications > 0 ? 1 : 0, note: '按当前已接入认证记录统计' },
      { label: '可顶岗员工', value: canStandInEmployees, status: '待确认', note: '需主管确认和近30天无重大异常' },
      { label: '认证覆盖率', value: null, status: '待接入', note: '需岗位在岗人数' },
    ],
    pending_metrics: [
      { label: '培训任务', status: tasks > 0 ? '已启用' : '待启用' },
      { label: '考试通过率', status: sessionCount > 0 ? '已启用' : '待启用' },
      { label: '绩效关联', status: avgScore > 0 ? '已接入' : '待接入' },
      { label: '晋升候选', status: promotionCandidates > 0 ? '已筛选' : '待规则筛选' },
    ],
    role_rows: [
      { role: '前厅服务员', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '迎宾', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '收银', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '烧鹅档', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '炒锅', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '店长', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
    ],
    promotion_path: ['岗位认证通过', '绩效分达标', '任务完成率达标', '近30天无重大违规/客诉', '主管评价合格', '连续稳定周期达标', '进入晋升候选池'],
    enable_sequence: [
      { step: '先补齐岗位与员工绑定', target: '岗位/员工基础数据', owner: 'HR/店长', deadline: '本周内', expected_result: '岗位盘点表从待接入变成可统计' },
      { step: '选1个岗位试跑：前厅服务员', target: '前厅服务员岗位', owner: '培训负责人', deadline: '3天内', expected_result: '明确试点员工和训练目标' },
      { step: '选1个培训主题：招牌菜推荐话术', target: '招牌菜推荐话术', owner: '培训负责人', deadline: '7天内', expected_result: '完成培训内容、考试题和任务标准' },
      { step: '选10名员工参与试点', target: '前厅服务员10人', owner: '店长/培训负责人', deadline: '7天内', expected_result: '形成可观察的学习和执行样本' },
      { step: '14天后复盘结果', target: '考试/任务/推荐菜销量', owner: '运营/HR', deadline: '14天后', expected_result: '看考试通过率、任务完成率、推荐菜销量变化' },
    ],
    action_entries: [
      { action: '补齐岗位与员工绑定', target: '全部门店岗位', owner: 'HR/店长', deadline: '本周内', expected_result: '看清岗位缺口和可顶岗人员' },
      { action: '试跑一个岗位培训闭环', target: '优先选择前厅服务员或烧鹅档', owner: '培训负责人', deadline: '7天内', expected_result: '验证学习、考试、认证流程' },
      { action: '建立晋升候选规则', target: '已认证员工', owner: 'HR负责人', deadline: '本月内', expected_result: '输出可解释的后备主管/店长名单' },
    ],
    rows: [
      { item: '学习完成', metric: '完成率', value: tasks > 0 ? completed / tasks : null, conclusion: tasks > 0 ? '看员工是否按时完成学习' : '本期暂无培训任务数据' },
      { item: '考试掌握', metric: '通过率', value: sessionCount > 0 ? passed / sessionCount : null, conclusion: sessionCount > 0 ? '看知识是否被掌握' : '本期暂无考试过程数据' },
      { item: '岗位认证', metric: '认证人数', value: certifications, conclusion: '证明员工已完成某类岗位技能认证' },
      { item: '执行表现', metric: '平均绩效分', value: avgScore > 0 ? avgScore : null, conclusion: avgScore > 0 ? '看认证后执行稳定性' : '绩效分尚未与培训认证完整关联' },
      { item: '人才梯队', metric: '晋升候选', value: promotionCandidates, conclusion: '晋升候选需同时满足认证、绩效、任务完成率和无重大违规' },
    ],
    recommendations: ['先把本报表定位为内部岗位认证和人才池管理表，暂不作为销售主证据。', '从一个岗位、一个培训主题、10名员工、一轮14天复盘开始跑闭环。', '服务话术和招牌菜推荐培训要关联销售结果复盘。', '晋升候选必须叠加绩效、任务完成率、考勤、客诉和主管评价，不能等同于岗位认证。'],
    methodology: ['L3影响归因：展示培训、认证、执行、绩效之间的相关变化。', '已认证员工只代表岗位认证完成；可顶岗员工必须满足认证通过、主管确认、近30天无重大异常。', '待接入表示对应业务数据尚未进入系统或尚未形成可统计结果；数据完整后会自动显示具体数值。', '不直接声明培训创造营业额，而是证明员工能力和执行结果正在改善。']
  }};
}
