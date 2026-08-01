/**
 * 租户 RLS 作用域契约（单一真源）。
 *
 * GAAS `server/scripts/apply-tenant-rls.mjs`（demo 收尾步骤）与
 * agents-service-v2 `scripts/tenant-isolation-scope.mjs` / 租户隔离测试
 * 都从这里取值，禁止在两侧各自维护排除清单。
 *
 * 定版（2026-08-01）：029/030 所有权收敛拍板——tenants/licenses/tenant_integrations
 * 的唯一写入方与 schema 权威在 GAAS；RLS 的 ENABLE/FORCE 由 demo 专用收尾步骤显式执行。
 */

/** 全局平台表：不套租户隔离，也不做 RLS 收尾。 */
export const TENANT_RLS_EXCLUDED_TABLES = Object.freeze([
  'tenants',
  'licenses',
  'agent_v2_configs',
  'analysis_rules',
  'analysis_sop',
  'cn_holiday_calendar',
  'hrms_state',
]);

/** RLS 策略名（GAAS 迁移链 052-078 与收尾步骤共用同一策略名）。 */
export const TENANT_RLS_POLICY_NAME = 'tenant_isolation';

/** 会话级 GUC：当前租户 id。 */
export const TENANT_RLS_GUC_TENANT_ID = 'app.tenant_id';

/** GUC 哨兵值：系统级后台任务（cron/跨租户平台任务）旁路 RLS。 */
export const TENANT_RLS_SYSTEM_TENANT_VALUE = '__system__';

/** 表名是否在全局排除清单内。 */
export function isTenantRlsExcluded(tableName) {
  return TENANT_RLS_EXCLUDED_TABLES.includes(tableName);
}
