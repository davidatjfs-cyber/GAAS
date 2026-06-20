-- 模式2批3: 飞书/企微相关表加 tenant_id，纯加列+默认值，零行为风险。
ALTER TABLE feishu_generic_records ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_generic_records_tenant ON feishu_generic_records(tenant_id);

ALTER TABLE feishu_pending_pllm_decisions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_pending_pllm_decisions_tenant ON feishu_pending_pllm_decisions(tenant_id);

ALTER TABLE feishu_pending_replies ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_pending_replies_tenant ON feishu_pending_replies(tenant_id);

ALTER TABLE feishu_sync_logs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_sync_logs_tenant ON feishu_sync_logs(tenant_id);

ALTER TABLE feishu_users ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_feishu_users_tenant ON feishu_users(tenant_id);

ALTER TABLE store_wecom_configs ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_store_wecom_configs_tenant ON store_wecom_configs(tenant_id);

ALTER TABLE wechat_work_customers ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS idx_wechat_work_customers_tenant ON wechat_work_customers(tenant_id);
