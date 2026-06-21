-- RLS Phase5全量推进第7批：9张表开RLS
-- action_plans(hq-planner-agent.js): generateActionPlan走authRequired路由ALS已覆盖；
--   approvePlan/rejectPlan被飞书机器人意图识别(无ALS)和HTTP路由两路调用，plan_id所属
--   租户调用方未必知道，改为findActionPlanTenant()扫描active租户定位后用tenantContext.run包裹。
--   handleHqBrainMessage(飞书消息入口)整体按store反查租户包裹，连带修复内部
--   fuzzyMatchStoreName/listPlans在FORCE RLS下读不到数据的问题。
-- monthly_margins(margin-message-handler.js): 飞书毛利率消息无ALS，按store反查租户。
-- growth_content_suggestions/employee_scores/performance_invalidation_records/
--   hrms_reward_punishment_records: 均在authRequired路由或同步链路内，用
--   resolveTenantIdDefault()补全tenant_id写入与ON CONFLICT目标。
-- task_assignments/acceptance_checklists/marketing_campaigns: 全代码库零引用，
--   死表，直接开RLS无需代码改动。
ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON action_plans
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE monthly_margins ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_margins FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monthly_margins
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_content_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_content_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_content_suggestions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE employee_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_scores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE performance_invalidation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_invalidation_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON performance_invalidation_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hrms_reward_punishment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_reward_punishment_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hrms_reward_punishment_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_assignments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE acceptance_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE acceptance_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acceptance_checklists
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing_campaigns
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
