// 门店预测配置：雨天系数、节假日策略
export const STORE_FORECAST_CONFIG = {
  '洪潮大宁久光店': { rainFactor: 0.90, snowFactor: 0.85, holidayAsWeekend: true },
  '洪潮久光店': { rainFactor: 0.90, snowFactor: 0.85, holidayAsWeekend: true },
  '马己仙上海音乐广场店': { rainFactor: 0.85, snowFactor: 0.80, holidayAsWeekend: true },
  '马己仙': { rainFactor: 0.85, snowFactor: 0.80, holidayAsWeekend: true },
  '_default': { rainFactor: 0.88, snowFactor: 0.82, holidayAsWeekend: true }
};

export function createGetStoreForecastConfig({ resolveTenantIdDefault, getBrandForStoreSync, getBrandConfigSync }) {
  function getStoreForecastConfig(store) {
    const s = String(store || '').trim();
    // resolveTenantIdDefault读AsyncLocalStorage里authRequired设置的租户上下文，
    // 不需要给这个函数的所有调用点都加tenantId参数。
    const tid = resolveTenantIdDefault();
    const brandKey = getBrandForStoreSync(s, tid)?.brandKey;
    const dbCfg = brandKey ? getBrandConfigSync(brandKey, tid)?.forecast : null;
    if (dbCfg) return dbCfg;
    if (STORE_FORECAST_CONFIG[s]) return STORE_FORECAST_CONFIG[s];
    // Partial name match for abbreviated store names
    const key = Object.keys(STORE_FORECAST_CONFIG).find(k => k !== '_default' && (s.includes(k) || k.includes(s)));
    return (key ? STORE_FORECAST_CONFIG[key] : null) || STORE_FORECAST_CONFIG['_default'];
  }
  return getStoreForecastConfig;
}

export function isCNYPeriod(dateStr) {
    // Spring Festival anomaly window. Mar 1+ treated as normal (元宵 = Feb 20 2026).
    if (!dateStr) return false;
    const d = new Date(dateStr + 'T00:00:00');
    if (!Number.isFinite(d.getTime())) return false;
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    // 2026 CNY window: Jan 25 – Feb 28
    if (y === 2026 && ((m === 1 && day >= 25) || m === 2)) return true;
    // Generic guard for other years: Jan 25 – Feb 28
    if (m === 2 || (m === 1 && day >= 25)) return true;
    return false;
}

// Known national public holidays (non-CNY) that inflate restaurant sales.
export const KNOWN_PUBLIC_HOLIDAYS = new Set([
  '2026-01-01','2026-01-02','2026-01-03',
  '2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05',
  '2026-06-19','2026-06-20','2026-06-21',
  '2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08',
  '2025-01-01','2025-01-02','2025-01-03',
  '2025-05-01','2025-05-02','2025-05-03','2025-05-04','2025-05-05',
  '2025-05-31','2025-06-01','2025-06-02',
  '2025-10-01','2025-10-02','2025-10-03','2025-10-04','2025-10-05','2025-10-06','2025-10-07','2025-10-08',
]);

export function isKnownPublicHoliday(dateStr) {
  return KNOWN_PUBLIC_HOLIDAYS.has(String(dateStr || '').trim());
}

export function isNormalWorkday(dateStr, isHoliday) {
    if (isHoliday) return false;
    if (isCNYPeriod(dateStr)) return false;
    if (isKnownPublicHoliday(dateStr)) return false;
    const d = new Date((dateStr || '') + 'T00:00:00');
    if (!Number.isFinite(d.getTime())) return false;
    const dow = d.getDay();
    return dow >= 1 && dow <= 5;
}
