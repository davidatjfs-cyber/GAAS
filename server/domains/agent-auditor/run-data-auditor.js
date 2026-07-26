/**
 * Data Auditor core: anomaly scan → agent_issues + KPI radar agent_messages.
 * Wave A1 peel from agents.js runDataAuditor.
 */
import { AgentCommunicationHelper } from '../../agent-communication-system.js';
import { getCategoryAssigneeRoleMap } from '../../agent-config-manager.js';
import { dailyReportRowMatches, feishuStoreSearchPatterns } from '../../v2-store-alignment.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-auditor', handler: 'run-data-auditor' });

/** Legacy BI categories migrated to agents-service-v2 — skip create to avoid dup ANO/MT. */
export const DISABLED_LEGACY_BI_CATEGORIES = new Set([
  '实收营收异常',
  '人效值异常',
  '充值异常',
  '桌访产品异常',
  '桌访占比异常',
  '产品差评异常',
  '服务差评异常',
  '总实收毛利率异常',
]);

export function isDisabledLegacyBiCategory(category) {
  return DISABLED_LEGACY_BI_CATEGORIES.has(String(category || '').trim());
}

export function buildKpiRadarAlertJson(issue) {
  return JSON.stringify({
    type: 'kpi_radar',
    category: issue?.category || '',
    store: issue?.store || '',
    severity: issue?.severity || 'medium',
    title: issue?.title || '',
    timestamp: new Date().toISOString(),
  });
}

