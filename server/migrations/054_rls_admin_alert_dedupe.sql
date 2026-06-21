-- RLS Phase5批1b：agent_admin_alert_log + agent_v2_data_alert_dedupe(agents-service-v2写入)。
-- 两表的读写代码已确认完整带tenant_id(notifyAdminsDataIssue全程用tenantContext.run()
-- 自包裹，不依赖调用方传入的ambient ALS上下文)，admin-api.js的读取也已带tenant_id过滤。
ALTER TABLE agent_admin_alert_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_admin_alert_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_admin_alert_log
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_v2_data_alert_dedupe ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_v2_data_alert_dedupe FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_v2_data_alert_dedupe
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
