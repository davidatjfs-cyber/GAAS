/**
 * Listen-time multi-tenant state↔DB reconcile (Wave M1 peel from index.js app.listen).
 * Each step is non-fatal; continueOnError across tenants.
 */
import { childLogger } from '../../utils/logger.js';
import {
  bindDailyReportsRuntimeDeps,
  dailyReportItemFromPgRow,
} from '../daily-reports/helpers.js';
import { domainJsonFieldEmpty } from './domain-json-empty.js';

const log = childLogger({ domain: 'shared', handler: 'startup-tenant-reconcile' });

/** Pure merge: DB base fields + state detail fields; keep state-only drafts. */
export function mergeDailyReportsForStartup(dbItems, existingArr) {
  const DETAIL_FIELDS = [
    'segments',
    'categories',
    'staff',
    'scheduleNextDay',
    'photos',
    'weather',
    'discount',
    'badReviews',
  ];
  const dbKeySet = new Set(dbItems.map((x) => `${x.date}|${x.store}`));
  const merged = dbItems.map((dbItem) => {
    const k = `${dbItem.date}|${dbItem.store}`;
    const stateItem = existingArr.find(
      (s) => `${String(s?.date || '').slice(0, 10)}|${String(s?.store || '').trim()}` === k
    );
    if (!stateItem?.data) return dbItem;
    const mergedData = { ...dbItem.data };
    for (const f of DETAIL_FIELDS) {
      const dbVal = dbItem.data[f];
      const stVal = stateItem.data[f];
      const dbEmpty =
        dbVal === undefined ||
        dbVal === null ||
        (typeof dbVal === 'object' && Object.keys(dbVal).length === 0) ||
        (Array.isArray(dbVal) && dbVal.length === 0);
      const stHas =
        stVal !== undefined &&
        stVal !== null &&
        (typeof stVal !== 'object' || Object.keys(stVal).length > 0) &&
        (!Array.isArray(stVal) || stVal.length > 0);
      if (dbEmpty && stHas) mergedData[f] = stVal;
    }
    return { ...dbItem, data: mergedData };
  });
  const stateOnlyItems = existingArr.filter((r) => {
    const k = `${String(r?.date || '').slice(0, 10)}|${String(r?.store || '').trim()}`;
    return !dbKeySet.has(k);
  });
  return { finalMerged: [...merged, ...stateOnlyItems], stateOnlyItems };
}

/** Pure merge: DB point_records authority; keep state-only ids not in DB. */
export function mergePointRecordsForStartup(dbPrItems, existingPr) {
  const dbPrIds = new Set(dbPrItems.map((x) => x.id));
  const stateOnlyPr = existingPr.filter((r) => r?.id && !dbPrIds.has(r.id));
  return { mergedPr: [...dbPrItems, ...stateOnlyPr], stateOnlyPr };
}

/**
 * @param {object} deps
 * @returns {() => Promise<{results: any[], errors: any[]}>}
 */
