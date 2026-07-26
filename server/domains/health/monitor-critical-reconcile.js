/**
 * Extracted from createListenMonitors — P5.4.
 */
import { childLogger } from '../../utils/logger.js';
const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

export function scheduleCriticalDataReconcile(deps) {
  const {
    pool, runForActiveTenants, runWithBootstrapTenantContext: _runWithBootstrapTenantContext, getSharedState,
    mergeSharedStateFields, purgeExpiredCache: _purgeExpiredCache, upsertLeaveDomainFromState,
    upsertPayrollDomainFromState, getExpectedMonthlyPerformancePeriodShanghai,
    countEligibleMonthlyPerformanceUsers, leaveAttendanceHelpers: _leaveAttendanceHelpers, safeErrMessage: _safeErrMessage,
    allowSchemaChanges: _allowSchemaChanges, setIntervalFn = setInterval, setTimeoutFn: _setTimeoutFn = setTimeout,
    beatHeartbeat, sendSystemAlert,
    isPosSalesCheckWindow: _isPosSalesCheckWindow, isLeaveCumulativeSnapshotWindow: _isLeaveCumulativeSnapshotWindow,
    isPastMonthlyPerformanceCloseWindow,
    findMissingPosStores: _findMissingPosStores, expectedStoresFromState: _expectedStoresFromState,
    dailyReportItemFromPgRow,
    DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN: _DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN, filterStaleHeartbeats: _filterStaleHeartbeats,
    formatStaleHeartbeatDeadLabel: _formatStaleHeartbeatDeadLabel, staleHeartbeatDedupeKey: _staleHeartbeatDedupeKey,
  } = deps;

// 原为单一字符串，改为按租户区分的Map，避免A租户的告警状态误挡住B租户
const _perfMonthlyMissingAlertKey = new Map();

// 核心数据每 10 分钟自愈回灌一次：即使 hrms_state 被旧快照污染，也会从权威表/独立域自动拉回
// 原用 runWithBootstrapTenantContext 只处理default租户；daily_reports/point_records等查询本身
// 靠pool的RLS会话变量自动按租户过滤，但getSharedState()/hrms_state.key='default'是硬编码的，
// 改为遍历活跃租户各自处理各自的hrms_state.key。
setIntervalFn(async () => {
  try {
  await runForActiveTenants(async (tenantId) => {
    try {
      await beatHeartbeat('critical_data_reconcile');
      const stateNow = (await getSharedState(tenantId)) || {};

    // 1) 营业日报：若 state 最新日期落后于表最新日期，则整段重建
    const drLatestR = await pool.query(`SELECT MAX(date)::text AS latest FROM daily_reports`);
    const drLatest = String(drLatestR.rows?.[0]?.latest || '').trim();
    const stateDrLatest = (Array.isArray(stateNow.dailyReports) ? stateNow.dailyReports : [])
      .map(r => String(r?.date || '').slice(0, 10))
      .filter(Boolean)
      .sort()
      .pop() || '';
    if (drLatest && drLatest > stateDrLatest) {
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
      // 保留 state 中的草稿（DB 没有的行），避免直接覆写丢失
      const existingArr = Array.isArray(stateNow.dailyReports) ? stateNow.dailyReports : [];
      const dbKeySet = new Set(dbItems.map(x => `${x.date}|${x.store}`));
      const stateOnlyItems = existingArr.filter(r => {
        const k = `${String(r?.date || '').slice(0, 10)}|${String(r?.store || '').trim()}`;
        return !dbKeySet.has(k);
      });
      const finalItems = [...dbItems, ...stateOnlyItems];
      // 直接 UPDATE hrms_state 的 dailyReports 字段，不经过 mergeSharedStateFields（避免与用户提交抢乐观锁）
      await pool.query(
        `UPDATE hrms_state SET data = jsonb_set(COALESCE(data, '{}'), '{dailyReports}', $1::jsonb), updated_at = NOW() WHERE key = $2`,
        [JSON.stringify(finalItems), tenantId]
      );
      await sendSystemAlert(`⚠️ [HRMS] 核心数据自愈：租户${tenantId} 营业日报 state 最新日期 ${stateDrLatest || '无'} 落后于表 ${drLatest}，已自动回灌。`);
    }

    // 2) 积分：若 point_records 数量大于 state.pointRecords，则自动重建
    const prCountR = await pool.query(`SELECT COUNT(*)::int AS c FROM point_records`);
    const dbPrCount = Number(prCountR.rows?.[0]?.c || 0);
    const statePrCount = Array.isArray(stateNow.pointRecords) ? stateNow.pointRecords.length : 0;
    if (dbPrCount > statePrCount) {
      const prRows = await pool.query(`
        SELECT id::text, approval_id, username, name, store, item_name, reason, points, amount, approved_at, approved_by
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
      await mergeSharedStateFields({ pointRecords: dbPrItems }, { pointRecords: 'id' });
      await sendSystemAlert(`⚠️ [HRMS] 核心数据自愈：积分记录 state=${statePrCount} 落后于表=${dbPrCount}，已自动回灌。`);
    }

    // 3) 绩效月结果：10 日关账窗口后，若应产出的月度绩效结果明显缺失，第一时间通知管理员。
    const shParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const shDay = Number(shParts.find((p) => p.type === 'day')?.value || '0');
    const shHour = Number(shParts.find((p) => p.type === 'hour')?.value || '0');
    // agents-service-v2 月度成绩单在每月10日 01:18 写入；此前告警属于误报窗口。
    const pastMonthlyCloseWindow = isPastMonthlyPerformanceCloseWindow(shDay, shHour);
    if (pastMonthlyCloseWindow) {
      const period = getExpectedMonthlyPerformancePeriodShanghai();
      const eligibleCount = await countEligibleMonthlyPerformanceUsers().catch(() => 0);
      if (eligibleCount > 0) {
        const perfCountR = await pool.query(
          `SELECT COUNT(*)::int AS c
           FROM agent_scores
           WHERE period = $1 AND score_model = 'new_model_monthly'`,
          [period]
        );
        const actualCount = Number(perfCountR.rows?.[0]?.c || 0);
        const minimumExpected = Math.max(1, Math.floor(eligibleCount * 0.8));
        const alertKey = `${period}:${eligibleCount}:${actualCount}`;
        if (actualCount < minimumExpected && _perfMonthlyMissingAlertKey.get(tenantId) !== alertKey) {
          _perfMonthlyMissingAlertKey.set(tenantId, alertKey);
          await sendSystemAlert([
            '🚨 [HRMS] 月度绩效结果缺失告警',
            `租户：${tenantId}`,
            `周期：${period}`,
            `应有人员（估算）：${eligibleCount}`,
            `已写入结果：${actualCount}`,
            '说明：月度绩效关账或结果写入可能未完成，员工端/管理端看到的绩效结果可能不完整。',
            '请立即检查 agents-service-v2 的 monthly_comprehensive_rating（每月10日01:18）、agent_scores 表。'
          ].join('\n'));
        }
        if (actualCount >= minimumExpected) {
          _perfMonthlyMissingAlertKey.delete(tenantId);
        }
      }
    }

    // 4) 欠休域 / 5) 薪资域：确保独立域始终跟随当前 state
      await upsertLeaveDomainFromState((await getSharedState(tenantId)) || {});
      await upsertPayrollDomainFromState((await getSharedState(tenantId)) || {});
    } catch (e) {
      log.error({ msg: 'monitor', detail: ['[monitor] critical data reconcile error:', tenantId, e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
    }
  }, { continueOnError: true });
  } catch (e) {
    log.error({ msg: 'monitor', detail: ['[monitor] critical data reconcile runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
  }
}, 10 * 60 * 1000);
}
