-- growth_* RLS：仅对当前库中已存在且含 tenant_id 的可选增长表启用。
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'growth_actions','growth_alerts','growth_campaign_jobs','growth_campaign_plans',
    'growth_campaigns','growth_churn_predictions','growth_content_calendar',
    'growth_coupons','growth_customer_profiles','growth_customers','growth_daily_metrics',
    'growth_delivery_logs','growth_events','growth_execution_logs','growth_holdout_members',
    'growth_learnings','growth_menu_health_reports','growth_profile_signals','growth_redemptions',
    'growth_segment_members','growth_sms_suppression','growth_stored_value_members',
    'growth_strategy_evaluations','growth_strategy_explanations','growth_sync_failures','growth_touch_rules'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    END IF;
  END LOOP;
END $$;
