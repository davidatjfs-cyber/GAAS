/**
 * Daily-reports HTTP routes (behavior-preserving extract from index.js).
 * registerDailyReportsRoutes(app, deps)
 */
import {
  bindDailyReportsRuntimeDeps,
  canAccessDailyReports,
  canWriteDailyReports,
  recalcWechatMonthTotalsForStoreMonth,
  upsertDailyReportPgFromStateReport,
} from './helpers.js';
import {
  listDailyReports,
  queryPrivateRoomMonthTotal,
  deleteDailyReportFromState,
  syncSubmittedDailyReportsToPg,
} from './service.js';
import { randomUUID } from 'crypto';
import { reconcileDailyReportAttendanceRegister } from '../../daily-attendance-register.js';

export { canAccessDailyReports, canWriteDailyReports, dailyReportItemFromPgRow } from './helpers.js';

export function registerDailyReportsRoutes(app, deps) {
  const {
    pool,
    authRequired,
    getSharedState,
    mergeSharedStateFields,
    safeDateOnly,
    stateFindUserRecord,
    expandAgentStoreLabels,
    inDateRange,
    hrmsNowISO,
    notifyAdminsDualWriteFailure,
    safeErrMessage,
    isAdmin,
    addStateNotification,
    makeNotif,
  } = deps;

  bindDailyReportsRuntimeDeps({
    pool,
    hrmsNowISO,
    safeDateOnly,
    getSharedState,
  });

  // 本月包房累计（仅洪潮品牌）
  app.get('/api/daily-reports/private-room-month-total', authRequired, async (req, res) => {
    const store = String(req.query?.store || '').trim();
    const month = String(req.query?.month || '').trim(); // YYYY-MM
    if (!store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.json({ total: 0 });
    }
    try {
      const { total } = await queryPrivateRoomMonthTotal({
        pool,
        store,
        month,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        expandAgentStoreLabels,
      });
      return res.json({ total });
    } catch (e) {
      console.error('[private-room-month-total]', e?.message);
      return res.json({ total: 0 });
    }
  });

  app.get('/api/daily-reports', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!canAccessDailyReports(role)) return res.status(403).json({ error: 'forbidden' });

    const date = safeDateOnly(req.query?.date);
    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    const storeQ = String(req.query?.store || '').trim();
    const limit = Math.min(2000, Math.max(1, Number(req.query?.limit || 200)));

    try {
      const payload = await listDailyReports({
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
        allowedStores: Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [],
        currentStore: String(req.user?.current_store || '').trim(),
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      });
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/daily-reports', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!canWriteDailyReports(role)) return res.status(403).json({ error: 'forbidden' });

    const date = safeDateOnly(req.body?.date);
    if (!date) return res.status(400).json({ error: 'missing_date' });

    try {
      const state0 = (await getSharedState()) || {};
      const me = stateFindUserRecord(state0, username) || {};
      const myStore = String(me?.store || '').trim();

      let store = String(req.body?.store || '').trim();
      const _allowedStoresDR = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStoreDR = String(req.user?.current_store || '').trim();
      if (role === 'store_manager') {
        store = (store && _allowedStoresDR.includes(store)) ? store : (_currentStoreDR || myStore);
      } else if (role === 'store_production_manager' || role === 'front_manager') {
        store = myStore;
      }
      if (!store) return res.status(400).json({ error: 'missing_store' });

      const payload = req.body?.data && typeof req.body.data === 'object' ? req.body.data : {};
      const operationalAnomalyNote = String(
        payload?.operational_anomaly_note ?? payload?.operationalAnomalyNote ?? ''
      )
        .trim()
        .slice(0, 4000);
      const wantSubmit = !!req.body?.submitted;
      const now = hrmsNowISO();

      const list = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
      const idx = list.findIndex(r => String(r?.store || '').trim() === store && String(r?.date || '').trim() === date);

      let item;
      /** 本次请求若执行了 daily_reports 双写且抛错，则必须失败返回，避免「HRMS 已提交、PG 无行」 */
      let lastPgDualWriteError = null;
      let shouldNotifySchedule = false;
      if (idx >= 0) {
        const prev = list[idx] || {};

        const alreadySubmitted = !!(prev?.submittedAt || prev?.submitted);
        if (alreadySubmitted && role === 'store_manager') {
          return res.status(403).json({ error: 'locked' });
        }

        const submittedAt = prev?.submittedAt || prev?.submitted_at || null;
        const submittedBy = prev?.submittedBy || prev?.submitted_by || null;
        const nextSubmittedAt = (wantSubmit && !submittedAt) ? now : submittedAt;
        const nextSubmittedBy = (wantSubmit && !submittedBy) ? username : submittedBy;
        shouldNotifySchedule = !!(wantSubmit && !submittedAt);

        const brand = String(payload?.brand || '').trim();

        item = {
          ...prev,
          store,
          date,
          data: payload,
          updatedAt: now,
          updatedBy: username
        };

        // 营业日报 → PostgreSQL：仅「正式提交」或「已提交后的再保存」时双写；草稿只留在 hrms_state，避免 PG 被半成品污染
        const shouldSyncDailyReportsPg = !!wantSubmit || alreadySubmitted;
        if (shouldSyncDailyReportsPg) {
        try {
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

          // 全量字段提取
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
            req.tenantId || req.user?.tenant_id || 'default'
          ]);
          await recalcWechatMonthTotalsForStoreMonth(pool, store, date, req.tenantId || req.user?.tenant_id || 'default');
          try {
            await reconcileDailyReportAttendanceRegister(pool, {
              store,
              brand,
              reportDate: date,
              staffPayload: payload?.staff || {},
              laborTotal: laborTotalVal,
              tenantId: req.tenantId || req.user?.tenant_id || 'default'
            });
          } catch (re) {
            console.warn('[daily_report_attendance_register]', store, date, re?.message);
          }
        } catch (e) {
          lastPgDualWriteError = lastPgDualWriteError || e;
          console.error('[daily_report_update]', e.message);
          // 底线：PG 双写失败必须通知管理员（飞书 + CRITICAL 日志），与返回 502 并行
          void notifyAdminsDualWriteFailure(`daily_reports（营业日报 PG 同步·更新 ${store} ${date}）`, e);
        }
        }

        if (wantSubmit || submittedAt) {
          item.submittedAt = nextSubmittedAt;
          item.submittedBy = nextSubmittedBy;
        }
        list.splice(idx, 1);
        list.unshift(item);
      } else {
        item = {
          id: randomUUID(),
          store,
          date,
          data: payload,
          createdAt: now,
          createdBy: username,
          updatedAt: now,
          updatedBy: username
        };

        if (wantSubmit) {
          item.submittedAt = now;
          item.submittedBy = username;
        }

        // 新建营业日报 → PG：仅在本请求带「正式提交」时双写；首次仅保存草稿不写 PG
        const shouldSyncNewDailyReportPg = !!wantSubmit;
        if (shouldSyncNewDailyReportPg) {
        try {
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
          const deliveryActual = Number(payload?.delivery?.eleme?.actual || 0) + Number(payload?.delivery?.meituan?.actual || 0);
          const deliveryOrders = Math.floor(Number(payload?.delivery?.eleme?.orders || 0)) + Math.floor(Number(payload?.delivery?.meituan?.orders || 0));
          const deliveryPreRevenue = Number(payload?.delivery?.eleme?.revenue || 0) + Number(payload?.delivery?.meituan?.revenue || 0);
          const deliveryBadReviews = Math.floor(Number(payload?.badReviews?.meituan || 0)) + Math.floor(Number(payload?.badReviews?.eleme || 0));
          const privateRoomUses = Math.max(0, Math.floor(Number(payload?.private_room_uses) || 0));
          const rechargeCount = Math.max(0, Math.floor(Number(payload?.recharge?.count) || 0));
          const rechargeAmount = Number(payload?.recharge?.amount) || 0;

          // 全量字段提取
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
            store,
            String(payload?.brand || '').trim(),
            date,
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
            req.tenantId || req.user?.tenant_id || 'default'
          ]);
          await recalcWechatMonthTotalsForStoreMonth(pool, store, date, req.tenantId || req.user?.tenant_id || 'default');
          try {
            await reconcileDailyReportAttendanceRegister(pool, {
              store,
              brand: String(payload?.brand || '').trim(),
              reportDate: date,
              staffPayload: payload?.staff || {},
              laborTotal: laborTotalVal,
              tenantId: req.tenantId || req.user?.tenant_id || 'default'
            });
          } catch (re) {
            console.warn('[daily_report_attendance_register]', store, date, re?.message);
          }
        } catch (e) {
          lastPgDualWriteError = lastPgDualWriteError || e;
          console.error('[daily_report_insert]', e.message);
          // 底线：PG 双写失败必须通知管理员（飞书 + CRITICAL 日志），与返回 502 并行
          void notifyAdminsDualWriteFailure(`daily_reports（营业日报 PG 同步·新建 ${store} ${date}）`, e);
        }
        }

        shouldNotifySchedule = !!wantSubmit;
        list.unshift(item);
      }

      if (lastPgDualWriteError) {
        return res.status(502).json({
          error: 'pg_sync_failed',
          message: String(lastPgDualWriteError.message || lastPgDualWriteError),
          hint:
            'PostgreSQL 表 daily_reports 双写失败：前端状态未保存。晨报/考勤/Agent 均依赖该表与 hrms_state 一致；请重试提交或联系管理员查看 HRMS 日志 [daily_report_*]、数据库约束与 DATABASE_URL。'
        });
      }

      let nextState = { ...state0, dailyReports: list };

      if (shouldNotifySchedule) {
        const allUsers = [
          ...(Array.isArray(state0.employees) ? state0.employees : []),
          ...(Array.isArray(state0.users) ? state0.users : [])
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
              reportId: item?.id || ''
            }));
          });
        };

        const schedule = payload?.scheduleNextDay && typeof payload.scheduleNextDay === 'object' ? payload.scheduleNextDay : {};
        notifyShift(schedule?.morningStaff, '早班', 'morning');
        notifyShift(schedule?.afternoonStaff, '午班', 'afternoon');
      }

      // 原子合并 dailyReports + notifications，避免 saveSharedState 全量写回与并发请求互相覆盖
      // dailyReports 以 store+date 为去重 key
      const drPatches = Array.isArray(nextState.dailyReports) ? nextState.dailyReports : [];
      const notifPatches = Array.isArray(nextState.notifications) ? nextState.notifications : [];
      try {
        await mergeSharedStateFields(
          { dailyReports: drPatches, notifications: notifPatches },
          { dailyReports: ['store', 'date'], notifications: 'id' }
        );
      } catch (mergeErr) {
        void notifyAdminsDualWriteFailure('daily_reports（营业日报 state 合并）', mergeErr);
        return res.status(502).json({ error: 'state_merge_failed', message: safeErrMessage(mergeErr) });
      }
      return res.json({ item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.delete('/api/daily-reports', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!isAdmin(role)) return res.status(403).json({ error: 'forbidden' });

    const store = String(req.query?.store || '').trim();
    const date = safeDateOnly(req.query?.date);
    if (!store) return res.status(400).json({ error: 'missing_store' });
    if (!date) return res.status(400).json({ error: 'missing_date' });

    try {
      const result = await deleteDailyReportFromState({
        store,
        date,
        getSharedState,
        mergeSharedStateFields,
        notifyAdminsDualWriteFailure,
        safeErrMessage,
      });
      if (result.error) {
        return res.status(502).json({ error: result.error, message: result.message });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  /** admin：从 hrms_state 将「已提交」营业日报强制 UPSERT 到 daily_reports（不修改 state，用于补 PG） */
  app.post('/api/admin/sync-submitted-daily-reports-pg', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden', message: '仅 admin 或 hq_manager' });
    }
    const date = safeDateOnly(req.body?.date);
    const storeFilter = String(req.body?.store || '').trim();
    if (!date) {
      return res.status(400).json({ error: 'missing_date', hint: 'JSON body: { "date": "2026-04-11", "store": "可选精确店名" }' });
    }
    try {
      const payload = await syncSubmittedDailyReportsToPg({
        date,
        storeFilter,
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
        getSharedState,
        safeDateOnly,
        upsertDailyReportPgFromStateReport,
        notifyAdminsDualWriteFailure,
        safeErrMessage,
      });
      return res.json(payload);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
