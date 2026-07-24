/**
 * Pure daily-reports logic (no req/res).
 */
import {
  formatPgDateOnly,
  dailyReportMergeKey,
  dailyReportItemFromPgRow,
  mergeDailyReportItemWithPgRow,
} from './helpers.js';

export async function listDailyReports({
  pool,
  getSharedState,
  stateFindUserRecord,
  inDateRange,
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
}) {
  const state0 = (await getSharedState()) || {};
  const me = stateFindUserRecord(state0, username) || {};
  const myStore = String(me?.store || '').trim();

  const allPeople = [...(Array.isArray(state0.employees) ? state0.employees : []), ...(Array.isArray(state0.users) ? state0.users : [])];
  const nameMap = new Map();
  allPeople.forEach(p => {
    const u = String(p?.username || '').trim().toLowerCase();
    const n = String(p?.name || '').trim();
    if (u && n && !nameMap.has(u)) nameMap.set(u, n);
  });
  const resolveRealName = (uname) => { const k = String(uname || '').trim().toLowerCase(); return nameMap.get(k) || String(uname || '').trim() || ''; };

  const _allowedStores7834 = Array.isArray(allowedStores) ? allowedStores : [];
  const _currentStore7834 = String(currentStore || '').trim();
  const _restrictedRoles7834 = ['store_manager', 'store_production_manager', 'front_manager'];
  const store = _restrictedRoles7834.includes(role)
    ? (storeQ && _allowedStores7834.includes(storeQ) ? storeQ : (_currentStore7834 || myStore))
    : storeQ;
  let items = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
  if (store) items = items.filter(r => String(r?.store || '').trim() === String(store).trim());
  if (date) {
    items = items.filter(r => String(r?.date || '').trim() === String(date).trim());
  } else if (start || end) {
    items = items.filter(r => inDateRange(String(r?.date || '').trim(), start, end));
  }

  items = items.filter(r => r && typeof r === 'object');

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
  const tenantIdQ = tenantId || 'default';
  if (pgMergeStart && pgMergeEnd) {
    try {
      const args = [pgMergeStart, pgMergeEnd];
      let sql = `
            SELECT store, date, brand, actual_revenue, pre_discount_revenue, total_discount,
                   dine_orders, dine_revenue, dine_traffic, efficiency, labor_total,
                   actual_margin, gross_profit, dianping_rating, new_wechat_members, wechat_month_total,
                   private_room_uses, operational_anomaly_note, delivery_pre_revenue, delivery_actual,
                   delivery_orders, delivery_bad_reviews, budget, budget_rate, submitted, submitted_at, updated_at,
                   recharge_count, recharge_amount,
                   weather, segments, discount_dine, discount_delivery, categories, delivery_detail,
                   bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch
            FROM daily_reports
            WHERE date >= $1::date AND date <= $2::date`;
      if (store) {
        sql += ` AND TRIM(store) = TRIM($3::text)`;
        args.push(String(store).trim());
      }
      args.push(tenantIdQ);
      sql += ` AND tenant_id = $${args.length}`;
      const pgR = await pool.query(sql, args);
      for (const row of pgR.rows) {
        const k = dailyReportMergeKey(row.store, row.date);
        const idx = items.findIndex(i => i && dailyReportMergeKey(i.store, i.date) === k);
        if (idx < 0) items.push(dailyReportItemFromPgRow(row));
        else items[idx] = mergeDailyReportItemWithPgRow(items[idx], row);
      }
    } catch (e) {
      console.error('[daily-reports pg merge]', e?.message);
    }
  } else if (pgMergeLatestLimit > 0) {
    try {
      const args = [];
      let sql = `
            SELECT store, date, brand, actual_revenue, pre_discount_revenue, total_discount,
                   dine_orders, dine_revenue, dine_traffic, efficiency, labor_total,
                   actual_margin, gross_profit, dianping_rating, new_wechat_members, wechat_month_total,
                   private_room_uses, operational_anomaly_note, delivery_pre_revenue, delivery_actual,
                   delivery_orders, delivery_bad_reviews, budget, budget_rate, submitted, submitted_at, updated_at,
                   recharge_count, recharge_amount,
                   weather, segments, discount_dine, discount_delivery, categories, delivery_detail,
                   bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch
            FROM daily_reports
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
      for (const row of pgR.rows) {
        const k = dailyReportMergeKey(row.store, row.date);
        const idx = items.findIndex(i => i && dailyReportMergeKey(i.store, i.date) === k);
        if (idx < 0) items.push(dailyReportItemFromPgRow(row));
        else items[idx] = mergeDailyReportItemWithPgRow(items[idx], row);
      }
    } catch (e) {
      console.error('[daily-reports pg merge latest]', e?.message);
    }
  }

  const stSettings = state0.settings && typeof state0.settings === 'object' ? state0.settings : {};
  const monthlyTargets = Array.isArray(stSettings.monthlyTargets) ? stSettings.monthlyTargets : [];

  if (items.length > 0) {
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
      console.error('[daily-reports db enrichment]', e?.message || e);
    }

    items = items.map(item => {
      if (!item || typeof item !== 'object') return item;
      const key = dailyReportMergeKey(item.store, item.date);
      const dbData = dbMap.get(key);

      const ym = formatPgDateOnly(item.date).slice(0, 7);
      const targetConfig = monthlyTargets.find(t =>
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

  items.sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')) || String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || '')));
  items = items.slice(0, limit);

  let wechat_month_base = 0;
  if (store && date) {
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
      wechat_month_base = Number(baseR.rows?.[0]?.base || 0);
    } catch (_e) { /* ignore */ }
  }
  return { items, wechat_month_base };
}

export async function queryPrivateRoomMonthTotal({
  pool,
  store,
  month,
  tenantId,
  expandAgentStoreLabels,
}) {
  if (!store || !month) {
    return { total: 0 };
  }

  const labels = [...new Set(expandAgentStoreLabels(store).map((s) => String(s || '').trim()).filter(Boolean))];
  const patterns = labels.map((s) => `%${s.replace(/%/g, '')}%`);
  const tenantIdQ = tenantId || 'default';

  let r = await pool.query(
    `SELECT COALESCE(SUM(private_room_uses), 0)::int AS total
     FROM daily_reports
     WHERE TO_CHAR(date::date,'YYYY-MM') = $1
       AND TRIM(store) = ANY($2::text[])
       AND tenant_id = $3`,
    [month, labels, tenantIdQ]
  );
  let total = parseInt(r.rows?.[0]?.total || 0, 10);
  if (!total) {
    r = await pool.query(
      `SELECT COALESCE(SUM(private_room_uses), 0)::int AS total
       FROM daily_reports
       WHERE TO_CHAR(date::date,'YYYY-MM') = $1
         AND TRIM(store) ILIKE ANY($2::text[])
         AND tenant_id = $3`,
      [month, patterns, tenantIdQ]
    );
    total = parseInt(r.rows?.[0]?.total || 0, 10);
  }
  return { total };
}

export async function deleteDailyReportFromState({
  store,
  date,
  getSharedState,
  mergeSharedStateFields,
  notifyAdminsDualWriteFailure,
  safeErrMessage,
}) {
  const state0 = (await getSharedState()) || {};
  const list = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
  const next = list.filter(r => !(String(r?.store || '').trim() === store && String(r?.date || '').trim() === date));
  try {
    await mergeSharedStateFields(
      { dailyReports: next },
      { dailyReports: ['store', 'date'] }
    );
  } catch (mergeErr) {
    void notifyAdminsDualWriteFailure('daily_reports（营业日报删除 state 合并）', mergeErr);
    return { error: 'state_merge_failed', message: safeErrMessage(mergeErr) };
  }
  return { ok: true };
}

export async function syncSubmittedDailyReportsToPg({
  date,
  storeFilter,
  tenantId,
  getSharedState,
  safeDateOnly,
  upsertDailyReportPgFromStateReport,
  notifyAdminsDualWriteFailure,
  safeErrMessage,
}) {
  const state0 = (await getSharedState()) || {};
  const list = Array.isArray(state0.dailyReports) ? state0.dailyReports : [];
  const results = [];
  for (const dr of list) {
    const d = safeDateOnly(dr?.date);
    const st = String(dr?.store || '').trim();
    if (d !== date) continue;
    if (storeFilter && st !== storeFilter) continue;
    const submitted = !!(dr?.submittedAt || dr?.submitted_at || dr?.submitted);
    if (!submitted) continue;
    try {
      await upsertDailyReportPgFromStateReport(dr, tenantId || 'default');
      results.push({ store: st, date: d, ok: true });
    } catch (e) {
      const msg = safeErrMessage(e);
      void notifyAdminsDualWriteFailure(`daily_reports（admin 补写 PG ${st} ${d}）`, e);
      results.push({ store: st, date: d, ok: false, error: msg });
    }
  }
  return {
    ok: true,
    date,
    storeFilter: storeFilter || null,
    matched: results.length,
    results,
  };
}