export function createStartupTenantReconcileRunner(deps) {
  const {
    pool,
    runForActiveTenants,
    getSharedState,
    mergeSharedStateFields,
    tenantContext,
    upsertPayrollDomainFromState,
    upsertLeaveDomainFromState,
    upsertEmployeesFromStateShape,
    loadEmployeesFromTable,
    hrmsNowISO,
    toNullableUuid,
    resolveTenantIdDefault,
    backfillDailyAttendanceRegisterMissing,
    dedupeGlobalSocialMediaPointRules,
    ensureGlobalSocialMediaPointRule,
    safeErrMessage,
  } = deps;

  return async function runStartupTenantReconcile() {
    // dailyReportItemFromPgRow 读 helpers 模块级 hrmsNowISO（由 routes 注册时 bind）
    bindDailyReportsRuntimeDeps({
      pool,
      hrmsNowISO,
      getSharedState,
      safeDateOnly: (v) => String(v || '').trim().slice(0, 10),
    });

    const startupTenantReconcile = await runForActiveTenants(async (tenantId) => {
    // 启动时权威重建：每次启动都从 daily_reports 表完整重建 hrms_state.dailyReports
    // 策略：DB 是基础字段（营收/订单等）的权威来源；但明细字段（segments/categories/staff/photos/schedule_next_day/weather/discount/bad_reviews）
    //       DB 从未写入过，必须从 state 保留，否则每次重启明细数据全部丢失。
    // 修复历史：raw row_to_json 写入导致 data.actual=0，pg date 时区偏移导致日期差1天
      try {
      const pgAll = await pool.query(`
        SELECT store, date, brand, actual_revenue, pre_discount_revenue, total_discount,
               dine_orders, dine_revenue, dine_traffic, efficiency, labor_total,
               actual_margin, gross_profit, dianping_rating, new_wechat_members, wechat_month_total,
               private_room_uses, operational_anomaly_note, delivery_pre_revenue, delivery_actual,
               delivery_orders, delivery_bad_reviews, budget, budget_rate, submitted, submitted_at, updated_at,
               recharge_count, recharge_amount,
               weather, segments, discount_dine, discount_delivery, categories, delivery_detail,
               bad_reviews_dianping, staff, schedule_next_day, photos, holiday_switch
        FROM daily_reports
        ORDER BY date DESC
      `);
      const dbItems = pgAll.rows.map(row => dailyReportItemFromPgRow(row));

      const state0 = (await getSharedState()) || {};
      const existingArr = Array.isArray(state0.dailyReports) ? state0.dailyReports : [];
      const { finalMerged, stateOnlyItems } = mergeDailyReportsForStartup(dbItems, existingArr);
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        const cur = await client2.query(`SELECT data FROM hrms_state WHERE key=$1 FOR UPDATE`, [tenantId]);
        const curData = cur.rows[0]?.data || {};
        await client2.query(
          `UPDATE hrms_state SET data=$2::jsonb, updated_at=NOW() WHERE key=$1`,
          [tenantId, JSON.stringify({ ...curData, dailyReports: finalMerged })]
        );
        await client2.query('COMMIT');
      } finally {
        client2.release();
      }
      log.info({ msg: 'startup', detail: [`[startup] 日报权威重建：DB ${dbItems.length} 条 + 草稿 ${stateOnlyItems.length} 条 = 共 ${finalMerged.length} 条`].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 日报权威重建失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 启动时权威重建：从 point_records 表完整重建 hrms_state.pointRecords
    // 策略：DB 表是唯一权威，覆盖 state 里所有同 id 的条目，保留 state 里没有 id 的孤立记录
      try {
      const prRows = await pool.query(`
        SELECT id::text, approval_id, username, name, store, item_name, reason,
               points, amount, approved_at, approved_by
        FROM point_records
        ORDER BY approved_at DESC NULLS LAST, created_at DESC
      `);
      const dbPrItems = prRows.rows.map(row => ({
        id: row.id,
        approvalId: row.approval_id || '',
        username: row.username || '',
        name: row.name || '',
        store: row.store || '',
        itemName: row.item_name || '',
        reason: row.reason || '',
        points: Number(row.points) || 0,
        amount: Number(row.amount) || 0,
        approvedAt: row.approved_at ? String(row.approved_at) : '',
        approvedBy: row.approved_by || '',
      }));
      const state1 = (await getSharedState()) || {};
      const existingPr = Array.isArray(state1.pointRecords) ? state1.pointRecords : [];
      const { mergedPr, stateOnlyPr } = mergePointRecordsForStartup(dbPrItems, existingPr);
      const client3 = await pool.connect();
      try {
        await client3.query('BEGIN');
        const cur3 = await client3.query(`SELECT data FROM hrms_state WHERE key=$1 FOR UPDATE`, [tenantId]);
        const curData3 = cur3.rows[0]?.data || {};
        await client3.query(
          `UPDATE hrms_state SET data=$2::jsonb, updated_at=NOW() WHERE key=$1`,
          [tenantId, JSON.stringify({ ...curData3, pointRecords: mergedPr })]
        );
        await client3.query('COMMIT');
      } finally {
        client3.release();
      }
      log.info({ msg: 'startup', detail: [`[startup] 积分记录权威重建：DB ${dbPrItems.length} 条 + 孤立 ${stateOnlyPr.length} 条 = 共 ${mergedPr.length} 条`].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 积分记录权威重建失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 考勤双表互备：checkin_records ↔ employee_attendance_records 补缺（防单表损坏）
      try {
      const insToMirror = await pool.query(`
        INSERT INTO employee_attendance_records (
          id, username, store, type, check_time, latitude, longitude, distance_meters,
          face_match, face_score, photo_url, status, note, confirmed_by, confirmed_at, created_at, synced_at
        )
        SELECT c.id, c.username, c.store, c.type, c.check_time::timestamptz, c.latitude, c.longitude, c.distance_meters,
               c.face_match, c.face_score, c.photo_url, c.status, c.note, c.confirmed_by, c.confirmed_at::timestamptz,
               c.created_at::timestamptz, NOW()
        FROM checkin_records c
        WHERE NOT EXISTS (SELECT 1 FROM employee_attendance_records e WHERE e.id = c.id)
      `);
      const insToCheckin = await pool.query(`
        INSERT INTO checkin_records (
          id, username, store, type, check_time, latitude, longitude, distance_meters,
          face_match, face_score, photo_url, status, note, confirmed_by, confirmed_at, created_at
        )
        SELECT e.id, e.username, e.store, e.type, e.check_time, e.latitude, e.longitude, e.distance_meters,
               e.face_match, e.face_score, e.photo_url, e.status, e.note, e.confirmed_by, e.confirmed_at, e.created_at
        FROM employee_attendance_records e
        WHERE NOT EXISTS (SELECT 1 FROM checkin_records c WHERE c.id = e.id)
      `);
      log.info({ msg: 'startup', detail: [
        `[startup] 考勤双表同步：→镜像 ${insToMirror.rowCount || 0} 条，→checkin ${insToCheckin.rowCount || 0} 条`
      ].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 考勤双表同步失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 薪资域双备：state 某字段空则从 hrms_payroll_domain 回灌，再写回独立表
      try {
      const domainR = await pool.query(`SELECT * FROM hrms_payroll_domain WHERE id = $1`, [tenantId]);
      const row = domainR.rows?.[0];
      if (row) {
        let stateP = (await getSharedState()) || {};
        let changed = false;
        const pairs = [
          ['payrollAdjustments', 'payroll_adjustments'],
          ['payrollAudits', 'payroll_audits'],
          ['salaryAdjustments', 'salary_adjustments'],
          ['monthlyConfirmations', 'monthly_confirmations']
        ];
        for (const [sk, col] of pairs) {
          const dbVal = row[col];
          const stVal = stateP[sk];
          if (domainJsonFieldEmpty(stVal) && !domainJsonFieldEmpty(dbVal)) {
            stateP = { ...stateP, [sk]: dbVal };
            changed = true;
          }
        }
        if (changed) {
          await pool.query(
            `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`,
            [tenantId, JSON.stringify(stateP)]
          );
          log.info({ msg: 'startup', detail: ['[startup] 薪资域从 hrms_payroll_domain 回灌到 hrms_state'].map((x) => (x == null ? '' : String(x))).join(' ') });
        }
      }
      const freshState = (await getSharedState()) || {};
      await upsertPayrollDomainFromState(freshState);
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 薪资域互备同步失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 欠休/累计假域双备：state 某字段空则从 hrms_leave_domain 回灌，再写回独立表
      try {
      const leaveDomainR = await pool.query(`SELECT * FROM hrms_leave_domain WHERE id = $1`, [tenantId]);
      const row = leaveDomainR.rows?.[0];
      if (row) {
        let stateL = (await getSharedState()) || {};
        let changed = false;
        const pairs = [
          ['leaveBalanceOverrides', 'leave_balance_overrides'],
          ['leaveBalanceAdjustments', 'leave_balance_adjustments'],
          ['leaveCumulativeCloseSnapshots', 'leave_cumulative_close_snapshots']
        ];
        for (const [sk, col] of pairs) {
          const dbVal = row[col];
          const stVal = stateL[sk];
          if (domainJsonFieldEmpty(stVal) && !domainJsonFieldEmpty(dbVal)) {
            stateL = { ...stateL, [sk]: dbVal };
            changed = true;
          }
        }
        if (changed) {
          await pool.query(
            `UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`,
            [tenantId, JSON.stringify(stateL)]
          );
          log.info({ msg: 'startup', detail: ['[startup] 欠休域从 hrms_leave_domain 回灌到 hrms_state'].map((x) => (x == null ? '' : String(x))).join(' ') });
        }
      }
      const freshLeaveState = (await getSharedState()) || {};
      await upsertLeaveDomainFromState(freshLeaveState);
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 欠休域互备同步失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // A1：启动时 state→表补齐；表中多出的账号回灌 state 镜像（GET 仍以表 hydrate 为准）
      try {
      const employeeSyncSummary = await tenantContext.run(tenantId, async () => {
          const stateEmp = (await getSharedState(tenantId)) || {};
          const empArr = Array.isArray(stateEmp.employees) ? stateEmp.employees : [];
          const syncedToTable = await upsertEmployeesFromStateShape(pool, tenantId, empArr);
          const dbEmpItems = await loadEmployeesFromTable(pool, tenantId);

          let backfilledToState = 0;
          if (dbEmpItems.length > 0) {
            const existingEmployees = Array.isArray(stateEmp.employees) ? stateEmp.employees : [];
            const existingUsernames = new Set(existingEmployees.map(e => String(e?.username || '').trim().toLowerCase()));
            const newEmps = dbEmpItems.filter(e => e.username && !existingUsernames.has(e.username.toLowerCase()));
            if (newEmps.length > 0) {
              await mergeSharedStateFields({ employees: newEmps }, { employees: 'username' }, tenantId);
              backfilledToState = newEmps.length;
            }
          }

          log.info({ msg: 'startup', detail: [`[startup][${tenantId}] 员工信息同步：${syncedToTable} 条 → employees 表；回灌 ${backfilledToState} 条 → hrms_state.employees`].map((x) => (x == null ? '' : String(x))).join(' ') });
          return { tenantId, syncedToTable, backfilledToState };
      });
      log.info({ msg: 'startup', detail: [`[startup][${tenantId}] 员工同步完成：写表 ${employeeSyncSummary.syncedToTable}，回灌 ${employeeSyncSummary.backfilledToState}`].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 多租户员工同步失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 启动时休假记录重建：hrms_leave_records DB → hrms_state.leaveRecords
      try {
      const dbLeave = await pool.query(`SELECT * FROM hrms_leave_records ORDER BY start_date DESC`);
      const dbLeaveItems = dbLeave.rows.map(r => ({
        id: String(r.id || ''),
        applicant: String(r.username || '').trim(),
        applicantName: String(r.name || '').trim(),
        store: String(r.store || '').trim(),
        brand: String(r.brand || '').trim(),
        startDate: r.start_date ? String(r.start_date).slice(0, 10) : '',
        endDate: r.end_date ? String(r.end_date).slice(0, 10) : '',
        days: r.days != null ? Number(r.days) : '',
        type: String(r.type || 'leave').trim(),
        reason: String(r.reason || '').trim(),
        createdAt: r.created_at ? String(r.created_at) : '',
        status: String(r.status || 'approved').trim()
      }));
      const dbLeaveKeySet = new Set(dbLeaveItems.map(x => `${x.applicant}|${x.startDate}|${x.endDate}`));
      let stateLeave = (await getSharedState()) || {};
      const existingLeave = Array.isArray(stateLeave.leaveRecords) ? stateLeave.leaveRecords : [];
      const stateOnlyLeave = existingLeave.filter(r => {
        const k = `${String(r?.applicant || '').trim()}|${String(r?.startDate || '').trim()}|${String(r?.endDate || '').trim()}`;
        return !dbLeaveKeySet.has(k);
      });
      const mergedLeave = [...dbLeaveItems, ...stateOnlyLeave];
      if (mergedLeave.length !== existingLeave.length) {
        stateLeave = { ...stateLeave, leaveRecords: mergedLeave };
        await pool.query(`UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`, [tenantId, JSON.stringify(stateLeave)]);
      }
      log.info({ msg: 'startup', detail: [`[startup] 休假记录重建：DB ${dbLeaveItems.length} 条 + 草稿 ${stateOnlyLeave.length} 条 = 共 ${mergedLeave.length} 条`].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 休假记录重建失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 启动时奖惩记录重建：hrms_reward_punishment_records DB → hrms_state.salaryAdjustments
      try {
      const dbRP = await pool.query(`SELECT * FROM hrms_reward_punishment_records WHERE status = 'active' ORDER BY created_at DESC`);
      const dbRPItems = dbRP.rows.map(r => ({
        id: String(r.id || ''),
        approvalId: String(r.approval_id || ''),
        targetUsername: String(r.username || '').trim(),
        targetName: String(r.name || '').trim(),
        type: String(r.type === 'reward' ? '奖励' : '惩罚').trim(),
        amount: Number(r.amount) || 0,
        signedAmount: r.type === 'reward' ? Math.abs(Number(r.amount) || 0) : -Math.abs(Number(r.amount) || 0),
        reason: String(r.reason || '').trim(),
        result: '',
        applicantUsername: String(r.created_by || '').trim(),
        applicantName: String(r.created_by || '').trim(),
        createdAt: r.created_at ? String(r.created_at) : '',
        status: 'approved'
      }));
      const dbRPKeySet = new Set(dbRPItems.map(x => x.id));
      let stateRP = (await getSharedState()) || {};
      const existingRP = Array.isArray(stateRP.salaryAdjustments) ? stateRP.salaryAdjustments : [];
      const stateOnlyRP = existingRP.filter(r => r?.id && !dbRPKeySet.has(r.id));
      const mergedRP = [...dbRPItems, ...stateOnlyRP];
      if (mergedRP.length !== existingRP.length) {
        stateRP = { ...stateRP, salaryAdjustments: mergedRP };
        await pool.query(`UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`, [tenantId, JSON.stringify(stateRP)]);
      }
      log.info({ msg: 'startup', detail: [`[startup] 奖惩记录重建：DB ${dbRPItems.length} 条 + 孤立 ${stateOnlyRP.length} 条 = 共 ${mergedRP.length} 条`].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 奖惩记录重建失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 启动时审批记录重建：approval_requests DB 已是权威，无需回灌 state（审批本身就是独立表）
    // 但确认表存在
      try {
      const arCheck = await pool.query(`SELECT COUNT(*) as cnt FROM approval_requests`);
      log.info({ msg: 'startup', detail: [`[startup] 审批记录表：${arCheck.rows[0]?.cnt || 0} 条`].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 审批记录表检查失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 启动时公司通知重建：hrms_user_notifications DB → hrms_state.notifications
    // V2 Agent 直接写 DB，HRMS 前端从 state 读取，需要回灌
    // 注意：前端按 targetUser 字段过滤，必须使用 targetUser 而非 targetUsername
      try {
      const dbNotif = await pool.query(`SELECT * FROM hrms_user_notifications ORDER BY created_at DESC LIMIT 500`);
      const dbNotifItems = dbNotif.rows.map(r => ({
        id: String(r.id || ''),
        targetUser: String(r.target_username || '').trim(),
        title: String(r.title || '').trim(),
        message: String(r.message || '').trim(),
        type: String(r.type || 'performance_deduction').trim(),
        meta: r.meta && typeof r.meta === 'object' ? r.meta : {},
        createdAt: r.created_at ? String(r.created_at) : ''
      }));
      if (dbNotifItems.length > 0) {
        let stateNotif = (await getSharedState()) || {};
        const existingNotifs = Array.isArray(stateNotif.notifications) ? stateNotif.notifications : [];
        const dbNotifIds = new Set(dbNotifItems.map(n => n.id));
        const stateOnlyNotifs = existingNotifs.filter(n => n?.id && !dbNotifIds.has(n.id));
        const mergedNotifs = [...dbNotifItems, ...stateOnlyNotifs];
        if (mergedNotifs.length !== existingNotifs.length) {
          stateNotif = { ...stateNotif, notifications: mergedNotifs };
          await pool.query(`UPDATE hrms_state SET data = $2::jsonb, updated_at = NOW() WHERE key = $1`, [tenantId, JSON.stringify(stateNotif)]);
        }
        log.info({ msg: 'startup', detail: [`[startup] 公司通知重建：DB ${dbNotifItems.length} 条 + 孤立 ${stateOnlyNotifs.length} 条 = 共 ${mergedNotifs.length} 条`].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 公司通知重建失败（非致命，不影响启动）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // ── 历史数据回填（state → DB，一次性补缺） ──

    // 回填：hrms_state.leaveRecords → hrms_leave_records
      try {
      const stateLR = (await getSharedState()) || {};
      const lrList = Array.isArray(stateLR.leaveRecords) ? stateLR.leaveRecords : [];
      if (lrList.length > 0) {
        const existingIds = await pool.query(`SELECT id::text FROM hrms_leave_records`);
        const existingSet = new Set(existingIds.rows.map(r => r.id));
        let backfillCount = 0;
        for (const lr of lrList) {
          const rid = String(lr?.id || '').trim();
          if (!rid || existingSet.has(rid)) continue;
          const startDate = String(lr?.startDate || '').trim();
          const endDate = String(lr?.endDate || '').trim();
          if (!startDate || !endDate) continue;
          await pool.query(
            `INSERT INTO hrms_leave_records (id, username, name, store, brand, start_date, end_date, days, type, reason, status, submitted_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11,$12)
             ON CONFLICT (id) DO NOTHING`,
            [rid, String(lr?.applicant || '').trim(), String(lr?.applicantName || lr?.name || '').trim(),
             String(lr?.store || '').trim(), String(lr?.brand || '').trim(),
             startDate, endDate, lr?.days != null && lr?.days !== '' ? Number(lr.days) : 0,
             String(lr?.type || 'leave').trim(), String(lr?.reason || '').trim(),
             String(lr?.createdAt || '').trim() || hrmsNowISO(), String(lr?.createdAt || '').trim() || hrmsNowISO()]
          );
          backfillCount++;
        }
        if (backfillCount > 0) log.info({ msg: 'startup', detail: [`[startup] 休假记录回填：${backfillCount} 条 state → hrms_leave_records`].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 休假记录回填失败（非致命）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 回填：hrms_state.salaryAdjustments → hrms_reward_punishment_records
    // 该表已开FORCE RLS；这段跑在app.listen启动回调里，没有HTTP请求/ALS上下文，
    // 必须显式包裹tenantContext.run，否则resolveTenantIdDefault()返回'default'但
    // session变量是fail-closed的sentinel，写入会被WITH CHECK拒绝。
      try {
      const stateSA = (await getSharedState()) || {};
      const saList = Array.isArray(stateSA.salaryAdjustments) ? stateSA.salaryAdjustments : [];
      if (saList.length > 0) {
        const existingIds = await pool.query(`SELECT id::text FROM hrms_reward_punishment_records`);
        const existingSet = new Set(existingIds.rows.map(r => r.id));
        let backfillCount = 0;
        for (const sa of saList) {
          const rid = String(sa?.id || '').trim();
          if (!rid || existingSet.has(rid)) continue;
          const rpType = String(sa?.type || '').trim();
          const isReward = rpType === '奖励' || rpType === 'reward';
          await pool.query(
            `INSERT INTO hrms_reward_punishment_records (id, username, name, store, brand, type, category, amount, reason, source, approval_id, status, created_by, created_at, tenant_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approval',$10,'active',$11,$12,$13)
             ON CONFLICT (id) DO NOTHING`,
            [rid, String(sa?.targetUsername || '').trim(), String(sa?.targetName || '').trim(),
             '', '', isReward ? 'reward' : 'punishment', rpType,
             Math.abs(Number(sa?.amount) || 0), String(sa?.reason || '').trim(),
             toNullableUuid(sa?.approvalId), String(sa?.applicantUsername || '').trim(),
             String(sa?.createdAt || '').trim() || hrmsNowISO(),
             resolveTenantIdDefault()]
          );
          backfillCount++;
        }
        if (backfillCount > 0) log.info({ msg: 'startup', detail: [`[startup] 奖惩记录回填：${backfillCount} 条 state → hrms_reward_punishment_records`].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 奖惩记录回填失败（非致命）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 回填：hrms_state.dailyReports → daily_reports 表（补充缺失的明细字段）
      try {
      const stateDR = (await getSharedState()) || {};
      const drList = Array.isArray(stateDR.dailyReports) ? stateDR.dailyReports : [];
      if (drList.length > 0) {
        let backfillCount = 0;
        for (const dr of drList) {
          const d = dr?.data;
          if (!d) continue;
          const store = String(dr?.store || '').trim();
          const date = String(dr?.date || '').trim().slice(0, 10);
          if (!store || !date) continue;

          const segments = d?.segments ? JSON.stringify(d.segments) : null;
          const categories = d?.categories ? JSON.stringify(d.categories) : null;
          const deliveryDetail = d?.delivery ? JSON.stringify(d.delivery) : null;
          const staff = d?.staff ? JSON.stringify(d.staff) : null;
          const scheduleNextDay = d?.scheduleNextDay ? JSON.stringify(d.scheduleNextDay) : null;
          const photos = d?.photos ? JSON.stringify(d.photos) : null;
          const weather = String(d?.weather || '').trim() || null;
          const holidaySwitch = !!(d?.holiday_switch ?? d?.holidaySwitch);
          const discountDine = Number(d?.discount?.dine) || 0;
          const discountDelivery = Number(d?.discount?.delivery) || 0;
          const badReviewsDianping = Math.floor(Number(d?.badReviews?.dianping) || 0);

          const hasDetail = segments || categories || deliveryDetail || staff || scheduleNextDay || photos || weather || discountDine || discountDelivery || holidaySwitch;
          if (!hasDetail) continue;

          await pool.query(
            `UPDATE daily_reports SET
               segments = COALESCE($3, segments),
               categories = COALESCE($4, categories),
               delivery_detail = COALESCE($5, delivery_detail),
               staff = COALESCE($6, staff),
               schedule_next_day = COALESCE($7, schedule_next_day),
               photos = COALESCE($8, photos),
               weather = COALESCE($9, weather),
               discount_dine = COALESCE($10, discount_dine),
               discount_delivery = COALESCE($11, discount_delivery),
               bad_reviews_dianping = COALESCE($12, bad_reviews_dianping),
               holiday_switch = COALESCE($13, holiday_switch),
               updated_at = NOW()
             WHERE store = $1 AND date = $2::date`,
            [store, date, segments, categories, deliveryDetail, staff, scheduleNextDay, photos, weather, discountDine, discountDelivery, badReviewsDianping, holidaySwitch]
          );
          backfillCount++;
        }
        if (backfillCount > 0) log.info({ msg: 'startup', detail: [`[startup] 营业日报明细回填：${backfillCount} 条 state → daily_reports`].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 营业日报明细回填失败（非致命）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

    // 补缺：daily_reports 已有但 daily_report_attendance_register 缺失（功能上线前提交的双写）
      try {
      const bf = await backfillDailyAttendanceRegisterMissing(pool, { maxRows: 2500 });
      if (bf.reconciled > 0) {
        log.info({ msg: 'startup', detail: [`[startup] 出勤台账补缺：扫描 ${bf.scanned} 条，写入 ${bf.reconciled} 条`].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
      } catch (e) {
        log.error({ msg: 'startup', detail: ['[startup] 出勤台账补缺失败（非致命）:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }

      await dedupeGlobalSocialMediaPointRules();
      await ensureGlobalSocialMediaPointRule();
    }, {
      continueOnError: true,
      onError: ({ tenantId, error }) => {
        log.error({ msg: 'startup', detail: [`[startup][${tenantId}] 租户数据重建失败（非致命）:`, safeErrMessage(error)].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
    });
    log.info({ msg: 'startup', detail: [`[startup] 多租户数据重建完成：成功 ${startupTenantReconcile.results.length}，失败 ${startupTenantReconcile.errors.length}`].map((x) => (x == null ? '' : String(x))).join(' ') });

    return startupTenantReconcile;
  };
}
