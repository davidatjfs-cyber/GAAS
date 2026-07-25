/**
 * Daily-reports domain helpers (behavior-preserving extract from index.js).
 * bindDailyReportsRuntimeDeps(deps) must be called from registerDailyReportsRoutes.
 */
import { randomUUID } from 'crypto';
import { reconcileDailyReportAttendanceRegister } from '../../daily-attendance-register.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'daily-reports', handler: 'helpers' });

export let pool;
export let hrmsNowISO;
export let safeDateOnly;
export let getSharedState;

export function bindDailyReportsRuntimeDeps(deps) {
  pool = deps.pool;
  hrmsNowISO = deps.hrmsNowISO;
  safeDateOnly = deps.safeDateOnly;
  getSharedState = deps.getSharedState;
}

export function canAccessDailyReports(role) {
  const r = String(role || '').trim();
  return r === 'admin' || r === 'hq_manager' || r === 'store_manager' || r === 'store_production_manager' || r === 'front_manager' || r === 'front_supervisor';
}

export function canWriteDailyReports(role) {
  const r = String(role || '').trim();
  return r === 'admin' || r === 'store_manager' || r === 'front_manager' || r === 'front_supervisor';
}

export function formatPgDateOnly(v) {
  if (v == null) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export function dailyReportMergeKey(store, dateVal) {
  return `${String(store || '').trim()}|${formatPgDateOnly(dateVal)}`;
}

/** 将 daily_reports 行转为与前端 / hrms_state 一致的日报条目（供列表合并） */
export function dailyReportItemFromPgRow(row) {
  const date = formatPgDateOnly(row.date);
  const store = String(row.store || '').trim();
  const pre = row.pre_discount_revenue != null ? Number(row.pre_discount_revenue) : 0;
  const disc = row.total_discount != null ? Number(row.total_discount) : 0;
  const delPre = Number(row.delivery_pre_revenue) || 0;
  const delAct = Number(row.delivery_actual) || 0;
  const delOrd = Math.floor(Number(row.delivery_orders) || 0);
  const _badRev = Math.floor(Number(row.delivery_bad_reviews) || 0);
  const submittedAt = row.submitted_at
    ? (row.submitted_at instanceof Date ? row.submitted_at.toISOString() : String(row.submitted_at))
    : null;

  // 解析 JSONB 字段（PostgreSQL JSONB 返回 JS 对象，不需要 JSON.parse）
  const parseJsonb = (val, fallback) => {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return fallback; } }
    return val; // 已经是对象/数组
  };
  const segments = parseJsonb(row.segments, {});
  const categories = parseJsonb(row.categories, {});
  const deliveryDetail = parseJsonb(row.delivery_detail, {});
  const staff = parseJsonb(row.staff, {});
  const scheduleNextDay = parseJsonb(row.schedule_next_day, {});
  const photos = parseJsonb(row.photos, []);

  // 外卖明细：优先用 delivery_detail，其次用聚合值
  const eleme = deliveryDetail?.eleme || { revenue: 0, actual: 0, orders: 0, targetRevenue: 0 };
  const meituan = deliveryDetail?.meituan || { revenue: delPre, actual: delAct, orders: delOrd, targetRevenue: 0 };

  // 差评明细
  const badReviewsDianping = Math.floor(Number(row.bad_reviews_dianping) || 0);

  const data = {
    brand: String(row.brand || '').trim(),
    actual: Number(row.actual_revenue) || 0,
    margin: row.actual_margin != null ? Number(row.actual_margin) : null,
    dianping_rating: row.dianping_rating != null ? Number(row.dianping_rating) : null,
    new_wechat_members: Math.floor(Number(row.new_wechat_members) || 0),
    wechat_month_total: Math.floor(Number(row.wechat_month_total) || 0),
    gross: pre,
    weather: String(row.weather || '').trim() || undefined,
    holiday_switch: !!row.holiday_switch,
    discount: {
      total: disc,
      dine: Number(row.discount_dine) || 0,
      delivery: Number(row.discount_delivery) || 0
    },
    dine: {
      orders: Math.floor(Number(row.dine_orders) || 0),
      revenue: Number(row.dine_revenue) || 0,
      traffic: Math.floor(Number(row.dine_traffic) || 0)
    },
    segments,
    categories,
    delivery: { eleme, meituan },
    badReviews: {
      dianping: badReviewsDianping,
      meituan: Math.floor(Number(row.delivery_bad_reviews) || 0),
      eleme: 0
    },
    efficiency: Number(row.efficiency) || 0,
    laborTotal: Number(row.labor_total) || 0,
    private_room_uses: Math.floor(Number(row.private_room_uses) || 0),
    operational_anomaly_note: String(row.operational_anomaly_note || '').trim(),
    budget: Number(row.budget) || 0,
    budgetRate: Number(row.budget_rate) || 0,
    recharge: {
      count: Math.floor(Number(row.recharge_count) || 0),
      amount: Number(row.recharge_amount) || 0
    },
    staff,
    scheduleNextDay,
    photos
  };
  return {
    id: randomUUID(),
    store,
    date,
    data,
    submitted: !!row.submitted || Number(row.actual_revenue) > 0,
    submittedAt,
    submittedBy: null,
    createdAt: submittedAt || hrmsNowISO(),
    updatedAt: row.updated_at
      ? (row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at))
      : submittedAt || hrmsNowISO(),
    _mergedFromPostgres: true
  };
}

