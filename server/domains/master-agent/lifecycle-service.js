/**
 * Master task lifecycle — binds pool/log deps for master-agent listeners.
 */
import { STATUS_FLOW } from './status-flow.js';
import { pickAssigneeForCategory } from './resolve-assignee.js';
import {
  createTask as createTaskImpl,
  emitEvent as emitEventImpl,
  generateTaskId,
  transitionTask as transitionTaskImpl,
} from './task-lifecycle.js';

function logResolveAssigneeWarnings(log, warnings, store) {
  for (const w of warnings) {
    if (w.startsWith('cross_store:')) {
      const [, username, userStore] = w.split(':');
      log.warn(
        `[resolveAssignee] ⚠️ 跨门店分派告警: 用户 ${username} 属于 ${userStore}，不属于目标门店 ${store}。自动重新匹配...`
      );
    } else if (w.startsWith('missing_user:')) {
      log.warn(
        `[resolveAssignee] ⚠️ 用户 ${w.slice('missing_user:'.length)} 不存在，自动重新匹配...`
      );
    } else if (w.startsWith('no_match:')) {
      const [, storeName, targetRole] = w.split(':');
      log.error(
        `[resolveAssignee] ❌ 未找到门店 ${storeName} 的责任人（目标角色: ${targetRole}）`
      );
    }
  }
}

export function createMasterTaskLifecycle({
  getPool,
  log,
  getSharedState,
  getCategoryAssigneeRoleMap,
  extractAnomalyRelations,
}) {
  const emitEvent = (
    taskId,
    eventType,
    fromAgent,
    toAgent,
    statusBefore,
    statusAfter,
    payload,
    tenantId
  ) =>
    emitEventImpl(
      getPool,
      log,
      taskId,
      eventType,
      fromAgent,
      toAgent,
      statusBefore,
      statusAfter,
      payload,
      tenantId
    );

  const transitionTask = (taskId, newStatus, agentName, data, tenantId) =>
    transitionTaskImpl(getPool, log, taskId, newStatus, agentName, data, tenantId);

  const createTask = (taskInput, tenantId) =>
    createTaskImpl(getPool, log, { extractAnomalyRelations }, taskInput, tenantId);

  async function resolveAssignee(category, store, existingAssignee, sourceData) {
    const state = await getSharedState();
    const roleMap = await getCategoryAssigneeRoleMap();
    const { assignee, warnings } = pickAssigneeForCategory({
      category,
      store,
      existingAssignee,
      sourceData,
      state,
      roleMap,
    });

    logResolveAssigneeWarnings(log, warnings, store);
    if (!assignee) return null;

    log.info(
      `[resolveAssignee] ✅ 已匹配责任人: ${assignee.name}(${assignee.username}) - ${assignee.role} @ ${store}`
    );
    return assignee;
  }

  return {
    STATUS_FLOW,
    statusFlow: STATUS_FLOW,
    generateTaskId,
    emitEvent,
    transitionTask,
    createTask,
    resolveAssignee,
  };
}
