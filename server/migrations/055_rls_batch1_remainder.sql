-- RLS Phase5批1收尾。表由可选 Agent/增长模块或后续 baseline 创建；存在时开启，空库缺失时安全跳过。
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_autonomous_logs','config_audit_log','agent_v2_pllm_monthly_report_log','rhythm_logs','agent_v2_morning_briefing_sends','agent_v2_scheduled_report_sends','decision_log','user_login_log'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    END IF;
  END LOOP;
END $$;
