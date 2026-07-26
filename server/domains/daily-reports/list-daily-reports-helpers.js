/**
 * P4 peel: listDailyReports orchestration helpers.
 */
import {
  formatPgDateOnly,
  dailyReportMergeKey,
  dailyReportItemFromPgRow,
  mergeDailyReportItemWithPgRow,
} from './helpers.js';

const DAILY_REPORTS_PG_SELECT = `
            SELECT store, date, brand, actual_revenue, pre_discount_revenue, total_discount,
                   dine_orders, dine_revenue, dine_traffic, efficiency, labor_total,
                   actual_margin, gross_profit, dianping_rating, new_wechat_members, wechat_month_total,
                   private_room_uses, operational_anomaly_note, delivery_pre_revenue, delivery_actual,
                   delivery_orders, delivery_bad_reviews, budget, budget_rate, submitted, submitted_at, updated_at,
                   recharge_count, recharge_amount,
                   weather, segments, discount_dine, discount_delivery, categories, delivery_detail,
                   bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch
            FROM daily_reports`;

export function buildDailyReportNameMap(state0) {
  const allPeople = [
    ...(Array.isArray(state0.employees) ? state0.employees : []),
    ...(Array.isArray(state0.users) ? state0.users : []),
  ];
  const nameMap = new Map();
  allPeople.forEach((p) => {
    const u = String(p?.username || '').trim().toLowerCase();
    const n = String(p?.name || '').trim();
    if (u && n && !nameMap.has(u)) nameMap.set(u, n);
  });
  return nameMap;
}

export function resolveListDailyReportsStoreFilter({
  role,
  storeQ,
  allowedStores,
  currentStore,
  myStore,
}) {
  const allowed = Array.isArray(allowedStores) ? allowedStores : [];
  const current = String(currentStore || '').trim();
  const restrictedRoles = ['store_manager', 'store_production_manager', 'front_manager'];
  if (!restrictedRoles.includes(role)) return storeQ;
  return storeQ && allowed.includes(storeQ) ? storeQ : (current || myStore);
}

export function filterStateDailyReports(items, { store, date, start, end, inDateRange }) {
  let out = items.slice();
  if (store) out = out.filter((r) => String(r?.store || '').trim() === String(store).trim());
  if (date) {
    out = out.filter((r) => String(r?.date || '').trim() === String(date).trim());
  } else if (start || end) {
    out = out.filter((r) => inDateRange(String(r?.date || '').trim(), start, end));
  }
  return out.filter((r) => r && typeof r === 'object');
}

export function resolvePgMergeWindow({ date, start, end, limit }) {
  let pgMergeStart = '';
  let pgMergeEnd = '';
  let pgMergeLatestLimit = 0;
  if (date) {
    pgMergeStart = pgMergeEnd = date;
  } else if (start || end) {
    pgMergeStart = start || end;
    pgMergeEnd = end || start;
    if (pgMergeStart && !pgMergeEnd) {
      pgMergeEnd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    }
    if (!pgMergeStart && pgMergeEnd) {
      pgMergeStart = pgMergeEnd;
    }
    if (pgMergeStart > pgMergeEnd) {
      const s = pgMergeStart;
      pgMergeStart = pgMergeEnd;
      pgMergeEnd = s;
    }
  } else {
    pgMergeLatestLimit = Math.max(limit, 200);
  }
  return { pgMergeStart, pgMergeEnd, pgMergeLatestLimit };
}

export function mergePgRowsIntoItems(items, rows) {
  const merged = items.slice();
  for (const row of rows) {
    const k = dailyReportMergeKey(row.store, row.date);
    const idx = merged.findIndex((i) => i && dailyReportMergeKey(i.store, i.date) === k);
    if (idx < 0) merged.push(dailyReportItemFromPgRow(row));
    else merged[idx] = mergeDailyReportItemWithPgRow(merged[idx], row);
  }
  return merged;
}

export async function mergeDailyReportsFromPgRange(pool, items, { pgMergeStart, pgMergeEnd, store, tenantIdQ }) {
  const args = [pgMergeStart, pgMergeEnd];
  let sql = `${DAILY_REPORTS_PG_SELECT}
            WHERE date >= $1::date AND date <= $2::date`;
  if (store) {
    sql += ` AND TRIM(store) = TRIM($3::text)`;
    args.push(String(store).trim());
  }
  args.push(tenantIdQ);
  sql += ` AND tenant_id = $${args.length}`;
  const pgR = await pool.query(sql, args);
  return mergePgRowsIntoItems(items, pgR.rows);
}

export async function mergeDailyReportsFromPgLatest(pool, items, { pgMergeLatestLimit, store, tenantIdQ }) {
  const args = [];
  let sql = `${DAILY_REPORTS_PG_SELECT}
            WHERE 1=1`;
  if (store) {
    sql += ` AND TRIM(store) = TRIM($1::text)`;
    args.push(String(store).trim());
  }
  args.push(tenantIdQ);
  sql += ` AND tenant_id = $${args.length}`;
  sql += ` ORDER BY date DESC, updated_at DESC NULLS LAST LIMIT $${args.length + 1}::int`;
  args.push(pgMergeLatestLimit);
  const pgR = await pool.query(sql, args);
  return mergePgRowsIntoItems(items, pgR.rows);
}

