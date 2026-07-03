-- migration 075(growth_*表补tenant_id唯一约束)在demo服务器(8.153.95.62)上未被正确执行——
-- 2026-07-03排查发现demo的growth_customers.uq_growth_customers_phone仍是(phone)单列旧定义，
-- 与代码里的 ON CONFLICT (phone, tenant_id) 不匹配，导致每日自动建档POS客户静默失败(被catch吞掉)。
-- HRMS生产环境该索引本就是正确的(phone, tenant_id)，只有demo漏跑。
-- 内容与075完全一致(不是新逻辑)，重复登记只是为了让migrate.js按文件名顺序重放时能再收敛一次；
-- 全是DROP IF EXISTS + CREATE/ADD CONSTRAINT，对已经正确的环境(如HRMS)是空操作。


ALTER TABLE growth_actions DROP CONSTRAINT IF EXISTS growth_actions_action_key_key;
ALTER TABLE growth_actions ADD CONSTRAINT growth_actions_action_key_key UNIQUE (action_key, tenant_id);

ALTER TABLE growth_alerts DROP CONSTRAINT IF EXISTS growth_alerts_alert_key_key;
ALTER TABLE growth_alerts ADD CONSTRAINT growth_alerts_alert_key_key UNIQUE (alert_key, tenant_id);

ALTER TABLE growth_campaign_plans DROP CONSTRAINT IF EXISTS growth_campaign_plans_plan_id_key;
ALTER TABLE growth_campaign_plans ADD CONSTRAINT growth_campaign_plans_plan_id_key UNIQUE (plan_id, tenant_id);

ALTER TABLE growth_campaigns DROP CONSTRAINT IF EXISTS growth_campaigns_campaign_id_key;
ALTER TABLE growth_campaigns ADD CONSTRAINT growth_campaigns_campaign_id_key UNIQUE (campaign_id, tenant_id);

ALTER TABLE growth_churn_predictions DROP CONSTRAINT IF EXISTS growth_churn_predictions_prediction_date_store_code_custome_key;
ALTER TABLE growth_churn_predictions ADD CONSTRAINT growth_churn_predictions_prediction_date_store_code_custome_key UNIQUE (prediction_date, store_code, customer_id, tenant_id);

ALTER TABLE growth_content_calendar DROP CONSTRAINT IF EXISTS growth_content_calendar_item_id_key;
ALTER TABLE growth_content_calendar ADD CONSTRAINT growth_content_calendar_item_id_key UNIQUE (item_id, tenant_id);

ALTER TABLE growth_content_suggestions DROP CONSTRAINT IF EXISTS growth_content_suggestions_suggestion_key_key;
ALTER TABLE growth_content_suggestions ADD CONSTRAINT growth_content_suggestions_suggestion_key_key UNIQUE (suggestion_key, tenant_id);

ALTER TABLE growth_coupons DROP CONSTRAINT IF EXISTS growth_coupons_coupon_id_key;
ALTER TABLE growth_coupons ADD CONSTRAINT growth_coupons_coupon_id_key UNIQUE (coupon_id, tenant_id);

ALTER TABLE growth_customer_profiles DROP CONSTRAINT IF EXISTS growth_customer_profiles_customer_id_key;
ALTER TABLE growth_customer_profiles ADD CONSTRAINT growth_customer_profiles_customer_id_key UNIQUE (customer_id, tenant_id);

-- growth_customers: phone/openid为部分唯一索引(允许多行NULL/空串)，FK只指向id主键，加tenant_id不影响FK
DROP INDEX IF EXISTS uq_growth_customers_phone;
CREATE UNIQUE INDEX uq_growth_customers_phone ON growth_customers (phone, tenant_id) WHERE (phone IS NOT NULL AND phone <> '');

DROP INDEX IF EXISTS uq_growth_customers_openid;
CREATE UNIQUE INDEX uq_growth_customers_openid ON growth_customers (openid, tenant_id) WHERE (openid IS NOT NULL AND openid <> '');

