export function isForecastStoreScopedRole(role) {
    const r = String(role || '').trim();
    return r === 'store_manager' || r === 'store_production_manager';
}

export function normalizeForecastBizType(input) {
    const v = String(input || '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'takeaway' || v === 'delivery' || v === '外卖') return 'takeaway';
    if (v === 'dinein' || v === 'dine_in' || v === '堂食') return 'dinein';
    return '';
}

export function createForecastBrandToken({ getBrandForStoreSync, resolveTenantIdDefault }) {
  // 从品牌名/门店名推断品牌 token（洪潮/马己仙），用于按品牌过滤菜品库成本，避免跨品牌成本污染。
  function forecastBrandToken(input) {
    const t = String(input || '');
    const dbBrand = getBrandForStoreSync(t, resolveTenantIdDefault())?.brandName;
    if (dbBrand) return dbBrand;
    if (t.includes('洪潮')) return '洪潮';
    if (t.includes('马己仙')) return '马己仙';
    return '';
  }
  return forecastBrandToken;
}

// Store-level business slot configuration.
// hasAfternoon: false  → no afternoon tea slot; 14:00-16:59 becomes early dinner.
// dineinEarlyStart: hour at which dine-in can start (e.g. 16 for weekend 16:30 arrivals).
export const STORE_SLOT_CONFIG = {
  '洪潮大宁久光店': { hasAfternoon: false, dineinEarlyStart: 16 },
  '洪潮久光店':     { hasAfternoon: false, dineinEarlyStart: 16 },
  '_default':       { hasAfternoon: true,  dineinEarlyStart: 17 }
};

export function createGetStoreSlotConfig({ resolveTenantIdDefault, getBrandForStoreSync, getBrandConfigSync }) {
  function getStoreSlotConfig(store) {
    const s = String(store || '').trim();
    const tid = resolveTenantIdDefault();
    const brandKey = getBrandForStoreSync(s, tid)?.brandKey;
    const dbCfg = brandKey ? getBrandConfigSync(brandKey, tid)?.slotConfig : null;
    if (dbCfg) return dbCfg;
    if (STORE_SLOT_CONFIG[s]) return STORE_SLOT_CONFIG[s];
    const key = Object.keys(STORE_SLOT_CONFIG).find(k => k !== '_default' && (s.includes(k) || k.includes(s)));
    return (key ? STORE_SLOT_CONFIG[key] : null) || STORE_SLOT_CONFIG['_default'];
  }
  return getStoreSlotConfig;
}

export function normalizeForecastSlot(input) {
    const v = String(input || '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'lunch' || v === 'noon' || v === '午市') return 'lunch';
    if (v === 'afternoon' || v === 'tea' || v === 'afternoon_tea' || v === '下午茶') return 'afternoon';
    if (v === 'dinner' || v === 'night' || v === '晚市') return 'dinner';
    return '';
}

// Returns the canonical slot for a given hour, respecting store-level slot config.
export function resolveSlotForHour(startHour, storeSlotCfg) {
    const cfg = storeSlotCfg || STORE_SLOT_CONFIG['_default'];
    if (startHour >= 10 && startHour < 14) return 'lunch';
    if (!cfg.hasAfternoon) {
      // No afternoon tea: everything from lunch-end onward is dinner
      if (startHour >= 14 && startHour < 23) return 'dinner';
    } else {
      if (startHour >= 14 && startHour < 17) return 'afternoon';
      if (startHour >= 17 && startHour < 23) return 'dinner';
    }
    return '';
}

export function createNormalizeForecastSlotFromHourRange({ getStoreSlotConfig }) {
  function normalizeForecastSlotFromHourRange(input, store) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const byWord = normalizeForecastSlot(raw);
    // If explicitly named as a slot, remap 'afternoon' → 'dinner' for stores without afternoon tea
    if (byWord) {
      if (byWord === 'afternoon' && store) {
        const cfg = getStoreSlotConfig(store);
        if (!cfg.hasAfternoon) return 'dinner';
      }
      return byWord;
    }
    const slotCfg = store ? getStoreSlotConfig(store) : null;
    // Match HH:MM or HH：MM patterns
    const m = raw.match(/(\d{1,2})\s*[:：]\s*\d{1,2}/);
    if (m) {
      const startHour = Number(m[1]);
      if (Number.isFinite(startHour)) {
        const s = resolveSlotForHour(startHour, slotCfg);
        if (s) return s;
      }
    }
    // Match decimal time from Excel (e.g. 0.708333 = 17:00)
    const dec = Number(raw);
    if (Number.isFinite(dec) && dec > 0 && dec < 1) {
      const hour = Math.floor(dec * 24);
      const s = resolveSlotForHour(hour, slotCfg);
      if (s) return s;
    }
    // Match AM/PM time (e.g. "5:00 PM", "5:00:00 PM")
    const ampm = raw.match(/(\d{1,2})\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{1,2})?\s*(AM|PM|am|pm|上午|下午)/i);
    if (ampm) {
      let h = Number(ampm[1]);
      const isPM = /pm|下午/i.test(ampm[2]);
      if (isPM && h < 12) h += 12;
      if (!isPM && h === 12) h = 0;
      const s = resolveSlotForHour(h, slotCfg);
      if (s) return s;
    }
    // Match plain hour number (e.g. "17" or "17:00")
    const plainHour = raw.match(/^(\d{1,2})$/);
    if (plainHour) {
      const s = resolveSlotForHour(Number(plainHour[1]), slotCfg);
      if (s) return s;
    }
    return '';
  }
  return normalizeForecastSlotFromHourRange;
}

