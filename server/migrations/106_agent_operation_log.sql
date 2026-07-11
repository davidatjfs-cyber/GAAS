-- Agent 操作审计日志：记录 Agent 执行工具调用(写操作)时"谁在什么时候用什么参数
-- 执行了什么工具/产生了什么结果"，供出问题时追溯。审计写入失败不影响主业务流程。
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
);
CREATE INDEX IF NOT EXISTS idx_agent_operation_log_created_at ON agent_operation_log (created_at);
CREATE INDEX IF NOT EXISTS idx_agent_operation_log_tool_name ON agent_operation_log (tool_name);