export async function enrichDailyReportItemsWithDb(pool, items, { monthlyTargets, tenantIdQ, resolveRealName, log }) {
  if (!items.length) return items;

  const dbMap = new Map();
  try {
    const pairStores = [];
    const pairDates = [];
    const seenPair = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const s = String(item.store || '').trim();
      const d = formatPgDateOnly(item.date);
      if (!s || !d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const pk = `${s}|${d}`;
      if (seenPair.has(pk)) continue;
      seenPair.add(pk);
      pairStores.push(s);
      pairDates.push(d);
    }
    if (pairStores.length > 0) {
      const dbResult = await pool.query(
        `SELECT dr.store, dr.date, dr.dianping_rating, dr.new_wechat_members, dr.wechat_month_total, dr.operational_anomaly_note
               FROM daily_reports dr
               INNER JOIN (SELECT * FROM unnest($1::text[], $2::text[]) AS t(store, ymd)) pairs
                 ON TRIM(dr.store) = TRIM(pairs.store) AND dr.date = pairs.ymd::date
               WHERE dr.tenant_id = $3`,
        [pairStores, pairDates, tenantIdQ]
      );
      for (const row of dbResult.rows) {
        dbMap.set(dailyReportMergeKey(row.store, row.date), row);
      }
    }
  } catch (e) {
    log.error({ msg: 'daily_reports_db_enrichment_failed', err: e?.message || String(e) });
  }

  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const key = dailyReportMergeKey(item.store, item.date);
    const dbData = dbMap.get(key);

    const ym = formatPgDateOnly(item.date).slice(0, 7);
    const targetConfig = monthlyTargets.find((t) =>
      String(t?.ym || t?.month || '').trim() === ym &&
      String(t?.store || '').trim() === String(item?.store || '').trim()
    );

    return {
      ...item,
      submitterName: resolveRealName(item?.submittedBy || item?.submitted_by || ''),
      updaterName: resolveRealName(item?.updatedBy || item?.updated_by || ''),
      data: {
        ...(item.data || {}),
        target_margin: targetConfig?.targets?.margin || null,
        dianping_rating: dbData?.dianping_rating ?? item?.data?.dianping_rating ?? null,
        new_wechat_members: dbData?.new_wechat_members ?? item?.data?.new_wechat_members ?? 0,
        wechat_month_total: dbData?.wechat_month_total ?? item?.data?.wechat_month_total ?? 0,
        operational_anomaly_note:
          dbData?.operational_anomaly_note ?? item?.data?.operational_anomaly_note ?? ''
      }
    };
  });
}

export async function queryWechatMonthBase(pool, { store, date, tenantIdQ }) {
  if (!store || !date) return 0;
  try {
    const monthStart = `${String(date).slice(0, 7)}-01`;
    const baseR = await pool.query(
      `SELECT COALESCE(SUM(new_wechat_members), 0) AS base
             FROM daily_reports
             WHERE TRIM(store) = TRIM($1::text)
               AND date >= $2::date
               AND date < ($2::date + INTERVAL '1 month')
               AND date <> $3::date
               AND tenant_id = $4`,
      [store, monthStart, date, tenantIdQ]
    );
    return Number(baseR.rows?.[0]?.base || 0);
  } catch (_e) {
    return 0;
  }
}

export async function runListDailyReports(deps, params) {
  const {
    pool,
    getSharedState,
    stateFindUserRecord,
    inDateRange,
    log,
  } = deps;
  const {
    username,
    role,
    date,
    start,
    end,
    storeQ,
    limit,
    allowedStores,
    currentStore,
    tenantId,
  } = params;

  const state0 = (await getSharedState()) || {};
  const me = stateFindUserRecord(state0, username) || {};
  const myStore = String(me?.store || '').trim();

  const nameMap = buildDailyReportNameMap(state0);
  const resolveRealName = (uname) => {
    const k = String(uname || '').trim().toLowerCase();
    return nameMap.get(k) || String(uname || '').trim() || '';
  };

  const store = resolveListDailyReportsStoreFilter({
    role,
    storeQ,
    allowedStores,
    currentStore,
    myStore,
  });

  let items = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
  items = filterStateDailyReports(items, { store, date, start, end, inDateRange });

  const { pgMergeStart, pgMergeEnd, pgMergeLatestLimit } = resolvePgMergeWindow({ date, start, end, limit });
  const tenantIdQ = tenantId || 'default';

  if (pgMergeStart && pgMergeEnd) {
    try {
      items = await mergeDailyReportsFromPgRange(pool, items, {
        pgMergeStart,
        pgMergeEnd,
        store,
        tenantIdQ,
      });
    } catch (e) {
      log.error({ msg: 'daily_reports_pg_merge_failed', err: e?.message || String(e) });
    }
  } else if (pgMergeLatestLimit > 0) {
    try {
      items = await mergeDailyReportsFromPgLatest(pool, items, {
        pgMergeLatestLimit,
        store,
        tenantIdQ,
      });
    } catch (e) {
      log.error({ msg: 'daily_reports_pg_merge_latest_failed', err: e?.message || String(e) });
    }
  }

  const stSettings = state0.settings && typeof state0.settings === 'object' ? state0.settings : {};
  const monthlyTargets = Array.isArray(stSettings.monthlyTargets) ? stSettings.monthlyTargets : [];
  items = await enrichDailyReportItemsWithDb(pool, items, {
    monthlyTargets,
    tenantIdQ,
    resolveRealName,
    log,
  });

  items.sort((a, b) =>
    String(b?.date || '').localeCompare(String(a?.date || '')) ||
    String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''))
  );
  items = items.slice(0, limit);

  const wechat_month_base = await queryWechatMonthBase(pool, { store, date, tenantIdQ });
  return { items, wechat_month_base };
}
