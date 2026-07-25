import { childLogger } from './logger.js';

const log = childLogger({ domain: 'agent-audit-log' });

/**
 * Agent 操作审计日志
 * 记录 Agent 执行工具调用（尤其是写操作）时"谁在什么时候用什么参数执行了什么工具/产生了什么结果"，
 * 便于出问题时追溯。审计写入失败不应影响主业务流程。
 */

export async function ensureAgentAuditLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_operation_log (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      tenant_id TEXT,
      operator_username TEXT,
      operator_role TEXT,
      tool_name TEXT,
      store_id TEXT,
      args JSONB,
      result_summary TEXT,
      status TEXT,
      error_message TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_operation_log_created_at ON agent_operation_log (created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_operation_log_tool_name ON agent_operation_log (tool_name)`);
}

/**
 * 记录一次 Agent 工具调用操作。失败会被吞掉（仅打印警告），不会抛出，不影响主流程。
 */
export async function logAgentOperation(pool, {
  tenantId = null,
  operatorUsername = null,
  operatorRole = null,
  toolName = null,
  storeId = null,
  args = null,
  resultSummary = null,
  status = null,
  errorMessage = null
} = {}) {
  try {
    await pool.query(
      `INSERT INTO agent_operation_log
        (tenant_id, operator_username, operator_role, tool_name, store_id, args, result_summary, status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, operatorUsername, operatorRole, toolName, storeId, args ? JSON.stringify(args) : null, resultSummary, status, errorMessage]
    );
  } catch (e) {
    log.warn({ msg: 'log_agent_operation_failed', err: e?.message });
  }
}
