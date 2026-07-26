/**
 * 门店诊断纯逻辑（从 store-diagnosis.js#getStoreDiagnosis 外提，可单测）。
 */

export const CATEGORY_LABELS = {
  water: '水吧',
  soup: '汤品',
  roast: '烧腊/卤水',
  wok: '炒锅',
  sashimi: '刺身',
};

export function normalizeReportCategories(raw) {
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

export function contributionItem(factor, magnitude, unit, detail, direction) {
  const mag = String(magnitude);
  let impact;
  if (direction === 'up') impact = `+${mag}${unit}`;
  else if (direction === 'down') impact = `-${mag}${unit}`;
  else impact = `${mag}${unit}`;
  return { factor, impact, detail, direction: direction || null };
}

export function sortContributions(list) {
  list.sort((a, b) => Math.abs(parseFloat(b.impact) || 0) - Math.abs(parseFloat(a.impact) || 0) || 0);
}

export function mapAnomalyType(key) {
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

export function getAnomalyDescription(key) {
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

export function resolveBrandKey(storeName) {
  if (storeName.includes('马己仙')) return '马己仙';
  if (storeName.includes('洪潮')) return '洪潮';
  return storeName;
}

function sumRows(rows, field) {
  return rows.reduce((s, r) => s + Number(r[field] || 0), 0);
}

function avgEfficiencyRows(rows) {
  const effRows = rows.filter(r => Number(r.efficiency) > 0);
  return effRows.length > 0
    ? effRows.reduce((s, r) => s + Number(r.efficiency), 0) / effRows.length
    : 0;
}

export function buildRevenueMetrics({
  reportRows,
  prevReportRows,
  dineMetrics,
  prevDineMetrics,
}) {
  if (!reportRows.length) return null;

  const totalRevenue = sumRows(reportRows, 'actual_revenue');
  const totalPreDiscountRevenue = sumRows(reportRows, 'pre_discount_revenue');
  const avgDailyRevenue = totalRevenue / reportRows.length;
  const totalTraffic = dineMetrics.dine_traffic;
  const avgDailyTraffic = dineMetrics.report_days > 0 ? Math.round(totalTraffic / dineMetrics.report_days) : 0;
  const totalOrders = dineMetrics.dine_orders;
  const avgSpendPerPerson = dineMetrics.avg_spend_per_person;
  const avgTableSpend = dineMetrics.avg_table_spend;
  const avgOrderValue = avgTableSpend;
  const avgEfficiency = avgEfficiencyRows(reportRows);
  const totalDeliveryRevenue = sumRows(reportRows, 'delivery_actual');
  const avgDeliveryShare = totalRevenue > 0 ? (totalDeliveryRevenue / totalRevenue) * 100 : 0;

  let prevTotalRevenue = 0;
  let prevTotalPreDiscountRevenue = 0;
  let prevTotalTraffic = 0;
  let prevTotalOrders = 0;
  let prevAvgEfficiency = 0;
  let prevTotalDeliveryRevenue = 0;
  let prevAvgTableSpend = 0;
  if (prevReportRows.length > 0) {
    prevTotalRevenue = sumRows(prevReportRows, 'actual_revenue');
    prevTotalPreDiscountRevenue = sumRows(prevReportRows, 'pre_discount_revenue');
    prevTotalTraffic = prevDineMetrics.dine_traffic;
    prevAvgTableSpend = prevDineMetrics.avg_table_spend;
    prevTotalOrders = prevDineMetrics.dine_orders;
    prevAvgEfficiency = avgEfficiencyRows(prevReportRows);
    prevTotalDeliveryRevenue = sumRows(prevReportRows, 'delivery_actual');
  }

  const revenueChange = prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue * 100).toFixed(1) : 0;
  const trafficChange = prevTotalTraffic > 0 ? ((totalTraffic - prevTotalTraffic) / prevTotalTraffic * 100).toFixed(1) : 0;
  const ordersChange = prevTotalOrders > 0 ? ((totalOrders - prevTotalOrders) / prevTotalOrders * 100).toFixed(1) : 0;
  const efficiencyChange = prevAvgEfficiency > 0 ? ((avgEfficiency - prevAvgEfficiency) / prevAvgEfficiency * 100).toFixed(1) : 0;
  const deliveryChange = prevTotalDeliveryRevenue > 0 ? ((totalDeliveryRevenue - prevTotalDeliveryRevenue) / prevTotalDeliveryRevenue * 100).toFixed(1) : 0;

  return {
    metrics: {
      totalRevenue,
      totalPreDiscountRevenue,
      avgDailyRevenue,
      totalTraffic,
      avgDailyTraffic,
      totalOrders,
      avgSpendPerPerson,
      avgTableSpend,
      avgOrderValue,
      avgEfficiency,
      totalDeliveryRevenue,
      avgDeliveryShare,
      prevTotalRevenue,
      prevTotalPreDiscountRevenue,
      prevTotalTraffic,
      prevTotalOrders,
      prevAvgEfficiency,
      prevTotalDeliveryRevenue,
      prevAvgTableSpend,
      prevAvgSpendPerPerson: prevDineMetrics.avg_spend_per_person,
      revenueChange,
      trafficChange,
      ordersChange,
      efficiencyChange,
      deliveryChange,
      reportDays: reportRows.length,
      prevReportDays: prevReportRows.length || 1,
      dineMetrics,
    },
    revenue: {
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
    },
  };
}

export function buildRevenueContributions({
  metrics,
  reportRows,
  prevReportRows,
  tableVisitCurrent,
  tableVisitPrev,
  topDissatisfiedDish,
  memberRevenueCurrent,
  memberRevenuePrev,
}) {
  const contributions = [];
  const m = metrics;
  const {
    totalRevenue, totalTraffic, totalOrders, avgEfficiency, avgTableSpend, avgSpendPerPerson,
    prevTotalTraffic, prevTotalOrders, prevAvgEfficiency, prevAvgTableSpend, prevAvgSpendPerPerson,
    prevTotalDeliveryRevenue, totalDeliveryRevenue, prevTotalRevenue,
    trafficChange, ordersChange, efficiencyChange, reportDays, prevReportDays,
  } = m;

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
      `日均订单从${Math.round(prevTotalOrders / prevReportDays)}${isUp ? '增至' : '降至'}${Math.round(totalOrders / reportDays)}`,
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

  let deliveryShareChangePct = null;
  let tableVisit = null;
  if (prevTotalDeliveryRevenue > 0) {
    const deliveryShare = totalRevenue > 0 ? (totalDeliveryRevenue / totalRevenue) * 100 : 0;
    const prevDeliveryShare = prevTotalRevenue > 0 ? (prevTotalDeliveryRevenue / prevTotalRevenue) * 100 : 0;
    const deliveryShareChange = deliveryShare - prevDeliveryShare;
    deliveryShareChangePct = Number(deliveryShareChange.toFixed(1));
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

  const ratedDays = reportRows.filter(r => Number(r.dine_traffic) > 0);
  const prevRatedDays = prevReportRows.filter(r => Number(r.dine_traffic) > 0);
  let ratingChangePct = null;
  let avgRating = null;
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

  const ratingDays = reportRows.filter(r => Number(r.dianping_rating) > 0);
  const prevRatingDays = prevReportRows.filter(r => Number(r.dianping_rating) > 0);
  if (ratingDays.length > 0 && prevRatingDays.length > 0) {
    avgRating = ratingDays.reduce((s, r) => s + Number(r.dianping_rating), 0) / ratingDays.length;
    const prevAvgRating = prevRatingDays.reduce((s, r) => s + Number(r.dianping_rating), 0) / prevRatingDays.length;
    ratingChangePct = prevAvgRating > 0 ? Number(((avgRating - prevAvgRating) / prevAvgRating * 100).toFixed(1)) : 0;
    if (ratingChangePct <= -3) {
      contributions.push(contributionItem(
        '服务评分下降',
        Math.abs(ratingChangePct), '%',
        `大众点评评分从${prevAvgRating.toFixed(2)}降至${avgRating.toFixed(2)}`,
        'down',
      ));
    }
  }

  const totalBadReviews = sumRows(reportRows, 'bad_reviews_dianping');
  const prevTotalBadReviews = sumRows(prevReportRows, 'bad_reviews_dianping');
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

  const tvCurTotal = Number(tableVisitCurrent?.total_visits || 0);
  const tvCurIssue = Number(tableVisitCurrent?.issue_count || 0);
  const tvPrevTotal = Number(tableVisitPrev?.total_visits || 0);
  const tvPrevIssue = Number(tableVisitPrev?.issue_count || 0);
  tableVisit = {
    current_issue_count: tvCurIssue,
    current_total: tvCurTotal,
    prev_issue_count: tvPrevIssue,
    prev_total: tvPrevTotal,
    latest_issue_date: tableVisitCurrent?.latest_issue_date || null,
  };
  if (tvCurIssue !== tvPrevIssue && (tvCurTotal > 0 || tvPrevTotal > 0)) {
    const isUp = tvCurIssue > tvPrevIssue;
    const tvPct = tvPrevIssue > 0 ? ((tvCurIssue - tvPrevIssue) / tvPrevIssue * 100).toFixed(1) : null;
    const dishHint = topDissatisfiedDish?.dish ? `，本期最多被反馈的菜品是「${topDissatisfiedDish.dish.slice(0, 12)}」` : '';
    contributions.push(contributionItem(
      isUp ? '桌访问题产品增加' : '桌访问题产品下降',
      tvPct !== null ? Math.abs(tvPct) : Math.abs(tvCurIssue - tvPrevIssue),
      tvPct !== null ? '%' : '单',
      `桌访反馈不满意菜品从${tvPrevIssue}单${isUp ? '增至' : '降至'}${tvCurIssue}单（共${tvCurTotal}次桌访）${dishHint}`,
      isUp ? 'up' : 'down',
    ));
  }

  const memberRev = Number(memberRevenueCurrent?.member_rev || 0);
  const totalRev = Number(memberRevenueCurrent?.total_rev || 0);
  const prevMemberRev = Number(memberRevenuePrev?.member_rev || 0);
  const prevTotalRev = Number(memberRevenuePrev?.total_rev || 0);
  let memberRevenueRatio = null;
  let prevMemberRevenueRatio = null;
  if (totalRev > 0 && prevTotalRev > 0) {
    memberRevenueRatio = Number((memberRev / totalRev * 100).toFixed(1));
    prevMemberRevenueRatio = Number((prevMemberRev / prevTotalRev * 100).toFixed(1));
    const ratioDiff = memberRevenueRatio - prevMemberRevenueRatio;
    if (Math.abs(ratioDiff) >= 2) {
      const isUp = ratioDiff > 0;
      contributions.push(contributionItem(
        isUp ? '会员消费占比上升' : '会员消费占比下降',
        Math.abs(ratioDiff).toFixed(1), '个百分点',
        `会员消费占比从${prevMemberRevenueRatio.toFixed(1)}%${isUp ? '升至' : '降至'}${memberRevenueRatio.toFixed(1)}%`,
        isUp ? 'up' : 'down',
      ));
    }
  }

  sortContributions(contributions);
  return {
    contributions,
    deliveryShareChangePct,
    ratingChangePct,
    avgRating: avgRating != null ? Number(avgRating.toFixed(2)) : null,
    tableVisit,
    memberRevenueRatio,
    prevMemberRevenueRatio,
  };
}

export function buildCustomerSection({
  dineTraffic,
  customerMetrics,
  prevCustomerMetrics,
  customerAnalysisRows,
  existingContributions = [],
}) {
  if (dineTraffic <= 0 && customerMetrics.total_customers <= 0 && customerAnalysisRows.length === 0) {
    return { customer: {}, contributions: existingContributions };
  }

  const totalNew = customerMetrics.new_customers || 0;
  const totalReturning = customerMetrics.returning_customers || 0;
  const totalOrders = customerMetrics.total_customers || 0;
  const newRatio = customerMetrics.new_pct || 0;

  const customer = {
    new_customers: totalNew,
    returning_customers: totalReturning,
    total_orders: totalOrders,
    new_ratio: Number(newRatio),
    returning_ratio: customerMetrics.returning_pct || 0,
    daily: customerAnalysisRows.map(r => ({
      date: r.biz_date,
      new: Number(r.new_customers || 0),
      returning: Number(r.returning_customers || 0),
      total: Number(r.total_orders || 0),
    })),
  };

  const contributions = [...existingContributions];
  const prevNewRatio = prevCustomerMetrics.total_customers > 0 ? prevCustomerMetrics.new_pct : null;
  if (prevNewRatio !== null && prevNewRatio > 0) {
    const newRatioChangePct = ((Number(newRatio) - prevNewRatio) / prevNewRatio * 100).toFixed(1);
    customer.prev_new_ratio = Number(prevNewRatio.toFixed(1));
    customer.new_ratio_change_pct = Number(newRatioChangePct);
    if (Number(newRatioChangePct) <= -10) {
      contributions.push(contributionItem(
        '新客占比下降',
        Math.abs(newRatioChangePct), '%',
        `新客占比从${prevNewRatio.toFixed(1)}%降至${newRatio}%，可能私域引流不足或门店获客能力下降`,
        'down',
      ));
    }
  } else if (Number(newRatio) < 20) {
    contributions.push(contributionItem(
      '新客占比低',
      newRatio, '%',
      `本周新客比例仅${newRatio}%，可能私域引流不足或门店获客能力下降`,
      null,
    ));
  }
  sortContributions(contributions);
  return { customer, contributions };
}

function parseTriggerValue(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return {};
  }
}

export function groupAnomalyRows(anomalyRows) {
  const anomalyGroups = {};
  for (const a of anomalyRows) {
    const key = a.anomaly_key;
    if (!anomalyGroups[key]) {
      anomalyGroups[key] = { key, severity: a.severity, count: 0, latest_date: a.trigger_date, detail: '', records: [] };
    }
    anomalyGroups[key].count++;
    if (a.trigger_date > anomalyGroups[key].latest_date) {
      anomalyGroups[key].latest_date = a.trigger_date;
    }
    const parsedValue = parseTriggerValue(a.trigger_value);
    if (parsedValue.detail) anomalyGroups[key].detail = parsedValue.detail;
    if (parsedValue.consecutiveDown) {
      anomalyGroups[key].detail = `连续${parsedValue.consecutiveDown}周下降(${parsedValue.changePct}%)`;
    }
    anomalyGroups[key].records.push({
      date: a.trigger_date,
      severity: a.severity,
      status: a.status || '',
      assigned_role: a.assigned_role || '',
      threshold_value: parseTriggerValue(a.threshold_value),
      trigger_value: parsedValue,
      detail: parsedValue.detail || '',
    });
  }

  return Object.values(anomalyGroups).map(g => ({
    type: mapAnomalyType(g.key),
    key: g.key,
    severity: g.severity,
    count: g.count,
    latest_date: g.latest_date,
    detail: g.detail || getAnomalyDescription(g.key),
    description: getAnomalyDescription(g.key),
    records: (g.records || []).slice(0, 20),
  }));
}

export function supplementAnomalies({ anomalies, revenue, reportRows, endDate }) {
  const result = [...anomalies];

  if (Number(revenue?.rating_change_pct) <= -3 && !result.some(a => a.key === 'bad_review_service')) {
    const worstDay = reportRows
      .filter(r => Number(r.dianping_rating) > 0)
      .sort((a, b) => Number(a.dianping_rating) - Number(b.dianping_rating))[0];
    if (worstDay) {
      result.push({
        type: mapAnomalyType('bad_review_service'),
        key: 'bad_review_service',
        severity: 'high',
        count: 1,
        latest_date: worstDay.date,
        detail: `服务评分较上周下降${Math.abs(revenue.rating_change_pct)}%（${worstDay.date}评分${Number(worstDay.dianping_rating).toFixed(2)}最低）`,
      });
    }
  }

  const tv = revenue?.table_visit;
  if (tv && tv.current_issue_count > 0) {
    const tvDetailText = `本期桌访反馈不满意菜品${tv.current_issue_count}单（上期${tv.prev_issue_count}单，共${tv.current_total}次桌访）`;
    const existingTvAnomaly = result.find(a => a.key === 'table_visit_product');
    if (existingTvAnomaly) {
      existingTvAnomaly.detail = tvDetailText;
    } else if (tv.current_issue_count > tv.prev_issue_count) {
      result.push({
        type: mapAnomalyType('table_visit_product'),
        key: 'table_visit_product',
        severity: 'medium',
        count: tv.current_issue_count,
        latest_date: tv.latest_issue_date || reportRows[0]?.date || endDate,
        detail: tvDetailText,
      });
    }
  }

  return result;
}

export function buildStaffingSection({ reportRows, revenue }) {
  if (!reportRows.length) return {};

  const latestReport = reportRows[0];
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

  const totalStaff = onDuty.length;
  const frontStaff = (staffByArea.front || []).length;
  const kitchenStaff = (staffByArea.kitchen || staffByArea.restStaff || []).length;

  const staffing = {
    latest_date: latestReport.date,
    total_on_duty: totalStaff,
    front_count: frontStaff,
    kitchen_count: kitchenStaff,
    by_area: staffByArea,
    is_understaffed: totalStaff < 5,
    issues: [],
  };

  const segments = latestReport.segments || {};
  const noonRev = Number(segments.noon || 0);
  const afternoonRev = Number(segments.afternoon || 0);
  const nightRev = Number(segments.night || 0);
  const segTotal = noonRev + afternoonRev + nightRev;
  if (segTotal > 0) {
    const nightShare = nightRev / segTotal;
    staffing.night_revenue_share = Number((nightShare * 100).toFixed(1));
    if (nightShare >= 0.45 && frontStaff < 3) {
      staffing.issues.push(`晚市营收占比${(nightShare * 100).toFixed(0)}%但前厅仅${frontStaff}人在岗，晚班前厅人手不足`);
    }
  }

  if (revenue?.is_decline && revenue.efficiency_change_pct < 0) {
    staffing.issues.push(`人效下降${Math.abs(revenue.efficiency_change_pct)}%，需关注排班合理性`);
  }

  return staffing;
}

export function buildTrainingSection({ trainingRows, employeeRows, endDate }) {
  const trainingByEmployee = {};
  for (const t of trainingRows) {
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

  const employeesWithoutTraining = [];
  for (const e of employeeRows) {
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

  return {
    total_assignments: trainingRows.length,
    by_employee: Object.values(trainingByEmployee),
    employees_without_training: employeesWithoutTraining,
    scope_label: `截至 ${endDate}，在职且从未被指派任何培训任务`,
    empty_label: '全员均已指派培训任务，无漏培人员',
  };
}

export function aggregateCategories(reportRows, storeTotalRevenue) {
  const categoryData = {};
  for (const r of reportRows) {
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
  return Object.values(categoryData)
    .filter(c => c.total > 0 || c.qty_total > 0)
    .sort((a, b) => b.total - a.total)
    .map(c => ({
      ...c,
      avg_daily: Math.round(c.total / Math.max(c.days, 1)),
      avg_qty_daily: Math.round(c.qty_total / Math.max(c.days, 1)),
      share_pct: storeTotalRevenue > 0 ? Number((c.total / storeTotalRevenue * 100).toFixed(1)) : 0,
    }));
}

export function buildDiagnosisSummary(result) {
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

  return {
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
}
