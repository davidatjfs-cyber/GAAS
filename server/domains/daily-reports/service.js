/**
 * Pure daily-reports logic (no req/res).
 */
import { randomUUID } from 'crypto';
import { childLogger } from '../../utils/logger.js';
import {
  formatPgDateOnly,
  dailyReportMergeKey,
  dailyReportItemFromPgRow,
  mergeDailyReportItemWithPgRow,
} from './helpers.js';

const log = childLogger({ domain: 'daily-reports', handler: 'service' });

const PG_SYNC_FAILED_HINT =
  'PostgreSQL 表 daily_reports 双写失败：前端状态未保存。晨报/考勤/Agent 均依赖该表与 hrms_state 一致；请重试提交或联系管理员查看 HRMS 日志 [daily_report_*]、数据库约束与 DATABASE_URL。';

export async function syncDailyReportRowToPg({
  pool,
  store,
  brand,
  date,
  payload,
  operationalAnomalyNote,
  tenantId,
  recalcWechatMonthTotalsForStoreMonth,
  reconcileDailyReportAttendanceRegister,
}) {
  const todayWechat = Math.max(0, Math.floor(Number(payload?.new_wechat_members) || 0));
  const dineOrders = Math.floor(Number(payload?.dine?.orders) || 0);
  const dineRevenue = Number(payload?.dine?.revenue) || 0;
  const dineTraffic = Math.floor(Number(payload?.dine?.traffic) || 0);
  const preDiscountRevenue = Number(payload?.gross) || 0;
  const totalDiscount = Number(payload?.discount?.total) || 0;
  const efficiencyVal = Number(payload?.efficiency) || 0;
  const laborTotalVal = Number(payload?.laborTotal) || 0;
  const grossProfit = Number(payload?.margin) || 0;
  const budgetVal = Number(payload?.budget) || 0;
  const budgetRateVal = Number(payload?.budgetRate) || 0;
  const deliveryElemeRev = Number(payload?.delivery?.eleme?.revenue) || 0;
  const deliveryMeituanRev = Number(payload?.delivery?.meituan?.revenue) || 0;
  const deliveryActual = Number(payload?.delivery?.eleme?.actual || 0) + Number(payload?.delivery?.meituan?.actual || 0);
  const deliveryOrders = Math.floor(Number(payload?.delivery?.eleme?.orders || 0)) + Math.floor(Number(payload?.delivery?.meituan?.orders || 0));
  const deliveryPreRevenue = deliveryElemeRev + deliveryMeituanRev;
  const deliveryBadReviews = Math.floor(Number(payload?.badReviews?.meituan || 0)) + Math.floor(Number(payload?.badReviews?.eleme || 0));
  const privateRoomUses = Math.max(0, Math.floor(Number(payload?.private_room_uses) || 0));
  const rechargeCount = Math.max(0, Math.floor(Number(payload?.recharge?.count) || 0));
  const rechargeAmount = Number(payload?.recharge?.amount) || 0;

  const weather = String(payload?.weather || '').trim() || null;
  const holidaySwitch = !!(payload?.holiday_switch ?? payload?.holidaySwitch);
  const segments = payload?.segments ? JSON.stringify(payload.segments) : null;
  const discountDine = Number(payload?.discount?.dine) || 0;
  const discountDelivery = Number(payload?.discount?.delivery) || 0;
  const categories = payload?.categories ? JSON.stringify(payload.categories) : null;
  const deliveryDetail = payload?.delivery ? JSON.stringify(payload.delivery) : null;
  const badReviewsDianping = Math.floor(Number(payload?.badReviews?.dianping) || 0);
  const staff = payload?.staff ? JSON.stringify(payload.staff) : null;
  const scheduleNextDay = payload?.scheduleNextDay ? JSON.stringify(payload.scheduleNextDay) : null;
  const photos = payload?.photos ? JSON.stringify(payload.photos) : null;

  const tenantIdQ = tenantId || 'default';

  await pool.query(`
    INSERT INTO daily_reports (store, brand, date, actual_revenue, actual_margin, dianping_rating, new_wechat_members, wechat_month_total, submitted, submitted_at,
      pre_discount_revenue, total_discount, dine_orders, dine_revenue, dine_traffic, efficiency, labor_total, gross_profit, budget, budget_rate,
      delivery_actual, delivery_orders, delivery_pre_revenue, delivery_bad_reviews, private_room_uses, operational_anomaly_note,
      recharge_count, recharge_amount,
      weather, segments, discount_dine, discount_delivery, categories, delivery_detail, bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch, tenant_id)
    /* $1/$2/$3 显式类型：避免 PG 对「VALUES 首列 varchar」与子查询中 $1::text 推断不一致 → inconsistent types for parameter $1 */
    VALUES ($1::text, $2::text, $3::date, $4, $5, $6, $7,
      COALESCE((
        SELECT SUM(dr.new_wechat_members)::bigint
        FROM daily_reports dr
        WHERE TRIM(dr.store) = TRIM($1::text)
          AND dr.date >= date_trunc('month', $3::date)::date
          AND dr.date < $3::date
          AND dr.tenant_id = $38
      ), 0) + $8::bigint,
      true, NOW(),
      $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26,
      $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)
    ON CONFLICT (store, date, tenant_id)
    DO UPDATE SET
      actual_revenue = EXCLUDED.actual_revenue,
      actual_margin = EXCLUDED.actual_margin,
      dianping_rating = EXCLUDED.dianping_rating,
      new_wechat_members = EXCLUDED.new_wechat_members,
      wechat_month_total = EXCLUDED.wechat_month_total,
      pre_discount_revenue = EXCLUDED.pre_discount_revenue,
      total_discount = EXCLUDED.total_discount,
      dine_orders = EXCLUDED.dine_orders,
      dine_revenue = EXCLUDED.dine_revenue,
      dine_traffic = EXCLUDED.dine_traffic,
      efficiency = EXCLUDED.efficiency,
      labor_total = EXCLUDED.labor_total,
      gross_profit = EXCLUDED.gross_profit,
      budget = EXCLUDED.budget,
      budget_rate = EXCLUDED.budget_rate,
      delivery_actual = EXCLUDED.delivery_actual,
      delivery_orders = EXCLUDED.delivery_orders,
      delivery_pre_revenue = EXCLUDED.delivery_pre_revenue,
      delivery_bad_reviews = EXCLUDED.delivery_bad_reviews,
      private_room_uses = EXCLUDED.private_room_uses,
      operational_anomaly_note = EXCLUDED.operational_anomaly_note,
      recharge_count = EXCLUDED.recharge_count,
      recharge_amount = EXCLUDED.recharge_amount,
      weather = EXCLUDED.weather,
      segments = EXCLUDED.segments,
      discount_dine = EXCLUDED.discount_dine,
      discount_delivery = EXCLUDED.discount_delivery,
      categories = EXCLUDED.categories,
      delivery_detail = EXCLUDED.delivery_detail,
      bad_reviews_dianping = EXCLUDED.bad_reviews_dianping,
      staff = EXCLUDED.staff,
      schedule_next_day = EXCLUDED.schedule_next_day,
      photos = EXCLUDED.photos,
      holiday_switch = EXCLUDED.holiday_switch,
      updated_at = NOW()
  `, [
    store, brand, date,
    payload?.actual || 0,
    payload?.margin || null,
    payload?.dianping_rating || null,
    todayWechat,
    todayWechat,
    preDiscountRevenue, totalDiscount, dineOrders, dineRevenue, dineTraffic,
    efficiencyVal, laborTotalVal, grossProfit, budgetVal, budgetRateVal,
    deliveryActual, deliveryOrders, deliveryPreRevenue, deliveryBadReviews,
    privateRoomUses,
    operationalAnomalyNote || null,
    rechargeCount, rechargeAmount,
    weather, segments, discountDine, discountDelivery, categories, deliveryDetail, badReviewsDianping, staff, scheduleNextDay, photos,
    holidaySwitch,
    tenantIdQ,
  ]);
  await recalcWechatMonthTotalsForStoreMonth(pool, store, date, tenantIdQ);
  try {
    await reconcileDailyReportAttendanceRegister(pool, {
      store,
      brand,
      reportDate: date,
      staffPayload: payload?.staff || {},
      laborTotal: laborTotalVal,
      tenantId: tenantIdQ,
    });
  } catch (re) {
    log.warn({
      msg: 'daily_report_attendance_register_failed',
      store,
      date,
      err: re?.message || String(re),
    });
  }
}

