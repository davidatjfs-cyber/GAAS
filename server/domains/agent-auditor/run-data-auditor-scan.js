import { AgentCommunicationHelper } from '../../agent-communication-system.js';
import { dailyReportRowMatches, feishuStoreSearchPatterns } from '../../v2-store-alignment.js';
import {
  daysInMonth,
  getMonthlyTarget,
  inDateRangeInclusive,
  isConsecutiveDate,
  toDateOnly,
  toNum,
} from './run-data-auditor.js';
import { fetchRechargeFromDailyReportsPg } from './run-data-auditor-recharge.js';

export function detectRevenueGapIssues({
  state,
  storeName,
  brand,
  storeReports,
  nowDate,
  periodLabel,
  isDaily,
  enableDailyReports,
  getStoreThreshold,
}) {
  const issues = [];
  const revenueGapMedium = getStoreThreshold(storeName, 'revenueGapMedium', 0.1);
  const revenueGapHigh = getStoreThreshold(storeName, 'revenueGapHigh', 0.2);
  if (!isDaily && enableDailyReports) {
    const ym = nowDate.slice(0, 7);
    const target = getMonthlyTarget(state, ym, storeName);
    const targetActual = toNum(target?.targets?.actual, 0);
    if (targetActual > 0) {
      const monthStart = `${ym}-01`;
      const monthReports = storeReports.filter((r) => {
        const d = toDateOnly(r?.date);
        return d && d >= monthStart && d <= nowDate;
      });

      const cumulativeActual = monthReports.reduce((s, r) => s + toNum(r?.data?.actual, 0), 0);
      const daysPassed = monthReports.length;
      const monthDays = Math.max(1, daysInMonth(nowDate));

      const actualAchieveRate = cumulativeActual / targetActual;
      const theoryAchieveRate = daysPassed / monthDays;
      const gap = theoryAchieveRate - actualAchieveRate;

      if (gap > revenueGapMedium) {
        const severity = gap > revenueGapHigh ? 'high' : 'medium';
        issues.push({
          agent: 'data_auditor',
          brand,
          store: storeName,
          category: '实收营收异常',
          severity,
          title: `${storeName} 累计实收营收达成偏低（${daysPassed}天较理论差 ${(gap * 100).toFixed(1)}%）`,
          detail: `${ym}月1日至${nowDate}累计：实收达成率 ${(actualAchieveRate * 100).toFixed(1)}%，理论达成率 ${(theoryAchieveRate * 100).toFixed(1)}%（${daysPassed}/${monthDays}天），差值 ${(gap * 100).toFixed(1)}%。`,
          data: {
            date: periodLabel,
            periodStart: monthStart,
            periodEnd: nowDate,
            daysPassed,
            monthDays,
            cumulativeActual: Number(cumulativeActual.toFixed(2)),
            targetActual: Number(targetActual.toFixed(2)),
            actualAchieveRate: Number((actualAchieveRate * 100).toFixed(2)),
            theoryAchieveRate: Number((theoryAchieveRate * 100).toFixed(2)),
            achieveGap: Number((gap * 100).toFixed(2)),
          },
        });
      }
    }
  }
  return issues;
}

export async function detectRechargeIssues(
  ctx,
  {
    storeName,
    brand,
    reportsSorted,
    isWeekly,
    getStoreThreshold,
  }
) {
  const issues = [];
  const rechargeHighDays = Math.max(2, getStoreThreshold(storeName, 'rechargeStreakHighDays', 2));
  if (isWeekly) return issues;

  let rechargeStreak = 0;
  let prevDate = '';
  for (const report of reportsSorted) {
    const reportDate = toDateOnly(report?.date);
    if (!reportDate) continue;
    const jsonAmt = toNum(report?.data?.recharge?.amount, 0);
    const jsonCnt = toNum(report?.data?.recharge?.count, 0);
    const pg = await fetchRechargeFromDailyReportsPg(ctx, storeName, reportDate);
    const rechargeAmount = Math.max(jsonAmt, pg.amt);
    const rechargeCount = Math.max(jsonCnt, pg.cnt);
    const noRecharge = rechargeAmount <= 0 && rechargeCount <= 0;

    if (noRecharge) {
      issues.push({
        agent: 'data_auditor',
        brand,
        store: storeName,
        category: '充值异常',
        severity: 'medium',
        title: `${storeName} ${reportDate} 当日无充值`,
        detail: `当日充值金额为 0（已交叉核对营业日报表 recharge_amount / recharge_count）。`,
        data: { date: reportDate, rechargeAmount: 0, rechargeCount: 0 },
      });
    }

    if (noRecharge && isConsecutiveDate(prevDate, reportDate)) rechargeStreak += 1;
    else rechargeStreak = noRecharge ? 1 : 0;

    if (rechargeStreak >= rechargeHighDays) {
      issues.push({
        agent: 'data_auditor',
        brand,
        store: storeName,
        category: '充值异常',
        severity: 'high',
        title: `${storeName} 连续${rechargeHighDays}天无充值`,
        detail: `截至 ${reportDate} 已连续 ${rechargeStreak} 天无充值。`,
        data: { date: reportDate, noRechargeDays: rechargeStreak },
      });
    }
    prevDate = reportDate;
  }
  return issues;
}

