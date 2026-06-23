-- RLS Phase5 全量收尾批 1：剩余共享库唯一约束 / 冲突键补 tenant_id
-- 目标：把 hosted rental 共享数据库里的“天然主键 / 去重键 / ON CONFLICT 目标”全部改成 tenant-aware，
-- 避免不同公司的数据互相顶掉、吞掉、误更新。

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pkey;
ALTER TABLE employees ADD CONSTRAINT employees_pkey PRIMARY KEY (username, tenant_id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username, tenant_id);

ALTER TABLE user_sessions DROP CONSTRAINT IF EXISTS user_sessions_pkey;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (username, tenant_id);

ALTER TABLE user_reads DROP CONSTRAINT IF EXISTS user_reads_pkey;
ALTER TABLE user_reads ADD CONSTRAINT user_reads_pkey PRIMARY KEY (username, module, item_key, tenant_id);

ALTER TABLE feishu_pending_replies DROP CONSTRAINT IF EXISTS feishu_pending_replies_pkey;
ALTER TABLE feishu_pending_replies ADD CONSTRAINT feishu_pending_replies_pkey PRIMARY KEY (open_id, tenant_id);

ALTER TABLE feishu_pending_pllm_decisions DROP CONSTRAINT IF EXISTS feishu_pending_pllm_decisions_pkey;
ALTER TABLE feishu_pending_pllm_decisions ADD CONSTRAINT feishu_pending_pllm_decisions_pkey PRIMARY KEY (open_id, tenant_id);

ALTER TABLE agent_v2_data_alert_dedupe DROP CONSTRAINT IF EXISTS agent_v2_data_alert_dedupe_pkey;
ALTER TABLE agent_v2_data_alert_dedupe ADD CONSTRAINT agent_v2_data_alert_dedupe_pkey PRIMARY KEY (dedupe_key, tenant_id);

ALTER TABLE agent_v2_morning_briefing_sends DROP CONSTRAINT IF EXISTS agent_v2_morning_briefing_sends_run_ymd_username_scope_key;
ALTER TABLE agent_v2_morning_briefing_sends ADD CONSTRAINT agent_v2_morning_briefing_sends_run_ymd_username_scope_key UNIQUE (run_ymd, username, scope, tenant_id);

ALTER TABLE agent_v2_scheduled_report_sends DROP CONSTRAINT IF EXISTS agent_v2_scheduled_report_sen_job_key_run_ymd_username_scop_key;
ALTER TABLE agent_v2_scheduled_report_sends ADD CONSTRAINT agent_v2_scheduled_report_sen_job_key_run_ymd_username_scop_key UNIQUE (job_key, run_ymd, username, scope, tenant_id);

ALTER TABLE customer_identities DROP CONSTRAINT IF EXISTS customer_identities_identity_type_identity_value_key;
ALTER TABLE customer_identities ADD CONSTRAINT customer_identities_identity_type_identity_value_key UNIQUE (identity_type, identity_value, tenant_id);

ALTER TABLE daily_report_attendance_register DROP CONSTRAINT IF EXISTS daily_report_attendance_register_store_report_date_key;
ALTER TABLE daily_report_attendance_register ADD CONSTRAINT daily_report_attendance_register_store_report_date_key UNIQUE (store, report_date, tenant_id);

ALTER TABLE daily_reports DROP CONSTRAINT IF EXISTS daily_reports_store_date_key;
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_store_date_key UNIQUE (store, date, tenant_id);

ALTER TABLE dish_library_costs DROP CONSTRAINT IF EXISTS uq_dish_library_costs_brand_biz_dish;
ALTER TABLE dish_library_costs ADD CONSTRAINT uq_dish_library_costs_brand_biz_dish UNIQUE (brand, biz_type, dish_name, tenant_id);

ALTER TABLE feishu_generic_records DROP CONSTRAINT IF EXISTS feishu_generic_records_app_token_table_id_record_id_key;
ALTER TABLE feishu_generic_records ADD CONSTRAINT feishu_generic_records_app_token_table_id_record_id_key UNIQUE (app_token, table_id, record_id, tenant_id);

ALTER TABLE generated_posters DROP CONSTRAINT IF EXISTS generated_posters_poster_key_key;
ALTER TABLE generated_posters ADD CONSTRAINT generated_posters_poster_key_key UNIQUE (poster_key, tenant_id);

