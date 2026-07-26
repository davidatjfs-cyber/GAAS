/**
 * Scheduled ops task executor (Wave A11b peel from agents.js executeScheduledTask).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-ops', handler: 'execute-scheduled-task' });

/** @internal exported for unit tests */
export function isWithinWorkingHours(nowFn = Date.now) {
  const hour = Number(
    new Date(nowFn()).toLocaleString('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    })
  );
  return hour >= 8 && hour <= 23;
}

/**
 * @param {object} deps
 * @returns {(taskKey: string, config: object) => Promise<void>}
 */
export function createExecuteScheduledTask(deps) {
  const {
    sendScheduledChecklist,
    sendSafetyCheck,
    refreshOpsAgentRuntimeConfig,
    buildScheduledTasksFromConfig,
    isBlockedOpsChecklistPattern,
    getOpsAgentConfig,
    scheduledTaskRuntimeStatus,
    env = process.env,
    nowFn = Date.now,
    isWithinWorkingHoursFn = isWithinWorkingHours,
  } = deps;

  return async function executeScheduledTask(taskKey, config) {
    if (!isWithinWorkingHoursFn(nowFn)) {
      log.info({ msg: 'skip_outside_working_hours', task_key: taskKey });
      return;
    }
    const disAllChecklist = String(env.HRMS_DISABLE_SCHEDULED_CHECKLIST || '')
      .trim()
      .toLowerCase();
    if (
      config?.action === 'send_checklist' &&
      (disAllChecklist === '1' || disAllChecklist === 'true' || disAllChecklist === 'yes')
    ) {
      log.info({ msg: 'skip_checklist_disabled', task_key: taskKey });
      return;
    }
    log.info({ msg: 'executing', task_key: taskKey });

    let liveConfig = config;

    if (liveConfig?.action === 'send_checklist' && !liveConfig?.random) {
      await refreshOpsAgentRuntimeConfig();
      const fresh = buildScheduledTasksFromConfig();
      const live = fresh[taskKey];
      if (!live || live.action !== 'send_checklist') {
        log.info({ msg: 'skip_stale_checklist_timer', task_key: taskKey });
        return;
      }
      liveConfig = { ...liveConfig, ...live, taskKey };
    }

    if (liveConfig?.random && liveConfig?.action === 'safety_check') {
      const dis = String(env.HRMS_DISABLE_RANDOM_INSPECTION || '').trim().toLowerCase();
      if (dis === '1' || dis === 'true' || dis === 'yes') {
        log.info({ msg: 'skip_random_inspection_disabled' });
        return;
      }
      await refreshOpsAgentRuntimeConfig();
      const m = taskKey.match(/_(\d+)$/);
      const idx = m ? parseInt(m[1], 10) - 1 : -1;
      const opsCfg = typeof getOpsAgentConfig === 'function' ? getOpsAgentConfig() : {};
      const list = Array.isArray(opsCfg?.scheduledTasks?.randomInspections)
        ? opsCfg.scheduledTasks.randomInspections
        : [];
      const live = idx >= 0 && idx < list.length ? list[idx] : null;
      if (!live || live.enabled === false || !String(live.type || '').trim()) {
        log.info({ msg: 'skip_random_slot_empty', task_key: taskKey, idx });
        return;
      }
      if (isBlockedOpsChecklistPattern(live.type, taskKey)) {
        log.info({ msg: 'skip_random_test_legacy', task_key: taskKey });
        return;
      }
      liveConfig = {
        ...liveConfig,
        type: String(live.type || '').trim(),
        description: String(live.description || '').trim(),
        timeWindow: Math.max(1, Math.floor(Number(live.timeWindow) || 15)),
        store: String(live.store || '').trim(),
        brand: String(live.brand || '').trim(),
        assigneeRoles:
          Array.isArray(live.assigneeRoles) && live.assigneeRoles.length
            ? live.assigneeRoles.map((r) => String(r || '').trim()).filter(Boolean)
            : liveConfig.assigneeRoles,
      };
    }

    const status = scheduledTaskRuntimeStatus.get(taskKey) || {
      taskKey,
      action: liveConfig?.action || '',
      nextExecutionAt: null,
      lastRunAt: null,
      runCount: 0,
      lastError: null,
    };
    status.lastRunAt = new Date(nowFn()).toISOString();
    status.runCount = Number(status.runCount || 0) + 1;
    status.lastError = null;

    try {
      switch (liveConfig.action) {
        case 'send_checklist':
          await sendScheduledChecklist(liveConfig);
          break;
        case 'safety_check':
          await sendSafetyCheck(liveConfig);
          break;
        default:
          log.info({ msg: 'unknown_task_action', action: liveConfig.action });
      }
    } catch (e) {
      status.lastError = String(e?.message || e);
      log.error({ msg: 'scheduled_task_failed', task_key: taskKey, err: String(e?.message || e) });
    } finally {
      scheduledTaskRuntimeStatus.set(taskKey, status);
    }
  };
}
