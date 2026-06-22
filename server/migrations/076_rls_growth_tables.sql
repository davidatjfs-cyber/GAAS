-- RLS Phase5全量推进-growth_*表批：25张growth_*表开RLS(growth_content_suggestions此前已开，跳过)
-- 写路径tenant_id补全见075；HRMS(growth-api.js/growth-phases.js)与agents-service-v2
-- (growth-monitor.js/campaign-autopilot.js/public-promo-service.js/agent-handlers.js/
-- agent-collaboration.js)两侧的INSERT/ON CONFLICT已核对完成，本次只开关。

ALTER TABLE growth_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_actions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_alerts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_campaign_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_campaign_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_campaign_jobs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_campaign_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_campaign_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_campaign_plans
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_campaigns
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_churn_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_churn_predictions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_churn_predictions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_content_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_content_calendar FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_content_calendar
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_coupons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_coupons
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_customer_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_customer_profiles
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_customers
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_daily_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_daily_metrics
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_delivery_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_delivery_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_execution_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_execution_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_holdout_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_holdout_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_holdout_members
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_learnings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_learnings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_menu_health_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_menu_health_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_menu_health_reports
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_profile_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_profile_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_profile_signals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_redemptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_segment_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_segment_members
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_sms_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_sms_suppression FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_sms_suppression
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_stored_value_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_stored_value_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_stored_value_members
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_strategy_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_strategy_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_strategy_evaluations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_strategy_explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_strategy_explanations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_strategy_explanations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_sync_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_sync_failures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_sync_failures
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE growth_touch_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_touch_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON growth_touch_rules
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
