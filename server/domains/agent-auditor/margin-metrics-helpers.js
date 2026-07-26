/**
 * Margin estimation / trusted net-margin for data auditor (P2 peel from agents.js).
 */
import { dailyReportRowMatches } from '../../v2-store-alignment.js';
import { getBrandForStoreSync } from '../../utils/brand-config-loader.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import {
  queryCostCoverageDiagnostics,
  queryMarginByBiz,
  resolveStoreKeyForReports,
} from '../../bi-weekly-report.js';

export function getActualRevenueFromHistoryRow(row, toNum) {
  let actual = Math.max(0, toNum(row?.actualRevenue, 0));
  let expected = Math.max(0, toNum(row?.expectedRevenue, 0));
  // 安全校验：折前>=实收，若反了则交换
  if (actual > 0 && expected > 0 && actual > expected) {
    const tmp = actual; actual = expected; expected = tmp;
  }
  if (actual > 0) return actual;
  const discount = Math.max(0, toNum(row?.totalDiscount, 0));
  return Math.max(0, expected - discount);
}

export function buildGrossProfileMap(profiles, store, { toNum, normProductKey }) {
  const map = new Map();
  (Array.isArray(profiles) ? profiles : [])
    .filter((x) => dailyReportRowMatches(store, x?.store))
    .forEach((x) => {
      const bizType = String(x?.bizType || '').trim().toLowerCase();
      const productKey = normProductKey(x?.product);
      if (!productKey) return;
      const key = `${bizType}||${productKey}`;
      map.set(key, {
        costPerUnit: toNum(x?.costPerUnit ?? x?.cost, NaN),
        grossPerUnit: toNum(x?.grossPerUnit ?? x?.grossProfit ?? x?.profitPerUnit, NaN)
      });
      if (bizType) {
        map.set(`||${productKey}`, {
          costPerUnit: toNum(x?.costPerUnit ?? x?.cost, NaN),
          grossPerUnit: toNum(x?.grossPerUnit ?? x?.grossProfit ?? x?.profitPerUnit, NaN)
        });
      }
    });
  return map;
}

