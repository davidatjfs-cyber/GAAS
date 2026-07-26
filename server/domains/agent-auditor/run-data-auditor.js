/**
 * Data Auditor core: anomaly scan → agent_issues + KPI radar agent_messages.
 * Wave A1 peel from agents.js runDataAuditor.
 */
import { resolveAuditorPeriod } from './run-data-auditor-period.js';
import { persistAuditorIssues } from './run-data-auditor-persist.js';
import { scanStoreAuditorIssues } from './run-data-auditor-scan.js';
import { dailyReportRowMatches } from '../../v2-store-alignment.js';

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
  const ctx = {
    pool: deps.pool,
    normalizeStoreKey: deps.normalizeStoreKey,
    normalizeCanonicalStoreName: deps.normalizeCanonicalStoreName,
    getStoreThreshold: deps.getStoreThreshold,
    findStoreManager: deps.findStoreManager,
  };

  return async function runDataAuditor(checkMode = 'daily', tenantId = 'default') {
    await deps.refreshBiAgentRuntimeConfig();
    const state = await deps.getSharedState(tenantId);
    const reports = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
    const stores = deps.getStoresFromState(state);
    const issues = [];
    const enableDailyReports = deps.isBiSourceEnabled('daily_reports');
    const enableTableVisit =
      deps.isBiSourceEnabled('table_visit_records') ||
      deps.isBiSourceEnabled('table_visit_bitable');

    await deps.checkDataSourceQuality();

    const period = resolveAuditorPeriod(checkMode);
    const scanParams = {
      state,
      reports,
      period,
      enableDailyReports,
      enableTableVisit,
      loadTableVisitMetricsByStore: deps.loadTableVisitMetricsByStore,
      resolveBrandContextByStore: deps.resolveBrandContextByStore,
      inferBrandFromStoreName: deps.inferBrandFromStoreName,
    };

    for (const storeInfo of stores) {
      const storeIssues = await scanStoreAuditorIssues(ctx, { ...scanParams, storeInfo });
      issues.push(...storeIssues);
    }

    const { created, newIssueIds } = await persistAuditorIssues(ctx, { issues, state, tenantId });

    return {
      scanned: reports.length,
      issuesFound: issues.length,
      issuesCreated: created,
      newIssueIds,
    };
  };
}
