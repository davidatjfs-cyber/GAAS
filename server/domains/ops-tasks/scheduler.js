import { childLogger } from '../../utils/logger.js';
import { beatHeartbeatSimple } from '../health/monitor-beat.js';

const log = childLogger({ domain: 'ops-tasks', handler: 'scheduler' });

export function createOpsTaskScheduler({
  pool,
  runForActiveTenants,
  ensureOpsTasksTable,
  opsDateOnly,
  ensureOpsTasksForDate,
}) {
  let __OPS_TASK_SCHEDULER_STARTED = false;

  // ops_tasks是真实业务数据(带RLS)，原只在default租户上下文里生成/关账，改为遍历活跃租户各自处理
  async function runOpsTaskSchedulerTick() {
    try {
      await runForActiveTenants(async (tenantId) => {
        try {
          await ensureOpsTasksTable();
          const today = opsDateOnly(new Date());
          await ensureOpsTasksForDate(today);
          await pool.query(
            `update ops_tasks
             set status = 'overdue', updated_at = now()
             where status = 'open'
               and due_at < now()`
          );
        } catch (e) {
          log.error({ msg: 'ops_scheduler_tick_failed', detail: [tenantId, e?.message || e] });
        }
      }, { continueOnError: true });
      await beatHeartbeatSimple(pool, 'ops_task_scheduler_tick');
    } catch (e) {
      log.error({ msg: 'ops_scheduler_runforactivetenants_error', err: e?.message || e });
    }
  }

  function startOpsTaskScheduler() {
    if (__OPS_TASK_SCHEDULER_STARTED) return;
    __OPS_TASK_SCHEDULER_STARTED = true;
    runOpsTaskSchedulerTick();
    setInterval(runOpsTaskSchedulerTick, 60 * 1000);
  }

  return { runOpsTaskSchedulerTick, startOpsTaskScheduler };
}