ALTER TABLE hrms_leave_balance_overrides DROP CONSTRAINT IF EXISTS hrms_leave_balance_overrides_username_month_key;
ALTER TABLE hrms_leave_balance_overrides ADD CONSTRAINT hrms_leave_balance_overrides_username_month_key UNIQUE (username, month, tenant_id);

ALTER TABLE hrms_payroll_history DROP CONSTRAINT IF EXISTS hrms_payroll_history_idempotency_key_key;
ALTER TABLE hrms_payroll_history ADD CONSTRAINT hrms_payroll_history_idempotency_key_key UNIQUE (idempotency_key, tenant_id);

ALTER TABLE master_tasks ADD CONSTRAINT master_tasks_task_id_tenant_id_key UNIQUE (task_id, tenant_id);

DROP INDEX IF EXISTS idx_pos_orders_no;
CREATE UNIQUE INDEX idx_pos_orders_no ON pos_orders (order_no, tenant_id);

DROP INDEX IF EXISTS idx_pos_items_dedupe;
CREATE UNIQUE INDEX idx_pos_items_dedupe ON pos_order_items (
  order_no,
  biz_date,
  store_code,
  COALESCE(sku, ''),
  COALESCE(dish_name, ''),
  COALESCE(spec, ''),
  COALESCE(tags, ''),
  unit_price,
  qty,
  COALESCE(unit, ''),
  amount_before_discount,
  service_fee,
  discount,
  amount_after_discount,
  COALESCE(category_mid, ''),
  COALESCE(category, ''),
  tenant_id
);

ALTER TABLE public_promo_tasks DROP CONSTRAINT IF EXISTS public_promo_tasks_task_key_key;
ALTER TABLE public_promo_tasks ADD CONSTRAINT public_promo_tasks_task_key_key UNIQUE (task_key, tenant_id);

ALTER TABLE sales_growth_snapshot DROP CONSTRAINT IF EXISTS sales_growth_snapshot_snapshot_date_store_code_dish_name_key;
ALTER TABLE sales_growth_snapshot ADD CONSTRAINT sales_growth_snapshot_snapshot_date_store_code_dish_name_key UNIQUE (snapshot_date, store_code, dish_name, tenant_id);

ALTER TABLE store_duty_bindings DROP CONSTRAINT IF EXISTS store_duty_bindings_username_store_key;
ALTER TABLE store_duty_bindings ADD CONSTRAINT store_duty_bindings_username_store_key UNIQUE (username, store, tenant_id);

ALTER TABLE store_ratings DROP CONSTRAINT IF EXISTS store_ratings_store_brand_period_key;
ALTER TABLE store_ratings ADD CONSTRAINT store_ratings_store_brand_period_key UNIQUE (store, brand, period, tenant_id);

ALTER TABLE store_wecom_configs DROP CONSTRAINT IF EXISTS store_wecom_configs_store_id_key;
ALTER TABLE store_wecom_configs ADD CONSTRAINT store_wecom_configs_store_id_key UNIQUE (store_id, tenant_id);

ALTER TABLE strategy_experiments DROP CONSTRAINT IF EXISTS strategy_experiments_experiment_code_key;
ALTER TABLE strategy_experiments ADD CONSTRAINT strategy_experiments_experiment_code_key UNIQUE (experiment_code, tenant_id);

ALTER TABLE strategy_rules DROP CONSTRAINT IF EXISTS strategy_rules_scenario_root_unique;
ALTER TABLE strategy_rules ADD CONSTRAINT strategy_rules_scenario_root_unique UNIQUE (scenario, root_cause, tenant_id);

DROP INDEX IF EXISTS strategy_rules_scenario_root_variant_unique;
CREATE UNIQUE INDEX strategy_rules_scenario_root_variant_unique
  ON strategy_rules (scenario, root_cause, variant_label, tenant_id);

ALTER TABLE table_visit_records DROP CONSTRAINT IF EXISTS table_visit_records_feishu_record_id_key;
ALTER TABLE table_visit_records ADD CONSTRAINT table_visit_records_feishu_record_id_key UNIQUE (feishu_record_id, tenant_id);

ALTER TABLE training_sessions DROP CONSTRAINT IF EXISTS training_sessions_employee_username_topic_id_key;
ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_employee_username_topic_id_key UNIQUE (employee_username, topic_id, tenant_id);
