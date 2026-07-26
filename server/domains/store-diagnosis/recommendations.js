/**
 * 门店诊断建议规则（从 store-diagnosis.js#generateRecommendations 外提，可单测）。
 */

function normalizeReportDate(date) {
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
}

function collectOnDutyStaff(staff) {
  const onDutyNames = [];
  for (const [area, people] of Object.entries(staff || {})) {
    if (!Array.isArray(people)) continue;
    for (const p of people) {
      if (p.name && p.name !== '休息') {
        onDutyNames.push({ name: p.name, user: p.user, area });
      }
    }
  }
  return onDutyNames;
}

const PRODUCT_REVIEW_AREAS = new Set([
  'kitchen', 'kitchen_area', 'restStaff', 'kitchenSupport', '后厨', '出品', '烧味', '点心', '打荷', '上什',
]);

const SERVICE_REVIEW_AREAS = new Set([
  'front', 'frontSupport', 'frontRestStaff', '前厅', 'service',
]);

function relevantAreasForAnomaly(anomalyKey) {
  return anomalyKey === 'bad_review_product' ? PRODUCT_REVIEW_AREAS : SERVICE_REVIEW_AREAS;
}

function trainingTopicForBadReview(store, anomalyKey) {
  if (anomalyKey === 'bad_review_service') {
    return { topicTitle: '客诉处置实操认证', topicTarget: '前厅' };
  }
  if (anomalyKey === 'bad_review_product') {
    let topicTitle = '';
    if (store.includes('马己仙')) topicTitle = '烧鸭';
    else if (store.includes('洪潮')) topicTitle = '油温控制';
    return { topicTitle, topicTarget: '厨房' };
  }
  return { topicTitle: '', topicTarget: '' };
}

export function buildRevenueDeclineMarketingRecs(revenue) {
  const recs = [];
  if (!revenue.is_decline || Number(revenue.change_pct) >= -5) return recs;
  for (const c of (revenue.contributions || [])) {
    if (c.factor !== '客流量下降') continue;
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
  return recs;
}

export function buildStaffingRecs(revenue, staffing) {
  const recs = [];
  if (Number(revenue.efficiency_change_pct) < -10) {
    recs.push({
      type: 'staffing',
      source: 'rule_engine',
      priority: 'medium',
      title: '优化排班结构',
      detail: `人效下降${Math.abs(revenue.efficiency_change_pct)}%，当前在岗${staffing.total_on_duty || 0}人。建议核对排班与客流高峰时段是否匹配`,
      target: '店长',
      related_anomaly: 'labor_efficiency',
    });
  }
  for (const issue of (staffing.issues || [])) {
    if (!issue.includes('晚班')) continue;
    recs.push({
      type: 'staffing',
      source: 'rule_engine',
      priority: 'high',
      title: '增加晚班前厅人手',
      detail: issue,
      target: '店长',
    });
  }
  return recs;
}

export function buildBadReviewTrainingRecs({ store, anomalies, reports, training }) {
  const recs = [];
  const badAnomalies = anomalies.filter(a =>
    a.key === 'bad_review_service' || a.key === 'bad_review_product'
  );
  if (!badAnomalies.length || !reports.length) return recs;

  for (const anomaly of badAnomalies) {
    const anomalyDateStr = normalizeReportDate(anomaly.latest_date);
    const reportForDate = reports.find(r => normalizeReportDate(r.date) === anomalyDateStr);
    if (!reportForDate?.staff) continue;

    const onDutyNames = collectOnDutyStaff(reportForDate.staff);
    const relevantAreas = relevantAreasForAnomaly(anomaly.key);
    const relevantStaff = onDutyNames.filter(s => relevantAreas.has(s.area));
    const { topicTitle, topicTarget } = trainingTopicForBadReview(store, anomaly.key);
    if (!topicTitle || relevantStaff.length === 0) continue;

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
        detail: `${anomaly.latest_date}出现${anomaly.type}（${anomaly.detail || ''}），上述${topicTarget}人员当天在岗且未完成《${topicTitle}》认证`,
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
        detail: `${anomaly.latest_date}出现${anomaly.type}，${topicTarget}人员当天在岗且已有培训认证，建议复核实际执行情况`,
        target: topicTarget,
        target_users: relevantStaff.map(s => s.user),
        related_anomaly: anomaly.key,
      });
    }
  }
  return recs;
}