export function detectTableVisitRatioIssues({
  storeName,
  brand,
  storeReports,
  tableVisitMetrics,
  weekAgoDate,
  nowDate,
  periodLabel,
  isDaily,
  enableTableVisit,
  enableDailyReports,
  getStoreThreshold,
}) {
  const issues = [];
  const ratioMedium = getStoreThreshold(storeName, 'tableVisitRatioMedium', 0.5);
  const ratioHigh = getStoreThreshold(storeName, 'tableVisitRatioHigh', 0.4);
  const weekVisits = Array.from(tableVisitMetrics.countByDate.values()).reduce(
    (s, n) => s + toNum(n, 0),
    0
  );
  const weekDineOrders = storeReports.reduce((s, r) => s + toNum(r?.data?.dine?.orders, 0), 0);
  const tableVisitRatio = weekDineOrders > 0 ? weekVisits / weekDineOrders : 0;
  if (
    !isDaily &&
    enableTableVisit &&
    enableDailyReports &&
    weekDineOrders > 0 &&
    tableVisitRatio < ratioMedium
  ) {
    issues.push({
      agent: 'data_auditor',
      brand,
      store: storeName,
      category: '桌访占比异常',
      severity: tableVisitRatio < ratioHigh ? 'high' : 'medium',
      title: `${storeName} ${weekAgoDate}~${nowDate} 桌访占比偏低（${(tableVisitRatio * 100).toFixed(1)}%）`,
      detail: `桌访数量 ${weekVisits}，堂食订单数量 ${weekDineOrders}，桌访占比 ${(tableVisitRatio * 100).toFixed(1)}%（medium:<${(ratioMedium * 100).toFixed(0)}%, high:<${(ratioHigh * 100).toFixed(0)}%）。`,
      data: {
        date: periodLabel,
        tableVisitCount: weekVisits,
        dineOrders: weekDineOrders,
        tableVisitOrderRatio: Number((tableVisitRatio * 100).toFixed(2)),
      },
    });
  }
  return issues;
}