export function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function toDateOnly(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

export function inDateRangeInclusive(v, start, end) {
  const d = toDateOnly(v);
  if (!d) return false;
  const s = toDateOnly(start);
  const e = toDateOnly(end);
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}

export function daysInMonth(dateStr) {
  const d = toDateOnly(dateStr);
  if (!d) return 30;
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 30;
  return new Date(y, m, 0).getDate();
}

export function isConsecutiveDate(prevDate, currDate) {
  const p = toDateOnly(prevDate);
  const c = toDateOnly(currDate);
  if (!p || !c) return false;
  const d1 = new Date(`${p}T00:00:00`).getTime();
  const d2 = new Date(`${c}T00:00:00`).getTime();
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return false;
  return d2 - d1 === 86400000;
}

export function getPreviousWeekRange(now = new Date()) {
  const cst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const dow = cst.getDay();
  const d2m = (dow + 6) % 7;
  const pM = new Date(cst);
  pM.setDate(pM.getDate() - d2m - 7);
  const pS = new Date(cst);
  pS.setDate(pS.getDate() - d2m - 1);
  const j1 = new Date(pM.getFullYear(), 0, 1);
  const wn = Math.ceil(((pM - j1) / 864e5 + j1.getDay() + 1) / 7);
  return {
    weekStart: toDateOnly(pM.toISOString()),
    weekEnd: toDateOnly(pS.toISOString()),
    weekLabel: `${pM.getFullYear()}-W${String(wn).padStart(2, '0')}`,
  };
}

export function shanghaiYesterdayYmd(now = new Date()) {
  const sh = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  sh.setDate(sh.getDate() - 1);
  const y = sh.getFullYear();
  const m = String(sh.getMonth() + 1).padStart(2, '0');
  const d = String(sh.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getMonthlyTarget(state, ym, store) {
  const settings = state?.settings && typeof state.settings === 'object' ? state.settings : {};
  const monthlyTargets = Array.isArray(settings?.monthlyTargets)
    ? settings.monthlyTargets
    : Array.isArray(state?.monthlyTargets)
      ? state.monthlyTargets
      : [];
  return (
    monthlyTargets.find(
      (x) => String(x?.ym || x?.month || '').trim() === ym && dailyReportRowMatches(store, x?.store)
    ) || null
  );
}

/**
 * daily_reports 门店名与飞书/配置简称并存时，用多模式 OR 聚合 SUM。
 */
export function dailyReportStoreLikePatternsForSql(storeName, normalizeStoreKey, normalizeCanonicalStoreName) {
  const raw = String(storeName || '').trim();
  const out = new Set();
  const add = (s) => {
    const k = normalizeStoreKey(s);
    if (k) out.add(`%${k}%`);
  };
  add(raw);
  add(normalizeCanonicalStoreName(raw));
  const n = normalizeStoreKey(raw);
  if (/洪潮|久光|大宁/.test(n)) {
    add('洪潮大宁久光店');
    add('洪潮久光店');
    add('洪潮');
  }
  if (/马己仙|音乐广场|大宁/.test(n)) {
    add('马己仙上海音乐广场店');
    add('马己仙大宁店');
    add('马己仙');
  }
  return [...out];
}

/**
 * @param {object} deps
 * @returns {(checkMode?: string, tenantId?: string) => Promise<object>}
 */
export function createRunDataAuditor(deps) {
  const {
    pool,
    getSharedState,
    getStoresFromState,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
    findStoreManager,
    refreshBiAgentRuntimeConfig,
    isBiSourceEnabled,
    getStoreThreshold,
    loadTableVisitMetricsByStore,
    checkDataSourceQuality,
    normalizeStoreKey,
    normalizeCanonicalStoreName,
  } = deps;

  async function fetchRechargeFromDailyReportsPg(storeName, reportDate) {
    if (!storeName || !reportDate) return { cnt: 0, amt: 0 };
    try {
      const pats = dailyReportStoreLikePatternsForSql(
        storeName,
        normalizeStoreKey,
        normalizeCanonicalStoreName
      );
      if (!pats.length) return { cnt: 0, amt: 0 };
      const r = await pool().query(
        `SELECT COALESCE(SUM(COALESCE(recharge_count,0)), 0)::int AS cnt,
                COALESCE(SUM(COALESCE(recharge_amount,0)), 0)::numeric AS amt
         FROM daily_reports
         WHERE date = $1::date
           AND lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE ANY($2::text[])`,
        [reportDate, pats]
      );
      const row = r.rows?.[0];
      return {
        cnt: parseInt(row?.cnt ?? 0, 10) || 0,
        amt: parseFloat(row?.amt ?? 0) || 0,
      };
    } catch {
      return { cnt: 0, amt: 0 };
    }
  }

  return async function runDataAuditor(checkMode = 'daily', tenantId = 'default') {
    await refreshBiAgentRuntimeConfig();
    const state = await getSharedState(tenantId);
    const reports = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
    const stores = getStoresFromState(state);
    const issues = [];
    const enableDailyReports = isBiSourceEnabled('daily_reports');
    const enableTableVisit =
      isBiSourceEnabled('table_visit_records') || isBiSourceEnabled('table_visit_bitable');

    await checkDataSourceQuality();

    for (const storeInfo of stores) {
      const storeName = storeInfo.name;
      const brandCtx = resolveBrandContextByStore(state, storeName);
      const brand = brandCtx.brandName || storeInfo.brand || inferBrandFromStoreName(storeName) || '洪潮';

      const now = new Date();
      const isWeekly = checkMode === 'weekly';
      const isDaily = checkMode === 'daily';
      let nowDate;
      let weekAgoDate;
      let periodLabel;
      if (isWeekly) {
        const wr = getPreviousWeekRange();
        weekAgoDate = wr.weekStart;
        nowDate = wr.weekEnd;
        periodLabel = wr.weekLabel;
      } else if (isDaily) {
        const y = shanghaiYesterdayYmd();
        nowDate = y;
        weekAgoDate = y;
        periodLabel = y;
      } else {
        nowDate = toDateOnly(now.toISOString());
        weekAgoDate = toDateOnly(new Date(now.getTime() - 7 * 86400000).toISOString());
        periodLabel = nowDate;
      }

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

      const rechargeHighDays = Math.max(2, getStoreThreshold(storeName, 'rechargeStreakHighDays', 2));
      if (!isWeekly) {
        let rechargeStreak = 0;
        let prevDate = '';
        for (const report of reportsSorted) {
          const reportDate = toDateOnly(report?.date);
          if (!reportDate) continue;
          const jsonAmt = toNum(report?.data?.recharge?.amount, 0);
          const jsonCnt = toNum(report?.data?.recharge?.count, 0);
          const pg = await fetchRechargeFromDailyReportsPg(storeName, reportDate);
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
      }

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

      const badReviewMedium = Math.max(1, getStoreThreshold(storeName, 'badReviewMedium', 1));
      const badReviewHigh = Math.max(badReviewMedium, getStoreThreshold(storeName, 'badReviewHigh', 2));
      if (!isDaily) {
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
      }
    }

    let created = 0;
    const newIssueIds = [];
    for (const issue of issues) {
      try {
        if (isDisabledLegacyBiCategory(issue?.category)) {
          log.info({
            msg: 'skip_legacy_bi_issue',
            category: issue?.category,
            title: String(issue?.title || '').slice(0, 100),
          });
          continue;
        }
        const issueDate = String(issue.data?.date || '').trim();
        const auditeeRole = String(issue.data?._auditee_role || '').trim();
        const existing = await pool().query(
          `SELECT id FROM agent_issues
         WHERE store = $1 AND category = $2
           AND COALESCE(data->>'date','') = COALESCE($3,'')
           AND COALESCE(data->>'_auditee_role','') = COALESCE($4,'')
           AND (
             ($3 <> '' AND created_at > NOW() - INTERVAL '7 days')
             OR ($3 = '' AND created_at > NOW() - INTERVAL '24 hours')
           )
           AND tenant_id = $5
         LIMIT 1`,
          [issue.store, issue.category, issueDate, auditeeRole, tenantId]
        );
        if (existing.rows?.length) continue;

        let assignee = null;
        try {
          const roleMap = await getCategoryAssigneeRoleMap();
          const targetRole = auditeeRole || roleMap[issue.category] || 'store_manager';
          const normalizedStore = normalizeStoreKey(issue.store);
          const allUsers = [
            ...(Array.isArray(state?.employees) ? state.employees : []),
            ...(Array.isArray(state?.users) ? state.users : []),
          ];
          let assigneeUser = allUsers.find(
            (u) =>
              normalizeStoreKey(u?.store) === normalizedStore &&
              String(u?.role || '').trim() === targetRole
          );
          if (!assigneeUser && targetRole === 'store_production_manager') {
            assigneeUser = allUsers.find(
              (u) =>
                normalizeStoreKey(u?.store) === normalizedStore &&
                String(u?.role || '').trim() === 'store_manager'
            );
          }
          assignee = assigneeUser ? String(assigneeUser.username || '').trim() : null;
        } catch {
          assignee = await findStoreManager(state, issue.store);
        }
        const r = await pool().query(
          `INSERT INTO agent_issues (agent, brand, store, category, severity, title, detail, data, assignee_username, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) RETURNING id`,
          [
            issue.agent,
            issue.brand,
            issue.store,
            issue.category,
            issue.severity,
            issue.title,
            issue.detail,
            JSON.stringify(issue.data),
            assignee,
            tenantId,
          ]
        );

        const radarPayload = buildKpiRadarAlertJson(issue);
        await pool().query(
          `INSERT INTO agent_messages (direction, channel, sender_name, routed_to, content_type, content, agent_data, tenant_id)
         VALUES ('out', 'system', 'BI Radar', 'master', 'kpi_radar_alert', $1, $2::jsonb, $3)`,
          [
            JSON.stringify(radarPayload),
            JSON.stringify({ route: 'master', kpiRadar: true, payload: radarPayload }),
            tenantId,
          ]
        );

        created++;
        if (r.rows?.[0]?.id) newIssueIds.push(r.rows[0].id);
      } catch (e) {
        log.error({ msg: 'insert_issue_failed', err: String(e?.message || e) });
      }
    }

    return {
      scanned: reports.length,
      issuesFound: issues.length,
      issuesCreated: created,
      newIssueIds,
    };
  };
}
