-- RLS Phase5全量推进第2批：4张表的唯一约束/索引不含tenant_id，同批修正
-- (data-executor.js / growth-api.js)，避免重演anomaly_triggers的ON CONFLICT报错。
ALTER TABLE agent_metric_cache DROP CONSTRAINT IF EXISTS agent_metric_cache_task_id_metric_id_time_range_store_key;
ALTER TABLE agent_metric_cache ADD CONSTRAINT agent_metric_cache_task_id_metric_id_time_range_store_key UNIQUE (task_id, metric_id, time_range, store, tenant_id);

ALTER TABLE store_marketing_profiles DROP CONSTRAINT IF EXISTS store_marketing_profiles_store_id_key;
ALTER TABLE store_marketing_profiles ADD CONSTRAINT store_marketing_profiles_store_id_key UNIQUE (store_id, tenant_id);

ALTER TABLE creative_assets DROP CONSTRAINT IF EXISTS creative_assets_asset_key_key;
ALTER TABLE creative_assets ADD CONSTRAINT creative_assets_asset_key_key UNIQUE (asset_key, tenant_id);

DROP INDEX IF EXISTS idx_ww_external_userid;
CREATE UNIQUE INDEX idx_ww_external_userid ON wechat_work_customers (external_userid, tenant_id) WHERE external_userid IS NOT NULL AND external_userid <> '';