/** 基于备货预测历史 + 成本库的估算；数据审计「总实收毛利率异常」已改用 resolveTrustedNetMarginForAuditorIssue（pos_sales_detail/日报），勿混用。 */
export async function estimateMarginMetricsForRange(deps, { state, store, startDate, endDate }) {
  const {
    pool,
    log,
    toNum,
    normProductKey,
    inDateRangeInclusive,
    normalizeStoreKey,
  } = deps;

  const historyRows = (Array.isArray(state?.inventoryForecastHistory) ? state.inventoryForecastHistory : [])
    .filter((x) => dailyReportRowMatches(store, x?.store))
    .filter((x) => inDateRangeInclusive(x?.date, startDate, endDate));
  const profiles = Array.isArray(state?.forecastGrossProfitProfiles) ? state.forecastGrossProfitProfiles : [];
  const profileMap = buildGrossProfileMap(profiles, store, { toNum, normProductKey });
  try {
    // 按品牌过滤成本，避免两品牌同名菜成本互相污染（品牌从门店名前缀推断；'*' 通用兜底）。
    const dlBrand = getBrandForStoreSync(store, resolveTenantIdDefault())?.brandName
      || (String(store||'').includes('洪潮') ? '洪潮' : (String(store||'').includes('马己仙') ? '马己仙' : ''));
    const dlParams = [normalizeStoreKey(store)];
    let dlBrandClause = '';
    if (dlBrand) { dlParams.push(dlBrand); dlBrandClause = ` AND (brand=$${dlParams.length} OR brand='*')`; }
    const dlR = await pool().query(
      `SELECT biz_type,dish_name,unit_cost FROM dish_library_costs WHERE enabled=TRUE AND (lower(regexp_replace(coalesce(store,''),'\\s+','','g'))=$1 OR store='*')${dlBrandClause}`,
      dlParams
    );
    for (const r of (dlR.rows||[])) { const biz=String(r.biz_type||'').trim().toLowerCase(); const pk=normProductKey(r.dish_name); const c=toNum(r.unit_cost,NaN); if(!pk||!Number.isFinite(c)||c<0) continue; if(!profileMap.has(`${biz}||${pk}`)) profileMap.set(`${biz}||${pk}`,{costPerUnit:c,grossPerUnit:NaN}); if(!profileMap.has(`||${pk}`)) profileMap.set(`||${pk}`,{costPerUnit:c,grossPerUnit:NaN}); }
  } catch(e) { log.error('[margin] dish_library_costs query error:', e?.message||e); }

  const out = {
    takeaway: { actualRevenue: 0, estimatedCost: 0, marginRate: 0 },
    dinein: { actualRevenue: 0, estimatedCost: 0, marginRate: 0 },
    total: { actualRevenue: 0, estimatedCost: 0, marginRate: 0 }
  };

  for (const row of historyRows) {
    const bizTypeRaw = String(row?.bizType || '').trim().toLowerCase();
    const bizType = bizTypeRaw === 'takeaway' || bizTypeRaw === 'delivery' || bizTypeRaw === '外卖'
      ? 'takeaway'
      : (bizTypeRaw === 'dinein' || bizTypeRaw === 'dine_in' || bizTypeRaw === '堂食' ? 'dinein' : '');
    if (!bizType) continue;

    const actualRevenue = getActualRevenueFromHistoryRow(row, toNum);
    out[bizType].actualRevenue += actualRevenue;
    out.total.actualRevenue += actualRevenue;

    const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
    const entries = Object.entries(products)
      .map(([name, qtyRaw]) => ({ name, qty: toNum(qtyRaw, 0) }))
      .filter((x) => x.qty > 0);
    const totalQty = entries.reduce((s, x) => s + x.qty, 0);
    if (!totalQty) continue;

    const expectedRevenue = Math.max(0, toNum(row?.expectedRevenue, 0));
    for (const entry of entries) {
      const key = normProductKey(entry.name);
      if (!key) continue;
      const profile = profileMap.get(`${bizType}||${key}`) || profileMap.get(`||${key}`) || null;
      if (!profile) continue;

      let estimatedCost = 0;
      if (Number.isFinite(profile.costPerUnit) && profile.costPerUnit >= 0) {
        estimatedCost = entry.qty * profile.costPerUnit;
      } else if (Number.isFinite(profile.grossPerUnit) && profile.grossPerUnit >= 0 && expectedRevenue > 0) {
        const allocRevenue = (entry.qty / totalQty) * expectedRevenue;
        estimatedCost = Math.max(0, allocRevenue - entry.qty * profile.grossPerUnit);
      }

      const cR = expectedRevenue > 0 ? (entry.qty/totalQty)*expectedRevenue : 0;
      out[bizType].estimatedCost += estimatedCost;
      out[bizType].covRev = (out[bizType].covRev||0)+cR;
      out.total.estimatedCost += estimatedCost;
      out.total.covRev = (out.total.covRev||0)+cR;
    }
  }

  const calcRate = (rev, cost) => {
    if (!(rev > 0)) return 0;
    return Math.max(0, 1 - cost / rev);
  };

  const xCost = (o) => o.covRev > 0 ? o.estimatedCost * (o.actualRevenue / o.covRev) : o.estimatedCost;
  out.takeaway.marginRate = calcRate(out.takeaway.actualRevenue, xCost(out.takeaway));
  out.dinein.marginRate = calcRate(out.dinein.actualRevenue, xCost(out.dinein));
  out.total.marginRate = calcRate(out.total.actualRevenue, xCost(out.total));

  return out;
}

/**
 * 数据审计「总实收毛利率异常」专用：只使用可核对的数据源，与 bi-weekly-report 对齐。
 * 1) 优先 pos_sales_detail + dish_library_costs（周报同款 SQL），并要求成本覆盖实收 ≥ 阈值、实收字段完整；
 * 2) 否则使用 PostgreSQL daily_reports.actual_margin（日报有填报的天数）；
 * 3) 不再用 inventoryForecastHistory 触发该类告警，避免「未提供销售明细却出毛利率」的质疑。
 */
