-- RLS Phase5全量推进第10批：3张表(由agents-service-v2写入)的唯一约束/PK补tenant_id
ALTER TABLE ops_tasks DROP CONSTRAINT IF EXISTS uq_ops_tasks_dedupe;
ALTER TABLE ops_tasks ADD CONSTRAINT uq_ops_tasks_dedupe UNIQUE (dedupe_key, tenant_id);

ALTER TABLE platform_data_cache DROP CONSTRAINT IF EXISTS platform_data_cache_platform_store_key;
ALTER TABLE platform_data_cache ADD CONSTRAINT platform_data_cache_platform_store_key UNIQUE (platform, store, tenant_id);

ALTER TABLE idempotency_keys DROP CONSTRAINT IF EXISTS idempotency_keys_pkey;
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key, tenant_id);