/** 合并日报明细数组：优先采用非空的一方；均有值时取条数更多的一方（便于用 PG 恢复被 state 截断的 staff/photos） */
export function mergeDailyReportDetailArrays(prevArr, nextArr) {
  const a = Array.isArray(prevArr) ? prevArr : [];
  const b = Array.isArray(nextArr) ? nextArr : [];
  if (!a.length) return b;
  if (!b.length) return a;
  return b.length >= a.length ? b : a;
}

/**
 * 同一门店+日期：将 PostgreSQL daily_reports 行与 hrms_state 中已有条目合并，
 * 避免 state 中缺 staff/scheduleNextDay/photos 时盖住 PG 完整数据。
 */
export function mergeDailyReportItemWithPgRow(existingItem, pgRow) {
  if (!existingItem || typeof existingItem !== 'object') {
    return dailyReportItemFromPgRow(pgRow);
  }
  const pgItem = dailyReportItemFromPgRow(pgRow);
  const ed = existingItem?.data && typeof existingItem.data === 'object' ? existingItem.data : {};
  const pd = pgItem?.data && typeof pgItem.data === 'object' ? pgItem.data : {};
  const merged = { ...ed, ...pd };
  const pes = ed.staff && typeof ed.staff === 'object' ? ed.staff : {};
  const pgs = pd.staff && typeof pd.staff === 'object' ? pd.staff : {};
  const STAFF_ARR_KEYS = ['front', 'kitchen', 'restStaff', 'frontRestStaff', 'kitchenRestStaff'];
  merged.staff = { ...pes, ...pgs };
  STAFF_ARR_KEYS.forEach((k) => {
    merged.staff[k] = mergeDailyReportDetailArrays(pes[k], pgs[k]);
  });
  const esc = ed.scheduleNextDay && typeof ed.scheduleNextDay === 'object' ? ed.scheduleNextDay : {};
  const psc = pd.scheduleNextDay && typeof pd.scheduleNextDay === 'object' ? pd.scheduleNextDay : {};
  merged.scheduleNextDay = { ...esc, ...psc };
  ['staff', 'frontStaff', 'kitchenStaff', 'morningStaff', 'afternoonStaff'].forEach((k) => {
    merged.scheduleNextDay[k] = mergeDailyReportDetailArrays(esc[k], psc[k]);
  });
  merged.photos = mergeDailyReportDetailArrays(ed.photos, pd.photos);
  const tsPick = (a, b) => {
    const ta = Date.parse(a) || 0;
    const tb = Date.parse(b) || 0;
    return tb >= ta ? b : a;
  };
  return {
    ...existingItem,
    store: String(existingItem?.store || pgItem.store || '').trim(),
    date: String(existingItem?.date || pgItem.date || '').trim(),
    data: merged,
    updatedAt: tsPick(existingItem?.updatedAt, pgItem?.updatedAt),
    submittedAt: existingItem?.submittedAt || existingItem?.submitted_at || pgItem.submittedAt,
    submitted: !!(existingItem?.submitted ?? existingItem?.submitted_at ?? pgItem.submitted),
    _mergedFromPostgres: true
  };
}

