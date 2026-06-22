-- RLS Phase5全量推进-agent_*核心表批(7张，agent_messages因17处INSERT site量大拆成独立批次)
-- agent_long_memory: 唯一约束补tenant_id(代码同步改ON CONFLICT)
ALTER TABLE agent_long_memory DROP CONSTRAINT IF EXISTS uq_agent_long_memory;
ALTER TABLE agent_long_memory ADD CONSTRAINT uq_agent_long_memory UNIQUE (user_key, memory_key, tenant_id);

-- 以下6张表PK/唯一约束本身不含跨租户碰撞风险(session_id/UUID/serial id均全局唯一)，
-- 代码已补tenant_id列写入值(agent-experience.js/message-pipeline.js/session-store.js)，
-- agent_collaboration_logs/agent_optimization_history无写入代码(预留表)，本批只开关。
ALTER TABLE agent_long_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_long_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_long_memory
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_sessions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_memory
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_task_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_task_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_experience ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_experience FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_experience
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_collaboration_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_collaboration_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_collaboration_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_optimization_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_optimization_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_optimization_history
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