export async function resolveTrustedNetMarginForAuditorIssue(deps, storeName, startDate, endDate) {
  const {
    pool,
    setReportPool,
    resolveStoreKeyForReports: resolveStoreKey = resolveStoreKeyForReports,
    queryCostCoverageDiagnostics: queryCostCov = queryCostCoverageDiagnostics,
    queryMarginByBiz: queryMargin = queryMarginByBiz,
  } = deps;

  const minCovPct = Math.min(100, Math.max(50, Number(process.env.DATA_AUDITOR_MIN_MARGIN_COST_COVERAGE_PCT || 85)));
  const maxMissingRevPct = Math.min(50, Math.max(0, Number(process.env.DATA_AUDITOR_MAX_MISSING_REVENUE_ROW_PCT || 10)));
  try {
    setReportPool(pool());
  } catch (e) {
    return { ok: false, reason: 'pool', message: e?.message || String(e) };
  }
  let align;
  try {
    align = await resolveStoreKey(storeName);
  } catch (e) {
    return { ok: false, reason: 'align_failed', message: e?.message || String(e) };
  }
  const storeDbKey = String(align?.useStore || storeName).trim() || String(storeName).trim();
  const rq = await pool().query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(COALESCE(revenue,0)),0)::numeric AS sum_rev,
            COUNT(*) FILTER (WHERE COALESCE(revenue,0)=0 AND COALESCE(sales_amount,0)>0)::int AS missing_rev_rows,
            COUNT(*) FILTER (WHERE COALESCE(sales_amount,0)>0)::int AS valid_sales_rows
     FROM pos_sales_detail
     WHERE store = $1 AND date >= $2::date AND date <= $3::date`,
    [storeDbKey, startDate, endDate]
  );
  const row = rq.rows?.[0] || {};
  const rawRows = Number(row.n || 0);
  const rawRev = Number(row.sum_rev || 0);
  const validSalesRows = Number(row.valid_sales_rows || 0);
  const missingRevRows = Number(row.missing_rev_rows || 0);
  const missingRevPct = validSalesRows > 0 ? (missingRevRows / validSalesRows) * 100 : 0;

  if (rawRows > 0 && rawRev > 0) {
    if (missingRevPct > maxMissingRevPct) {
      return {
        ok: false,
        reason: 'pos_sales_incomplete_revenue',
        storeDbKey,
        alignNote: align?.note || null,
        message: `pos_sales_detail 中 ${missingRevRows}/${validSalesRows} 行(${missingRevPct.toFixed(1)}%)实收(revenue)为0，超过审计允许上限 ${maxMissingRevPct}%，不触发毛利率异常（请先修正导入）。`
      };
    }
    let cov;
    let marginPack;
    try {
      cov = await queryCostCov(storeDbKey, startDate, endDate, 8);
      marginPack = await queryMargin(storeDbKey, startDate, endDate);
    } catch (e) {
      return { ok: false, reason: 'query_failed', storeDbKey, message: e?.message || String(e) };
    }
    const revCov = cov?.total?.revenueCoveragePct;
    if (revCov == null || !Number.isFinite(revCov) || revCov < minCovPct) {
      return {
        ok: false,
        reason: 'low_cost_coverage',
        storeDbKey,
        alignNote: align?.note || null,
        coverage: cov?.total || null,
        message: `菜品成本库对实收营收覆盖率 ${revCov != null && Number.isFinite(revCov) ? revCov.toFixed(1) : '—'}%，低于审计门槛 ${minCovPct}%（与周报「仅命中成本」口径一致），不触发毛利率异常。请补齐 dish_library_costs / dish_name_aliases。`
      };
    }
    const netPct = marginPack?.margins?.totalNetMarginPct;
    if (netPct == null || !Number.isFinite(netPct)) {
      return { ok: false, reason: 'no_margin', storeDbKey, message: 'pos_sales_detail 有数据但无法计算总实收毛利率（请检查销售额与成本匹配）。' };
    }
    return {
      ok: true,
      source: 'pos_sales_detail_plus_cost_library',
      marginRate: netPct / 100,
      actualRevenue: Number(marginPack.total.revenue || 0),
      estimatedCost: Number(marginPack.total.cost || 0),
      coverage: cov.total,
      storeDbKey,
      alignNote: align?.note || null,
      summary: `数据源：pos_sales_detail + dish_library_costs（与经营周报一致）；门店库键「${storeDbKey}」；成本覆盖实收 ${Number(revCov).toFixed(1)}%。${align?.note ? ` ${align.note}` : ''}`
    };
  }

  try {
    const dr = await pool().query(
      `SELECT ROUND(AVG(actual_margin)::numeric, 4) AS av_g,
              COUNT(*)::int AS days_n
       FROM daily_reports
       WHERE TRIM(store) = $1 AND date >= $2::date AND date <= $3::date
         AND actual_margin IS NOT NULL AND actual_margin > 0`,
      [storeDbKey, startDate, endDate]
    );
    const av = parseFloat(dr.rows?.[0]?.av_g);
    const daysN = Number(dr.rows?.[0]?.days_n || 0);
    if (Number.isFinite(av) && av > 0 && daysN >= 1) {
      return {
        ok: true,
        source: 'daily_reports_pg',
        marginRate: av / 100,
        actualRevenue: null,
        estimatedCost: null,
        drDays: daysN,
        storeDbKey,
        alignNote: align?.note || null,
        summary: `数据源：PostgreSQL daily_reports.actual_margin（${daysN} 天有值）；未使用备货预测。门店库键「${storeDbKey}」。${align?.note ? ` ${align.note}` : ''}`
      };
    }
  } catch (e) {
    return { ok: false, reason: 'daily_reports_failed', storeDbKey, message: e?.message || String(e) };
  }

  return {
    ok: false,
    reason: 'no_trusted_source',
    storeDbKey,
    alignNote: align?.note || null,
    message: '周期内无可用 pos_sales_detail 实收，且 daily_reports 无有效 actual_margin，不触发「总实收毛利率异常」（避免不可核实数据）。'
  };
}

