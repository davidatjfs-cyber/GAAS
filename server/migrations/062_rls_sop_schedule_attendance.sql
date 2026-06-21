-- RLS Phase5全量推进第3批：SOP分发/排班/考勤/入离职/临时用工7张表开RLS。
-- 调用方均在authRequired路由内(registerSOPDistributionRoutes/registerHRMSApiRoutes)，
-- 用resolveTenantIdDefault()读取请求的真实ALS上下文。
ALTER TABLE sop_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sop_versions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sop_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_distributions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sop_distributions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sop_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_quiz_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sop_quiz_questions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON schedules
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE employment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE employment_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employment_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE temp_staffing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE temp_staffing_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON temp_staffing_requests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
