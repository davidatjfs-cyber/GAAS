/**
 * Ops scheduled-task timers + status Map (P2 peel from agents.js).
 */
import {
  getInspectionIntervalDays,
  isBlockedOpsChecklistPattern,
  shouldSkipHrmsScheduledChecklistBody,
} from './scheduled-task-runtime-helpers.js';

/**
 * @param {object} deps
 * @param {Function} deps.refreshOpsAgentRuntimeConfig
 * @param {Function} deps.buildScheduledTasksFromConfig
 * @param {Function} deps.executeScheduledTask
 * @param {{ info: Function, error?: Function }} deps.log
 * @param {typeof setTimeout} [deps.setTimeoutFn]
 * @param {typeof clearTimeout} [deps.clearTimeoutFn]
 * @param {() => Date} [deps.nowFn]
 * @param {() => number} [deps.randomFn]
 */
export function createScheduledTaskRuntimeApi(deps) {
  const {
    refreshOpsAgentRuntimeConfig,
    buildScheduledTasksFromConfig,
    executeScheduledTask,
    log,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = () => new Date(),
    randomFn = Math.random,
    env = process.env,
  } = deps;

  const scheduledTaskIntervals = new Map();
  const scheduledTaskRuntimeStatus = new Map();

  function shouldSkipHrmsScheduledChecklist(config) {
    return shouldSkipHrmsScheduledChecklistBody(config, { env, log, isBlocked: isBlockedOpsChecklistPattern });
  }

  function getScheduledTaskStatus() {
    const tasks = Array.from(scheduledTaskRuntimeStatus.entries()).map(([taskKey, status]) => ({
      taskKey,
      ...status
    }));
    return {
      started: scheduledTaskIntervals.size > 0,
      activeTimers: scheduledTaskIntervals.size,
      tasks
    };
  }

  function scheduleFixedTask(taskKey, config) {
    const [hour, minute] = config.time.split(':').map(Number);
    const intervalDays = getInspectionIntervalDays(config);

    const scheduleNext = () => {
      const now = nowFn();
      const cst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
      const ds = `${cst.getFullYear()}-${String(cst.getMonth() + 1).padStart(2, '0')}-${String(cst.getDate()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`;
      let nextExecution = new Date(ds);

      if (nextExecution.getTime() <= now.getTime()) {
        nextExecution = new Date(nextExecution.getTime() + intervalDays * 86400000);
      }

      const msUntilExecution = nextExecution.getTime() - now.getTime();
      const status = scheduledTaskRuntimeStatus.get(taskKey);
      if (status) {
        status.nextExecutionAt = nextExecution.toISOString();
        scheduledTaskRuntimeStatus.set(taskKey, status);
      }

      const timer = setTimeoutFn(() => {
        executeScheduledTask(taskKey, config);
        scheduleNext();
      }, msUntilExecution);
      scheduledTaskIntervals.set(taskKey, timer);

      log.info(`[ops] scheduled ${taskKey} for: ${nextExecution.toISOString()}`);
    };

    scheduleNext();
  }

  function scheduleRandomTask(taskKey, config) {
    const [minHours, maxHours] = config.interval;

    const scheduleNext = () => {
      const intervalHours = minHours + randomFn() * (maxHours - minHours);
      let nextExecution = new Date(nowFn().getTime() + intervalHours * 3600000);
      const cstH = Number(nextExecution.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }));
      if (cstH < 8 || cstH >= 23) {
        const hoursUntilNext = cstH >= 23 ? (24 - cstH + 8) : (8 - cstH);
        const baseNext = new Date(nextExecution.getTime() + hoursUntilNext * 3600000);
        baseNext.setMinutes(0, 0, 0);
        nextExecution = new Date(baseNext.getTime() + randomFn() * 6 * 3600000);
      }
      const intervalMs = nextExecution.getTime() - nowFn().getTime();
      const status = scheduledTaskRuntimeStatus.get(taskKey);
      if (status) {
        status.nextExecutionAt = nextExecution.toISOString();
        scheduledTaskRuntimeStatus.set(taskKey, status);
      }

      const timer = setTimeoutFn(() => {
        executeScheduledTask(taskKey, config);
        scheduleNext();
      }, intervalMs);
      scheduledTaskIntervals.set(taskKey, timer);

      log.info(`[ops] scheduled random ${taskKey} for: ${nextExecution.toISOString()} (interval: ${intervalHours}h)`);
    };

    scheduleNext();
  }

  async function startScheduledTasks() {
    log.info('[ops] starting scheduled tasks...');
    await refreshOpsAgentRuntimeConfig();
    const runtimeTasks = buildScheduledTasksFromConfig();

    for (const [, timer] of scheduledTaskIntervals) {
      clearTimeoutFn(timer);
    }
    scheduledTaskIntervals.clear();
    scheduledTaskRuntimeStatus.clear();

    for (const [taskKey, config] of Object.entries(runtimeTasks)) {
      scheduledTaskRuntimeStatus.set(taskKey, {
        taskKey,
        action: config.action,
        nextExecutionAt: null,
        lastRunAt: null,
        runCount: 0,
        lastError: null
      });
      if (config.random) {
        scheduleRandomTask(taskKey, config);
      } else {
        scheduleFixedTask(taskKey, config);
      }
    }
  }

  return {
    scheduledTaskRuntimeStatus,
    isBlockedOpsChecklistPattern,
    shouldSkipHrmsScheduledChecklist,
    getInspectionIntervalDays,
    getScheduledTaskStatus,
    startScheduledTasks,
    scheduleFixedTask,
    scheduleRandomTask,
  };
}
