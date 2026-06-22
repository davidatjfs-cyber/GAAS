-- RLS Phase5全量推进第9批：5张表全代码库(hr-management-system+agents-service-v2两个
-- codebase都查过)零引用，确认是死表，直接开RLS无需任何代码改动。
ALTER TABLE task_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_locks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_locks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE task_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_runs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE escalation_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_chains FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalation_chains
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE brand_voice_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_voice_samples FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON brand_voice_samples
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE data_quality_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_quality_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_quality_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