export async function upsertDailyReport({
  pool,
  getSharedState,
  mergeSharedStateFields,
  stateFindUserRecord,
  addStateNotification,
  makeNotif,
  notifyAdminsDualWriteFailure,
  safeErrMessage,
  hrmsNowISO,
  randomUUID: randomUUIDFn,
  recalcWechatMonthTotalsForStoreMonth,
  reconcileDailyReportAttendanceRegister,
  username,
  role,
  date,
  bodyStore,
  allowedStores,
  currentStore,
  dataPayload,
  wantSubmit,
  tenantId,
}) {
  const state0 = (await getSharedState()) || {};
  const me = stateFindUserRecord(state0, username) || {};
  const myStore = String(me?.store || '').trim();

  let store = String(bodyStore || '').trim();
  const _allowedStoresDR = Array.isArray(allowedStores) ? allowedStores : [];
  const _currentStoreDR = String(currentStore || '').trim();
  if (role === 'store_manager') {
    store = (store && _allowedStoresDR.includes(store)) ? store : (_currentStoreDR || myStore);
  } else if (role === 'store_production_manager' || role === 'front_manager') {
    store = myStore;
  }
  if (!store) return { error: 'missing_store', status: 400 };

  const payload = dataPayload && typeof dataPayload === 'object' ? dataPayload : {};
  const operationalAnomalyNote = String(
    payload?.operational_anomaly_note ?? payload?.operationalAnomalyNote ?? ''
  )
    .trim()
    .slice(0, 4000);
  const now = hrmsNowISO();
  const tenantIdQ = tenantId || 'default';
  const uuidFn = randomUUIDFn || randomUUID;

  const list = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
  const idx = list.findIndex(r => String(r?.store || '').trim() === store && String(r?.date || '').trim() === date);

  let item;
  let lastPgDualWriteError = null;
  let shouldNotifySchedule = false;

  const syncPg = async (pgNotifyLabel) => {
    try {
      await syncDailyReportRowToPg({
        pool,
        store,
        brand: String(payload?.brand || '').trim(),
        date,
        payload,
        operationalAnomalyNote,
        tenantId: tenantIdQ,
        recalcWechatMonthTotalsForStoreMonth,
        reconcileDailyReportAttendanceRegister,
      });
    } catch (e) {
      lastPgDualWriteError = lastPgDualWriteError || e;
      log.error({ msg: `daily_report_${pgNotifyLabel}_failed`, err: e?.message || String(e) });
      void notifyAdminsDualWriteFailure(`daily_reports（营业日报 PG 同步·${pgNotifyLabel === 'update' ? '更新' : '新建'} ${store} ${date}）`, e);
    }
  };

  if (idx >= 0) {
    const prev = list[idx] || {};

    const alreadySubmitted = !!(prev?.submittedAt || prev?.submitted);
    if (alreadySubmitted && role === 'store_manager') {
      return { error: 'locked', status: 403 };
    }

    const submittedAt = prev?.submittedAt || prev?.submitted_at || null;
    const submittedBy = prev?.submittedBy || prev?.submitted_by || null;
    const nextSubmittedAt = (wantSubmit && !submittedAt) ? now : submittedAt;
    const nextSubmittedBy = (wantSubmit && !submittedBy) ? username : submittedBy;
    shouldNotifySchedule = !!(wantSubmit && !submittedAt);

    item = {
      ...prev,
      store,
      date,
      data: payload,
      updatedAt: now,
      updatedBy: username,
    };

    const shouldSyncDailyReportsPg = !!wantSubmit || alreadySubmitted;
    if (shouldSyncDailyReportsPg) {
      await syncPg('update');
    }

    if (wantSubmit || submittedAt) {
      item.submittedAt = nextSubmittedAt;
      item.submittedBy = nextSubmittedBy;
    }
    list.splice(idx, 1);
    list.unshift(item);
  } else {
    item = {
      id: uuidFn(),
      store,
      date,
      data: payload,
      createdAt: now,
      createdBy: username,
      updatedAt: now,
      updatedBy: username,
    };

    if (wantSubmit) {
      item.submittedAt = now;
      item.submittedBy = username;
    }

    const shouldSyncNewDailyReportPg = !!wantSubmit;
    if (shouldSyncNewDailyReportPg) {
      await syncPg('insert');
    }

    shouldNotifySchedule = !!wantSubmit;
    list.unshift(item);
  }

  if (lastPgDualWriteError) {
    return {
      error: 'pg_sync_failed',
      status: 502,
      message: String(lastPgDualWriteError.message || lastPgDualWriteError),
      hint: PG_SYNC_FAILED_HINT,
    };
  }

  let nextState = { ...state0, dailyReports: list };

  if (shouldNotifySchedule) {
    const allUsers = [
      ...(Array.isArray(state0.employees) ? state0.employees : []),
      ...(Array.isArray(state0.users) ? state0.users : []),
    ];
    const byName = new Map();
    allUsers.forEach((x) => {
      const name = String(x?.name || '').trim();
      if (!name) return;
      byName.set(name.toLowerCase(), x);
    });

    const resolveRecipient = (raw) => {
      const username0 = String(raw?.user || raw?.username || raw?.userName || '').trim();
      const name0 = String(raw?.name || raw?.employeeName || '').trim();
      if (username0) {
        const rec = stateFindUserRecord(state0, username0) || {};
        const displayName = String(rec?.name || name0 || username0).trim() || username0;
        return { username: username0, name: displayName };
      }
      if (!name0) return null;
      const rec = byName.get(name0.toLowerCase()) || null;
      const username1 = String(rec?.username || '').trim();
      if (!username1) return null;
      const displayName = String(rec?.name || name0).trim() || username1;
      return { username: username1, name: displayName };
    };

    const notifyShift = (arr, shiftLabel, shiftKey) => {
      const seen = new Set();
      (Array.isArray(arr) ? arr : []).forEach((x) => {
        const rec = resolveRecipient(x);
        if (!rec?.username) return;
        const k = String(rec.username || '').trim().toLowerCase() + '||' + shiftKey;
        if (seen.has(k)) return;
        seen.add(k);
        const msg = `亲爱的${rec.name}，你是明天${shiftLabel}，请准时到岗并准时完成打卡考勤。`;
        nextState = addStateNotification(nextState, makeNotif(rec.username, '排班通知', msg, {
          type: 'schedule_notice',
          store,
          date,
          shift: shiftKey,
          reportId: item?.id || '',
        }));
      });
    };

    const schedule = payload?.scheduleNextDay && typeof payload.scheduleNextDay === 'object' ? payload.scheduleNextDay : {};
    notifyShift(schedule?.morningStaff, '早班', 'morning');
    notifyShift(schedule?.afternoonStaff, '午班', 'afternoon');
  }

  const drPatches = Array.isArray(nextState.dailyReports) ? nextState.dailyReports : [];
  const notifPatches = Array.isArray(nextState.notifications) ? nextState.notifications : [];
  try {
    await mergeSharedStateFields(
      { dailyReports: drPatches, notifications: notifPatches },
      { dailyReports: ['store', 'date'], notifications: 'id' }
    );
  } catch (mergeErr) {
    void notifyAdminsDualWriteFailure('daily_reports（营业日报 state 合并）', mergeErr);
    return { error: 'state_merge_failed', status: 502, message: safeErrMessage(mergeErr) };
  }
  return { ok: true, item };
}

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
      log.error({ msg: 'daily_reports_pg_merge_failed', err: e?.message || String(e) });
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
      log.error({ msg: 'daily_reports_pg_merge_latest_failed', err: e?.message || String(e) });
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
      log.error({ msg: 'daily_reports_db_enrichment_failed', err: e?.message || String(e) });
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
