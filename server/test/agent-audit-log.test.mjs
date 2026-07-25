import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureAgentAuditLogTable,
  logAgentOperation,
} from '../utils/agent-audit-log.js';

test('ensureAgentAuditLogTable：建表 + 索引', async () => {
  const sqls = [];
  const pool = {
    query: async (sql) => {
      sqls.push(String(sql));
      return { rows: [] };
    },
  };
  await ensureAgentAuditLogTable(pool);
  assert.ok(sqls.some((s) => /CREATE TABLE IF NOT EXISTS agent_operation_log/i.test(s)));
  assert.ok(sqls.some((s) => /idx_agent_operation_log_created_at/i.test(s)));
  assert.ok(sqls.some((s) => /idx_agent_operation_log_tool_name/i.test(s)));
});

test('logAgentOperation：成功写入；失败吞掉', async () => {
  const okPool = {
    query: async (_sql, params) => {
      assert.equal(params[3], 'tool_x');
      return { rows: [] };
    },
  };
  await logAgentOperation(okPool, {
    toolName: 'tool_x',
    args: { a: 1 },
    status: 'ok',
    resultSummary: 'done',
  });

  const badPool = {
    query: async () => {
      throw new Error('db_down');
    },
  };
  await logAgentOperation(badPool, { toolName: 'x' }); // 不抛
});
