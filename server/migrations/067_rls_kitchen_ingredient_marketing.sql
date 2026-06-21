-- RLS Phase5全量推进第6批：厨房执行(kitchen-execution.js)+配方原料库(recipe-management.js)+
-- 营销支付规则(growth-api.js)+月度循环奖惩模板(index.js) 8张表开RLS。
-- recurring_reward_templates对应的cron(runMonthlyRecurringRewardTemplatesJob)原先不是
-- per-tenant循环调用，改成遍历active租户分别查再按各模板自带的tenant_id分别处理；
-- 包裹过程中3处continue改成return(包进了箭头函数边界)。
ALTER TABLE ingredient_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingredient_categories
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE ingredient_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_library FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingredient_library
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE dish_station_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_station_mapping FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dish_station_mapping
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE kitchen_exec_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_exec_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_exec_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE kitchen_step_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_step_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_step_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE kitchen_sop_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_sop_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_sop_steps
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE marketing_payment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_payment_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing_payment_rules
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE recurring_reward_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_reward_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recurring_reward_templates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
