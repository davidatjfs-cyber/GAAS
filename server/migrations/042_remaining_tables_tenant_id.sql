-- 模式2批5: 剩余165张表统一加 tenant_id 列，纯加列+默认值，零行为风险。
-- 查询层过滤将在后续按表/模块分批跟进（见任务清单）。
ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_ab_test_results_tenant ON ab_test_results(tenant_id);

ALTER TABLE acceptance_checklists ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_acceptance_checklists_tenant ON acceptance_checklists(tenant_id);

ALTER TABLE action_plans ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_action_plans_tenant ON action_plans(tenant_id);

ALTER TABLE agent_admin_alert_log ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_admin_alert_log_tenant ON agent_admin_alert_log(tenant_id);

ALTER TABLE agent_appeals ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_appeals_tenant ON agent_appeals(tenant_id);

ALTER TABLE agent_autonomous_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_autonomous_logs_tenant ON agent_autonomous_logs(tenant_id);

ALTER TABLE agent_autonomous_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_autonomous_tasks_tenant ON agent_autonomous_tasks(tenant_id);

ALTER TABLE agent_collaboration_archives ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_collaboration_archives_tenant ON agent_collaboration_archives(tenant_id);

ALTER TABLE agent_collaboration_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_collaboration_logs_tenant ON agent_collaboration_logs(tenant_id);

ALTER TABLE agent_configs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_configs_tenant ON agent_configs(tenant_id);

ALTER TABLE agent_eval_runs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_eval_runs_tenant ON agent_eval_runs(tenant_id);

ALTER TABLE agent_experience ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_experience_tenant ON agent_experience(tenant_id);

ALTER TABLE agent_issues ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_issues_tenant ON agent_issues(tenant_id);

ALTER TABLE agent_issues_reports ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_issues_reports_tenant ON agent_issues_reports(tenant_id);

ALTER TABLE agent_long_memory ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_long_memory_tenant ON agent_long_memory(tenant_id);

ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant ON agent_memory(tenant_id);

ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_messages_tenant ON agent_messages(tenant_id);

ALTER TABLE agent_metric_cache ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_metric_cache_tenant ON agent_metric_cache(tenant_id);

ALTER TABLE agent_notifications ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_notifications_tenant ON agent_notifications(tenant_id);

ALTER TABLE agent_optimization_history ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_optimization_history_tenant ON agent_optimization_history(tenant_id);

ALTER TABLE agent_prompt_templates ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_prompt_templates_tenant ON agent_prompt_templates(tenant_id);

ALTER TABLE agent_quality_audits ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_quality_audits_tenant ON agent_quality_audits(tenant_id);

ALTER TABLE agent_reply_templates ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_reply_templates_tenant ON agent_reply_templates(tenant_id);

ALTER TABLE agent_rules ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_rules_tenant ON agent_rules(tenant_id);

ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_scores_tenant ON agent_scores(tenant_id);

ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant ON agent_sessions(tenant_id);

ALTER TABLE agent_task_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_task_logs_tenant ON agent_task_logs(tenant_id);

ALTER TABLE agent_v2_configs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_configs_tenant ON agent_v2_configs(tenant_id);

ALTER TABLE agent_v2_cron_runs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_cron_runs_tenant ON agent_v2_cron_runs(tenant_id);

ALTER TABLE agent_v2_data_alert_dedupe ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_data_alert_dedupe_tenant ON agent_v2_data_alert_dedupe(tenant_id);

ALTER TABLE agent_v2_morning_briefing_sends ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_morning_briefing_sends_tenant ON agent_v2_morning_briefing_sends(tenant_id);

ALTER TABLE agent_v2_pllm_monthly_report_log ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_pllm_monthly_report_log_tenant ON agent_v2_pllm_monthly_report_log(tenant_id);

ALTER TABLE agent_v2_scheduled_report_sends ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_v2_scheduled_report_sends_tenant ON agent_v2_scheduled_report_sends(tenant_id);

ALTER TABLE agent_visual_audits ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_agent_visual_audits_tenant ON agent_visual_audits(tenant_id);

ALTER TABLE analysis_rules ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_analysis_rules_tenant ON analysis_rules(tenant_id);

ALTER TABLE analysis_sop ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_analysis_sop_tenant ON analysis_sop(tenant_id);

ALTER TABLE anomaly_pending_notifications ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_anomaly_pending_notifications_tenant ON anomaly_pending_notifications(tenant_id);

ALTER TABLE anomaly_triggers ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_anomaly_triggers_tenant ON anomaly_triggers(tenant_id);