export function createNormalizeForecastUploadDate({ safeDateOnly }) {
  function normalizeForecastUploadDate(input) {
    const v = String(input || '').trim();
    if (!v) return '';
    const date = safeDateOnly(v);
    if (date) return date;
    // Chinese: X月Y日
    const cn = v.match(/^(\d{1,2})月(\d{1,2})日$/);
    if (cn) {
      const y = new Date().getFullYear();
      const m = String(Math.max(1, Math.min(12, Number(cn[1] || 1)))).padStart(2, '0');
      const d = String(Math.max(1, Math.min(31, Number(cn[2] || 1)))).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    // M/D/YY or M/D/YYYY (XLSX date output format)
    const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mdy) {
      let yr = Number(mdy[3]);
      if (yr < 100) yr += yr < 50 ? 2000 : 1900;
      const m = String(Math.max(1, Math.min(12, Number(mdy[1])))).padStart(2, '0');
      const d = String(Math.max(1, Math.min(31, Number(mdy[2])))).padStart(2, '0');
      return `${yr}-${m}-${d}`;
    }
    // D/M/YYYY or DD/MM/YYYY
    const dmy = v.match(/^(\d{1,2})[\.\-](\d{1,2})[\.\-](\d{4})$/);
    if (dmy) {
      const a = Number(dmy[1]), b = Number(dmy[2]), yr = Number(dmy[3]);
      if (a > 12 && b <= 12) {
        return `${yr}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
      }
      return `${yr}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    }
    // YYYY/M/D
    const ymd = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (ymd) {
      return `${ymd[1]}-${String(ymd[2]).padStart(2, '0')}-${String(ymd[3]).padStart(2, '0')}`;
    }
    return '';
  }
  return normalizeForecastUploadDate;
}

export function inferForecastUploadDateFromFilename(input, now = new Date()) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const basename = raw.replace(/\.[^.]+$/, '');

    // 1) Full date patterns in filename: YYYY-MM-DD / YYYY_MM_DD / YYYY.MM.DD
    const full = basename.match(/(20\d{2})[-_.\/年](\d{1,2})[-_.\/月](\d{1,2})/);
    if (full) {
      const y = Number(full[1]);
      const m = Number(full[2]);
      const d = Number(full[3]);
      if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    // 2) Range-like pattern: 2-16-22 => interpret as M-D1-D2, choose D2
    const mdRange = basename.match(/(^|\D)(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{1,2})(\D|$)/);
    if (mdRange) {
      const m = Number(mdRange[2]);
      const d1 = Number(mdRange[3]);
      const d2 = Number(mdRange[4]);
      if (m >= 1 && m <= 12 && d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) {
        const y = now.getFullYear();
        const day = Math.max(d1, d2);
        return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // 3) Single month-day pattern: 2-16 / 2_16 / 2.16
    const md = basename.match(/(^|\D)(\d{1,2})[-_.\/](\d{1,2})(\D|$)/);
    if (md) {
      const m = Number(md[2]);
      const d = Number(md[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const y = now.getFullYear();
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    return '';
}

export function normalizeForecastWeather(input) {
    return String(input || '').trim().slice(0, 40);
}

export function normalizeForecastStoreName(input) {
    return String(input || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function normalizeForecastStoreKey(input) {
    return normalizeForecastStoreName(input).replace(/\s+/g, '').toLowerCase();
}

export function createShiftForecastDate({ safeDateOnly }) {
  function shiftForecastDate(dateStr, deltaDays) {
    const safe = safeDateOnly(dateStr);
    if (!safe) return '';
    const dt = new Date(`${safe}T00:00:00Z`);
    if (!Number.isFinite(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + Number(deltaDays || 0));
    return dt.toISOString().slice(0, 10);
  }
  return shiftForecastDate;
}

export function forecastHistoryRowKey(row) {
  return [
    String(row?.store || '').trim(),
    String(row?.bizType || '').trim(),
    String(row?.slot || '').trim(),
    String(row?.date || '').trim()
  ].join('||');
}

export function sortForecastHistoryRows(rows, limit = 0) {
    const sorted = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const aDate = String(a?.date || '');
      const bDate = String(b?.date || '');
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''));
    });
    if (limit > 0) return sorted.slice(0, limit);
    return sorted;
}

export function mergePreferredForecastHistoryRows(primaryRows, fallbackRows, limit = 0) {
    const map = new Map();
    (Array.isArray(primaryRows) ? primaryRows : []).forEach((row) => {
      map.set(forecastHistoryRowKey(row), row);
    });
    (Array.isArray(fallbackRows) ? fallbackRows : []).forEach((row) => {
      const key = forecastHistoryRowKey(row);
      if (!map.has(key)) map.set(key, row);
    });
    return sortForecastHistoryRows(Array.from(map.values()), limit);
}
