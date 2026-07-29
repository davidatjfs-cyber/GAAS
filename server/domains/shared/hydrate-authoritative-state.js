/**
 * 权威表 → state 镜像的统一 hydrate 收口。
 * 必须在 getSharedState() 内调用，不能只挂在 GET /api/state——
 * 全库业务读入口是 getSharedState，仅 HTTP handler hydrate 会导致鉴权/审批等读到陈旧 blob。
 *
 * employees：表 hydrate 已启用，blob 字段保留至独立 PR 再 strip（用户决策）。
 */
import { hydrateStateFromAuthoritativeTables } from '../payroll/service.js';
import { hydrateEmployeesFromTable } from '../employees/service.js';
import { hydrateFlowConfigFromTable } from '../flow-config/service.js';
import { hydrateNotificationsFromTable } from '../notifications/service.js';
import { hydrateExamResultsFromTable } from '../exam-results/service.js';
import { hydrateDailyReportsFromTable } from '../daily-reports/service.js';
import {
  hydrateLeaveDomainFromTable,
  hydrateLeaveRecordsFromTable,
} from '../leave-attendance/domain-service.js';
import { hydrateInventoryForecastFromTables } from '../inventory-forecast/table-service.js';
import { hydrateQuestionSetsFromTable } from '../remaining-state/question-sets-service.js';

/**
 * @param {import('pg').Pool} pool
 * @param {object|null|undefined} state
 * @param {string} [tenantId]
 * @returns {Promise<object|null|undefined>}
 */
export async function hydrateAuthoritativeState(pool, state, tenantId) {
  if (!state || typeof state !== 'object') return state;
  let next = state;
  next = await hydrateStateFromAuthoritativeTables(pool, next, tenantId);
  next = await hydrateEmployeesFromTable(pool, next, tenantId);
  next = await hydrateFlowConfigFromTable(pool, next, tenantId);
  next = await hydrateNotificationsFromTable(pool, next, tenantId);
  next = await hydrateExamResultsFromTable(pool, next, tenantId);
  next = await hydrateDailyReportsFromTable(pool, next, tenantId);
  next = await hydrateLeaveDomainFromTable(pool, next, tenantId);
  next = await hydrateLeaveRecordsFromTable(pool, next, tenantId);
  next = await hydrateInventoryForecastFromTables(pool, next, tenantId);
  next = await hydrateQuestionSetsFromTable(pool, next, tenantId);
  return next;
}