ALTER TABLE attention_scores ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_attention_scores_tenant ON attention_scores(tenant_id);

ALTER TABLE auto_ops_runs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_auto_ops_runs_tenant ON auto_ops_runs(tenant_id);

ALTER TABLE automated_test_results ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_automated_test_results_tenant ON automated_test_results(tenant_id);

ALTER TABLE bad_reviews ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_bad_reviews_tenant ON bad_reviews(tenant_id);

ALTER TABLE bitable_submissions_archive ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_bitable_submissions_archive_tenant ON bitable_submissions_archive(tenant_id);

ALTER TABLE brand_voice_samples ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_brand_voice_samples_tenant ON brand_voice_samples(tenant_id);

ALTER TABLE business_entity_relations ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_business_entity_relations_tenant ON business_entity_relations(tenant_id);

ALTER TABLE checkin_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_checkin_records_tenant ON checkin_records(tenant_id);

ALTER TABLE cn_holiday_calendar ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_cn_holiday_calendar_tenant ON cn_holiday_calendar(tenant_id);

ALTER TABLE config_audit_log ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_config_audit_log_tenant ON config_audit_log(tenant_id);

ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_content_performance_tenant ON content_performance(tenant_id);

ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_creative_assets_tenant ON creative_assets(tenant_id);

ALTER TABLE customer_identities ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_customer_identities_tenant ON customer_identities(tenant_id);

ALTER TABLE daily_reports ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant ON daily_reports(tenant_id);

ALTER TABLE data_quality_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_data_quality_logs_tenant ON data_quality_logs(tenant_id);

ALTER TABLE decision_log ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_decision_log_tenant ON decision_log(tenant_id);

ALTER TABLE diagnosis_feedback ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_diagnosis_feedback_tenant ON diagnosis_feedback(tenant_id);

ALTER TABLE dish_library_costs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_dish_library_costs_tenant ON dish_library_costs(tenant_id);

ALTER TABLE dish_name_aliases ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_dish_name_aliases_tenant ON dish_name_aliases(tenant_id);

ALTER TABLE dish_station_mapping ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_dish_station_mapping_tenant ON dish_station_mapping(tenant_id);

ALTER TABLE employee_attachments ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_employee_attachments_tenant ON employee_attachments(tenant_id);

ALTER TABLE employee_scores ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_employee_scores_tenant ON employee_scores(tenant_id);

ALTER TABLE employee_training_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_employee_training_records_tenant ON employee_training_records(tenant_id);

ALTER TABLE employment_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_employment_records_tenant ON employment_records(tenant_id);

ALTER TABLE entity_health_snapshot ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_entity_health_snapshot_tenant ON entity_health_snapshot(tenant_id);

ALTER TABLE escalation_chains ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_escalation_chains_tenant ON escalation_chains(tenant_id);

ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_exam_results_tenant ON exam_results(tenant_id);

ALTER TABLE file_access_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_file_access_logs_tenant ON file_access_logs(tenant_id);

ALTER TABLE files ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_files_tenant ON files(tenant_id);

ALTER TABLE generated_posters ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_generated_posters_tenant ON generated_posters(tenant_id);

ALTER TABLE growth_alerts ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_alerts_tenant ON growth_alerts(tenant_id);

ALTER TABLE growth_campaign_jobs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_campaign_jobs_tenant ON growth_campaign_jobs(tenant_id);

ALTER TABLE growth_campaign_plans ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_campaign_plans_tenant ON growth_campaign_plans(tenant_id);

ALTER TABLE growth_campaigns ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_campaigns_tenant ON growth_campaigns(tenant_id);

ALTER TABLE growth_churn_predictions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_churn_predictions_tenant ON growth_churn_predictions(tenant_id);

ALTER TABLE growth_content_calendar ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_content_calendar_tenant ON growth_content_calendar(tenant_id);

ALTER TABLE growth_coupons ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_coupons_tenant ON growth_coupons(tenant_id);

ALTER TABLE growth_customer_profiles ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_customer_profiles_tenant ON growth_customer_profiles(tenant_id);

ALTER TABLE growth_customers ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_customers_tenant ON growth_customers(tenant_id);

ALTER TABLE growth_daily_metrics ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_daily_metrics_tenant ON growth_daily_metrics(tenant_id);

ALTER TABLE growth_delivery_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_delivery_logs_tenant ON growth_delivery_logs(tenant_id);

ALTER TABLE growth_events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_events_tenant ON growth_events(tenant_id);

