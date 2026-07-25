/**
 * Listen-time monitors: session purge, heartbeat, cache purge, critical reconcile,
 * POS sales check, leave-cumulative snapshot (Wave M2 peel from index.js app.listen).
 */
import { childLogger } from '../../utils/logger.js';
import {
  DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN,
  filterStaleHeartbeats,
  formatStaleHeartbeatDeadLabel,
  staleHeartbeatDedupeKey,
} from './scheduler-heartbeat.js';
import { dailyReportItemFromPgRow, bindDailyReportsRuntimeDeps } from '../daily-reports/helpers.js';

const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

/** Pure: POS sales check fires 23:30–23:34 local clock. */
export function isPosSalesCheckWindow(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  return h === 23 && m >= 30 && m <= 34;
}

/** Pure: Shanghai calendar parts for leave snapshot (day=01, hour=6, minute<15). */
export function isLeaveCumulativeSnapshotWindow(parts) {
  const gv = (t) => parts.find((x) => x.type === t)?.value || '';
  const d = gv('day');
  const h = Number(gv('hour'));
  const mi = Number(gv('minute'));
  return d === '01' && h === 6 && mi < 15;
}

/** Pure: after monthly performance close window (day>10 or day=10 hour>=2 Shanghai). */
export function isPastMonthlyPerformanceCloseWindow(shDay, shHour) {
  return shDay > 10 || (shDay === 10 && shHour >= 2);
}

/** Pure: expected store names missing from POS present list (4-char fuzzy). */
export function findMissingPosStores(expectedStores, presentStores) {
  return (expectedStores || []).filter(
    (es) => !presentStores.some((ps) => ps.includes(es.slice(0, 4)) || es.includes(ps.slice(0, 4)))
  );
}

