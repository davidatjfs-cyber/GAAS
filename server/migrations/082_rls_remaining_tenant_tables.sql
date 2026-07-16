-- 剩余 tenant_id 业务表：空库中不存在的可选表跳过。sales_raw 已下线，禁止重新引用。
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ab_test_results','ab_test_tasks','agent_collaboration_logs','agent_optimization_history','anomaly_triggers','approval_requests','auto_ops_runs','automated_test_results','bad_reviews','bitable_submissions_archive','business_entity_relations','checkin_records','content_performance','customer_identities','daily_report_attendance_register','daily_reports','dish_library_costs','employee_attendance_records','employee_training_records','employees','entity_health_snapshot','exam_results','feishu_generic_records','feishu_pending_pllm_decisions','feishu_pending_replies','generated_posters','hrms_leave_balance_overrides','hrms_leave_domain','hrms_leave_records','hrms_payroll_domain','hrms_payroll_history','master_events','master_tasks','point_records','pos_order_items','pos_orders','public_promo_tasks','sales_growth_snapshot','store_duty_bindings','store_ratings','store_wecom_configs','stores','strategy_experiments','strategy_rules','strategy_variants','table_visit_records','training_assignments','training_certifications','training_plan_phases','training_plans','training_sessions','training_topics','user_reads','user_sessions','users'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',t);
    END IF;
  END LOOP;
END $$;