ALTER TABLE growth_daily_metrics DROP CONSTRAINT IF EXISTS growth_daily_metrics_metric_date_store_id_campaign_id_chann_key;
ALTER TABLE growth_daily_metrics ADD CONSTRAINT growth_daily_metrics_metric_date_store_id_campaign_id_chann_key UNIQUE (metric_date, store_id, campaign_id, channel, tenant_id);

ALTER TABLE growth_delivery_logs DROP CONSTRAINT IF EXISTS growth_delivery_logs_delivery_key_key;
ALTER TABLE growth_delivery_logs ADD CONSTRAINT growth_delivery_logs_delivery_key_key UNIQUE (delivery_key, tenant_id);

ALTER TABLE growth_events DROP CONSTRAINT IF EXISTS growth_events_idempotency_key_key;
ALTER TABLE growth_events ADD CONSTRAINT growth_events_idempotency_key_key UNIQUE (idempotency_key, tenant_id);

-- growth_holdout_members: 主键即(phone, campaign_key)，无表引用其FK，可安全重建为含tenant_id
ALTER TABLE growth_holdout_members DROP CONSTRAINT IF EXISTS growth_holdout_members_pkey;
ALTER TABLE growth_holdout_members ADD CONSTRAINT growth_holdout_members_pkey PRIMARY KEY (phone, campaign_key, tenant_id);

-- growth_learnings: source_id部分唯一索引(允许NULL/空串重复)
DROP INDEX IF EXISTS uq_growth_learnings_source;
CREATE UNIQUE INDEX uq_growth_learnings_source ON growth_learnings (source_type, source_id, tenant_id) WHERE (source_id IS NOT NULL AND source_id <> '');

ALTER TABLE growth_menu_health_reports DROP CONSTRAINT IF EXISTS growth_menu_health_reports_report_month_store_code_key;
ALTER TABLE growth_menu_health_reports ADD CONSTRAINT growth_menu_health_reports_report_month_store_code_key UNIQUE (report_month, store_code, tenant_id);

ALTER TABLE growth_redemptions DROP CONSTRAINT IF EXISTS growth_redemptions_coupon_id_redeemed_at_key;
ALTER TABLE growth_redemptions ADD CONSTRAINT growth_redemptions_coupon_id_redeemed_at_key UNIQUE (coupon_id, redeemed_at, tenant_id);

-- growth_segment_members: 主键即(phone, segment_key)，无表引用其FK
ALTER TABLE growth_segment_members DROP CONSTRAINT IF EXISTS growth_segment_members_pkey;
ALTER TABLE growth_segment_members ADD CONSTRAINT growth_segment_members_pkey PRIMARY KEY (phone, segment_key, tenant_id);

-- growth_sms_suppression: 主键即phone，无表引用其FK
ALTER TABLE growth_sms_suppression DROP CONSTRAINT IF EXISTS growth_sms_suppression_pkey;
ALTER TABLE growth_sms_suppression ADD CONSTRAINT growth_sms_suppression_pkey PRIMARY KEY (phone, tenant_id);

-- growth_stored_value_members: 主键即card_no，无表引用其FK
ALTER TABLE growth_stored_value_members DROP CONSTRAINT IF EXISTS growth_stored_value_members_pkey;
ALTER TABLE growth_stored_value_members ADD CONSTRAINT growth_stored_value_members_pkey PRIMARY KEY (card_no, tenant_id);

ALTER TABLE growth_strategy_evaluations DROP CONSTRAINT IF EXISTS growth_strategy_evaluations_strategy_key_key;
ALTER TABLE growth_strategy_evaluations ADD CONSTRAINT growth_strategy_evaluations_strategy_key_key UNIQUE (strategy_key, tenant_id);

ALTER TABLE growth_touch_rules DROP CONSTRAINT IF EXISTS growth_touch_rules_rule_key_key;
ALTER TABLE growth_touch_rules ADD CONSTRAINT growth_touch_rules_rule_key_key UNIQUE (rule_key, tenant_id);
