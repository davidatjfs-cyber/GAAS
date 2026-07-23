/**
 * Daily-reports HTTP routes (behavior-preserving extract from index.js).
 * registerDailyReportsRoutes(app, deps)
 */
import {
  bindDailyReportsRuntimeDeps,
  canAccessDailyReports,
  canWriteDailyReports,
  formatPgDateOnly,
  dailyReportMergeKey,
  dailyReportItemFromPgRow,
  mergeDailyReportItemWithPgRow,
  recalcWechatMonthTotalsForStoreMonth,
  upsertDailyReportPgFromStateReport,
} from './helpers.js';
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
      const labels = [...new Set(expandAgentStoreLabels(store).map((s) => String(s || '').trim()).filter(Boolean))];
      const patterns = labels.map((s) => `%${s.replace(/%/g, '')}%`);

      const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
      // 先按规范店名/别名做精确匹配，再退化到 ILIKE ANY，兼容洪潮门店双轨写法。
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
      const state0 = (await getSharedState()) || {};
      const me = stateFindUserRecord(state0, username) || {};
      const myStore = String(me?.store || '').trim();

      // 构建 username→真名 映射表
      const allPeople = [...(Array.isArray(state0.employees) ? state0.employees : []), ...(Array.isArray(state0.users) ? state0.users : [])];
      const nameMap = new Map();
      allPeople.forEach(p => {
        const u = String(p?.username || '').trim().toLowerCase();
        const n = String(p?.name || '').trim();
        if (u && n && !nameMap.has(u)) nameMap.set(u, n);
      });
      const resolveRealName = (uname) => { const k = String(uname || '').trim().toLowerCase(); return nameMap.get(k) || String(uname || '').trim() || ''; };

      const _allowedStores7834 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore7834 = String(req.user?.current_store || '').trim();
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

      // state.dailyReports 若含 null/非对象，后面 findIndex(i => dailyReportMergeKey(i.store,...)) 会读 i.store 抛 TypeError → 整接口 500
      items = items.filter(r => r && typeof r === 'object');

      // 合并 PostgreSQL daily_reports：默认列表场景也要补并最近已落库数据。
      // 否则一旦 hrms_state.dailyReports 断档，前端会从某一天开始整段“消失”。
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
          args.push(req.tenantId || req.user?.tenant_id || 'default');
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
          args.push(req.tenantId || req.user?.tenant_id || 'default');
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
    
      // 从系统设置获取目标值并合并到数据中
      const stSettings = state0.settings && typeof state0.settings === 'object' ? state0.settings : {};
      const monthlyTargets = Array.isArray(stSettings.monthlyTargets) ? stSettings.monthlyTargets : [];
    
      // 从数据库补全点评/企微等（与下方 items.map 合并；勿再单独跑未规范化日期的 unnest 查询，易 PG 报错→整接口 500）
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
            // 仅 YYYY-MM-DD 进 unnest::date，避免脏数据导致 PG 报错（错误已 try 包住，但可少一次无效查询）
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
              [pairStores, pairDates, req.tenantId || req.user?.tenant_id || 'default']
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

          // 从monthlyTargets查找当月目标（与 key 一致用规范 YYYY-MM）
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

      // 企微累计基数: 当查询指定门店+日期时，返回该月「当前日期之前」的企微新增合计（避免 YYYY-MM-31 非法日期导致查询失败→基数恒为 0）
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
            [store, monthStart, date, req.tenantId || req.user?.tenant_id || 'default']
          );
          wechat_month_base = Number(baseR.rows?.[0]?.base || 0);
        } catch (_e) { /* ignore */ }
      }
      return res.json({ items, wechat_month_base });
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
      const state0 = (await getSharedState()) || {};
      const list = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
      const next = list.filter(r => !(String(r?.store || '').trim() === store && String(r?.date || '').trim() === date));
      // 原子合并 dailyReports，避免 saveSharedState 全量写回与并发请求互相覆盖
      try {
        await mergeSharedStateFields(
          { dailyReports: next },
          { dailyReports: ['store', 'date'] }
        );
      } catch (mergeErr) {
        void notifyAdminsDualWriteFailure('daily_reports（营业日报删除 state 合并）', mergeErr);
        return res.status(502).json({ error: 'state_merge_failed', message: safeErrMessage(mergeErr) });
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
          await upsertDailyReportPgFromStateReport(dr, req.tenantId || req.user?.tenant_id || 'default');
          results.push({ store: st, date: d, ok: true });
        } catch (e) {
          const msg = safeErrMessage(e);
          void notifyAdminsDualWriteFailure(`daily_reports（admin 补写 PG ${st} ${d}）`, e);
          results.push({ store: st, date: d, ok: false, error: msg });
        }
      }
      return res.json({
        ok: true,
        date,
        storeFilter: storeFilter || null,
        matched: results.length,
        results
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