export async function detectBadReviewIssues(
  ctx,
  {
    storeName,
    brand,
    weekAgoDate,
    nowDate,
    periodLabel,
    isDaily,
    getStoreThreshold,
  }
) {
  const { pool, normalizeStoreKey } = ctx;
  const issues = [];
  if (isDaily) return issues;

  const badReviewMedium = Math.max(1, getStoreThreshold(storeName, 'badReviewMedium', 1));
  const badReviewHigh = Math.max(badReviewMedium, getStoreThreshold(storeName, 'badReviewHigh', 2));
  try {
    const day7AgoDate = weekAgoDate;
    const brPats = feishuStoreSearchPatterns(storeName);
    const productReviews = brPats.length
      ? await pool().query(
          `SELECT product_name, COUNT(*) as cnt
             FROM bad_reviews
             WHERE store ILIKE ANY($1::text[]) AND review_type = 'product'
               AND date >= $2::date AND date <= $3::date
               AND product_name IS NOT NULL AND product_name != ''
             GROUP BY product_name`,
          [brPats, day7AgoDate, nowDate]
        )
      : await pool().query(
          `SELECT product_name, COUNT(*) as cnt
             FROM bad_reviews
             WHERE lower(regexp_replace(store, '\\s+', '', 'g')) = $1 AND review_type = 'product'
               AND date >= $2::date AND date <= $3::date
               AND product_name IS NOT NULL AND product_name != ''
             GROUP BY product_name`,
          [normalizeStoreKey(storeName), day7AgoDate, nowDate]
        );

    for (const row of productReviews.rows || []) {
      const product = String(row.product_name || '').trim();
      const count7d = Number(row.cnt || 0);
      if (count7d >= badReviewMedium) {
        issues.push({
          agent: 'data_auditor',
          brand,
          store: storeName,
          category: '产品差评异常',
          severity: count7d >= badReviewHigh ? 'high' : 'medium',
          title: `${storeName}「${product}」${weekAgoDate}~${nowDate} 收到 ${count7d} 次产品差评`,
          detail: `${weekAgoDate}~${nowDate} 产品「${product}」收到 ${count7d} 次差评（medium:≥${badReviewMedium}, high:≥${badReviewHigh}）。`,
          data: {
            date: periodLabel,
            productName: product,
            reviewCount: count7d,
            periodDays: 7,
            reviewType: 'product',
          },
        });
      }
    }

    const serviceReviews = brPats.length
      ? await pool().query(
          `SELECT service_item, COUNT(*) as cnt
             FROM bad_reviews
             WHERE store ILIKE ANY($1::text[]) AND review_type = 'service'
               AND date >= $2::date AND date <= $3::date
               AND service_item IS NOT NULL AND service_item != ''
             GROUP BY service_item`,
          [brPats, day7AgoDate, nowDate]
        )
      : await pool().query(
          `SELECT service_item, COUNT(*) as cnt
             FROM bad_reviews
             WHERE lower(regexp_replace(store, '\\s+', '', 'g')) = $1 AND review_type = 'service'
               AND date >= $2::date AND date <= $3::date
               AND service_item IS NOT NULL AND service_item != ''
             GROUP BY service_item`,
          [normalizeStoreKey(storeName), day7AgoDate, nowDate]
        );

    for (const row of serviceReviews.rows || []) {
      const service = String(row.service_item || '').trim();
      const count7d = Number(row.cnt || 0);
      if (count7d >= badReviewMedium) {
        issues.push({
          agent: 'data_auditor',
          brand,
          store: storeName,
          category: '服务差评异常',
          severity: count7d >= badReviewHigh ? 'high' : 'medium',
          title: `${storeName}「${service}」服务${weekAgoDate}~${nowDate} 收到 ${count7d} 次差评`,
          detail: `${weekAgoDate}~${nowDate} 服务项「${service}」收到 ${count7d} 次差评（medium:≥${badReviewMedium}, high:≥${badReviewHigh}）。`,
          data: {
            date: periodLabel,
            serviceItem: service,
            reviewCount: count7d,
            periodDays: 7,
            reviewType: 'service',
          },
        });
      }
    }
  } catch {
    // bad_reviews 表可能不存在
  }
  return issues;
}

export async function scanStoreAuditorIssues(ctx, params) {
  const {
    state,
    reports,
    storeInfo,
    period,
    enableDailyReports,
    enableTableVisit,
    loadTableVisitMetricsByStore,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
  } = params;
  const { nowDate, weekAgoDate, periodLabel, isWeekly, isDaily } = period;

  const storeName = storeInfo.name;
  const brandCtx = resolveBrandContextByStore(state, storeName);
  const brand = brandCtx.brandName || storeInfo.brand || inferBrandFromStoreName(storeName) || '洪潮';

  const storeReports = enableDailyReports
    ? reports.filter((r) => {
        if (!dailyReportRowMatches(storeName, r?.store)) return false;
        return inDateRangeInclusive(r?.date, weekAgoDate, nowDate);
      })
    : [];
  if (enableDailyReports && !storeReports.length) {
    await AgentCommunicationHelper.reportDataSourceIssue(
      'daily_reports',
      `门店 ${storeName} 缺少营业数据`,
      '无法进行营收异常检测',
      '建议检查数据同步机制'
    );
  }

  const tableVisitMetrics = enableTableVisit
    ? await loadTableVisitMetricsByStore(storeName, weekAgoDate, nowDate)
    : {
        countByDate: new Map(),
        dissatisfiedProducts: new Map(),
        dissatisfiedByDate: new Map(),
        productLabelByKey: new Map(),
      };
  const reportsSorted = storeReports
    .slice()
    .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));

  const { getStoreThreshold } = ctx;
  const issues = [];

  issues.push(
    ...detectRevenueGapIssues({
      state,
      storeName,
      brand,
      storeReports,
      nowDate,
      periodLabel,
      isDaily,
      enableDailyReports,
      getStoreThreshold,
    })
  );

  issues.push(
    ...(await detectRechargeIssues(ctx, {
      storeName,
      brand,
      reportsSorted,
      isWeekly,
      getStoreThreshold,
    }))
  );

  issues.push(
    ...detectTableVisitRatioIssues({
      storeName,
      brand,
      storeReports,
      tableVisitMetrics,
      weekAgoDate,
      nowDate,
      periodLabel,
      isDaily,
      enableTableVisit,
      enableDailyReports,
      getStoreThreshold,
    })
  );

  issues.push(
    ...(await detectBadReviewIssues(ctx, {
      storeName,
      brand,
      weekAgoDate,
      nowDate,
      periodLabel,
      isDaily,
      getStoreThreshold,
    }))
  );

  return issues;
}
