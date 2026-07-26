/**
 * Pure daily-reports logic (no req/res).
 */
import { randomUUID } from 'crypto';
import { childLogger } from '../../utils/logger.js';
import {
  resolveDailyReportStore,
  applyScheduleNotifications,
  upsertDailyReportItem,
} from './upsert-schedule-notify-helpers.js';
import { runListDailyReports } from './list-daily-reports-helpers.js';

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

  const store = resolveDailyReportStore({
    role,
    bodyStore,
    allowedStores,
    currentStore,
    myStore,
  });
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

  let lastPgDualWriteError = null;

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

  const upsertResult = await upsertDailyReportItem({
    list,
    idx,
    prev: idx >= 0 ? list[idx] : null,
    store,
    date,
    payload,
    username,
    now,
    wantSubmit,
    role,
    uuidFn,
    syncPg,
  });
  if (upsertResult.error) return upsertResult;

  const { item, shouldNotifySchedule } = upsertResult;

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
    nextState = applyScheduleNotifications({
      state0,
      nextState,
      payload,
      store,
      date,
      item,
      stateFindUserRecord,
      addStateNotification,
      makeNotif,
    });
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

export async function listDailyReports(params) {
  return runListDailyReports({ ...params, log }, params);
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
