/**
 * 跨服务契约：SHARED_TABLE_WRITERS 矩阵形状冻结。
 * 与 CLAUDE.md「共享表唯一写入方」对齐；改矩阵必须双边通知 agents-service-v2。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_TABLES, SHARED_TABLE_WRITERS } from '@gaas/shared';

/** 写入方只允许 gaas | agents；表集合与 SHARED_TABLES 一一对应 */
const ALLOWED_WRITERS = new Set(['gaas', 'agents']);

const AGENTS_OWNED = new Set([
  SHARED_TABLES.MASTER_TASKS,
  SHARED_TABLES.FEISHU_USERS,
  SHARED_TABLES.FEISHU_GENERIC_RECORDS,
  SHARED_TABLES.AGENT_MESSAGES,
  SHARED_TABLES.AGENT_SCORES,
  SHARED_TABLES.KNOWLEDGE_BASE,
]);

const GAAS_OWNED = new Set([
  SHARED_TABLES.DAILY_REPORTS,
  SHARED_TABLES.HRMS_STATE,
  SHARED_TABLES.POS_ORDER_ITEMS,
  SHARED_TABLES.POS_SALES_DETAIL,
  SHARED_TABLES.TENANTS,
  SHARED_TABLES.TENANT_INTEGRATIONS,
  SHARED_TABLES.POINT_RECORDS,
  SHARED_TABLES.HRMS_PAYROLL_DOMAIN,
  SHARED_TABLES.STORE_NAME_ALIASES,
  SHARED_TABLES.EMPLOYEES,
  SHARED_TABLES.HR_RATING_CONFIGS,
  SHARED_TABLES.HRMS_USER_NOTIFICATIONS,
  SHARED_TABLES.EXAM_RESULTS,
]);

test('SHARED_TABLE_WRITERS 覆盖全部 SHARED_TABLES 且写入方合法', () => {
  const tables = Object.values(SHARED_TABLES);
  assert.ok(tables.length >= 15);
  for (const table of tables) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SHARED_TABLE_WRITERS, table),
      `missing writer for ${table}`
    );
    assert.ok(
      ALLOWED_WRITERS.has(SHARED_TABLE_WRITERS[table]),
      `illegal writer ${SHARED_TABLE_WRITERS[table]} for ${table}`
    );
  }
  for (const table of Object.keys(SHARED_TABLE_WRITERS)) {
    assert.ok(tables.includes(table), `writer matrix has unknown table ${table}`);
  }
});

test('共享表写入方矩阵与 CLAUDE 约定一致（agents / gaas 分组）', () => {
  for (const table of AGENTS_OWNED) {
    assert.equal(SHARED_TABLE_WRITERS[table], 'agents', table);
  }
  for (const table of GAAS_OWNED) {
    assert.equal(SHARED_TABLE_WRITERS[table], 'gaas', table);
  }
  assert.equal(AGENTS_OWNED.size + GAAS_OWNED.size, Object.keys(SHARED_TABLE_WRITERS).length);
});
