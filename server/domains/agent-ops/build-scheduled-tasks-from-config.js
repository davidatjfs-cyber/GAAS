/**
 * Build runtime scheduled task map from OPS agent config (Wave A12b peel).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-ops', handler: 'build-scheduled-tasks' });

const DEFAULT_SCHEDULED_TASKS = {};

/**
 * @param {object} deps
 * @returns {() => Record<string, object>}
 */
export function createBuildScheduledTasksFromConfig(deps) {
  const {
    getOpsAgentConfig,
    isBlockedOpsChecklistPattern,
    env = process.env,
    defaultScheduledTasks = DEFAULT_SCHEDULED_TASKS,
  } = deps;

  return function buildScheduledTasksFromConfig() {
    const legacyEnable = String(env.HRMS_ENABLE_LEGACY_SCHEDULED_CHECKLIST || '')
      .trim()
      .toLowerCase();
    if (!(legacyEnable === '1' || legacyEnable === 'true' || legacyEnable === 'yes')) {
      log.info({ msg: 'legacy_scheduled_checklist_disabled' });
      return {};
    }

    const opsCfg = typeof getOpsAgentConfig === 'function' ? getOpsAgentConfig() || {} : {};
    const runtime = {};
    const inspections = Array.isArray(opsCfg?.scheduledTasks?.dailyInspections)
      ? opsCfg.scheduledTasks.dailyInspections
      : [];
    const randomInspections = Array.isArray(opsCfg?.scheduledTasks?.randomInspections)
      ? opsCfg.scheduledTasks.randomInspections
      : [];

    for (const inspection of inspections) {
      if (inspection?.enabled === false) continue;
      const store = String(inspection?.store || '').trim();
      const brand = String(inspection?.brand || '').trim();
      const type = String(inspection?.type || '').trim();
      const time = String(inspection?.time || '').trim();
      const timeWindow = Math.max(5, Math.floor(Number(inspection?.timeWindow) || 60));
      if (!type || !time || (!brand && !store)) continue;
      const identity = store || brand;
      const key = `${identity}_${type === 'opening' ? '开市' : type === 'closing' ? '收档' : type}`;
      if (isBlockedOpsChecklistPattern(type, key)) {
        log.info({ msg: 'skip_daily_test_legacy', key });
        continue;
      }
      runtime[key] = {
        store,
        time,
        frequency: String(inspection?.frequency || 'daily').trim(),
        customIntervalDays: Math.max(1, Math.floor(Number(inspection?.customIntervalDays) || 1)),
        action: 'send_checklist',
        brand,
        timeWindow,
        checkType: type,
      };
    }

    for (let i = 0; i < randomInspections.length; i += 1) {
      const inspection = randomInspections[i] || {};
      if (inspection?.enabled === false) continue;
      const type = String(inspection?.type || '').trim();
      if (!type) continue;
      const store = String(inspection?.store || '').trim();
      const brand = String(inspection?.brand || '').trim();
      const minH = Math.max(
        1,
        Math.floor(Number(inspection?.intervalMinHours) || Number(inspection?.interval?.[0]) || 2)
      );
      const maxH = Math.max(
        minH,
        Math.floor(Number(inspection?.intervalMaxHours) || Number(inspection?.interval?.[1]) || 4)
      );
      const key = `随机抽检_${store || brand || '全门店'}_${type}_${i + 1}`;
      if (isBlockedOpsChecklistPattern(type, key)) {
        log.info({ msg: 'skip_random_test_legacy', key });
        continue;
      }
      runtime[key] = {
        random: true,
        interval: [minH, maxH],
        action: 'safety_check',
        type,
        description: String(inspection?.description || '食安抽检').trim(),
        timeWindow: Math.max(1, Math.floor(Number(inspection?.timeWindow) || 15)),
        store,
        brand,
        assigneeRoles:
          Array.isArray(inspection?.assigneeRoles) && inspection.assigneeRoles.length
            ? inspection.assigneeRoles.map((r) => String(r || '').trim()).filter(Boolean)
            : ['store_manager', 'store_production_manager'],
      };
    }

    if (Object.keys(runtime).length === 0) {
      const hasExplicitDailyConfig = Array.isArray(opsCfg?.scheduledTasks?.dailyInspections);
      const hasExplicitRandomConfig = Array.isArray(opsCfg?.scheduledTasks?.randomInspections);
      const dailyLen = hasExplicitDailyConfig ? opsCfg.scheduledTasks.dailyInspections.length : -1;
      const randomLen = hasExplicitRandomConfig
        ? opsCfg.scheduledTasks.randomInspections.length
        : -1;
      if (dailyLen === 0 && randomLen === 0) {
        log.info({ msg: 'all_scheduled_tasks_cleared' });
        return {};
      }
      if (hasExplicitDailyConfig || hasExplicitRandomConfig) {
        log.info({ msg: 'no_valid_scheduled_tasks', daily: dailyLen, random: randomLen });
        return {};
      }
      log.info({ msg: 'using_default_scheduled_tasks' });
      return { ...defaultScheduledTasks };
    }
    return runtime;
  };
}
