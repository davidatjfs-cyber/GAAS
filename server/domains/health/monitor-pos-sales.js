/**
 * Extracted from createListenMonitors — P5.4.
 */
import { childLogger } from '../../utils/logger.js';
import { wasRecentlyFiredPersisted, markFiredPersisted } from './monitor-beat.js';
const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

export function schedulePosSalesCheck(deps) {
  const {
    pool, runForActiveTenants, runWithBootstrapTenantContext: _runWithBootstrapTenantContext, getSharedState,
    mergeSharedStateFields: _mergeSharedStateFields, purgeExpiredCache: _purgeExpiredCache, upsertLeaveDomainFromState: _upsertLeaveDomainFromState,
    upsertPayrollDomainFromState: _upsertPayrollDomainFromState, getExpectedMonthlyPerformancePeriodShanghai: _getExpectedMonthlyPerformancePeriodShanghai,
    countEligibleMonthlyPerformanceUsers: _countEligibleMonthlyPerformanceUsers, leaveAttendanceHelpers: _leaveAttendanceHelpers, safeErrMessage: _safeErrMessage,
    allowSchemaChanges: _allowSchemaChanges, setIntervalFn = setInterval, setTimeoutFn: _setTimeoutFn = setTimeout,
    beatHeartbeat, sendSystemAlert,
    isPosSalesCheckWindow, isLeaveCumulativeSnapshotWindow: _isLeaveCumulativeSnapshotWindow,
    findMissingPosStores, expectedStoresFromState,
    dailyReportItemFromPgRow: _dailyReportItemFromPgRow,
    DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN: _DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN, filterStaleHeartbeats: _filterStaleHeartbeats,
    formatStaleHeartbeatDeadLabel: _formatStaleHeartbeatDeadLabel, staleHeartbeatDedupeKey: _staleHeartbeatDedupeKey,
  } = deps;

// ── P0-2: 每天 23:30 检查销售数据完整性 ──────────────
// 用 setInterval 每5分钟检查时间窗口
// 原用 runWithBootstrapTenantContext 只处理default租户，改为遍历活跃租户各自检查；
// 去重标记也从单一值改为按租户区分的 Map。
// 2026-08-01 修复：上面这个 Map 是进程内状态，pm2 restart 就清零——生产实测一天内因为
// 部署多次重启，同一个"缺失门店"检查在23:30~23:35窗口内被触发了4次，插入4条一模一样的
// "销售数据缺失告警"，用户被迫反复点掉"同一条"通知。改成读写 scheduler_heartbeat 表
// 持久化去重，重启不再清零判断依据（cooldown 20小时，比窗口长但不到24小时，避免真的
// 隔天还没查过）。
setIntervalFn(async () => {
  try {
  await runForActiveTenants(async (tenantId) => {
    const now = new Date();
    // 每天 23:30~23:35 触发一次
    if (!isPosSalesCheckWindow(now)) return;
    const dedupeKey = `pos_sales_check_fired_${tenantId}`;
    if (await wasRecentlyFiredPersisted(pool, dedupeKey, 20 * 60)) return;
    await markFiredPersisted(pool, dedupeKey);

    try {
      // 获取昨天日期（sales_raw已下线，改查pos_sales_detail视图，一般T+1检查）
      const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
      const r = await pool.query(
        `SELECT DISTINCT store FROM pos_sales_detail WHERE date = $1`,
        [yesterday]
      );
      const presentStores = r.rows.map(row => String(row.store || '').trim());

      // 预期门店列表：门店经理的店铺归属存在 hrms_state 的员工名单里(state.employees/state.users)，
      // 不在 SQL users 表(该表只有 role/is_active，没有 store/status 列，此前一直查错表导致这里天天报错)
      const state = (await getSharedState(tenantId)) || {};
      const expectedStores = expectedStoresFromState(state);
      const missing = findMissingPosStores(expectedStores, presentStores);

      await beatHeartbeat('pos_sales_check');

      if (missing.length > 0) {
        const msg = [
          `⚠️ [HRMS] 销售数据缺失告警`,
          `租户：${tenantId}`,
          `检查日期：${yesterday}`,
          `缺失门店：${missing.join('、')}`,
          `已有数据：${presentStores.join('、') || '无'}`,
          `销售明细已改为自动同步（pos_order_items），如持续缺失请检查该门店的POS同步是否中断。`
        ].join('\n');
        log.error({ msg: 'monitor', detail: ['[monitor] pos_sales_detail missing stores:', tenantId, missing].map((x) => (x == null ? '' : String(x))).join(' ') });
        await sendSystemAlert(msg);
      } else {
        log.info({ msg: 'monitor', detail: [`[monitor] sales check OK for tenant=${tenantId} ${yesterday}: ${presentStores.join('、')}`].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
    } catch (e) {
      log.error({ msg: 'monitor', detail: ['[monitor] sales check error:', tenantId, e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
    }
  }, { continueOnError: true });
  } catch (e) {
    log.error({ msg: 'monitor', detail: ['[monitor] sales check runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
  }
}, 5 * 60 * 1000);
}
