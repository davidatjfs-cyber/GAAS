/**
 * Master Agent periodic tick helpers — tenant-scoped interval wiring.
 */
import { pool } from '../../utils/database.js';
import { beatHeartbeatSimple } from '../health/monitor-beat.js';

export function createTenantScopedTick({ pool, getActiveTenantIds, tenantContext, log }) {
  return function tenantTick(label, run, options = {}) {
    const {
      logWhen = (result) => result > 0,
      formatMessage = (result) => String(result),
    } = options;

    return async () => {
      for (const tenantId of await getActiveTenantIds(pool())) {
        await tenantContext.run(tenantId, async () => {
          try {
            const result = await run(tenantId);
            if (logWhen(result)) {
              log.info(
                `[master:tick] ${label}(${tenantId}) ${formatMessage(result)}`
              );
            }
          } catch (e) {
            log.error(
              `[master:tick] ${label} error (tenant=${tenantId}):`,
              e?.message
            );
          }
        });
      }
    };
  };
}

// 2026-08-01：这15个 master-agent 内部tick(审计/派工/训练/巡检/BI推送等)之前完全没有心跳，
// 系统性排查定时任务时发现的缺口——不需要逐个改调用方，在这个通用注册器里统一包一层，
// 一次改动覆盖全部15个。entry.name 缺失时退化成 'unnamed_master_tick_N'（不阻断功能，
// 只是心跳记录不区分是哪个tick，提示后续给 buildMasterIntervalSchedule 补全 name）。
function wrapWithHeartbeat(fn, name) {
  return () => {
    Promise.resolve(fn())
      .then(() => beatHeartbeatSimple(pool(), name))
      .catch(() => {});
  };
}

export function registerMasterIntervals(schedule, log) {
  schedule.forEach((entry, i) => {
    const name = entry.name || `unnamed_master_tick_${i}`;
    const wrapped = wrapWithHeartbeat(entry.fn, name);
    setInterval(wrapped, entry.intervalMs);
    if (entry.startupDelayMs != null) {
      setTimeout(wrapped, entry.startupDelayMs);
    }
  });
  log.info(
    '[master] All agent listeners started (including KG health tick + auto-ops engine)'
  );
}