export function buildNewCustomerRatioRecs(customer, employees) {
  const newRatioDeclined = Number(customer.new_ratio_change_pct) <= -10;
  const newRatioLow = customer.new_ratio > 0 && customer.new_ratio < 20;
  if (!newRatioDeclined && !newRatioLow) return [];

  const manager = employees.find(e =>
    e.position?.includes('店长') || e.position?.includes('manager')
  );
  const managerName = manager?.name || '店长';
  const reasonDetail = newRatioDeclined
    ? `新客占比从${customer.prev_new_ratio}%降至${customer.new_ratio}%（环比下降${Math.abs(customer.new_ratio_change_pct)}%）`
    : `新客占比仅${customer.new_ratio}%，低于行业基准20%`;
  return [{
    type: 'training',
    source: 'rule_engine',
    priority: 'high',
    title: `建议给${managerName}补《会员营销技巧》培训`,
    detail: `${reasonDetail}。建议通过《会员营销技巧》培训提升门店获客与会员转化能力`,
    target: managerName,
    target_users: manager ? [manager.username] : [],
    topic_title: '会员营销技巧',
  }];
}

export function buildConversionTrainingRecs(revenue, reports) {
  const convContribution = (revenue.contributions || []).find(c => c.factor === '到店转化率下降');
  if (!convContribution || !reports.length) return [];

  const latestStaff = reports[0].staff || {};
  const frontNames = [];
  for (const area of ['front', 'frontRestStaff']) {
    for (const p of (latestStaff[area] || [])) {
      if (p.name && p.user) frontNames.push({ name: p.name, user: p.user });
    }
  }
  if (!frontNames.length) return [];

  const names = frontNames.slice(0, 5).map(s => s.name).join('、');
  return [{
    type: 'training',
    source: 'rule_engine',
    priority: 'medium',
    title: `建议给${names}补《收银引导与点单话术》培训`,
    detail: `${convContribution.detail}，当前在岗前厅人员建议加强收银转化话术训练`,
    target: '前厅',
    target_users: frontNames.map(s => s.user),
    topic_title: '收银引导与点单话术',
    related_anomaly: null,
  }];
}

export function buildAnomalyMarketingRecs(anomalies) {
  const recs = [];
  const rechargeAnomaly = anomalies.find(a => a.key === 'recharge_zero');
  if (rechargeAnomaly) {
    recs.push({
      type: 'marketing',
      source: 'rule_engine',
      priority: 'high',
      title: '启动储值卡推广活动',
      detail: '连续多日无会员充值记录，建议推出储值优惠（充500送50）并培训前厅话术',
      target: '店长',
      related_anomaly: 'recharge_zero',
    });
  }
  const trendAnomaly = anomalies.find(a => a.key === 'weekday_trend');
  if (trendAnomaly?.detail) {
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
  return recs;
}

export function buildNewEmployeeTrainingRecs(training) {
  const newEmployees = (training.employees_without_training || []).filter(e => e.is_new);
  if (!newEmployees.length) return [];
  const names = newEmployees.map(e => e.name).join('、');
  return [{
    type: 'training',
    source: 'rule_engine',
    priority: 'medium',
    title: `新员工${names}尚未完成入职培训`,
    detail: `${names}入职未满90天且无培训记录，建议立即安排入职SOP培训`,
    target: names,
    target_users: newEmployees.map(e => e.username),
    topic_title: '新员工入职SOP',
  }];
}

export function generateRecommendations(ctx) {
  const { store, revenue, customer, anomalies, staffing, training, employees, reports } = ctx;
  return [
    ...buildRevenueDeclineMarketingRecs(revenue),
    ...buildStaffingRecs(revenue, staffing),
    ...buildBadReviewTrainingRecs({ store, anomalies, reports, training }),
    ...buildNewCustomerRatioRecs(customer, employees),
    ...buildConversionTrainingRecs(revenue, reports),
    ...buildAnomalyMarketingRecs(anomalies),
    ...buildNewEmployeeTrainingRecs(training),
  ];
}