/** Pure: collect expected stores from state employees/users (active store_managers). */
export function expectedStoresFromState(state) {
  const staffList = [].concat(
    Array.isArray(state?.employees) ? state.employees : [],
    Array.isArray(state?.users) ? state.users : []
  );
  return [
    ...new Set(
      staffList
        .filter(
          (x) =>
            String(x?.role || '').trim() === 'store_manager' &&
            String(x?.status || '').trim() !== '离职' &&
            String(x?.status || '').trim() !== 'inactive'
        )
        .map((x) => String(x?.store || '').trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * @param {object} deps
 * @returns {{ beatHeartbeat: Function, startListenMonitors: Function }}
 */
export function createListenMonitors(deps) {
  const {
    pool,
    runForActiveTenants,
    runWithBootstrapTenantContext,
    tenantContext,
    getSharedState,
    mergeSharedStateFields,
    purgeExpiredCache,
    sendAdminSystemAlert,
    upsertLeaveDomainFromState,
    upsertPayrollDomainFromState,
    getExpectedMonthlyPerformancePeriodShanghai,
    countEligibleMonthlyPerformanceUsers,
    leaveAttendanceHelpers,
    safeErrMessage,
    hrmsNowISO,
    allowSchemaChanges,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
  } = deps;

  async function beatHeartbeat(taskName) {
    try {
      await tenantContext.run('default', async () => {
        await pool.query(
          `INSERT INTO scheduler_heartbeat (task_name, last_beat, run_count, tenant_id)
           VALUES ($1, NOW(), 1, 'default')
           ON CONFLICT (task_name)
           DO UPDATE SET last_beat = NOW(), run_count = scheduler_heartbeat.run_count + 1`,
          [taskName]
        );
      });
    } catch (_) {
      /* ignore */
    }
  }

  async function sendSystemAlert(msg) {
    try {
      await sendAdminSystemAlert(msg, {
        persistToHrms: true,
        notificationType: 'system_alert',
        meta: { source: 'monitor' },
      });
    } catch (e) {
      log.error({
        msg: 'monitor',
        detail: ['[monitor] sendSystemAlert error:', e?.message]
          .map((x) => (x == null ? '' : String(x)))
          .join(' '),
      });
    }
  }

  async function startListenMonitors() {
    bindDailyReportsRuntimeDeps({
      pool,
      hrmsNowISO: hrmsNowISO || (() => new Date().toISOString()),
      getSharedState,
      safeDateOnly: (v) => String(v || '').trim().slice(0, 10),
    });


    // P0B: Purge expired session states every hour
    // 原用runWithBootstrapTenantContext只清default租户，agent_long_memory开了RLS，改为遍历活跃租户各自清理
    setIntervalFn(async () => {
      try {
        await runForActiveTenants(async (tenantId) => {
          try {
            const r = await pool.query(
              `DELETE FROM agent_long_memory
               WHERE memory_key = 'session_state'
                 AND updated_at < NOW() - INTERVAL '2 hours'`
            );
            if (r.rowCount > 0) log.info({ msg: 'monitor', detail: [`[intelligence] Purged ${r.rowCount} expired session states, tenant=${tenantId}`].map((x) => (x == null ? '' : String(x))).join(' ') });
          } catch (e) {
            log.error({ msg: 'monitor', detail: ['[intelligence] Session state purge error:', tenantId, e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
          }
        }, { continueOnError: true });
      } catch (e) {
        log.error({ msg: 'monitor', detail: ['[intelligence] Session state purge runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
    }, 60 * 60 * 1000);

    // ── P0-3: 定时任务心跳表（表结构由 migrate / 093 等提供；启动仅在允许 schema 变更时 ensure）──
    if (allowSchemaChanges) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS scheduler_heartbeat (
            task_name   TEXT PRIMARY KEY,
            last_beat   TIMESTAMPTZ DEFAULT NOW(),
            run_count   BIGINT DEFAULT 0
          )
        `);
        log.info({ msg: 'monitor', detail: ['[monitor] scheduler_heartbeat table ready'].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'monitor', detail: ['[monitor] heartbeat table init error:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
    }

    const HEARTBEAT_ALERT_THRESHOLDS_MIN = DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN;
    const heartbeatAlertDedup = new Map();

    // 带心跳的缓存清理（覆盖原 setInterval）
    // agent_metric_cache 带tenant_id/RLS，原只清default租户会导致其他租户缓存堆积不过期；改为遍历活跃租户。
    // 心跳(beatHeartbeat)本身是系统级监控，不依赖租户上下文，仍在租户循环外单独打一次。
    const runCachePurge = async () => {
      try {
        await runForActiveTenants(() => purgeExpiredCache().catch(() => {}), { continueOnError: true });
      } catch (e) {
        log.error({ msg: 'monitor', detail: ['[cache_purge] runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
      await beatHeartbeat('cache_purge');
    };
    setIntervalFn(runCachePurge, 2 * 60 * 60 * 1000);
    // 启动即执行一次并写心跳，避免重启后首个 2 小时窗口误判为“任务停摆”
    setTimeoutFn(runCachePurge, 15 * 1000);

    // ── P0-3: 每 30 分钟检查心跳是否存活 ────────────────────────
    setIntervalFn(async () => {
      await runWithBootstrapTenantContext(async () => {
        try {
          const r = await pool.query(`
            SELECT task_name,
                   EXTRACT(EPOCH FROM (NOW() - last_beat)) / 60 AS minutes_ago
            FROM scheduler_heartbeat
          `);
          const staleRows = filterStaleHeartbeats(r.rows || [], HEARTBEAT_ALERT_THRESHOLDS_MIN);
          if (staleRows.length > 0) {
            const dead = formatStaleHeartbeatDeadLabel(staleRows);
            const dedupeKey = staleHeartbeatDedupeKey(staleRows);
            const lastSent = Number(heartbeatAlertDedup.get(dedupeKey) || 0);
            if (Date.now() - lastSent < 2 * 60 * 60 * 1000) return;
            heartbeatAlertDedup.set(dedupeKey, Date.now());
            const msg = `🚨 [HRMS] 定时任务心跳异常\n停止任务：${dead}\n请登录服务器检查：\nsystemctl status hrms.service`;
            log.error({ msg: 'monitor', detail: ['[monitor] Dead tasks:', dead].map((x) => (x == null ? '' : String(x))).join(' ') });
            await sendSystemAlert(msg);
          }
        } catch (e) {
          log.error({ msg: 'monitor', detail: ['[monitor] heartbeat check error:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
        }
      });
    }, 30 * 60 * 1000);

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

    // ── P0-2: 每天 23:30 检查销售数据完整性 ──────────────
    // 用 setInterval 每5分钟检查时间窗口
    // 原用 runWithBootstrapTenantContext 只处理default租户，改为遍历活跃租户各自检查；
    // 去重标记也从单一值改为按租户区分的 Map。
    const _salesCheckFiredDate = new Map();
    setIntervalFn(async () => {
      try {
      await runForActiveTenants(async (tenantId) => {
        const now = new Date();
        // 每天 23:30~23:35 触发一次
        if (!isPosSalesCheckWindow(now)) return;
        if (_salesCheckFiredDate.get(tenantId) === now.getDate()) return;
        _salesCheckFiredDate.set(tenantId, now.getDate());

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

    // ── 上月末「累计假期」池快照：上海时间每月 1 日 06:00–06:14 写入，供当月展示与公式解耦 ──
    // 原用 runWithBootstrapTenantContext 只处理 default 租户；改为遍历全部活跃租户，
    // 去重标记也从单一字符串改为按租户区分的 Map，避免A租户跑完误挡住B租户。
    const _leaveCumulativeSnapshotDoneCurYm = new Map();
    setIntervalFn(async () => {
      try {
        await runForActiveTenants(async (tenantId) => {
          try {
            const partsFmt = new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Shanghai',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });
            const p = partsFmt.formatToParts(new Date());
            const gv = (t) => p.find(x => x.type === t)?.value || '';
            if (!isLeaveCumulativeSnapshotWindow(p)) return;
            const y = gv('year');
            const mo = gv('month');
            const curYm = `${y}-${mo}`;
            if (_leaveCumulativeSnapshotDoneCurYm.get(tenantId) === curYm) return;
            const closedMonth = leaveAttendanceHelpers.shiftMonth(curYm, -1);
            if (!closedMonth) return;
            const r = await leaveAttendanceHelpers.runLeaveCumulativeCloseSnapshotForClosedMonth(closedMonth);
            if (r?.ok) {
              _leaveCumulativeSnapshotDoneCurYm.set(tenantId, curYm);
              log.info({ msg: 'monitor', detail: ['[leave-cumulative-snapshot] locked tenant=', tenantId, 'closedMonth=', r.closedMonth, 'employees=', r.employees].map((x) => (x == null ? '' : String(x))).join(' ') });
            } else {
              await sendSystemAlert([
                '🔴 [HRMS] 上月累计假期自动快照失败',
                `租户：${tenantId}`,
                `闭合月：${closedMonth}`,
                `当前上海月：${curYm}`,
                `原因：${String(r?.error || 'unknown')}`,
                '请检查服务日志 [leave-cumulative-snapshot] 与 state 持久化；窗口内将每分钟重试。'
              ].join('\n'));
            }
          } catch (e) {
            log.error({ msg: 'monitor', detail: ['[leave-cumulative-snapshot] tick:', tenantId, e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
            try {
              await sendSystemAlert([
                '🔴 [HRMS] 上月累计假期快照任务异常',
                `租户：${tenantId}`,
                `错误：${safeErrMessage(e)}`,
                '请检查 hrms-service 日志与数据库/共享状态写入。'
              ].join('\n'));
            } catch (_) { /* ignore */ }
          }
        }, { continueOnError: true });
      } catch (e) {
        log.error({ msg: 'monitor', detail: ['[leave-cumulative-snapshot] runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
    }, 60 * 1000);

  }

  return { beatHeartbeat, startListenMonitors };
}