ALTER TABLE growth_execution_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_execution_logs_tenant ON growth_execution_logs(tenant_id);

ALTER TABLE growth_holdout_members ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_holdout_members_tenant ON growth_holdout_members(tenant_id);

ALTER TABLE growth_learnings ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_learnings_tenant ON growth_learnings(tenant_id);

ALTER TABLE growth_menu_health_reports ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_menu_health_reports_tenant ON growth_menu_health_reports(tenant_id);

ALTER TABLE growth_profile_signals ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_profile_signals_tenant ON growth_profile_signals(tenant_id);

ALTER TABLE growth_redemptions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_redemptions_tenant ON growth_redemptions(tenant_id);

ALTER TABLE growth_segment_members ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_segment_members_tenant ON growth_segment_members(tenant_id);

ALTER TABLE growth_sms_suppression ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_sms_suppression_tenant ON growth_sms_suppression(tenant_id);

ALTER TABLE growth_stored_value_members ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_stored_value_members_tenant ON growth_stored_value_members(tenant_id);

ALTER TABLE growth_strategy_evaluations ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_strategy_evaluations_tenant ON growth_strategy_evaluations(tenant_id);

ALTER TABLE growth_strategy_explanations ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_strategy_explanations_tenant ON growth_strategy_explanations(tenant_id);

ALTER TABLE growth_sync_failures ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_sync_failures_tenant ON growth_sync_failures(tenant_id);

ALTER TABLE growth_touch_rules ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_growth_touch_rules_tenant ON growth_touch_rules(tenant_id);

ALTER TABLE hr_rating_configs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hr_rating_configs_tenant ON hr_rating_configs(tenant_id);

ALTER TABLE hrms_reward_punishment_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_reward_punishment_records_tenant ON hrms_reward_punishment_records(tenant_id);

ALTER TABLE hrms_user_notifications ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_hrms_user_notifications_tenant ON hrms_user_notifications(tenant_id);

ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_tenant ON idempotency_keys(tenant_id);

ALTER TABLE ingredient_categories ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_ingredient_categories_tenant ON ingredient_categories(tenant_id);

ALTER TABLE ingredient_library ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_ingredient_library_tenant ON ingredient_library(tenant_id);

ALTER TABLE kitchen_exec_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_kitchen_exec_logs_tenant ON kitchen_exec_logs(tenant_id);

ALTER TABLE kitchen_reports ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_kitchen_reports_tenant ON kitchen_reports(tenant_id);

ALTER TABLE kitchen_sop_steps ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_kitchen_sop_steps_tenant ON kitchen_sop_steps(tenant_id);

ALTER TABLE kitchen_step_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_kitchen_step_logs_tenant ON kitchen_step_logs(tenant_id);

ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tenant ON knowledge_base(tenant_id);

ALTER TABLE knowledge_edit_history ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_knowledge_edit_history_tenant ON knowledge_edit_history(tenant_id);

ALTER TABLE kpi_snapshots ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_tenant ON kpi_snapshots(tenant_id);

ALTER TABLE kpi_targets ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_kpi_targets_tenant ON kpi_targets(tenant_id);

ALTER TABLE margin_targets ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_margin_targets_tenant ON margin_targets(tenant_id);

ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant ON marketing_campaigns(tenant_id);

ALTER TABLE marketing_case_library ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_marketing_case_library_tenant ON marketing_case_library(tenant_id);

ALTER TABLE marketing_payment_rules ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_marketing_payment_rules_tenant ON marketing_payment_rules(tenant_id);

ALTER TABLE marketing_templates ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_marketing_templates_tenant ON marketing_templates(tenant_id);

ALTER TABLE master_events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_master_events_tenant ON master_events(tenant_id);

ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_master_tasks_tenant ON master_tasks(tenant_id);

ALTER TABLE material_receiving_reports ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_material_receiving_reports_tenant ON material_receiving_reports(tenant_id);

ALTER TABLE metric_dictionary ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_metric_dictionary_tenant ON metric_dictionary(tenant_id);

ALTER TABLE monthly_margins ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_monthly_margins_tenant ON monthly_margins(tenant_id);

ALTER TABLE ops_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_ops_tasks_tenant ON ops_tasks(tenant_id);

ALTER TABLE performance_invalidation_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_performance_invalidation_records_tenant ON performance_invalidation_records(tenant_id);

ALTER TABLE platform_data_cache ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_platform_data_cache_tenant ON platform_data_cache(tenant_id);

