-- RLS Phase5 全量收尾批 2：生产库剩余 tenant_id 表补齐 RLS
-- 注意：tenants / licenses / agent_v2_configs / analysis_rules / analysis_sop / cn_holiday_calendar
-- 属于系统注册表或全局共享参考数据，不在本批普通业务 RLS 范围内。

ALTER TABLE ab_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ab_test_results;
CREATE POLICY tenant_isolation ON ab_test_results
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE ab_test_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ab_test_tasks;
CREATE POLICY tenant_isolation ON ab_test_tasks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_collaboration_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_collaboration_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_collaboration_logs;
CREATE POLICY tenant_isolation ON agent_collaboration_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_optimization_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_optimization_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_optimization_history;
CREATE POLICY tenant_isolation ON agent_optimization_history
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE anomaly_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_triggers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON anomaly_triggers;
CREATE POLICY tenant_isolation ON anomaly_triggers
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON approval_requests;
CREATE POLICY tenant_isolation ON approval_requests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE auto_ops_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_ops_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON auto_ops_runs;
CREATE POLICY tenant_isolation ON auto_ops_runs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE automated_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE automated_test_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON automated_test_results;
CREATE POLICY tenant_isolation ON automated_test_results
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE bad_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE bad_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bad_reviews;
CREATE POLICY tenant_isolation ON bad_reviews
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE bitable_submissions_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitable_submissions_archive FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bitable_submissions_archive;
CREATE POLICY tenant_isolation ON bitable_submissions_archive
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE business_entity_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_entity_relations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_entity_relations;
CREATE POLICY tenant_isolation ON business_entity_relations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE checkin_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON checkin_records;
CREATE POLICY tenant_isolation ON checkin_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE content_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_performance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON content_performance;
CREATE POLICY tenant_isolation ON content_performance
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_identities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customer_identities;
CREATE POLICY tenant_isolation ON customer_identities
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE daily_report_attendance_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_report_attendance_register FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON daily_report_attendance_register;
CREATE POLICY tenant_isolation ON daily_report_attendance_register
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON daily_reports;
CREATE POLICY tenant_isolation ON daily_reports
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE dish_library_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_library_costs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dish_library_costs;
CREATE POLICY tenant_isolation ON dish_library_costs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE employee_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_attendance_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_attendance_records;
CREATE POLICY tenant_isolation ON employee_attendance_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE employee_training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_training_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employee_training_records;
CREATE POLICY tenant_isolation ON employee_training_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON employees;
CREATE POLICY tenant_isolation ON employees
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE entity_health_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_health_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON entity_health_snapshot;
CREATE POLICY tenant_isolation ON entity_health_snapshot
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exam_results;
CREATE POLICY tenant_isolation ON exam_results
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE feishu_generic_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE feishu_generic_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON feishu_generic_records;
CREATE POLICY tenant_isolation ON feishu_generic_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE feishu_pending_pllm_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feishu_pending_pllm_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON feishu_pending_pllm_decisions;
CREATE POLICY tenant_isolation ON feishu_pending_pllm_decisions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE feishu_pending_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE feishu_pending_replies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON feishu_pending_replies;
CREATE POLICY tenant_isolation ON feishu_pending_replies
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE generated_posters ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_posters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON generated_posters;
CREATE POLICY tenant_isolation ON generated_posters
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hrms_leave_balance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_leave_balance_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms_leave_balance_overrides;
CREATE POLICY tenant_isolation ON hrms_leave_balance_overrides
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hrms_leave_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_leave_domain FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms_leave_domain;
CREATE POLICY tenant_isolation ON hrms_leave_domain
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hrms_leave_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_leave_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms_leave_records;
CREATE POLICY tenant_isolation ON hrms_leave_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hrms_payroll_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_payroll_domain FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms_payroll_domain;
CREATE POLICY tenant_isolation ON hrms_payroll_domain
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hrms_payroll_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_payroll_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hrms_payroll_history;
CREATE POLICY tenant_isolation ON hrms_payroll_history
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE master_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON master_events;
CREATE POLICY tenant_isolation ON master_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE master_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON master_tasks;
CREATE POLICY tenant_isolation ON master_tasks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE point_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON point_records;
CREATE POLICY tenant_isolation ON point_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pos_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_order_items;
CREATE POLICY tenant_isolation ON pos_order_items
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE pos_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_orders;
CREATE POLICY tenant_isolation ON pos_orders
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE public_promo_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_promo_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public_promo_tasks;
CREATE POLICY tenant_isolation ON public_promo_tasks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sales_growth_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_growth_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_growth_snapshot;
CREATE POLICY tenant_isolation ON sales_growth_snapshot
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sales_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_raw FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_raw;
CREATE POLICY tenant_isolation ON sales_raw
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE store_duty_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_duty_bindings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON store_duty_bindings;
CREATE POLICY tenant_isolation ON store_duty_bindings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE store_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_ratings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON store_ratings;
CREATE POLICY tenant_isolation ON store_ratings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE store_wecom_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_wecom_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON store_wecom_configs;
CREATE POLICY tenant_isolation ON store_wecom_configs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stores;
CREATE POLICY tenant_isolation ON stores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE strategy_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_experiments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON strategy_experiments;
CREATE POLICY tenant_isolation ON strategy_experiments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE strategy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON strategy_rules;
CREATE POLICY tenant_isolation ON strategy_rules
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE strategy_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_variants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON strategy_variants;
CREATE POLICY tenant_isolation ON strategy_variants
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE table_visit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_visit_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON table_visit_records;
CREATE POLICY tenant_isolation ON table_visit_records
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE training_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training_assignments;
CREATE POLICY tenant_isolation ON training_assignments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE training_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_certifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training_certifications;
CREATE POLICY tenant_isolation ON training_certifications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE training_plan_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_plan_phases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training_plan_phases;
CREATE POLICY tenant_isolation ON training_plan_phases
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE training_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training_plans;
CREATE POLICY tenant_isolation ON training_plans
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training_sessions;
CREATE POLICY tenant_isolation ON training_sessions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE training_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_topics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON training_topics;
CREATE POLICY tenant_isolation ON training_topics
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE user_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_reads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_reads;
CREATE POLICY tenant_isolation ON user_reads
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_sessions;
CREATE POLICY tenant_isolation ON user_sessions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
