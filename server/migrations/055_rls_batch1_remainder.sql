-- RLS Phase5批1收尾：剩余8张表全部开启RLS。逐表审计读写路径后分两类处理：
--   全局系统表(固定tenant_id='default'，写路径已改为tenantContext.run('default',...)自包裹)：
--     agent_autonomous_logs, config_audit_log, agent_v2_pllm_monthly_report_log, rhythm_logs
--   真实业务表(按store/username解析真实租户)：
--     agent_v2_morning_briefing_sends, agent_v2_scheduled_report_sends(按username，tenantId已在
--     调用链路中正确传递), decision_log(按store，复用resolveTenantIdForStore), user_login_log
--     (登录时还没有JWT/ALS上下文，由调用方传入刚查到的用户tenant_id)
ALTER TABLE agent_autonomous_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_autonomous_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_autonomous_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE config_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON config_audit_log
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_v2_pllm_monthly_report_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_v2_pllm_monthly_report_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_v2_pllm_monthly_report_log
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE rhythm_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rhythm_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rhythm_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_v2_morning_briefing_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_v2_morning_briefing_sends FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_v2_morning_briefing_sends
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_v2_scheduled_report_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_v2_scheduled_report_sends FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_v2_scheduled_report_sends
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE decision_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decision_log
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE user_login_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_login_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_login_log
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