ALTER TABLE point_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_point_records_tenant ON point_records(tenant_id);

ALTER TABLE poster_templates ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_poster_templates_tenant ON poster_templates(tenant_id);

ALTER TABLE public_channels ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_public_channels_tenant ON public_channels(tenant_id);

ALTER TABLE public_promo_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_public_promo_tasks_tenant ON public_promo_tasks(tenant_id);

ALTER TABLE recipe_component_ingredients ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_recipe_component_ingredients_tenant ON recipe_component_ingredients(tenant_id);

ALTER TABLE recipe_component_steps ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_recipe_component_steps_tenant ON recipe_component_steps(tenant_id);

ALTER TABLE recipe_components ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_recipe_components_tenant ON recipe_components(tenant_id);

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_recipes_tenant ON recipes(tenant_id);

ALTER TABLE recurring_reward_templates ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_recurring_reward_templates_tenant ON recurring_reward_templates(tenant_id);

ALTER TABLE regression_check_results ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_regression_check_results_tenant ON regression_check_results(tenant_id);

ALTER TABLE revenue_targets ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_revenue_targets_tenant ON revenue_targets(tenant_id);

ALTER TABLE rhythm_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_rhythm_logs_tenant ON rhythm_logs(tenant_id);

ALTER TABLE sales_growth_snapshot ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sales_growth_snapshot_tenant ON sales_growth_snapshot(tenant_id);

ALTER TABLE scheduler_heartbeat ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_scheduler_heartbeat_tenant ON scheduler_heartbeat(tenant_id);

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id);

ALTER TABLE sop_cases ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sop_cases_tenant ON sop_cases(tenant_id);

ALTER TABLE sop_definitions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sop_definitions_tenant ON sop_definitions(tenant_id);

ALTER TABLE sop_distributions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sop_distributions_tenant ON sop_distributions(tenant_id);

ALTER TABLE sop_questions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sop_questions_tenant ON sop_questions(tenant_id);

ALTER TABLE sop_quiz_questions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sop_quiz_questions_tenant ON sop_quiz_questions(tenant_id);

ALTER TABLE sop_steps ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sop_steps_tenant ON sop_steps(tenant_id);

ALTER TABLE sop_versions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_sop_versions_tenant ON sop_versions(tenant_id);

ALTER TABLE store_duty_bindings ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_duty_bindings_tenant ON store_duty_bindings(tenant_id);

ALTER TABLE store_marketing_constraints ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_marketing_constraints_tenant ON store_marketing_constraints(tenant_id);

ALTER TABLE store_marketing_profiles ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_marketing_profiles_tenant ON store_marketing_profiles(tenant_id);

ALTER TABLE store_meeting_reports ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_meeting_reports_tenant ON store_meeting_reports(tenant_id);

ALTER TABLE store_ratings ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_ratings_tenant ON store_ratings(tenant_id);

ALTER TABLE stores ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_stores_tenant ON stores(tenant_id);

ALTER TABLE strategy_rules ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_strategy_rules_tenant ON strategy_rules(tenant_id);

ALTER TABLE strategy_variants ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_strategy_variants_tenant ON strategy_variants(tenant_id);

ALTER TABLE table_visit_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_table_visit_records_tenant ON table_visit_records(tenant_id);

ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_task_assignments_tenant ON task_assignments(tenant_id);

ALTER TABLE task_evidences ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_task_evidences_tenant ON task_evidences(tenant_id);

ALTER TABLE task_experience_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_task_experience_logs_tenant ON task_experience_logs(tenant_id);

ALTER TABLE task_locks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_task_locks_tenant ON task_locks(tenant_id);

ALTER TABLE task_reviews ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_task_reviews_tenant ON task_reviews(tenant_id);

ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_task_runs_tenant ON task_runs(tenant_id);

ALTER TABLE temp_staffing_requests ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_temp_staffing_requests_tenant ON temp_staffing_requests(tenant_id);

ALTER TABLE training_plan_phases ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_training_plan_phases_tenant ON training_plan_phases(tenant_id);

ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_training_plans_tenant ON training_plans(tenant_id);

ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_training_sessions_tenant ON training_sessions(tenant_id);

ALTER TABLE training_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_training_tasks_tenant ON training_tasks(tenant_id);

ALTER TABLE user_login_log ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_user_login_log_tenant ON user_login_log(tenant_id);

ALTER TABLE user_reads ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_user_reads_tenant ON user_reads(tenant_id);

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_user_sessions_tenant ON user_sessions(tenant_id);

