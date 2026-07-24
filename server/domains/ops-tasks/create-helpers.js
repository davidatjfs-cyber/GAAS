import { normalizeOpsRole } from './config.js';
import { buildOpsFeedback } from './feedback.js';
import { createOpsTaskTemplateHelpers } from './templates.js';
import { createOpsTaskCreateHelpers } from './create-task.js';
import { createOpsTaskScheduler } from './scheduler.js';

export function createOpsTaskHelpers({
  pool,
  safeDateOnly,
  getSharedState,
  resolveTenantIdDefault,
  pickStoreRoleUsernameByStore,
  runForActiveTenants,
  ensureOpsTasksTable,
}) {
  const {
    opsDateOnly,
    opsDateAt,
    resolveOpsStoreBrand,
    getOpsManagedStores,
    getOpsStoreAssignee,
    buildOpsTaskTemplates,
  } = createOpsTaskTemplateHelpers({ safeDateOnly, pickStoreRoleUsernameByStore });

  const {
    createOpsTaskIfAbsent,
    ensureOpsTasksForDate,
  } = createOpsTaskCreateHelpers({
    pool,
    safeDateOnly,
    getSharedState,
    resolveTenantIdDefault,
    getOpsManagedStores,
    resolveOpsStoreBrand,
    buildOpsTaskTemplates,
    getOpsStoreAssignee,
  });

  const {
    runOpsTaskSchedulerTick,
    startOpsTaskScheduler,
  } = createOpsTaskScheduler({
    pool,
    runForActiveTenants,
    ensureOpsTasksTable,
    opsDateOnly,
    ensureOpsTasksForDate,
  });

  return {
    normalizeOpsRole,
    buildOpsFeedback,
    opsDateOnly,
    opsDateAt,
    buildOpsTaskTemplates,
    ensureOpsTasksForDate,
    createOpsTaskIfAbsent,
    startOpsTaskScheduler,
    runOpsTaskSchedulerTick,
    resolveOpsStoreBrand,
    getOpsManagedStores,
    getOpsStoreAssignee,
  };
}
