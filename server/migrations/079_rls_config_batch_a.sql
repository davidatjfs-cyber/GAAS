-- 配置类表：仅对当前库中已存在且含 tenant_id 的表执行约束/RLS升级。
DO $$
DECLARE x JSONB; t TEXT; oldc TEXT; newc TEXT; cols TEXT;
BEGIN
  FOR x IN SELECT value FROM jsonb_array_elements('[
    ["agent_configs","agent_configs_agent_id_key","agent_configs_agent_id_tenant_key","agent_id"],
    ["agent_prompt_templates","agent_prompt_templates_template_key_key","agent_prompt_templates_template_key_tenant_key","template_key"],
    ["agent_reply_templates","agent_reply_templates_template_key_key","agent_reply_templates_template_key_tenant_key","template_key"],
    ["agent_rules","agent_rules_category_key","agent_rules_category_tenant_key","category"],
    ["hr_rating_configs","hr_rating_configs_config_key_key","hr_rating_configs_config_key_tenant_key","config_key"],
    ["margin_targets","margin_targets_store_brand_period_key","margin_targets_store_brand_period_tenant_key","store,brand,period"],
    ["revenue_targets","revenue_targets_store_brand_period_key","revenue_targets_store_brand_period_tenant_key","store,brand,period"],
    ["kpi_snapshots","kpi_snapshots_snapshot_date_store_key","kpi_snapshots_snapshot_date_store_tenant_key","snapshot_date,store"],
    ["store_marketing_constraints","store_marketing_constraints_store_id_key","store_marketing_constraints_store_id_tenant_key","store_id"],
    ["poster_templates","poster_templates_template_key_key","poster_templates_template_key_tenant_key","template_key"],
    ["marketing_case_library","marketing_case_library_case_key_key","marketing_case_library_case_key_tenant_key","case_key"],
    ["public_channels","public_channels_channel_key_key","public_channels_channel_key_tenant_key","channel_key"]
  ]'::jsonb) LOOP
    t:=x->>0; oldc:=x->>1; newc:=x->>2; cols:=x->>3;
    IF to_regclass('public.'||t) IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',t,oldc);
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%s, tenant_id)',t,newc,cols);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['agent_configs','agent_prompt_templates','agent_reply_templates','agent_rules','hr_rating_configs','metric_dictionary','margin_targets','revenue_targets','kpi_targets','kpi_snapshots','store_marketing_constraints','poster_templates','marketing_templates','marketing_case_library','public_channels','sop_cases'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',t);
    END IF;
  END LOOP;
END $$;