/** 重算当月各日报行的 wechat_month_total（按日 running sum，修复「累计=当日」及补录后不一致） */
export async function recalcWechatMonthTotalsForStoreMonth(pool, store, anchorDate, tenantId) {
  const st = String(store || '').trim();
  const ymd = String(anchorDate || '').slice(0, 10);
  if (!st || ymd.length < 10) return;
  // 按自然月分区：[monthStart, nextMonth)；跨月后 anchor 落在下月即从下月 1 号重算，累计从 0 重新累加。
  const monthStart = `${ymd.slice(0, 7)}-01`;
  const tid = String(tenantId || '').trim() || 'default';
  try {
    await pool.query(
      `WITH sums AS (
         SELECT date::date AS d,
           SUM(COALESCE(new_wechat_members, 0)) OVER (ORDER BY date)::bigint AS cum
         FROM daily_reports
         WHERE TRIM(store) = TRIM($1::text)
           AND date >= $2::date
           AND date < ($2::date + INTERVAL '1 month')
           AND tenant_id = $3
       )
       UPDATE daily_reports dr
       SET wechat_month_total = LEAST(2147483647, GREATEST(0, sums.cum))::int
       FROM sums
       WHERE TRIM(dr.store) = TRIM($1::text) AND dr.date::date = sums.d AND dr.tenant_id = $3`,
      [st, monthStart, tid]
    );
  } catch (e) {
    log.error({ msg: 'wechat_month_total_recalc_failed', err: e?.message || String(e) });
  }
}

/**
 * 从 hrms_state 中的日报条目 UPSERT 到 PostgreSQL daily_reports（与 POST /api/daily-reports 正式提交双写字段一致）。
 * 供 admin 在「state 已提交但 PG 缺行」时补数，不修改 hrms_state。
 */
export async function upsertDailyReportPgFromStateReport(dr, tenantId) {
  const payload = dr?.data && typeof dr.data === 'object' ? dr.data : {};
  const store = String(dr?.store || '').trim();
  const date = safeDateOnly(dr?.date);
  if (!store || !date) throw new Error('missing_store_or_date');
  const operationalAnomalyNote = String(
    payload?.operational_anomaly_note ?? payload?.operationalAnomalyNote ?? ''
  )
    .trim()
    .slice(0, 4000);
  const brand = String(payload?.brand || '').trim();
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

  await pool.query(
    `
          INSERT INTO daily_reports (store, brand, date, actual_revenue, actual_margin, dianping_rating, new_wechat_members, wechat_month_total, submitted, submitted_at,
            pre_discount_revenue, total_discount, dine_orders, dine_revenue, dine_traffic, efficiency, labor_total, gross_profit, budget, budget_rate,
            delivery_actual, delivery_orders, delivery_pre_revenue, delivery_bad_reviews, private_room_uses, operational_anomaly_note,
            recharge_count, recharge_amount,
            weather, segments, discount_dine, discount_delivery, categories, delivery_detail, bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch, tenant_id)
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
        `,
    [
      store,
      brand,
      date,
      payload?.actual || 0,
      payload?.margin || null,
      payload?.dianping_rating || null,
      todayWechat,
      todayWechat,
      preDiscountRevenue,
      totalDiscount,
      dineOrders,
      dineRevenue,
      dineTraffic,
      efficiencyVal,
      laborTotalVal,
      grossProfit,
      budgetVal,
      budgetRateVal,
      deliveryActual,
      deliveryOrders,
      deliveryPreRevenue,
      deliveryBadReviews,
      privateRoomUses,
      operationalAnomalyNote || null,
      rechargeCount,
      rechargeAmount,
      weather,
      segments,
      discountDine,
      discountDelivery,
      categories,
      deliveryDetail,
      badReviewsDianping,
      staff,
      scheduleNextDay,
      photos,
      holidaySwitch,
      tenantId || 'default'
    ]
  );
  await recalcWechatMonthTotalsForStoreMonth(pool, store, date, tenantId);
  try {
    await reconcileDailyReportAttendanceRegister(pool, {
      store,
      brand,
      reportDate: date,
      staffPayload: payload?.staff || {},
      laborTotal: laborTotalVal,
      tenantId: tenantId || 'default'
    });
  } catch (re) {
    log.warn({
      msg: 'daily_report_attendance_register_failed',
      store,
      date,
      err: re?.message || String(re),
    });
  }
  // 闭环：日报保存后同步重算权威日结果（排班+打卡+休假）
  try {
    const { reconcileAttendanceDays } = await import('../../services/hrms-attendance-day.js');
    await reconcileAttendanceDays({
      tenantId: tenantId || 'default',
      store,
      startDate: date,
      endDate: date,
      db: pool,
      getSharedState
    });
  } catch (adErr) {
    log.warn({
      msg: 'hrms_attendance_day_reconcile_after_daily_report_failed',
      store,
      date,
      err: adErr?.message || String(adErr),
    });
  }
}
