-- growth_* 唯一约束补 tenant_id。全部为可选增长模块表：存在且列结构可用时迁移，空库缺失时跳过。
DO $$
DECLARE x JSONB; t TEXT; c TEXT; cols TEXT;
BEGIN
  FOR x IN SELECT value FROM jsonb_array_elements('[
    ["growth_actions","growth_actions_action_key_key","action_key"], ["growth_alerts","growth_alerts_alert_key_key","alert_key"], ["growth_campaign_plans","growth_campaign_plans_plan_id_key","plan_id"], ["growth_campaigns","growth_campaigns_campaign_id_key","campaign_id"], ["growth_churn_predictions","growth_churn_predictions_prediction_date_store_code_custome_key","prediction_date,store_code,customer_id"], ["growth_content_calendar","growth_content_calendar_item_id_key","item_id"], ["growth_content_suggestions","growth_content_suggestions_suggestion_key_key","suggestion_key"], ["growth_coupons","growth_coupons_coupon_id_key","coupon_id"], ["growth_customer_profiles","growth_customer_profiles_customer_id_key","customer_id"], ["growth_daily_metrics","growth_daily_metrics_metric_date_store_id_campaign_id_chann_key","metric_date,store_id,campaign_id,channel"], ["growth_delivery_logs","growth_delivery_logs_delivery_key_key","delivery_key"], ["growth_events","growth_events_idempotency_key_key","idempotency_key"], ["growth_menu_health_reports","growth_menu_health_reports_report_month_store_code_key","report_month,store_code"], ["growth_redemptions","growth_redemptions_coupon_id_redeemed_at_key","coupon_id,redeemed_at"], ["growth_strategy_evaluations","growth_strategy_evaluations_strategy_key_key","strategy_key"], ["growth_touch_rules","growth_touch_rules_rule_key_key","rule_key"]
  ]'::jsonb) LOOP
    t := x->>0; c := x->>1; cols := x->>2;
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, c);
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%s, tenant_id)', t, c, cols);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['growth_customers','growth_learnings'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      IF t = 'growth_customers' THEN
        DROP INDEX IF EXISTS uq_growth_customers_phone;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_customers_phone ON growth_customers(phone, tenant_id) WHERE phone IS NOT NULL AND phone <> '';
        DROP INDEX IF EXISTS uq_growth_customers_openid;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_customers_openid ON growth_customers(openid, tenant_id) WHERE openid IS NOT NULL AND openid <> '';
      ELSE
        DROP INDEX IF EXISTS uq_growth_learnings_source;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_learnings_source ON growth_learnings(source_type, source_id, tenant_id) WHERE source_id IS NOT NULL AND source_id <> '';
      END IF;
    END IF;
  END LOOP;
  IF to_regclass('public.growth_holdout_members') IS NOT NULL THEN
    ALTER TABLE growth_holdout_members DROP CONSTRAINT IF EXISTS growth_holdout_members_pkey;
    ALTER TABLE growth_holdout_members ADD CONSTRAINT growth_holdout_members_pkey PRIMARY KEY (phone, campaign_key, tenant_id);
  END IF;
  IF to_regclass('public.growth_segment_members') IS NOT NULL THEN
    ALTER TABLE growth_segment_members DROP CONSTRAINT IF EXISTS growth_segment_members_pkey;
    ALTER TABLE growth_segment_members ADD CONSTRAINT growth_segment_members_pkey PRIMARY KEY (phone, segment_key, tenant_id);
  END IF;
  IF to_regclass('public.growth_sms_suppression') IS NOT NULL THEN
    ALTER TABLE growth_sms_suppression DROP CONSTRAINT IF EXISTS growth_sms_suppression_pkey;
    ALTER TABLE growth_sms_suppression ADD CONSTRAINT growth_sms_suppression_pkey PRIMARY KEY (phone, tenant_id);
  END IF;
  IF to_regclass('public.growth_stored_value_members') IS NOT NULL THEN
    ALTER TABLE growth_stored_value_members DROP CONSTRAINT IF EXISTS growth_stored_value_members_pkey;
    ALTER TABLE growth_stored_value_members ADD CONSTRAINT growth_stored_value_members_pkey PRIMARY KEY (card_no, tenant_id);
  END IF;
END $$;
