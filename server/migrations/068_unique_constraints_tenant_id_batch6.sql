-- RLS Phase5全量推进第7批：4张表的唯一约束补tenant_id
DO $$
BEGIN
  IF to_regclass('public.monthly_margins') IS NOT NULL THEN
    ALTER TABLE monthly_margins DROP CONSTRAINT IF EXISTS monthly_margins_store_brand_period_key;
    ALTER TABLE monthly_margins ADD CONSTRAINT monthly_margins_store_brand_period_key UNIQUE (store, brand, period, tenant_id);
  END IF;
  IF to_regclass('public.growth_content_suggestions') IS NOT NULL THEN
    ALTER TABLE growth_content_suggestions DROP CONSTRAINT IF EXISTS growth_content_suggestions_suggestion_key_key;
    ALTER TABLE growth_content_suggestions ADD CONSTRAINT growth_content_suggestions_suggestion_key_key UNIQUE (suggestion_key, tenant_id);
  END IF;
  IF to_regclass('public.employee_scores') IS NOT NULL THEN
    ALTER TABLE employee_scores DROP CONSTRAINT IF EXISTS employee_scores_store_username_role_period_key;
    ALTER TABLE employee_scores ADD CONSTRAINT employee_scores_store_username_role_period_key UNIQUE (store, username, role, period, tenant_id);
  END IF;
  IF to_regclass('public.performance_invalidation_records') IS NOT NULL THEN
    ALTER TABLE performance_invalidation_records DROP CONSTRAINT IF EXISTS uq_invalidation_source;
    ALTER TABLE performance_invalidation_records ADD CONSTRAINT uq_invalidation_source UNIQUE (source_type, source_id, tenant_id);
  END IF;
END $$;
